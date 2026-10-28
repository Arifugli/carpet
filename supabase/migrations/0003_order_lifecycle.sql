begin;

create table if not exists public.cancel_reasons (
  code text primary key, name_ru text not null, name_uz text,
  active boolean not null default true, position integer not null default 0
);
insert into public.cancel_reasons(code,name_ru,position) values
 ('expensive','Дорого',1),('changed_mind','Передумал',2),
 ('unreachable','Не дозвонились',3),('competitor','Выбрал конкурента',4),
 ('timing','Не устроил срок',5),('condition','Ковёр не принят из-за состояния',6),('other','Другое',7)
on conflict (code) do nothing;

alter table public.orders
 add column if not exists cancel_reason_code text references public.cancel_reasons(code),
 add column if not exists cancel_comment text,
 add column if not exists cancelled_at timestamptz,
 add column if not exists cancelled_by uuid,
 add column if not exists cancelled_from_status public.order_status,
 add column if not exists completed_work_amount numeric(12,0) check (completed_work_amount >= 0),
 add column if not exists cancellation_payment_amount numeric(12,0) check (cancellation_payment_amount >= 0),
 add column if not exists paid_amount numeric(12,0) not null default 0 check (paid_amount >= 0),
 add column if not exists payment_recorded_at timestamptz,
 add column if not exists washing_started_at timestamptz,
 add column if not exists workshop_received_at timestamptz,
 add column if not exists delete_requested_at timestamptz,
 add column if not exists delete_requested_by uuid,
 add column if not exists delete_request_reason text,
 add column if not exists deleted_at timestamptz,
 add column if not exists deleted_by uuid,
 add column if not exists delete_reason text,
 add column if not exists deleted_status public.order_status,
 add column if not exists delete_snapshot jsonb,
 add column if not exists restored_at timestamptz,
 add column if not exists restored_by uuid;

-- Сохраняем признаки уже выполненной работы даже после шага назад.
update public.orders o set
 washing_started_at = coalesce(o.washing_started_at,
   (select min(h.created_at) from public.status_history h where h.order_id=o.id
     and h.status in ('washing','drying','ready','delivering','delivered')),
   case when o.status in ('washing','drying','ready','delivering','delivered') then o.updated_at end),
 workshop_received_at = coalesce(o.workshop_received_at,o.washing_started_at,
   (select min(h.created_at) from public.status_history h where h.order_id=o.id
     and h.status in ('received','washing','drying','ready','delivering','delivered')),
   case when o.status in ('received','washing','drying','ready','delivering','delivered') then o.updated_at end)
where (o.washing_started_at is null and (
 o.status in ('washing','drying','ready','delivering','delivered') or exists(
 select 1 from public.status_history h where h.order_id=o.id and h.status in ('washing','drying','ready','delivering','delivered'))))
 or (o.workshop_received_at is null and (o.washing_started_at is not null or
 o.status in ('received','washing','drying','ready','delivering','delivered') or exists(
 select 1 from public.status_history h where h.order_id=o.id and h.status in ('received','washing','drying','ready','delivering','delivered'))));

create table if not exists public.audit_log (
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(), user_id uuid, role text not null,
 entity text not null, entity_id uuid not null, action text not null,
 "before" jsonb, "after" jsonb, ip inet
);
create index if not exists audit_log_entity_idx on public.audit_log(entity,entity_id,at desc,id desc);
create index if not exists audit_log_at_idx on public.audit_log(at desc,id desc);
create index if not exists orders_active_list_idx on public.orders(created_at desc,id desc) where deleted_at is null;
create index if not exists orders_active_status_idx on public.orders(status,created_at desc,id desc) where deleted_at is null;
create index if not exists orders_trash_idx on public.orders(deleted_at desc,id desc) where deleted_at is not null;
create index if not exists orders_trash_actor_idx on public.orders(deleted_by,deleted_at desc,id desc) where deleted_at is not null;
create index if not exists orders_delete_requests_idx on public.orders(delete_requested_at desc,id desc)
 where deleted_at is null and delete_requested_at is not null;

alter table public.audit_log enable row level security;
alter table public.cancel_reasons enable row level security;
-- Все операционные данные проходят через API с проверкой роли и области видимости.
do $$ declare t text; begin
 foreach t in array array['clients','orders','order_items','order_photos','status_history','cancel_reasons','audit_log'] loop
   execute format('revoke all on public.%I from public, anon, authenticated',t);
   execute format('grant select, insert, update on public.%I to service_role',t);
   execute format('revoke delete, truncate on public.%I from service_role',t);
 end loop;
end $$;
revoke update on public.audit_log from service_role;
grant usage,select on all sequences in schema public to service_role;

create or replace function public.reject_destructive_mutation() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin raise exception using errcode='42501', message='Физическое удаление и изменение журнала запрещены'; end $$;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete or truncate on public.audit_log
 for each statement execute function public.reject_destructive_mutation();
drop trigger if exists orders_no_delete on public.orders;
create trigger orders_no_delete before delete or truncate on public.orders
 for each statement execute function public.reject_destructive_mutation();

create or replace function public.lifecycle_actor(p_user uuid, p_ip inet default null) returns text
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r text;
begin
 select role::text into r from public.profiles where id=p_user and active for share;
 if r is null then raise exception using errcode='42501',message='Сотрудник не найден или неактивен'; end if;
 perform set_config('app.actor_id',p_user::text,true);
 perform set_config('app.actor_role',r,true);
 perform set_config('app.actor_ip',coalesce(p_ip::text,''),true);
 return r;
end $$;

create or replace function public.order_snapshot(p_order uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('code','K-'||o.number,
   'order',to_jsonb(o)-'delete_snapshot'-'track_token',
   'client',(select to_jsonb(c) from public.clients c where c.id=o.client_id),
   'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.seq),'[]'::jsonb) from public.order_items i where i.order_id=o.id),
   'photos',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.order_photos p join public.order_items i on i.id=p.item_id where i.order_id=o.id),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at,h.id),'[]'::jsonb) from public.status_history h where h.order_id=o.id),
   'actor',(select jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role) from public.profiles p
      where p.id=nullif(current_setting('app.actor_id',true),'')::uuid))
 from public.orders o where o.id=p_order
$$;

create or replace function public.guard_order_lifecycle() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and old.deleted_at is not null then
   if new.deleted_at is not null or current_setting('app.order_action',true) is distinct from 'restored' then
     raise exception using errcode='55000',message='Удалённый заказ доступен только для восстановления';
   end if;
 end if;
 if new.status='cancelled' and (tg_op='INSERT' or old.status is distinct from new.status) then
   if current_setting('app.order_action',true) is distinct from 'cancelled' then
     raise exception using errcode='23514',message='Для отказа используйте отмену с причиной';
   end if;
 end if;
 if new.status in ('received','washing','drying','ready','delivering','delivered') then
   new.workshop_received_at := coalesce(new.workshop_received_at,clock_timestamp());
 end if;
 if new.status in ('washing','drying','ready','delivering','delivered') then
   new.washing_started_at := coalesce(new.washing_started_at,clock_timestamp());
 end if;
 if new.paid_amount>0 then new.payment_recorded_at := coalesce(new.payment_recorded_at,clock_timestamp()); end if;
 if tg_op='UPDATE' then
   new.washing_started_at := coalesce(old.washing_started_at,new.washing_started_at);
   new.workshop_received_at := coalesce(old.workshop_received_at,new.workshop_received_at);
   new.payment_recorded_at := coalesce(old.payment_recorded_at,new.payment_recorded_at);
   if new.status<>'new' then
     new.delete_requested_at:=null; new.delete_requested_by:=null; new.delete_request_reason:=null;
   end if;
 end if;
 return new;
end $$;
drop trigger if exists orders_lifecycle_guard on public.orders;
create trigger orders_lifecycle_guard before insert or update on public.orders
 for each row execute function public.guard_order_lifecycle();

create or replace function public.audit_order_change() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a text; b jsonb;
begin
 if tg_op='INSERT' then a:='created'; b:=null;
 else
   b:=to_jsonb(old)-'track_token';
   a:=case
    when old.deleted_at is null and new.deleted_at is not null then 'deleted'
    when old.deleted_at is not null and new.deleted_at is null then 'restored'
    when old.status<>new.status and new.status='cancelled' then 'cancelled'
    when old.status<>new.status then 'status_changed'
    when old.delete_requested_at is distinct from new.delete_requested_at and new.delete_requested_at is not null then 'deletion_requested'
    when old.driver_id is distinct from new.driver_id then 'driver_assigned'
    else 'updated' end;
 end if;
 insert into public.audit_log(user_id,role,entity,entity_id,action,"before","after",ip)
 values (nullif(current_setting('app.actor_id',true),'')::uuid,
   coalesce(nullif(current_setting('app.actor_role',true),''),'system'),'order',new.id,a,b,
   to_jsonb(new)-'track_token',nullif(current_setting('app.actor_ip',true),'')::inet);
 return new;
end $$;
drop trigger if exists orders_audit on public.orders;
create trigger orders_audit after insert or update on public.orders for each row execute function public.audit_order_change();

create table if not exists public.order_creation_keys (
 user_id uuid not null, key uuid not null, payload jsonb not null,
 order_id uuid not null references public.orders(id), created_at timestamptz not null default now(),
 primary key(user_id,key)
);
alter table public.order_creation_keys enable row level security;
revoke all on public.order_creation_keys from public,anon,authenticated;
grant select,insert on public.order_creation_keys to service_role;
revoke update,delete,truncate on public.order_creation_keys from service_role;

create or replace function public.create_order_audited(p jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous public.order_creation_keys; oid uuid;
begin
 if public.lifecycle_actor(p_user,p_ip) not in ('admin','operator') then
   raise exception using errcode='42501',message='Недостаточно прав для создания заказа';
 end if;
 if p_key is not null then
   perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
   select * into previous from public.order_creation_keys where user_id=p_user and key=p_key;
   if found then
     if previous.payload is distinct from p then raise exception using errcode='55000',message='Ключ повторного запроса уже использован с другими данными'; end if;
     if exists(select 1 from public.orders where id=previous.order_id and deleted_at is not null) then
       raise exception using errcode='55000',message='Этот заказ уже удалён. Повторное создание с тем же ключом запрещено'; end if;
     return previous.order_id;
   end if;
 end if;
 oid:=public.create_order(p,p_user);
 if p_key is not null then insert into public.order_creation_keys(user_id,key,payload,order_id) values(p_user,p_key,p,oid); end if;
 return oid;
end $$;

-- Старый RPC остаётся совместимым, но отменять им без причины больше нельзя.
create or replace function public.change_order_status(p_order uuid,p_status public.order_status,p_user uuid,p_note text default null)
returns public.order_status language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text; a int; b int;
 flow public.order_status[]:=enum_range('new'::public.order_status,'delivered'::public.order_status);
begin
 r:=public.lifecycle_actor(p_user,nullif(current_setting('app.actor_ip',true),'')::inet);
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if p_status='cancelled' then raise exception using errcode='23514',message='Для отказа укажите причину через отмену заказа'; end if;
 if r not in ('admin','operator') and not (r='driver' and (o.driver_id is not distinct from p_user) and p_status in ('received','delivering','delivered'))
   and not (r='workshop' and o.status in ('received','washing','drying','ready') and p_status in ('washing','drying','ready')) then
   raise exception using errcode='42501',message='Эта смена статуса запрещена для вашей роли';
 end if;
 if o.status=p_status then return o.status; end if;
 if o.status in ('delivered','cancelled') then raise exception using errcode='55000',message='Заказ уже закрыт'; end if;
 a:=array_position(flow,o.status); b:=array_position(flow,p_status);
 if a is null or b is null or abs(a-b)<>1 then raise exception using errcode='23514',message='Недопустимый переход статуса'; end if;
 if p_status='pickup_assigned' and o.driver_id is null then raise exception using errcode='23514',message='Сначала назначьте водителя'; end if;
 update public.orders set status=p_status where id=p_order;
 insert into public.status_history(order_id,status,changed_by,note) values(p_order,p_status,p_user,p_note);
 return p_status;
end $$;

create or replace function public.change_order_status_audited(p_order uuid,p_status public.order_status,p_user uuid,p_note text default null,p_ip inet default null)
returns public.order_status language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.lifecycle_actor(p_user,p_ip);
 return public.change_order_status(p_order,p_status,p_user,p_note);
end $$;

create or replace function public.cancel_order(p_order uuid,p_user uuid,p_reason text,p_comment text,
 p_work_amount numeric default null,p_payment_amount numeric default null,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if r not in ('admin','manager') and not (r='operator' and o.status='new') then
   raise exception using errcode='42501',message='Оператор может отменять только новые заказы'; end if;
 if o.status in ('delivered','cancelled') then raise exception using errcode='55000',message='Заказ уже закрыт'; end if;
 if p_reason is null or not exists(select 1 from public.cancel_reasons where code=p_reason and active) then
   raise exception using errcode='23514',message='Выберите действующую причину отказа'; end if;
 if p_comment is null or length(btrim(p_comment)) not between 1 and 1000 then
   raise exception using errcode='23514',message='Укажите комментарий к отказу (до 1000 символов)'; end if;
 if o.workshop_received_at is not null and (p_work_amount is null or p_payment_amount is null) then
   raise exception using errcode='23514',message='Укажите стоимость выполненных работ и принятую оплату, включая ноль'; end if;
 if coalesce(p_work_amount,0)<0 or coalesce(p_payment_amount,0)<0
   or coalesce(p_work_amount,0)<>trunc(coalesce(p_work_amount,0)) or coalesce(p_payment_amount,0)<>trunc(coalesce(p_payment_amount,0))
   or coalesce(p_work_amount,0)>999999999999 or coalesce(p_payment_amount,0)>999999999999
   or coalesce(p_work_amount,0)::text in ('NaN','Infinity','-Infinity') or coalesce(p_payment_amount,0)::text in ('NaN','Infinity','-Infinity') then
   raise exception using errcode='23514',message='Суммы должны быть целыми неотрицательными значениями в сумах'; end if;
 perform set_config('app.order_action','cancelled',true);
 update public.orders set status='cancelled',cancel_reason_code=p_reason,cancel_comment=btrim(p_comment),
   cancelled_at=clock_timestamp(),cancelled_by=p_user,cancelled_from_status=o.status,
   completed_work_amount=coalesce(p_work_amount,0),cancellation_payment_amount=coalesce(p_payment_amount,0),
   paid_amount=paid_amount+coalesce(p_payment_amount,0)
 where id=p_order returning * into o;
 insert into public.status_history(order_id,status,changed_by,note) values(p_order,'cancelled',p_user,p_reason||': '||btrim(p_comment));
 return o;
end $$;

create or replace function public.request_order_deletion(p_order uuid,p_user uuid,p_reason text,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if r<>'operator' or o.status<>'new' then raise exception using errcode='42501',message='Заявку на удаление может отправить оператор для нового заказа'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception using errcode='23514',message='Укажите причину удаления (до 500 символов)'; end if;
 if o.washing_started_at is not null or o.payment_recorded_at is not null or o.paid_amount>0 then
   raise exception using errcode='55000',message='Заказ с оплатой или начатой стиркой можно только отменить'; end if;
 if o.delete_requested_at is not null then raise exception using errcode='55000',message='Заявка на удаление уже отправлена'; end if;
 update public.orders set delete_requested_at=clock_timestamp(),delete_requested_by=p_user,delete_request_reason=btrim(p_reason)
 where id=p_order returning * into o;
 return o;
end $$;

create or replace function public.soft_delete_order(p_order uuid,p_user uuid,p_reason text,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text; snapshot jsonb;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 if r not in ('admin','manager') then raise exception using errcode='42501',message='Удаление доступно администратору и руководителю'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if o.deleted_at is not null then raise exception using errcode='55000',message='Заказ уже в корзине'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception using errcode='23514',message='Укажите причину удаления (до 500 символов)'; end if;
 if o.paid_amount>0 or o.payment_recorded_at is not null or o.washing_started_at is not null or o.status='delivered'
   or exists(select 1 from public.status_history h where h.order_id=p_order and h.status in ('washing','drying','ready','delivering','delivered')) then
   raise exception using errcode='55000',message='Заказ с оплатой или начатой стиркой можно только отменить'; end if;
 snapshot:=public.order_snapshot(p_order);
 update public.orders set deleted_at=clock_timestamp(),deleted_by=p_user,delete_reason=btrim(p_reason),
   deleted_status=status,delete_snapshot=snapshot,delete_requested_at=null,delete_requested_by=null,delete_request_reason=null
 where id=p_order returning * into o;
 return o;
end $$;

create or replace function public.restore_order(p_order uuid,p_user uuid,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 if r not in ('admin','manager') then raise exception using errcode='42501',message='Восстановление доступно администратору и руководителю'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if o.deleted_at is null then raise exception using errcode='55000',message='Заказ не находится в корзине'; end if;
 perform set_config('app.order_action','restored',true);
 update public.orders set deleted_at=null,deleted_by=null,delete_reason=null,
   status=deleted_status,restored_at=clock_timestamp(),restored_by=p_user
 where id=p_order returning * into o;
 return o;
end $$;

create or replace function public.assign_order_driver(p_order uuid,p_user uuid,p_driver uuid default null,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 if r not in ('admin','operator') then raise exception using errcode='42501',message='Недостаточно прав'; end if;
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if o.status in ('cancelled','delivered') then raise exception using errcode='55000',message='Заказ уже закрыт'; end if;
 if p_driver is not null and not exists(select 1 from public.profiles where id=p_driver and active and role='driver') then
   raise exception using errcode='23514',message='Водитель не найден'; end if;
 update public.orders set driver_id=p_driver where id=p_order returning * into o;
 return o;
end $$;

-- Не даём менять вложения удалённого заказа; блокировка родителя исключает гонку с удалением.
create or replace function public.guard_order_child() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare oid uuid; previous_oid uuid; o public.orders;
begin
 if tg_table_name='order_photos' then
   select order_id into oid from public.order_items where id=new.item_id;
   if tg_op='UPDATE' then select order_id into previous_oid from public.order_items where id=old.item_id; end if;
 else
   oid:=new.order_id;
   if tg_op='UPDATE' then previous_oid:=old.order_id; end if;
 end if;
 for o in select * from public.orders where id in (oid,previous_oid) order by id for update loop
   if o.deleted_at is not null then raise exception using errcode='55000',message='Нельзя менять данные удалённого заказа'; end if;
 end loop;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['order_items','order_photos','status_history'] loop
  execute format('drop trigger if exists lifecycle_child_guard on public.%I',t);
  execute format('create trigger lifecycle_child_guard before insert or update on public.%I for each row execute function public.guard_order_child()',t);
 end loop;
end $$;

create or replace function public.public_order_status(p_token text) returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('code','K-'||o.number,'status',o.status,'pickup_date',o.pickup_date,'total',o.total,
  'items',(select count(*) from public.order_items i where i.order_id=o.id),
  'history',(select coalesce(jsonb_agg(jsonb_build_object('status',h.status,'at',h.created_at) order by h.created_at,h.id),'[]'::jsonb)
    from public.status_history h where h.order_id=o.id))
 from public.orders o where o.track_token=p_token and o.deleted_at is null
$$;

-- Представления для будущих отчётов исключают корзину и сохраняют отказы.
create or replace view public.active_orders with (security_invoker=true) as select * from public.orders where deleted_at is null;
create or replace view public.cancelled_orders with (security_invoker=true) as
 select o.*,r.name_ru as cancel_reason_name from public.orders o left join public.cancel_reasons r on r.code=o.cancel_reason_code
 where o.deleted_at is null and o.status='cancelled';
revoke all on public.active_orders,public.cancelled_orders from public,anon,authenticated;
grant select on public.active_orders,public.cancelled_orders to service_role;

-- Все новые RPC доступны исключительно серверу; p_user берётся из проверенного JWT API.
create or replace function public.audit_related_change() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare eid uuid; kind text; before_data jsonb;
begin
 kind:=case tg_table_name when 'clients' then 'client' when 'order_items' then 'order_item'
   when 'order_photos' then 'order_photo' else 'tariff' end;
 if tg_table_name='tariffs' then eid:=md5('tariff:'||(to_jsonb(new)->>'code'))::uuid;
 else eid:=(to_jsonb(new)->>'id')::uuid; end if;
 if tg_op='UPDATE' then before_data:=to_jsonb(old); end if;
 insert into public.audit_log(user_id,role,entity,entity_id,action,"before","after",ip)
 values(nullif(current_setting('app.actor_id',true),'')::uuid,
   coalesce(nullif(current_setting('app.actor_role',true),''),'system'),kind,eid,
   case when tg_op='INSERT' then 'created' else 'updated' end,before_data,to_jsonb(new),
   nullif(current_setting('app.actor_ip',true),'')::inet);
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['clients','order_items','order_photos','tariffs'] loop
  execute format('drop trigger if exists related_audit on public.%I',t);
  execute format('create trigger related_audit after insert or update on public.%I for each row execute function public.audit_related_change()',t);
 end loop;
end $$;

create or replace function public.save_tariff_audited(p_code text,p_data jsonb,p_user uuid,p_ip inet default null) returns public.tariffs
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.tariffs;
begin
 if public.lifecycle_actor(p_user,p_ip)<>'admin' then raise exception using errcode='42501',message='Тарифы меняет только администратор'; end if;
 insert into public.tariffs(code,name,price_per_m2,active) values(p_code,p_data->>'name',(p_data->>'price_per_m2')::numeric,(p_data->>'active')::boolean)
 on conflict(code) do update set name=excluded.name,price_per_m2=excluded.price_per_m2,active=excluded.active returning * into result;
 return result;
end $$;

create or replace function public.register_order_photo(p_item uuid,p_path text,p_kind text,p_user uuid,p_ip inet default null) returns public.order_photos
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r text; o public.orders; result public.order_photos;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 select orders.* into o from public.orders join public.order_items i on i.order_id=orders.id where i.id=p_item for update of orders;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Ковёр не найден'; end if;
 if r not in ('admin','operator') and not(r='driver' and (o.driver_id is not distinct from p_user))
   and not(r='workshop' and o.status in ('received','washing','drying','ready')) then
   raise exception using errcode='42501',message='Недостаточно прав для этого заказа'; end if;
 if p_path is null or p_path !~ ('^'||o.id::text||'/'||p_item::text||'/[a-f0-9-]{36}\.jpg$') then
   raise exception using errcode='23514',message='Неверный путь файла'; end if;
 insert into public.order_photos(item_id,storage_path,kind,created_by) values(p_item,p_path,p_kind,p_user) returning * into result;
 return result;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('lifecycle_actor','order_snapshot','create_order_audited','change_order_status',
 'change_order_status_audited','cancel_order','request_order_deletion','soft_delete_order','restore_order','assign_order_driver',
 'public_order_status','guard_order_lifecycle','audit_order_change','guard_order_child','reject_destructive_mutation',
 'audit_related_change','save_tariff_audited','register_order_photo') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
