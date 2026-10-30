begin;
alter table public.orders add column if not exists pickup_state text not null default 'pending' check(pickup_state in ('pending','picked_up','handed_over','accepted')),
 add column if not exists picked_up_at timestamptz,add column if not exists picked_up_by uuid references public.profiles(id),
 add column if not exists handed_over_at timestamptz,add column if not exists handed_over_by uuid references public.profiles(id),
 add column if not exists workshop_accepted_at timestamptz,add column if not exists workshop_accepted_by uuid references public.profiles(id),
 add column if not exists driver_measurement_closed_at timestamptz;
create index if not exists orders_picked_up_by_idx on public.orders(picked_up_by);
create index if not exists orders_handed_over_by_idx on public.orders(handed_over_by);
create index if not exists orders_workshop_accepted_by_idx on public.orders(workshop_accepted_by);
create index if not exists orders_branch_pickup_state_idx on public.orders(branch_id,pickup_state) where deleted_at is null;
-- Отмечаем только уже подтверждённые старой системой факты; цену и размеры не меняем.
update public.orders o set pickup_state=case
 when o.status in ('washing','drying','ready','delivering','delivered') or exists(select 1 from public.item_measurements m join public.order_items i on i.id=m.item_id where i.order_id=o.id and m.source_role='workshop') then 'accepted'
 when o.status='received' then 'picked_up' else 'pending' end
where o.pickup_state='pending';
alter table public.order_items drop constraint if exists order_items_measurement_origin_check;
alter table public.order_items add constraint order_items_measurement_origin_check check(measurement_origin in ('legacy','pending','driver','workshop'));
create table if not exists public.pickup_events(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),
 event text not null check(event in ('collected','handed_over','accepted')),actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),snapshot jsonb not null default '{}');
create index if not exists pickup_events_order_idx on public.pickup_events(order_id,created_at,id);
create index if not exists pickup_events_actor_idx on public.pickup_events(actor_id);
create or replace function public.crm_pickup_immutable() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception using errcode='55000',message='Журнал передачи изделий неизменяем';end $$;
drop trigger if exists pickup_events_immutable on public.pickup_events;
create trigger pickup_events_immutable before update or delete on public.pickup_events for each row execute function public.crm_pickup_immutable();
drop trigger if exists pickup_events_audit on public.pickup_events;
create trigger pickup_events_audit after insert on public.pickup_events for each row execute function public.crm_audit_change();

create or replace function public.crm_order(p_order uuid,p_user uuid,p_permission text default 'read') returns public.orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;actor public.profiles;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден';end if;
 actor:=public.crm_require(p_user,p_permission,o.branch_id);
 if actor.role::text='driver' and o.driver_id is distinct from p_user and not exists(select 1 from public.visits v where v.order_id=o.id and v.driver_id=p_user and v.state in ('planned','en_route')) then raise exception using errcode='42501',message='Это не ваше задание';end if;
 if actor.role::text='workshop' and not (o.status in ('received','washing','drying','ready') or (o.status='pickup_assigned' and o.pickup_state='handed_over')) then raise exception using errcode='42501',message='Заказ не находится в цехе';end if;
 return o;
end $$;
create or replace function public.crm_reprice_measured(oid uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;sub numeric;area numeric;pending boolean;tot numeric;fee numeric;s jsonb;quote jsonb;
begin
 select * into o from public.orders where id=oid for update;s:=o.pricing_snapshot->'settings';
 select coalesce(sum(price),0),coalesce(sum(area_m2),0),coalesce(bool_or(unit='m2' and measurement_origin not in ('driver','workshop')),false) into sub,area,pending from public.order_items where order_id=oid;
 tot:=round(sub*(o.pricing_snapshot->>'factor')::numeric,-3);fee:=case when sub>0 and sub<(s->>'free_delivery_from')::numeric then (s->>'delivery_fee')::numeric else 0 end;
 quote:=jsonb_build_object('subtotal',sub,'area_m2',area,'adjustment',tot-sub,'delivery_fee',case when pending then 0 else fee end,'total',case when pending then null else tot+fee end,'pending_measurements',pending,'price_basis','driver','measured_at',clock_timestamp());
 update public.orders set subtotal=sub,adjustment=tot-sub,delivery_fee=case when pending then 0 else fee end,total=case when pending then 0 else tot+fee end,
 pricing_state=case when pending then 'awaiting_measurements' else 'priced' end,pricing_snapshot=pricing_snapshot||quote where id=oid;
end $$;
create or replace function public.crm_measure_item(d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;o public.orders;i public.order_items;previous public.item_measurements;driver_sample public.item_measurements;m public.item_measurements;oid uuid;l numeric;w numeric;
begin
 actor:=public.crm_require(u,'read');if actor.role::text not in ('driver','workshop') then raise exception using errcode='42501',message='Замеры выполняют водитель и цех';end if;
 select order_id into oid from public.order_items where id=(d->>'item_id')::uuid;
 if oid is null then raise exception using errcode='P0002',message='Изделие не найдено';end if;
 o:=public.crm_order(oid,u);select * into i from public.order_items where id=(d->>'item_id')::uuid for update;
 if o.measurement_mode<>'verified' or o.status in ('cancelled','delivered','washing','drying','ready','delivering') or o.washing_started_at is not null then raise exception using errcode='55000',message='Замеры этого заказа уже закрыты';end if;
 if actor.role::text='driver' and (o.status not in ('new','pickup_assigned','received') or o.driver_measurement_closed_at is not null or o.pickup_state not in ('pending','picked_up')) then raise exception using errcode='55000',message='Цех уже начал приёмку; замер водителя закрыт';end if;
 if actor.role::text='workshop' and (o.status<>'received' or o.pickup_state<>'accepted') then raise exception using errcode='55000',message='Замер цеха доступен при приёмке';end if;
 l:=(d->>'length_m')::numeric;w:=(d->>'width_m')::numeric;
 if l<>round(l,2) or w<>round(w,2) then raise exception using errcode='23514',message='Укажите размеры с точностью до сантиметра';end if;
 if (l is null)<>(w is null) or (i.unit='m2' and l is null) or l not between .3 and 20 or w not between .3 and 20 then raise exception using errcode='23514',message='Укажите длину и ширину от 0,3 до 20 м';end if;
 if actor.role::text='driver' and i.unit='m2' and (o.payment_recorded_at is not null or o.paid_amount>0 or exists(select 1 from public.payments where order_id=o.id and state in ('confirmed','pending')) or exists(select 1 from public.order_discounts where order_id=o.id)) then raise exception using errcode='55000',message='После оплаты или скидки изменять площадь нельзя';end if;
 select * into previous from public.item_measurements where item_id=i.id and source_role=actor.role::text order by created_at desc,id desc limit 1;
 if d ? 'expected_id' and previous.id is distinct from (d->>'expected_id')::uuid then raise exception using errcode='55000',message='Замер изменился. Обновите карточку';end if;
 if previous.id is not null and previous.length_m is not distinct from l and previous.width_m is not distinct from w then
  if actor.role::text='driver' and i.measurement_origin='pending' then
   update public.order_items set length_m=l,width_m=w,measurement_origin='driver',price=case when unit='piece' then unit_rate else round(l*w*unit_rate) end where id=i.id;
   if i.unit='m2' then perform public.crm_reprice_measured(o.id);end if;
  end if;return to_jsonb(previous);
 end if;
 select * into driver_sample from public.item_measurements where item_id=i.id and source_role='driver' order by created_at desc,id desc limit 1;
 if (previous.id is not null or (actor.role::text='workshop' and driver_sample.area_m2 is not null and abs(driver_sample.area_m2-l*w)>.01)) and length(btrim(coalesce(d->>'reason','')))<3 then raise exception using errcode='23514',message='Укажите причину исправления или расхождения замеров';end if;
 insert into public.item_measurements(item_id,source_role,length_m,width_m,measured_by,measured_name,reason) values(i.id,actor.role::text,l,w,u,actor.full_name,nullif(btrim(d->>'reason'),'')) returning * into m;
 if actor.role::text='driver' then
  update public.order_items set length_m=l,width_m=w,measurement_origin='driver',price=case when unit='piece' then unit_rate else round(l*w*unit_rate) end where id=i.id;
  if i.unit='m2' then perform public.crm_reprice_measured(o.id);end if;
 else
  -- Замер цеха проверяет фактическую площадь, согласованная водителем цена сохраняется.
  update public.order_items set length_m=l,width_m=w,measurement_origin='workshop' where id=i.id;
 end if;
 return to_jsonb(m);
end $$;
create or replace function public.crm_pickup_progress(oid uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('items_count',count(*),'driver_measured_count',count(*) filter(where exists(select 1 from public.item_measurements m where m.item_id=i.id and m.source_role='driver')),
 'photo_items_count',count(*) filter(where exists(select 1 from public.order_photos p where p.item_id=i.id and p.kind='intake')),
 'workshop_measured_count',count(*) filter(where i.measurement_origin='workshop')) from public.order_items i where i.order_id=oid
$$;
create or replace function public.crm_pickup_action(cmd text,d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;progress jsonb;n integer;previous_status public.order_status;
begin
 o:=public.crm_order((d->>'order_id')::uuid,u);a:=public.crm_require(u,'read',o.branch_id);previous_status:=o.status;
 if o.measurement_mode<>'verified' or o.status in ('cancelled','delivered','washing','drying','ready','delivering') then raise exception using errcode='55000',message='Передача этого заказа уже закрыта';end if;
 if o.pickup_state is distinct from d->>'expected_state' then raise exception using errcode='55000',message='Состояние передачи изменилось. Обновите карточку';end if;
 if cmd in ('pickup.collect','pickup.handover') then
  if a.role::text<>'driver' or o.driver_id is distinct from u then raise exception using errcode='42501',message='Это действие выполняет назначенный водитель';end if;
  progress:=public.crm_pickup_progress(o.id);n:=(progress->>'items_count')::integer;
  if n=0 or (progress->>'driver_measured_count')::integer<>n or o.pricing_state<>'priced' then raise exception using errcode='55000',message='Сначала сохраните замеры/количество всех изделий и рассчитайте стоимость';end if;
  if (progress->>'photo_items_count')::integer<>n then raise exception using errcode='55000',message='Добавьте фото каждого изделия и дождитесь загрузки';end if;
  if cmd='pickup.collect' then
   if o.pickup_state<>'pending' then raise exception using errcode='55000',message='Забор уже отмечен';end if;
   update public.orders set pickup_state='picked_up',picked_up_at=clock_timestamp(),picked_up_by=u,driver_measurement_closed_at=clock_timestamp(),status=case when status='new' then 'pickup_assigned'::public.order_status else status end where id=o.id returning * into o;
   if previous_status='new' then insert into public.status_history(order_id,status,changed_by,note) values(o.id,'pickup_assigned',u,'Водитель забрал изделия');end if;
   update public.visits set state='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() where order_id=o.id and kind='pickup' and driver_id=u and state in ('planned','en_route');
  else
   if o.pickup_state<>'picked_up' then raise exception using errcode='55000',message='Сначала отметьте «Забрал»';end if;
   update public.orders set pickup_state='handed_over',handed_over_at=clock_timestamp(),handed_over_by=u,driver_measurement_closed_at=coalesce(driver_measurement_closed_at,clock_timestamp()) where id=o.id returning * into o;
  end if;
 else
  perform public.crm_require(u,'workshop',o.branch_id);
  if a.role::text not in ('workshop','admin') or o.pickup_state<>'handed_over' then raise exception using errcode='55000',message='Сначала водитель должен передать изделия цеху';end if;
  update public.orders set pickup_state='accepted',workshop_accepted_at=clock_timestamp(),workshop_accepted_by=u,status='received',production_stage='received' where id=o.id returning * into o;
  if previous_status<>'received' then insert into public.status_history(order_id,status,changed_by,note) values(o.id,'received',u,'Цех подтвердил приём изделий');end if;
 end if;
 insert into public.pickup_events(order_id,event,actor_id,snapshot) values(o.id,case cmd when 'pickup.collect' then 'collected' when 'pickup.handover' then 'handed_over' else 'accepted' end,u,
  jsonb_build_object('total',o.total,'pricing_snapshot',o.pricing_snapshot,'progress',public.crm_pickup_progress(o.id)));
 return to_jsonb(o)||public.crm_pickup_progress(o.id);
end $$;

create or replace function public.crm_pickup_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.measurement_mode='verified' then
  if new.status='received' and old.status<>'received' and (new.pickup_state<>'accepted' or old.pickup_state<>'handed_over') then raise exception using errcode='55000',message='Цех должен подтвердить приём кнопкой «Принял»';end if;
  if new.status in ('washing','drying','ready','delivering','delivered') and new.pickup_state<>'accepted' then raise exception using errcode='55000',message='Сначала подтвердите передачу и приём изделий цехом';end if;
 end if;return new;
end $$;
drop trigger if exists pickup_order_guard on public.orders;
create trigger pickup_order_guard before update on public.orders for each row execute function public.crm_pickup_guard();

do $$begin if to_regprocedure('public.crm_command_v11(text,jsonb,uuid,inet,uuid)') is null then alter function public.crm_command(text,jsonb,uuid,inet,uuid) rename to crm_command_v11;end if;end $$;
create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare receipt public.command_receipts;result jsonb;o public.orders;i jsonb;a public.profiles;n integer;
begin
 if p_command='visit.event' and p_data->>'event'='completed' and exists(select 1 from public.visits v join public.orders z on z.id=v.order_id where v.id=(p_data->>'visit_id')::uuid and v.kind='pickup' and z.measurement_mode='verified') then
  raise exception using errcode='55000',message='Используйте «Забрал» после замеров и загрузки фото';end if;
 if p_command not in ('pickup.collect','pickup.handover','workshop.accept','order.measure') then return public.crm_command_v11(p_command,p_data,p_user,p_ip,p_key);end if;
 perform public.lifecycle_actor(p_user,p_ip);a:=public.crm_require(p_user,'read');
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));select * into receipt from public.command_receipts where user_id=p_user and key=p_key;
 if found then if receipt.command<>p_command or receipt.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ уже использован для другого действия';end if;return receipt.result;end if;
 if p_command='order.measure' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user);
  select count(*) into n from public.order_items where order_id=o.id;
  if n<>jsonb_array_length(p_data->'items') or n<>(select count(distinct x->>'item_id') from jsonb_array_elements(p_data->'items')x) or exists(select 1 from jsonb_array_elements(p_data->'items')x where not exists(select 1 from public.order_items where id=(x->>'item_id')::uuid and order_id=o.id)) then raise exception using errcode='23514',message='Подтвердите размеры/количество каждого изделия заказа';end if;
  for i in select * from jsonb_array_elements(p_data->'items') loop perform public.crm_measure_item(i,p_user);end loop;
  select * into o from public.orders where id=o.id;result:=jsonb_build_object('order_id',o.id,'total',o.total,'pricing_state',o.pricing_state)||public.crm_pickup_progress(o.id);
 else result:=public.crm_pickup_action(p_command,p_data,p_user);end if;
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);return result;
end $$;

create or replace function public.crm_photo_gallery(d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;cid uuid;oid uuid;rows jsonb;lim integer:=least(greatest(coalesce((d->>'limit')::integer,50),1),100);last_row jsonb;
begin
 a:=public.crm_require(u,'read');bid:=coalesce((d->>'branch_id')::uuid,a.branch_id);oid:=(d->>'order_id')::uuid;cid:=(d->>'client_id')::uuid;
 if oid is not null then
  select client_id,branch_id into cid,bid from public.orders where id=oid and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Заказ не найден';end if;
 end if;
 if bid is not null then perform public.crm_require(u,'read',bid);end if;
 if a.role::text not in ('admin','manager') and (a.branch_id is null or bid is distinct from a.branch_id) then raise exception using errcode='42501',message='Нет доступа к этому филиалу';end if;
 if cid is null or not exists(select 1 from public.orders where client_id=cid and deleted_at is null and (bid is null or branch_id=bid)) then raise exception using errcode='P0002',message='Клиент не найден в филиале';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from(
  select p.id,p.kind,p.created_at,p.storage_path,i.seq,i.order_id,'K-'||o.number code,i.tariff_code
  from public.order_photos p join public.order_items i on i.id=p.item_id join public.orders o on o.id=i.order_id
  where o.client_id=cid and o.deleted_at is null and (oid is null or o.id=oid) and (bid is null or o.branch_id=bid)
   and (d->>'cursor_at' is null or (p.created_at,p.id)<((d->>'cursor_at')::timestamptz,(d->>'cursor_id')::uuid))
  order by p.created_at desc,p.id desc limit lim+1)q;
 last_row:=rows->(lim-1);
 return jsonb_build_object('data',case when jsonb_array_length(rows)>lim then rows-lim else rows end,'next_cursor',case when jsonb_array_length(rows)>lim then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;

do $$begin if to_regprocedure('public.crm_workspace_v11(text,jsonb,uuid)') is null then alter function public.crm_workspace(text,jsonb,uuid) rename to crm_workspace_v11;end if;end $$;
create or replace function public.crm_workspace(p_view text,p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;day date:=coalesce((p_filters->>'date')::date,(now() at time zone 'Asia/Tashkent')::date);lim integer:=least(greatest(coalesce((p_filters->>'limit')::integer,50),1),100);rows jsonb;last_row jsonb;data jsonb;
begin
 if p_view not in ('driver','dispatch','workshop','client') then return public.crm_workspace_v11(p_view,p_filters,p_user);end if;
 a:=public.crm_require(p_user,'read');bid:=coalesce((p_filters->>'branch_id')::uuid,a.branch_id);if bid is not null then perform public.crm_require(p_user,'read',bid);end if;
 if p_view='client' then
  data:=public.crm_workspace_v11(p_view,p_filters,p_user);
  select coalesce(jsonb_agg(x||jsonb_build_object('branch_id',o.branch_id,'pickup_state',o.pickup_state,'photo_count',(select count(*) from public.order_photos p join public.order_items i on i.id=p.item_id where i.order_id=o.id)) order by n),'[]') into rows
   from jsonb_array_elements(data->'orders') with ordinality q(x,n) join public.orders o on o.id=(x->>'id')::uuid;
  return jsonb_set(data,'{orders}',rows);
 elsif p_view in ('driver','dispatch') then
  if p_view='dispatch' then perform public.crm_require(p_user,'dispatch',bid);elsif a.role::text not in ('driver','admin') then raise exception using errcode='42501',message='Нет доступа к заданиям водителя';end if;
  select coalesce(jsonb_agg(q.x order by q.created_at desc,q.id desc),'[]') into rows from(
   select v.id,v.created_at,to_jsonb(v)||jsonb_build_object('code','K-'||o.number,'status',o.status,'address',o.address,'route_address',o.route_address,
    'client_name',c.name,'phone',c.phone,'total',o.total,'paid_amount',o.paid_amount,'urgent',o.urgent,'pricing_state',o.pricing_state,'measurement_mode',o.measurement_mode,
    'pickup_state',o.pickup_state,'can_driver_measure',o.driver_measurement_closed_at is null and o.pickup_state in ('pending','picked_up'))||public.crm_pickup_progress(o.id) x
   from public.visits v join public.orders o on o.id=v.order_id join public.clients c on c.id=o.client_id
   where o.deleted_at is null and o.status<>'cancelled' and (bid is null or v.branch_id=bid)
    and (v.scheduled_date=day or (p_view='driver' and v.kind='pickup' and o.pickup_state in ('picked_up','handed_over')))
    and (p_view<>'driver' or v.driver_id=p_user) and (p_filters->>'driver_id' is null or v.driver_id=(p_filters->>'driver_id')::uuid)
    and (p_view<>'driver' or v.kind<>'pickup' or o.measurement_mode<>'verified' or (v.state in ('planned','en_route','completed') and not exists(select 1 from public.visits newer where newer.order_id=v.order_id and newer.kind=v.kind and newer.driver_id=v.driver_id and newer.state in ('planned','en_route','completed') and (newer.created_at,newer.id)>(v.created_at,v.id))))
    and (p_filters->>'cursor_at' is null or (v.created_at,v.id)<((p_filters->>'cursor_at')::timestamptz,(p_filters->>'cursor_id')::uuid))
   union all
   select o.id,o.created_at,jsonb_build_object('id',o.id,'order_id',o.id,'branch_id',o.branch_id,'driver_id',o.driver_id,'kind','pickup','state','planned','position',0,'created_at',o.created_at,'scheduled_date',o.pickup_date,'slot_code',o.pickup_slot,'zone_code',o.zone_code,
    'code','K-'||o.number,'status',o.status,'address',o.address,'route_address',o.route_address,'client_name',c.name,'phone',c.phone,'total',o.total,'paid_amount',o.paid_amount,'urgent',o.urgent,'pricing_state',o.pricing_state,'measurement_mode',o.measurement_mode,
    'pickup_state',o.pickup_state,'can_driver_measure',o.driver_measurement_closed_at is null and o.pickup_state in ('pending','picked_up'))||public.crm_pickup_progress(o.id)
   from public.orders o join public.clients c on c.id=o.client_id
   where p_view='driver' and o.driver_id=p_user and o.measurement_mode='verified' and o.deleted_at is null and o.status in ('new','pickup_assigned','received') and o.pickup_state<>'accepted'
    and not exists(select 1 from public.visits v where v.order_id=o.id and v.kind='pickup' and v.driver_id=p_user)
    and (p_filters->>'cursor_at' is null or (o.created_at,o.id)<((p_filters->>'cursor_at')::timestamptz,(p_filters->>'cursor_id')::uuid))
   order by created_at desc,id desc limit lim+1)q;
 else
  perform public.crm_require(p_user,'workshop',bid);
  select coalesce(jsonb_agg(q.x order by q.urgent desc,q.created_at,q.id),'[]') into rows from(
   select o.id,o.urgent,o.created_at,jsonb_build_object('id',o.id,'code','K-'||o.number,'status',o.status,'stage',case when o.measurement_mode='verified' and o.pickup_state='handed_over' then 'awaiting_acceptance' else coalesce(o.production_stage,o.status::text) end,
    'urgent',o.urgent,'created_at',o.created_at,'promised_at',o.promised_at,'branch_id',o.branch_id,'pickup_state',o.pickup_state,'measurement_mode',o.measurement_mode,'pricing_state',o.pricing_state,'total',o.total,
    'area_m2',(select sum(i.area_m2) from public.order_items i where i.order_id=o.id),'stage_at',coalesce(o.workshop_accepted_at,o.handed_over_at,o.workshop_received_at,o.created_at),
    'items',(select jsonb_agg(to_jsonb(i) order by i.seq) from public.order_items i where i.order_id=o.id))||public.crm_pickup_progress(o.id) x
   from public.orders o where o.deleted_at is null and (bid is null or o.branch_id=bid)
    and ((o.status in ('received','washing','drying','ready') and (o.measurement_mode='legacy' or o.pickup_state='accepted')) or (o.status in ('pickup_assigned','received') and o.pickup_state='handed_over'))
    and (p_filters->>'stage' is null or case when o.pickup_state='handed_over' then 'awaiting_acceptance' else coalesce(o.production_stage,o.status::text) end=p_filters->>'stage')
    and (p_filters->>'cursor_at' is null or ((case when o.urgent then 0 else 1 end),o.created_at,o.id)>((case when (p_filters->>'cursor_priority')::boolean then 0 else 1 end),(p_filters->>'cursor_at')::timestamptz,(p_filters->>'cursor_id')::uuid))
   order by o.urgent desc,o.created_at,o.id limit lim+1)q;
 end if;
 last_row:=rows->(lim-1);return jsonb_build_object('data',case when jsonb_array_length(rows)>lim then rows-lim else rows end,'next_cursor',case when jsonb_array_length(rows)>lim then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id','priority',last_row->'urgent') else null end);
end $$;

alter table public.pickup_events enable row level security;
revoke all on public.pickup_events from public,anon,authenticated;
grant select,insert on public.pickup_events to service_role;
revoke update,delete,truncate on public.pickup_events from service_role;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',to_regprocedure('public.crm_photo_gallery(jsonb,uuid)') is not null and has_table_privilege(current_user,'public.pickup_events','insert') and has_table_privilege(current_user,'public.item_measurements','insert'),'schema',12)
$$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crm_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';

commit;
