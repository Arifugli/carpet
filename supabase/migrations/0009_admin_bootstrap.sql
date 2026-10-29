begin;
-- Вызывается только сервером с приватным ключом при первом запуске Blueprint.
-- app_metadata ставится Admin Auth API и не редактируется самим пользователем.
create or replace function public.crm_bootstrap_admin(p_email text,p_user uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
 if exists(select 1 from public.profiles where role='admin' and active) then return jsonb_build_object('initialized',true);end if;
 if p_email is null or length(p_email)>254 then raise exception using errcode='23514',message='Укажите почту первоначального администратора';end if;
 select a.id into target from auth.users a where lower(a.email)=lower(p_email)
  and a.raw_app_meta_data->>'crm_bootstrap'='true' and (p_user is null or a.id=p_user);
 if p_user is null then return jsonb_build_object('initialized',false,'pending_user_id',target);end if;
 if target is null then raise exception using errcode='42501',message='Первоначальная учётная запись не подтверждена сервером';end if;
 perform set_config('app.actor_id',target::text,true);perform set_config('app.actor_role','system',true);perform set_config('app.actor_ip','',true);
 update public.profiles set role='admin',active=true,full_name=coalesce(nullif(full_name,''),'Администратор'),branch_id=null where id=target;
 if not found then raise exception using errcode='P0002',message='Профиль первоначального администратора не найден';end if;
 return jsonb_build_object('initialized',true);
end $$;
revoke all on function public.crm_bootstrap_admin(text,uuid) from public,anon,authenticated;
grant execute on function public.crm_bootstrap_admin(text,uuid) to service_role;
-- service_role использует эту функцию с SECURITY INVOKER, не получает доступ ко всем Auth-полям.
grant select(id,email,raw_app_meta_data) on auth.users to service_role;
create or replace function public.crm_ready() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',to_regprocedure('public.crm_bootstrap_admin(text,uuid)') is not null
  and to_regclass('public.integration_outbox') is not null
  and has_table_privilege(current_user,'public.profiles','select')
  and has_table_privilege(current_user,'public.tariffs','select')
  and has_table_privilege(current_user,'public.settings','select'),'schema',9)
$$;
revoke all on function public.crm_ready() from public,anon,authenticated;
grant execute on function public.crm_ready() to service_role;
notify pgrst,'reload schema';
commit;
