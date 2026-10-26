-- Personal documents are private, revisioned and never hard-deleted by clients.
begin;
create schema if not exists litdb_private;
revoke all on schema litdb_private from public, anon, authenticated;
create table if not exists public.personal_documents (
  seq bigint generated always as identity unique,
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('memo','groups','pref')),
  doc_id text not null check (length(doc_id) between 1 and 200),
  revision bigint not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=1048576),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(user_id,kind,doc_id)
);
create table if not exists public.personal_versions (
  user_id uuid not null, kind text not null, doc_id text not null,
  revision bigint not null, payload jsonb not null,
  saved_at timestamptz not null default clock_timestamp(),
  primary key(user_id,kind,doc_id,revision)
);
create index if not exists personal_versions_time on public.personal_versions(user_id,saved_at desc);
create table if not exists public.personal_daily_backups (
  user_id uuid not null, backup_day date not null, documents jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,backup_day)
);
alter table public.personal_documents enable row level security;
alter table public.personal_versions enable row level security;
alter table public.personal_daily_backups enable row level security;
revoke all on public.personal_documents, public.personal_versions, public.personal_daily_backups from anon, authenticated;
grant select,insert,update on public.personal_documents to authenticated;
grant usage,select on sequence public.personal_documents_seq_seq to authenticated;
grant select on public.personal_versions,public.personal_daily_backups to authenticated;
create policy personal_read on public.personal_documents for select to authenticated using ((select auth.uid())=user_id);
create policy personal_insert on public.personal_documents for insert to authenticated with check ((select auth.uid())=user_id);
create policy personal_update on public.personal_documents for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy versions_read on public.personal_versions for select to authenticated using ((select auth.uid())=user_id);
create policy backups_read on public.personal_daily_backups for select to authenticated using ((select auth.uid())=user_id);

create or replace function litdb_private.personal_revision_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.user_id,new.kind,new.doc_id,new.seq) is distinct from (old.user_id,old.kind,old.doc_id,old.seq) then
    raise exception 'Document identity is immutable' using errcode='22023';
  end if;
  if new.kind='pref' and new.doc_id not in ('litdb-meta-tracker','envLitPageSize','litdb-ris-imports','envLitFolders','envLitFolderList','envLitMyTags','envLitTagList','envLitFollow','envLitHist','envLitSavedQ','envLitDeleted','envLitFavs','litdb-follows','envLitNotes','envLitRead') then
    raise exception 'Unsupported preference' using errcode='22023';
  end if;
  if tg_op='UPDATE' and new.revision<>old.revision+1 or tg_op='INSERT' and new.revision<>1 then
    raise exception 'Invalid revision' using errcode='40001';
  end if;
  if (select coalesce(sum(octet_length(payload::text)),0) from public.personal_versions where user_id=new.user_id)>67108864 then
    raise exception 'Personal history quota reached; export a backup and contact the administrator' using errcode='54000';
  end if;
  new.updated_at=clock_timestamp();
  return new;
end $$;
create trigger personal_guard before insert or update on public.personal_documents for each row execute function litdb_private.personal_revision_guard();

create or replace function litdb_private.personal_archive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.personal_versions(user_id,kind,doc_id,revision,payload)
    values(new.user_id,new.kind,new.doc_id,new.revision,new.payload);
  -- A separate daily checkpoint remains even after later edits/deletions.
  insert into public.personal_daily_backups(user_id,backup_day,documents)
    select new.user_id,(clock_timestamp() at time zone 'UTC')::date,
      coalesce(jsonb_agg(jsonb_build_object('kind',kind,'doc_id',doc_id,'revision',revision,'payload',payload)), '[]')
    from public.personal_documents where user_id=new.user_id
    on conflict do nothing;
  return new;
end $$;
create trigger personal_archive after insert or update on public.personal_documents for each row execute function litdb_private.personal_archive();

create or replace function public.personal_put(p_kind text,p_doc_id text,p_payload jsonb,p_expected_revision bigint)
returns setof public.personal_documents language plpgsql security invoker set search_path='' as $$
declare u uuid=auth.uid();
begin
  if u is null then raise exception 'Login required' using errcode='28000'; end if;
  if p_expected_revision=0 then
    return query insert into public.personal_documents(user_id,kind,doc_id,payload,revision)
      values(u,p_kind,p_doc_id,p_payload,1) on conflict do nothing returning *;
  else
    return query update public.personal_documents set payload=p_payload,revision=revision+1
      where user_id=u and kind=p_kind and doc_id=p_doc_id and revision=p_expected_revision returning *;
  end if;
end $$;
revoke all on function public.personal_put(text,text,jsonb,bigint) from public,anon;
grant execute on function public.personal_put(text,text,jsonb,bigint) to authenticated;

-- Immutable private attachments. No public URL, overwrite or client delete policy.
insert into storage.buckets(id,name,public,file_size_limit)
values('litdb-personal','litdb-personal',false,26214400) on conflict(id) do nothing;
create policy personal_file_read on storage.objects for select to authenticated
using(bucket_id='litdb-personal' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy personal_file_insert on storage.objects for insert to authenticated
with check(bucket_id='litdb-personal' and (storage.foldername(name))[1]=(select auth.uid())::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}$');

-- Server-side checkpoints run without an open browser. Retain at least 30 days.
create or replace function litdb_private.personal_daily_checkpoint() returns void
language plpgsql security definer set search_path='' as $$
begin
  insert into public.personal_daily_backups(user_id,backup_day,documents)
  select user_id,(clock_timestamp() at time zone 'UTC')::date,
    jsonb_agg(jsonb_build_object('kind',kind,'doc_id',doc_id,'revision',revision,'payload',payload))
  from public.personal_documents group by user_id
  on conflict(user_id,backup_day) do update set documents=excluded.documents,created_at=clock_timestamp();
  delete from public.personal_versions v where v.saved_at<clock_timestamp()-interval '35 days'
    and exists(select 1 from public.personal_documents d where (d.user_id,d.kind,d.doc_id)=(v.user_id,v.kind,v.doc_id) and d.revision>v.revision);
  delete from public.personal_daily_backups where backup_day<(current_date-35);
end $$;
revoke all on function litdb_private.personal_daily_checkpoint() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('litdb-personal-daily','20 19 * * *','select litdb_private.personal_daily_checkpoint()');
notify pgrst,'reload schema';
commit;
