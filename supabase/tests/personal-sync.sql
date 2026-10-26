-- Run as project postgres in SQL Editor. Every synthetic write is rolled back.
begin;
do $$ begin
 if not exists(select 1 from cron.job where jobname='litdb-personal-daily' and active) then raise exception 'Backup schedule missing';end if;
 if exists(select 1 from storage.buckets where id='litdb-personal' and public) then raise exception 'Bucket must be private';end if;
 if has_table_privilege('anon','public.personal_documents','SELECT') then raise exception 'Anonymous can read private documents';end if;
 if has_table_privilege('authenticated','public.personal_versions','DELETE') then raise exception 'History deletion allowed';end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from auth.users order by created_at limit 1),true);
set local role authenticated;
select * from public.personal_put('memo','deployment-self-test', '{"title":"Deployment test (transaction rollback)","body":"original","created":1,"files":[]}',0);
select * from public.personal_put('memo','deployment-self-test', '{"title":"Deployment test (transaction rollback)","body":"edited","created":1,"files":[]}',1);
do $$ begin
 if (select count(*) from public.personal_versions where doc_id='deployment-self-test')<>2 then raise exception 'History not retained';end if;
 if exists(select 1 from public.personal_put('memo','deployment-self-test','{}',1)) then raise exception 'Stale write accepted';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
do $$ begin
 if exists(select 1 from public.personal_documents) or exists(select 1 from public.personal_versions) or exists(select 1 from public.personal_daily_backups) then raise exception 'Cross-account data visible';end if;
end $$;
reset role;
rollback;
select 'PASS: private bucket, daily cron, real RLS, version retention, stale-write protection, cross-account isolation; test writes rolled back.' as acceptance;
