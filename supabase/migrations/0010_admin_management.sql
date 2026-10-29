begin;
-- Ссылки заказов и аудит сохраняются; удаление справочников означает архивирование.
do $$ declare t text;begin
 foreach t in array array['profiles','branches','catalog_entries','notification_templates','cancel_reasons'] loop
  execute format('alter table public.%I add column if not exists archived_at timestamptz,add column if not exists archived_by uuid',t);
 end loop;
end $$;
create table if not exists public.tariff_controls(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),code text not null references public.tariffs(code),
 archived_at timestamptz,archived_by uuid,unique(branch_id,code)
);
create index if not exists profiles_branch_active_idx on public.profiles(branch_id) where active;
create index if not exists orders_driver_open_idx on public.orders(driver_id) where deleted_at is null and status not in ('cancelled','delivered');
create index if not exists tasks_assigned_open_idx on public.tasks(assigned_to) where status='open';

create or replace function public.crm_rate(p_code text,p_branch uuid,p_at timestamptz default now()) returns numeric
language sql stable security invoker set search_path=public,pg_temp as $$
 select case when v.active and not exists(select 1 from public.tariff_controls c where c.branch_id=p_branch and c.code=p_code and c.archived_at is not null) then v.price_per_m2 end
 from public.tariff_versions v where v.code=p_code and (v.branch_id=p_branch or v.branch_id is null) and v.effective_at<=p_at
 order by (v.branch_id is not null) desc,v.effective_at desc,v.created_at desc,v.id desc limit 1
$$;

create or replace function public.crm_admin_archive_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare old_data jsonb:=to_jsonb(old);new_data jsonb:=to_jsonb(new);uid uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 if new.archived_at is not null and new.active then raise exception using errcode='55000',message='Сначала восстановите удалённую запись';end if;
 if tg_table_name='branches' and ((old.active and not new.active) or (old.archived_at is null and new.archived_at is not null)) then
  perform 1 from public.branches where id=old.id for update;
  if exists(select 1 from public.profiles where branch_id=old.id and active) then raise exception using errcode='55000',message='Сначала перенесите или отключите сотрудников филиала';end if;
  if exists(select 1 from public.orders where branch_id=old.id and deleted_at is null and status not in ('cancelled','delivered')) then raise exception using errcode='55000',message='Сначала завершите заказы филиала';end if;
 end if;
 if tg_table_name='profiles' then
  if new.active and new.role::text not in ('admin','manager') then
   perform 1 from public.branches where id=new.branch_id and active and archived_at is null for key share;
   if not found then raise exception using errcode='23514',message='Укажите действующий филиал';end if;
  end if;
  if uid is not null and old.role::text='admin' and old.active and (new.role::text<>'admin' or not new.active) then
   perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
   if not exists(select 1 from public.profiles where id<>old.id and role='admin' and active) then raise exception using errcode='55000',message='Нельзя отключить последнего администратора';end if;
  end if;
  if old.archived_at is null and new.archived_at is not null then
   if old.id=uid then raise exception using errcode='55000',message='Нельзя удалить собственную учётную запись';end if;
   if exists(select 1 from public.orders where driver_id=old.id and deleted_at is null and status not in ('cancelled','delivered'))
    or exists(select 1 from public.visits v join public.orders o on o.id=v.order_id where v.driver_id=old.id and v.state in ('planned','en_route') and o.deleted_at is null and o.status not in ('cancelled','delivered'))
    or exists(select 1 from public.tasks where assigned_to=old.id and status='open') then raise exception using errcode='55000',message='Сначала переназначьте открытые заказы и задания сотрудника';end if;
  end if;
 end if;
 return new;
end $$;

-- Блокировки связывают назначение/создание с архивированием филиала и водителя.
create or replace function public.crm_admin_assignment_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or new.branch_id is distinct from old.branch_id then
  perform 1 from public.branches where id=new.branch_id and active and archived_at is null for key share;
  if not found then raise exception using errcode='23514',message='Филиал недоступен';end if;
 end if;
 if new.driver_id is not null and (tg_op='INSERT' or new.driver_id is distinct from old.driver_id) then
  perform 1 from public.profiles where id=new.driver_id and role='driver' and active and archived_at is null and branch_id=new.branch_id for key share;
  if not found then raise exception using errcode='23514',message='Водитель недоступен для филиала';end if;
 end if;
 return new;
end $$;

create or replace function public.crm_admin_command(p_command text,p_data jsonb,p_user uuid,p_ip inet,p_key uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;previous public.command_receipts;entity text:=p_data->>'entity';rid uuid:=(p_data->>'id')::uuid;
 bid uuid:=(p_data->>'branch_id')::uuid;obj jsonb;result jsonb;archiving boolean:=p_command='admin.archive';
begin
 perform public.lifecycle_actor(p_user,p_ip);actor:=public.crm_require(p_user,'staff');
 if actor.role::text<>'admin' then raise exception using errcode='42501',message='Управление доступно только администратору';end if;
 if p_command not in ('admin.update','admin.archive','admin.restore') or p_key is null then raise exception using errcode='23514',message='Неверное административное действие';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
 select * into previous from public.command_receipts where user_id=p_user and key=p_key;
 if found then
  if previous.command<>p_command or previous.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ использован для другого действия';end if;
  return previous.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('crm:admin:management',0));
 if entity='staff' then perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));end if;
 case entity
 when 'branch' then select to_jsonb(b) into obj from public.branches b where id=rid for update;
 when 'staff' then select to_jsonb(p) into obj from public.profiles p where id=rid for update;
 when 'catalog' then select to_jsonb(c) into obj from public.catalog_entries c where id=rid for update;
 when 'template' then select to_jsonb(t) into obj from public.notification_templates t where id=rid for update;
 when 'reason' then select to_jsonb(r) into obj from public.cancel_reasons r where code=p_data->>'code' for update;
 when 'tariff' then
  if not exists(select 1 from public.tariffs where code=p_data->>'code') or not exists(select 1 from public.branches where id=bid) then raise exception using errcode='P0002',message='Тариф или филиал не найден';end if;
  insert into public.tariff_controls(branch_id,code) values(bid,p_data->>'code') on conflict(branch_id,code) do nothing;
  select to_jsonb(c) into obj from public.tariff_controls c where branch_id=bid and code=p_data->>'code' for update;
 else raise exception using errcode='23514',message='Неизвестный вид записи';end case;
 if obj is null then raise exception using errcode='P0002',message='Запись не найдена';end if;
 if p_command='admin.update' then
  if obj->>'archived_at' is not null then raise exception using errcode='55000',message='Сначала восстановите удалённую запись';end if;
  case entity
  when 'branch' then
   update public.branches set code=p_data->>'code',name=p_data->>'name',address=coalesce(p_data->>'address',''),phone=nullif(p_data->>'phone',''),active=(p_data->>'active')::boolean,
    workshop_capacity_m2=(p_data->>'workshop_capacity_m2')::numeric,sla_hours=(p_data->>'sla_hours')::integer where id=rid returning to_jsonb(branches.*) into result;
  when 'catalog' then
   if obj->>'kind'<>p_data->>'kind' or obj->>'code'<>p_data->>'code' or obj->>'branch_id'<>p_data->>'branch_id' then raise exception using errcode='23514',message='Вид, код и филиал записи нельзя менять';end if;
   update public.catalog_entries set name_ru=p_data->>'name_ru',name_uz=coalesce(p_data->>'name_uz',''),active=(p_data->>'active')::boolean,
    position=coalesce((p_data->>'position')::integer,position),config=config||coalesce(p_data->'config','{}') where id=rid returning to_jsonb(catalog_entries.*) into result;
  when 'reason' then
   update public.cancel_reasons set name_ru=p_data->>'name_ru',name_uz=coalesce(p_data->>'name_uz',''),active=(p_data->>'active')::boolean,
    position=coalesce((p_data->>'position')::integer,position) where code=p_data->>'code' returning to_jsonb(cancel_reasons.*) into result;
  when 'template' then
   if obj->>'branch_id'<>p_data->>'branch_id' then raise exception using errcode='23514',message='Филиал шаблона нельзя менять';end if;
   update public.notification_templates set code=p_data->>'code',channel=p_data->>'channel',locale=p_data->>'locale',body=p_data->>'body',active=(p_data->>'active')::boolean
    where id=rid returning to_jsonb(notification_templates.*) into result;
  else raise exception using errcode='23514',message='Для сотрудника и тарифа используйте форму изменения';end case;
 else
  if archiving and obj->>'archived_at' is not null then raise exception using errcode='55000',message='Запись уже удалена';end if;
  if not archiving and obj->>'archived_at' is null then raise exception using errcode='55000',message='Запись не удалена';end if;
  case entity
  when 'branch' then update public.branches set active=not archiving,archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where id=rid returning to_jsonb(branches.*) into result;
  when 'staff' then update public.profiles set active=false,archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where id=rid returning to_jsonb(profiles.*) into result;
  when 'catalog' then update public.catalog_entries set active=not archiving,archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where id=rid returning to_jsonb(catalog_entries.*) into result;
  when 'template' then update public.notification_templates set active=not archiving,archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where id=rid returning to_jsonb(notification_templates.*) into result;
  when 'reason' then update public.cancel_reasons set active=not archiving,archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where code=p_data->>'code' returning to_jsonb(cancel_reasons.*) into result;
  when 'tariff' then update public.tariff_controls set archived_at=case when archiving then clock_timestamp() end,archived_by=case when archiving then p_user end where id=(obj->>'id')::uuid returning to_jsonb(tariff_controls.*) into result;
  end case;
 end if;
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);
 return result;
end $$;

do $$ begin
 if to_regprocedure('public.crm_workspace_v9(text,jsonb,uuid)') is null then alter function public.crm_workspace(text,jsonb,uuid) rename to crm_workspace_v9;end if;
end $$;
create or replace function public.crm_workspace(p_view text,p_filters jsonb,p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare data jsonb;bid uuid;
begin
 if p_view='bootstrap' then
  data:=public.crm_workspace_v9(p_view,p_filters,p_user);bid:=coalesce((p_filters->>'branch_id')::uuid,(select branch_id from public.profiles where id=p_user),'01000000-0000-4000-8000-000000000001');
  return data||jsonb_build_object('tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'name',v.name,'price_per_m2',public.crm_rate(t.code,bid),'active',public.crm_rate(t.code,bid) is not null)),'[]')
   from public.tariffs t join lateral(select name from public.tariff_versions x where x.code=t.code and (x.branch_id=bid or x.branch_id is null) and x.effective_at<=now()
    order by (x.branch_id is not null) desc,x.effective_at desc,x.created_at desc,x.id desc limit 1)v on true));
 end if;
 if p_view<>'admin' then return public.crm_workspace_v9(p_view,p_filters,p_user);end if;
 perform public.crm_require(p_user,'staff');
 return jsonb_build_object(
  'staff',(select coalesce(jsonb_agg(to_jsonb(p) order by p.full_name),'[]') from public.profiles p),
  'branches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.name),'[]') from public.branches b),
  'catalogs',(select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.position,c.code),'[]') from public.catalog_entries c),
  'reasons',(select coalesce(jsonb_agg(to_jsonb(r) order by r.position,r.code),'[]') from public.cancel_reasons r),
  'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.code,t.channel,t.locale),'[]') from public.notification_templates t),
  'tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'branch_id',b.id,'name',v.name,'price_per_m2',v.price_per_m2,'active',v.active and v.effective_at<=now(),
   'effective_at',v.effective_at,'archived_at',c.archived_at) order by b.name,t.code),'[]') from public.branches b cross join public.tariffs t
   left join public.tariff_controls c on c.branch_id=b.id and c.code=t.code
   join lateral(select * from public.tariff_versions x where x.code=t.code and (x.branch_id=b.id or x.branch_id is null)
    order by (x.effective_at<=now()) desc,(x.branch_id is not null) desc,x.effective_at desc,x.created_at desc,x.id desc limit 1)v on true),
  'tariff_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.tariff_versions order by effective_at desc limit 100)v),
  'setting_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.setting_versions order by effective_at desc limit 100)v));
end $$;

do $$ declare t text;begin
 foreach t in array array['profiles','branches','catalog_entries','notification_templates','cancel_reasons'] loop
  execute format('drop trigger if exists admin_archive_guard on public.%I',t);
  execute format('create trigger admin_archive_guard before update on public.%I for each row execute function public.crm_admin_archive_guard()',t);
  execute format('revoke delete,truncate on public.%I from service_role',t);
 end loop;
 foreach t in array array['orders','visits'] loop
  execute format('drop trigger if exists admin_assignment_guard on public.%I',t);
  execute format('create trigger admin_assignment_guard before insert or update of driver_id,branch_id on public.%I for each row execute function public.crm_admin_assignment_guard()',t);
 end loop;
end $$;
alter table public.tariff_controls enable row level security;
revoke all on public.tariff_controls from public,anon,authenticated;
grant select,insert,update on public.tariff_controls to service_role;
revoke delete,truncate on public.tariff_controls from service_role;
drop trigger if exists admin_control_audit on public.tariff_controls;
create trigger admin_control_audit after insert or update on public.tariff_controls for each row execute function public.crm_audit_change();

create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',to_regprocedure('public.crm_admin_command(text,jsonb,uuid,inet,uuid)') is not null
  and to_regprocedure('public.crm_bootstrap_admin(text,uuid)') is not null and to_regclass('public.integration_outbox') is not null
  and has_table_privilege(current_user,'public.profiles','select') and has_table_privilege(current_user,'public.tariff_controls','select')
  and has_table_privilege(current_user,'public.tariffs','select') and has_table_privilege(current_user,'public.settings','select'),'schema',10)
$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('crm_admin_command','crm_admin_archive_guard','crm_admin_assignment_guard','crm_rate','crm_workspace','crm_workspace_v9','crm_ready') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
