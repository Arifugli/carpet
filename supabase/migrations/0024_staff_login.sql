-- Optional, installation-wide usernames for existing Supabase Auth accounts.
-- No passwords, roles, sessions or existing account emails are changed here.
begin;
alter table public.profiles add column login text;
alter table public.profiles add constraint profiles_login_format check(login is null or login ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
create unique index profiles_login_unique on public.profiles(login) where login is not null;

create function public.crm_staff_login_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then if new.login is null then return new;end if;
 elsif new.login is not distinct from old.login then return new;end if;
 if current_setting('app.staff_login_write',true) is distinct from 'allowed' then raise exception using errcode='42501',message='Логин назначает администратор';end if;
 perform public.crm_require(nullif(current_setting('app.actor_id',true),'')::uuid,'staff');
 return new;
end $$;
create trigger profiles_login_guard before insert or update on public.profiles for each row execute function public.crm_staff_login_guard();

create function public.crm_staff_login_set(p_target uuid,p_login text,p_user uuid,p_ip inet) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_login text;normalized text:=nullif(lower(btrim(p_login)),'');begin
 perform public.crm_require(p_user,'staff');perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
 select login into current_login from public.profiles where id=p_target for update;
 if not found then raise exception using errcode='P0002',message='Сотрудник не найден';end if;
 if normalized is not null and normalized !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then raise exception using errcode='23514',message='Логин: 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний';end if;
 if normalized is not distinct from current_login then return current_login;end if;
 perform public.lifecycle_actor(p_user,p_ip);perform set_config('app.staff_login_write','allowed',true);
 update public.profiles set login=normalized where id=p_target;
 perform set_config('app.staff_login_write','',true);return normalized;
end $$;

-- Called only by the server before password verification. Never grant it to client roles.
create function public.crm_login_identity(p_login text) returns uuid language sql stable security invoker set search_path=public,pg_temp as $$
 select id from public.profiles where login=lower(btrim(p_login)) and active
 and role::text in ('operator','driver','warehouse','washer','packer','admin') and (role::text='admin' or branch_id is not null)
$$;

-- Keep the complete original payload in command_receipts so retries cannot rename twice.
-- Take locks in the same order as the existing staff command; all changes roll back together.
alter function public.crm_command(text,jsonb,uuid,inet,uuid) rename to crm_command_v23;
create function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_command='staff.update' and p_data ? 'login' then
  perform public.crm_require(p_user,'staff');perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
  if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
  if exists(select 1 from public.command_receipts where user_id=p_user and key=p_key) then return public.crm_command_v23(p_command,p_data,p_user,p_ip,p_key);end if;
  perform public.crm_staff_login_set((p_data->>'user_id')::uuid,p_data->>'login',p_user,p_ip);
 end if;
 return public.crm_command_v23(p_command,p_data,p_user,p_ip,p_key);
end $$;

revoke all on function public.crm_staff_login_guard(),public.crm_staff_login_set(uuid,text,uuid,inet),public.crm_login_identity(text),public.crm_command(text,jsonb,uuid,inet,uuid) from public,anon,authenticated;
grant execute on function public.crm_staff_login_guard(),public.crm_staff_login_set(uuid,text,uuid,inet),public.crm_login_identity(text),public.crm_command(text,jsonb,uuid,inet,uuid) to service_role;

create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset')
 and to_regprocedure('public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)') is not null
 and to_regprocedure('public.crm_queue(jsonb,uuid,boolean)') is not null
 and has_function_privilege(current_user,'public.crm_queue(jsonb,uuid,boolean)','execute')
 and to_regprocedure('public.crm_cash_day(jsonb,uuid)') is not null
 and has_function_privilege(current_user,'public.crm_cash_day(jsonb,uuid)','execute')
 and to_regprocedure('public.crm_cash_close_due_months()') is not null
 and to_regclass('public.cash_month_closures') is not null
 and to_regprocedure('public.crm_branding_save(jsonb,uuid,inet)') is not null
 and has_function_privilege(current_user,'public.crm_branding_public()','execute') and to_regprocedure('public.crm_login_identity(text)') is not null and has_function_privilege(current_user,'public.crm_login_identity(text)','execute'),'schema',24)
$$;
notify pgrst,'reload schema';
commit;
