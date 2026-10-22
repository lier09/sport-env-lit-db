-- Manual environment decisions overlay the immutable paper shards.
-- Run once as project owner. No corpus deletion or user-profile migration.
begin;
create table if not exists public.literature_env_reviews (
 paper_id text primary key check (paper_id ~ '^W[0-9]{1,20}$'),
 environments text[] not null default '{}',
 revision integer not null default 0 check (revision >= 0),
 updated_at timestamptz not null default now(),
 reviewer_id uuid not null,
 check (cardinality(environments) <= 7 and environments <@ array['低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境']::text[])
);
create table if not exists public.literature_env_review_history (
 id bigint generated always as identity primary key,
 paper_id text not null,
 previous_environments text[] not null,
 environments text[] not null,
 revision integer not null,
 reviewer_id uuid not null,
 reviewed_at timestamptz not null default now(),
 note text not null default '' check (length(note) <= 200)
);
create table if not exists public.literature_env_review_requests (
 request_id uuid primary key,
 reviewer_id uuid not null,
 payload jsonb not null,
 result jsonb,
 created_at timestamptz not null default now()
);
alter table public.literature_env_reviews enable row level security;
alter table public.literature_env_review_history enable row level security;
alter table public.literature_env_review_requests enable row level security;
revoke all on public.literature_env_reviews, public.literature_env_review_history, public.literature_env_review_requests from public,anon,authenticated;
grant select (paper_id,environments,revision,updated_at) on public.literature_env_reviews to anon,authenticated;
grant all on public.literature_env_reviews, public.literature_env_review_history, public.literature_env_review_requests to service_role;
grant usage, select on sequence public.literature_env_review_history_id_seq to service_role;
drop policy if exists environment_reviews_public_read on public.literature_env_reviews;
create policy environment_reviews_public_read on public.literature_env_reviews for select to anon,authenticated using (revision > 0);

create or replace function public.apply_literature_env_reviews(p_request_id uuid,p_actor uuid,p_changes jsonb,p_note text default '')
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare
 req public.literature_env_review_requests%rowtype;
 current_row public.literature_env_reviews%rowtype;
 change jsonb;
 paper text;
 expected integer;
 targets text[];
 previous text[];
 answer jsonb := '[]'::jsonb;
 canonical_payload jsonb;
begin
 if p_actor is null or p_request_id is null or p_changes is null or jsonb_typeof(p_changes) <> 'array'
    or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 200
    or length(coalesce(p_note,'')) > 200 then raise exception 'Invalid review batch' using errcode='22023'; end if;
 if (select count(distinct x->>'paper_id') from jsonb_array_elements(p_changes) x) <> jsonb_array_length(p_changes)
    then raise exception 'Duplicate paper IDs' using errcode='22023'; end if;
 canonical_payload := jsonb_build_object('changes',p_changes,'note',coalesce(p_note,''));
 insert into public.literature_env_review_requests(request_id,reviewer_id,payload)
 values(p_request_id,p_actor,canonical_payload) on conflict do nothing;
 select * into req from public.literature_env_review_requests where request_id=p_request_id for update;
 if req.reviewer_id <> p_actor or req.payload <> canonical_payload then raise exception 'Request ID reused with different content' using errcode='22023'; end if;
 if req.result is not null then return req.result; end if;
 -- Deterministic locking order prevents two overlapping batches deadlocking.
 for change in select value from jsonb_array_elements(p_changes) order by value->>'paper_id' loop
  paper := change->>'paper_id';
  if paper is null or paper !~ '^W[0-9]{1,20}$' or change->'environments' is null or change->'source_environments' is null or change->>'expected_revision' is null or jsonb_typeof(change->'environments') <> 'array'
     or jsonb_typeof(change->'source_environments') <> 'array'
     or (change->>'expected_revision') !~ '^[0-9]{1,9}$' then raise exception 'Invalid review change' using errcode='22023'; end if;
  expected := (change->>'expected_revision')::integer;
  select coalesce(array_agg(value),array[]::text[]) into targets from jsonb_array_elements_text(change->'environments');
  if cardinality(targets)>7 or not targets <@ array['低温','高氧','高温','高温高湿','交叉适应','高原低氧','其他环境']::text[]
     or (select count(distinct x) from unnest(targets) x) <> cardinality(targets)
     then raise exception 'Invalid environment' using errcode='22023'; end if;
  select coalesce(array_agg(value),array[]::text[]) into previous from jsonb_array_elements_text(change->'source_environments');
  if cardinality(previous)>20 or exists(select 1 from unnest(previous) x where length(x)>50) then raise exception 'Invalid source environments' using errcode='22023'; end if;
  insert into public.literature_env_reviews(paper_id,reviewer_id) values(paper,p_actor) on conflict do nothing;
  select * into current_row from public.literature_env_reviews where paper_id=paper for update;
  if current_row.revision <> expected then raise exception 'Review revision conflict' using errcode='40001'; end if;
  if current_row.revision>0 then previous:=current_row.environments; end if;
  update public.literature_env_reviews set environments=targets,revision=revision+1,updated_at=now(),reviewer_id=p_actor where paper_id=paper returning * into current_row;
  insert into public.literature_env_review_history(paper_id,previous_environments,environments,revision,reviewer_id,note)
  values(paper,previous,targets,current_row.revision,p_actor,coalesce(p_note,''));
  answer:=answer||jsonb_build_array(jsonb_build_object('paper_id',paper,'environments',targets,'revision',current_row.revision,'updated_at',current_row.updated_at));
 end loop;
 update public.literature_env_review_requests set result=jsonb_build_object('rows',answer) where request_id=p_request_id;
 return jsonb_build_object('rows',answer);
end;
$$;
revoke all on function public.apply_literature_env_reviews(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_literature_env_reviews(uuid,uuid,jsonb,text) to service_role;
commit;
