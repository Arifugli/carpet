begin;
-- Новые проекты Supabase больше не выдают эти права автоматически.
-- Браузер использует только Express API, сервер — проверенный service_role.
revoke all on public.profiles,public.tariffs,public.settings from public,anon,authenticated;
grant select,insert,update on public.profiles,public.tariffs to service_role;
grant select on public.settings to service_role;
revoke delete,truncate on public.profiles,public.tariffs,public.settings from service_role;

alter function public.setting(text) set search_path=public,pg_temp;
alter function public.touch_updated_at() set search_path=public,pg_temp;
alter function public.is_staff() set search_path=public,pg_temp;
revoke all on function public.setting(text),public.touch_updated_at(),public.is_staff(),public.handle_new_user() from public,anon,authenticated;
grant execute on function public.setting(text),public.touch_updated_at(),public.is_staff(),public.handle_new_user() to service_role;

create or replace function public.crm_ready() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',
  to_regprocedure('public.crm_provider(text,text,jsonb)') is not null
  and to_regclass('public.integration_outbox') is not null
  and has_table_privilege(current_user,'public.profiles','select')
  and has_table_privilege(current_user,'public.tariffs','select')
  and has_table_privilege(current_user,'public.settings','select'),'schema',8)
$$;
revoke all on function public.crm_ready() from public,anon,authenticated;
grant execute on function public.crm_ready() to service_role;
notify pgrst,'reload schema';
commit;
