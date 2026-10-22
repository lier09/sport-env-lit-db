-- Run as project owner after migration. Every test change is rolled back.
begin;
do $$
declare
 actor uuid := '00000000-0000-4000-8000-000000000001';
 request uuid := '00000000-0000-4000-8000-000000000002';
 changes jsonb := '[{"paper_id":"W99999999999999999991","expected_revision":0,"source_environments":["待分类"],"environments":["低温","高原低氧"]}]';
 first_result jsonb;
 second_result jsonb;
begin
 if exists(select 1 from public.literature_env_reviews where paper_id in ('W99999999999999999991','W99999999999999999990')) then raise exception 'Reserved test IDs already exist'; end if;
 first_result := public.apply_literature_env_reviews(request,actor,changes,'deployment test');
 second_result := public.apply_literature_env_reviews(request,actor,changes,'deployment test');
 if first_result <> second_result or (select count(*) from public.literature_env_review_history where paper_id='W99999999999999999991') <> 1 then raise exception 'Idempotency failed'; end if;
 begin
  perform public.apply_literature_env_reviews('00000000-0000-4000-8000-000000000003',actor,
   '[{"paper_id":"W99999999999999999990","expected_revision":0,"source_environments":[],"environments":["高温"]},{"paper_id":"W99999999999999999991","expected_revision":0,"source_environments":[],"environments":["高温"]}]','conflict test');
  raise exception 'Expected revision conflict';
 exception when serialization_failure then null;
 end;
 if exists(select 1 from public.literature_env_reviews where paper_id='W99999999999999999990') then raise exception 'Batch rollback failed'; end if;
 if has_column_privilege('anon','public.literature_env_reviews','reviewer_id','SELECT') or has_table_privilege('anon','public.literature_env_review_history','SELECT') or has_table_privilege('authenticated','public.literature_env_reviews','UPDATE') or has_function_privilege('authenticated','public.apply_literature_env_reviews(uuid,uuid,jsonb,text)','EXECUTE') then raise exception 'Private permission leaked'; end if;
 if not has_column_privilege('anon','public.literature_env_reviews','paper_id','SELECT') then raise exception 'Public read missing'; end if;
end $$;
set local role anon;
select paper_id,environments,revision,updated_at from public.literature_env_reviews where paper_id='W99999999999999999991';
reset role;
rollback;
