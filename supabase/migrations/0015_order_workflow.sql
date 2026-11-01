begin;
select set_config('app.workflow_maintenance','allowed',true);
-- Retired enum labels remain only for inactive historic profiles. Active access is CHECK-protected.
create table public.role_reassignments(profile_id uuid primary key references public.profiles(id),previous_role text not null,was_active boolean not null,recorded_at timestamptz not null default clock_timestamp());
insert into public.role_reassignments(profile_id,previous_role,was_active) select id,role::text,active from public.profiles where role::text not in ('operator','driver','warehouse','washer','packer','admin');
update public.profiles set active=false where role::text not in ('operator','driver','warehouse','washer','packer','admin') and active;
alter table public.profiles add constraint active_workflow_roles check(not active or role::text in ('operator','driver','warehouse','washer','packer','admin'));
alter table public.profiles add column driver_color text not null default '#f9a8d4' check(driver_color ~ '^#[0-9a-fA-F]{6}$');
create table public.driver_districts(driver_id uuid not null references public.profiles(id),district_code text not null references public.uz_districts(code),primary key(driver_id,district_code));
create index driver_districts_district_idx on public.driver_districts(district_code);
create table public.maintenance_cleanup_runs(key text primary key,completed_at timestamptz not null default clock_timestamp(),counts jsonb not null,storage_manifest jsonb not null);
alter table public.orders add column pickup_driver_id uuid references public.profiles(id),add column delivery_driver_id uuid references public.profiles(id),
 add column pickup_at timestamptz,add column stage_entered_at timestamptz not null default now(),
 add column warehouse_received_at timestamptz,add column warehouse_received_by uuid references public.profiles(id),add column warehouse_verified_at timestamptz,
 add column wash_phase text check(wash_phase in ('acceptance','washing','drying')),add column washer_id uuid references public.profiles(id),
 add column packing_received_at timestamptz,add column packing_received_by uuid references public.profiles(id),
 add column postponed_reason text,add column production_cycle integer not null default 0;
create index orders_pickup_driver_idx on public.orders(pickup_driver_id);
create index orders_delivery_driver_idx on public.orders(delivery_driver_id);
create index orders_warehouse_received_by_idx on public.orders(warehouse_received_by);
create index orders_washer_idx on public.orders(washer_id);
create index orders_packing_received_by_idx on public.orders(packing_received_by);
create index orders_board_idx on public.orders(branch_id,status,stage_entered_at,id) where deleted_at is null;
alter table public.order_items add column quantity integer not null default 1 check(quantity between 1 and 1000);
alter table public.item_measurements drop constraint item_measurements_source_role_check;
alter table public.item_measurements add constraint measurement_roles check(source_role in ('driver','warehouse')) not valid;
alter table public.item_measurements add column quantity integer not null default 1 check(quantity between 1 and 1000),add column production_cycle integer not null default 0;
alter table public.order_items drop constraint order_items_measurement_origin_check;
alter table public.order_items add constraint measurement_origin_roles check(measurement_origin in ('pending','driver','warehouse')) not valid;
alter table public.order_photos add column source_role text,add column production_cycle integer not null default 0;
alter table public.orders add constraint current_workflow_status check(status::text in ('new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled')) not valid;
alter table public.production_events drop constraint if exists production_events_stage_check;
alter table public.piece_rates drop constraint if exists piece_rates_role_check;
alter table public.piece_rates add column active boolean not null default true;
update public.piece_rates set active=false where role not in ('driver','warehouse','washer','packer');
alter table public.piece_rates add constraint active_rate_roles check(not active or role in ('driver','warehouse','washer','packer'));
delete from public.role_permissions;
insert into public.role_permissions(role,permissions) values
('admin','["read", "create", "quote", "cancel", "delete", "restore", "trash", "audit", "photos", "tariffs", "clients", "leads", "calls", "tasks", "payments", "staff", "catalogs", "reports", "exports", "integrations", "inventory", "payroll", "complaints", "discounts", "branches", "admin", "defects"]'::jsonb),
('operator','["read", "create", "quote", "cancel", "requestDeletion", "clients", "leads", "calls", "tasks", "complaints"]'::jsonb),
('driver','["read", "photos", "payments", "tasks", "pickup", "delivery"]'::jsonb),
('warehouse','["read", "warehouse", "measure", "defects"]'::jsonb),
('washer','["read", "wash", "defects"]'::jsonb),
('packer','["read", "pack", "photos", "defects"]'::jsonb);
do $$declare f record;definition text;original_definition text;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' loop
  definition:=pg_get_functiondef(f.signature);original_definition:=definition;
  definition:=replace(definition,'actor.role::text=''workshop''', 'actor.role::text in (''warehouse'',''washer'',''packer'')');
  definition:=replace(replace(replace(definition,'''manager''', '''admin'''),'''dispatcher''', '''admin'''),'''workshop''', '''admin''');
  definition:=replace(replace(replace(definition,'''pickup_assigned''', '''pickup_planned'''),'''received''', '''warehouse'''),'''ready''', '''ready_for_delivery''');
  definition:=replace(definition,'''delivering''', '''in_transit''');
  if definition is distinct from original_definition then execute definition;end if;
 end loop;
end $$;
drop view public.crm_report_facts cascade;
create or replace view public.crm_report_facts with(security_invoker=true) as
 select o.*,c.name as client_name,c.phone as client_phone,
 coalesce(operator.full_name,o.created_by::text,'Не указан') as operator_name,
 coalesce(driver.full_name,o.driver_id::text,'Не назначен') as driver_name,
 coalesce(items.area_m2,0) as area_m2,coalesce(items.item_subtotal,0) as item_subtotal,
 coalesce(history.received_at,o.workshop_received_at) as received_at,history.delivered_at,
 case when o.status='cancelled' then o.completed_work_amount else o.total end as liability,
 case when o.status='cancelled' and o.completed_work_amount is null then null else greatest(case when o.status='cancelled' then o.completed_work_amount else o.total end-o.paid_amount,0) end as outstanding
 from public.orders o join public.clients c on c.id=o.client_id
 left join public.profiles operator on operator.id=o.created_by left join public.profiles driver on driver.id=o.driver_id
 left join lateral(select sum(i.area_m2) area_m2,sum(i.price) item_subtotal from public.order_items i where i.order_id=o.id) items on true
 left join lateral(select min(h.created_at) filter(where h.status='warehouse') received_at,max(h.created_at) filter(where h.status='delivered') delivered_at from public.status_history h where h.order_id=o.id) history on true
 where o.deleted_at is null;
create or replace view public.crm_stage_intervals with(security_invoker=true) as
 select order_id,stage,at,actor_id,lead(at) over(partition by order_id order by at,event_id) as next_at
 from (
 select order_id,status::text stage,created_at at,changed_by actor_id,'h:'||lpad(id::text,20,'0') event_id from public.status_history
 union all select order_id,stage,at,actor_id,'p:'||id::text from public.production_events where stage in ('quality_check','packing')
 ) events;

create or replace function public.crm_report_cohort(f jsonb,p_history boolean default false) returns setof public.crm_report_facts
language sql stable security invoker set search_path=public,pg_temp as $$
 select * from public.crm_report_facts o
 where (p_history or o.created_at>=((f->>'from')::date::timestamp at time zone 'Asia/Tashkent'))
 and o.created_at<(((f->>'to')::date+1)::timestamp at time zone 'Asia/Tashkent')
 and (f->>'branch_id' is null or o.branch_id=(f->>'branch_id')::uuid)
 and (f->>'operator_id' is null or o.created_by=(f->>'operator_id')::uuid)
 and (f->>'driver_id' is null or o.driver_id=(f->>'driver_id')::uuid)
 and (f->>'source' is null or o.source=f->>'source')
$$;

create or replace function public.crm_report(p_name text,p_filters jsonb,p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb:=p_filters;rows jsonb:='[]';summary jsonb:='{}';coverage jsonb:='{}';
 start_at timestamptz;end_at timestamptz;n numeric;total_n numeric;call_n numeric;linked_n numeric;unknown_calls numeric;pickup_n numeric;delivered_n numeric;paid_n numeric;
begin
 perform public.crm_require(p_user,'reports');
 f:=jsonb_build_object('from',coalesce(p_filters->>'from',date_trunc('month',now() at time zone 'Asia/Tashkent')::date::text),
  'to',coalesce(p_filters->>'to',(now() at time zone 'Asia/Tashkent')::date::text))||p_filters;
 start_at:=(f->>'from')::date::timestamp at time zone 'Asia/Tashkent';end_at:=((f->>'to')::date+1)::timestamp at time zone 'Asia/Tashkent';
 if end_at<=start_at or (f->>'to')::date-(f->>'from')::date>3660 then raise exception using errcode='23514',message='Укажите корректный период не более 10 лет';end if;
 case p_name
 when 'funnel' then
  select count(*),count(*) filter(where received_at is not null),count(*) filter(where status='delivered'),count(*) filter(where status='delivered' and paid_amount>=liability)
   into total_n,pickup_n,delivered_n,paid_n from public.crm_report_cohort(f);
  select count(*),count(*) filter(where c.order_id is not null and o.created_at>=start_at and o.created_at<end_at),count(*) filter(where c.outcome in ('ringing','answered') and c.order_id is null)
   into call_n,linked_n,unknown_calls from public.calls c left join public.orders o on o.id=c.order_id
   where c.started_at>=start_at and c.started_at<end_at and (c.order_id is null or o.deleted_at is null)
   and (f->>'branch_id' is null or c.branch_id=(f->>'branch_id')::uuid) and (f->>'operator_id' is null or c.operator_id=(f->>'operator_id')::uuid)
   and (f->>'driver_id' is null or o.driver_id=(f->>'driver_id')::uuid) and (f->>'source' is null or c.source=f->>'source');
  rows:=jsonb_build_array(
   jsonb_build_object('stage','Звонки','count',call_n,'converted',null,'base',null,'conversion',null),
   jsonb_build_object('stage','Заявки','count',total_n,'converted',case when unknown_calls=0 then linked_n end,'base',case when unknown_calls=0 then call_n end,'conversion',case when unknown_calls=0 then linked_n/nullif(call_n,0) end),
   jsonb_build_object('stage','Забрано','count',pickup_n,'converted',pickup_n,'base',total_n,'conversion',pickup_n/nullif(total_n,0)),
   jsonb_build_object('stage','Выполнено','count',delivered_n,'converted',delivered_n,'base',pickup_n,'conversion',delivered_n/nullif(pickup_n,0)),
   jsonb_build_object('stage','Оплачено','count',paid_n,'converted',paid_n,'base',delivered_n,'conversion',paid_n/nullif(delivered_n,0)));
  summary:=jsonb_build_object('calls',call_n,'orders',total_n,'completed',delivered_n,'paid',paid_n);
  coverage:=jsonb_build_object('calls_with_unknown_result',unknown_calls,'linked_calls',linked_n,'calls',call_n);
 when 'cancellations' then
  select count(*) into total_n from public.crm_report_cohort(f);select count(*) into n from public.crm_report_cohort(f) where status='cancelled';
  select coalesce(jsonb_agg(to_jsonb(q) order by q.count desc,q.reason,q.stage,q.operator),'[]') into rows from (
   select coalesce(r.name_ru,'Исторический отказ без причины') as reason,coalesce(o.cancelled_from_status::text,'Неизвестный этап') as stage,o.operator_name as operator,
    count(*)::numeric as count,count(*)::numeric/nullif(n,0) as share,count(*)::numeric/nullif(total_n,0) as cancellation_rate,
    sum(case when o.completed_work_amount is not null then greatest(o.total-o.completed_work_amount,0) end) as lost_revenue,sum(o.completed_work_amount) as work_amount
   from public.crm_report_cohort(f) o left join public.cancel_reasons r on r.code=o.cancel_reason_code where o.status='cancelled' group by 1,2,3) q;
  summary:=jsonb_build_object('orders',total_n,'cancelled',n,'rate',n/nullif(total_n,0),'lost_revenue',case when n=0 then 0 else (select sum(case when completed_work_amount is not null then greatest(total-completed_work_amount,0) end) from public.crm_report_cohort(f) where status='cancelled') end);
 when 'sales' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.day),'[]') into rows from (
   select (case when o.status='delivered' then o.delivered_at else o.cancelled_at end at time zone 'Asia/Tashkent')::date as day,
    count(*) filter(where o.status='delivered')::numeric as orders,
    sum(case when o.status='delivered' then o.total else o.completed_work_amount end) as revenue,
    coalesce(sum(o.completed_work_amount) filter(where o.status='cancelled'),0) as cancelled_work_revenue,
    coalesce(sum(o.total) filter(where o.status='delivered'),0) as delivered_revenue,
    coalesce(sum(o.area_m2) filter(where o.status='delivered'),0) as area_m2,count(*) filter(where o.urgent and o.status='delivered')::numeric as urgent_orders,
    sum(o.total) filter(where o.status='delivered')/nullif(count(*) filter(where o.status='delivered'),0) as average_check,
    count(*) filter(where o.urgent and o.status='delivered')::numeric/nullif(count(*) filter(where o.status='delivered'),0) as urgent_share
   from public.crm_report_cohort(f,true) o where (o.status='delivered' and o.delivered_at>=start_at and o.delivered_at<end_at)
    or (o.status='cancelled' and o.completed_work_amount>0 and o.cancelled_at>=start_at and o.cancelled_at<end_at) group by 1) q;
  select jsonb_build_object('orders',coalesce(sum((x->>'orders')::numeric),0),'revenue',coalesce(sum((x->>'revenue')::numeric),0),'area_m2',coalesce(sum((x->>'area_m2')::numeric),0),
   'average_check',sum((x->>'delivered_revenue')::numeric)/nullif(sum((x->>'orders')::numeric),0),'urgent_share',sum((x->>'urgent_orders')::numeric)/nullif(sum((x->>'orders')::numeric),0)) into summary from jsonb_array_elements(rows) x;
 when 'mix' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.base_revenue desc,q.tariff),'[]') into rows from (
   select t.name as tariff,sum(i.quantity)::numeric as items,sum(i.area_m2) area_m2,sum(i.price) base_revenue
   from public.crm_report_cohort(f,true) o join public.order_items i on i.order_id=o.id join public.tariffs t on t.code=i.tariff_code
   where o.status='delivered' and o.delivered_at>=start_at and o.delivered_at<end_at group by 1) q;
  select jsonb_build_object('items',coalesce(sum((x->>'items')::numeric),0),'area_m2',coalesce(sum((x->>'area_m2')::numeric),0),'base_revenue',coalesce(sum((x->>'base_revenue')::numeric),0)) into summary from jsonb_array_elements(rows) x;
 when 'turnaround' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.stage),'[]') into rows from (
   select s.stage,count(*)::numeric as stages,count(*) filter(where s.next_at is not null)::numeric as completed_stages,
    sum(extract(epoch from coalesce(s.next_at,clock_timestamp())-s.at)/3600) as total_hours,
    sum(extract(epoch from s.next_at-s.at)/3600) filter(where s.next_at is not null) as completed_hours,
    avg(extract(epoch from s.next_at-s.at)/3600) filter(where s.next_at is not null) as average_hours,
    count(*) filter(where s.next_at is null)::numeric as in_progress
   from public.crm_stage_intervals s join public.crm_report_cohort(f) o on o.id=s.order_id where s.stage not in ('cancelled','delivered') group by 1) q;
  select jsonb_build_object('completed',count(*) filter(where status='delivered'),
   'average_hours',avg(extract(epoch from delivered_at-created_at)/3600) filter(where status='delivered'),
   'late_orders',count(*) filter(where (status='delivered' and delivered_at>promised_at) or (status not in ('delivered','cancelled') and promised_at<clock_timestamp()))) into summary from public.crm_report_cohort(f);
 when 'logistics' then
  select coalesce(jsonb_agg(to_jsonb(q) order by q.visits desc,q.driver),'[]') into rows from (
   select coalesce(p.full_name,'Не назначен') as driver,count(*)::numeric as visits,count(*) filter(where v.state='completed')::numeric as completed,
    count(*) filter(where v.state='completed')::numeric/nullif(count(*) filter(where v.state in ('completed','failed')),0) as success_rate,
    count(*) filter(where v.state='failed')::numeric as failed,
    count(*)-count(distinct(v.order_id,v.kind)) as repeat_visits,
    sum(extract(epoch from v.arrived_at-v.departed_at)/60) filter(where v.arrived_at is not null and v.departed_at is not null) as travel_minutes,
    count(*) filter(where v.arrived_at is not null and v.departed_at is not null)::numeric as measured_visits,
    avg(extract(epoch from v.arrived_at-v.departed_at)/60) filter(where v.arrived_at is not null and v.departed_at is not null) as average_travel_minutes
   from public.visits v join public.crm_report_facts o on o.id=v.order_id left join public.profiles p on p.id=v.driver_id
   where v.scheduled_date>=(f->>'from')::date and v.scheduled_date<=(f->>'to')::date
   and (f->>'branch_id' is null or v.branch_id=(f->>'branch_id')::uuid) and (f->>'operator_id' is null or o.created_by=(f->>'operator_id')::uuid)
   and (f->>'driver_id' is null or v.driver_id=(f->>'driver_id')::uuid) and (f->>'source' is null or o.source=f->>'source') group by 1) q;
  select jsonb_build_object('visits',coalesce(sum((x->>'visits')::numeric),0),'completed',coalesce(sum((x->>'completed')::numeric),0),'measured_visits',coalesce(sum((x->>'measured_visits')::numeric),0)) into summary from jsonb_array_elements(rows) x;
  coverage:=jsonb_build_object('travel_requires_arrival',true);
 when 'quality' then
  with days as(select generate_series((f->>'from')::date,(f->>'to')::date,interval '1 day')::date as day),
   claims as(select (c.created_at at time zone 'Asia/Tashkent')::date as day,count(*)::numeric complaints,count(*) filter(where c.resolution='rewash')::numeric rewashes
    from public.complaints c join public.crm_report_cohort(f,true) o on o.id=c.order_id where c.created_at>=start_at and c.created_at<end_at group by 1),
   ratings as(select (r.created_at at time zone 'Asia/Tashkent')::date as day,count(*)::numeric responses,count(*) filter(where r.score>=9)::numeric promoters,
    count(*) filter(where r.score<=6)::numeric detractors,avg(r.score) average_score from public.feedback r join public.crm_report_cohort(f,true) o on o.id=r.order_id where r.created_at>=start_at and r.created_at<end_at group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'complaints',coalesce(c.complaints,0),'rewashes',coalesce(c.rewashes,0),'responses',coalesce(r.responses,0),
   'promoters',coalesce(r.promoters,0),'detractors',coalesce(r.detractors,0),'nps',100*(r.promoters-r.detractors)/nullif(r.responses,0),'average_score',r.average_score) order by d.day),'[]') into rows
   from days d left join claims c using(day) left join ratings r using(day) where c.complaints is not null or r.responses is not null;
  select jsonb_build_object('complaints',coalesce(sum((x->>'complaints')::numeric),0),'rewashes',coalesce(sum((x->>'rewashes')::numeric),0),
   'responses',coalesce(sum((x->>'responses')::numeric),0),'nps',100*(sum((x->>'promoters')::numeric)-sum((x->>'detractors')::numeric))/nullif(sum((x->>'responses')::numeric),0)) into summary from jsonb_array_elements(rows) x;
 when 'debt' then
  select coalesce(jsonb_agg(jsonb_build_object('code','K-'||o.number,'client',o.client_name,'day',(o.created_at at time zone 'Asia/Tashkent')::date,
   'liability',o.liability,'paid',o.paid_amount,'debt',o.outstanding,'age_days',greatest((now() at time zone 'Asia/Tashkent')::date-(o.created_at at time zone 'Asia/Tashkent')::date,0),'phone',o.client_phone)
   order by o.outstanding desc,o.number),'[]') into rows from public.crm_report_cohort(f) o where o.outstanding>0;
  select jsonb_build_object('orders',count(*),'debt',coalesce(sum(outstanding),0),'paid',coalesce(sum(paid_amount),0)) into summary from public.crm_report_cohort(f) where outstanding>0;
 when 'retention' then
  select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object('repeat_client',case when q.orders>=2 then 1 else 0 end,'sleeping',case when q.days_since>=coalesce((f->>'dormant_days')::integer,90) then 1 else 0 end)
    order by q.days_since desc,q.client),'[]') into rows from (
   select o.client_name as client,min((o.created_at at time zone 'Asia/Tashkent')::date) as first_order,max((o.created_at at time zone 'Asia/Tashkent')::date) as last_order,
    count(*)::numeric as orders,count(*) filter(where o.created_at>=start_at)::numeric as period_orders,
    count(*) filter(where o.created_at>=start_at and o.sequence>1)::numeric as repeat_period_orders,
    greatest((f->>'to')::date-max((o.created_at at time zone 'Asia/Tashkent')::date),0) as days_since
   from (select source_row.*,row_number() over(partition by source_row.client_id order by source_row.created_at,source_row.id) sequence from public.crm_report_cohort(f,true) source_row where source_row.status<>'cancelled') o group by o.client_id,o.client_name) q;
  select jsonb_build_object('clients',count(*),'repeat_clients',coalesce(sum((x->>'repeat_client')::numeric),0),'repeat_share',sum((x->>'repeat_client')::numeric)/nullif(count(*),0),
   'sleeping',coalesce(sum((x->>'sleeping')::numeric),0),'dormant_days',coalesce((f->>'dormant_days')::integer,90),'repeat_order_share',sum((x->>'repeat_period_orders')::numeric)/nullif(sum((x->>'period_orders')::numeric),0)) into summary from jsonb_array_elements(rows) x;
 else raise exception using errcode='23514',message='Неизвестный отчёт';end case;
 coverage:=coverage||jsonb_build_object('delivered_without_time',(select count(*) from public.crm_report_cohort(f,true) where status='delivered' and delivered_at is null),
  'cancelled_work_unknown',(select count(*) from public.crm_report_cohort(f) where status='cancelled' and completed_work_amount is null));
 return jsonb_build_object('name',p_name,'filters',f,'rows',rows,'summary',summary,'coverage',coverage,'generated_at',clock_timestamp(),'total_rows',jsonb_array_length(rows));
end $$;


create or replace function public.crm_business_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;o public.orders;v public.visits;payment public.payments;previous public.command_receipts;
 result jsonb;bid uuid;rid uuid;cid uuid;stage text;next_stage text;cap numeric;target public.profiles;
begin
 if p_command='staff.update' then perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));end if;
 perform public.lifecycle_actor(p_user,p_ip);actor:=public.crm_require(p_user,'read');
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
 select * into previous from public.command_receipts where user_id=p_user and key=p_key;
 if found then
  if previous.command<>p_command or previous.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ уже использован для другого действия';end if;
  return previous.result;
 end if;
 bid:=coalesce((p_data->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');
 case p_command
 when 'photo.register' then result:=to_jsonb(public.register_order_photo((p_data->>'item_id')::uuid,p_data->>'path',p_data->>'kind',p_user,p_ip));
 when 'lead.save' then
  perform public.crm_require(p_user,'leads',bid);
  if p_data->>'outcome'='refused' and not exists(select 1 from public.cancel_reasons where code=p_data->>'reason_code' and active) then
   raise exception using errcode='23514',message='Укажите причину отказа';end if;
  if p_data->>'outcome'='callback' and p_data->>'callback_at' is null then raise exception using errcode='23514',message='Укажите время перезвона';end if;
  select id into cid from public.clients where phone_key=right(regexp_replace(p_data->>'phone','\D','','g'),9);
  insert into public.leads(branch_id,client_id,phone,name,source,outcome,reason_code,comment,callback_at,created_by)
  values(bid,cid,p_data->>'phone',coalesce(p_data->>'name',''),coalesce(p_data->>'source','call_in'),p_data->>'outcome',p_data->>'reason_code',coalesce(p_data->>'comment',''),(p_data->>'callback_at')::timestamptz,p_user) returning to_jsonb(leads.*) into result;
  if p_data->>'callback_at' is not null then
   insert into public.tasks(branch_id,title,due_at,assigned_to,client_id,note,created_by) values(bid,'Перезвонить: '||(p_data->>'phone'),(p_data->>'callback_at')::timestamptz,p_user,cid,coalesce(p_data->>'comment',''),p_user);
  end if;
 when 'lead.convert' then
  select branch_id into bid from public.leads where id=(p_data->>'lead_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Обращение не найдено';end if;
  perform public.crm_require(p_user,'leads',bid);o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'read');
  if o.branch_id<>bid then raise exception using errcode='42501',message='Заказ из другого филиала';end if;
  update public.leads set outcome='converted',order_id=o.id,updated_at=clock_timestamp() where id=(p_data->>'lead_id')::uuid returning to_jsonb(leads.*) into result;
 when 'client.address' then
  perform public.crm_require(p_user,'clients',bid);
  if not exists(select 1 from public.clients where id=(p_data->>'client_id')::uuid) then raise exception using errcode='P0002',message='Клиент не найден';end if;
  insert into public.client_addresses(client_id,label,address,region_code,district_code,street,house,apartment,landmark,private_house,created_by)
  values((p_data->>'client_id')::uuid,coalesce(p_data->>'label',''),public.crm_format_address(p_data),p_data->>'region_code',p_data->>'district_code',p_data->>'street',p_data->>'house',p_data->>'apartment',p_data->>'landmark',coalesce((p_data->>'private_house')::boolean,false),p_user)
  on conflict(client_id,address) do update set label=excluded.label
  returning to_jsonb(client_addresses.*) into result;
 when 'call.log' then
  perform public.crm_require(p_user,'calls',bid);
  select id into cid from public.clients where phone_key=right(regexp_replace(p_data->>'phone','\D','','g'),9);
  if p_data->>'order_id' is not null then o:=public.crm_order((p_data->>'order_id')::uuid,p_user);if o.branch_id<>bid then raise exception using errcode='42501',message='Заказ из другого филиала';end if;end if;
  insert into public.calls(branch_id,phone,direction,outcome,source,client_id,order_id,operator_id,recording_url,ended_at)
  values(bid,p_data->>'phone',p_data->>'direction',p_data->>'outcome',coalesce(p_data->>'source','call_in'),cid,(p_data->>'order_id')::uuid,p_user,p_data->>'recording_url',case when p_data->>'outcome'<>'ringing' then clock_timestamp() end)
  returning to_jsonb(calls.*) into result;
 when 'task.save' then
  perform public.crm_require(p_user,'tasks',bid);
  rid:=coalesce((p_data->>'assigned_to')::uuid,p_user);
  if rid<>p_user and actor.role::text not in ('admin','admin') then raise exception using errcode='42501',message='Можно создавать напоминания только себе';end if;
  if not exists(select 1 from public.profiles where id=rid and active and (branch_id=bid or role::text in ('admin','admin'))) then raise exception using errcode='23514',message='Исполнитель не найден';end if;
  if p_data->>'order_id' is not null then o:=public.crm_order((p_data->>'order_id')::uuid,p_user);bid:=o.branch_id;end if;
  insert into public.tasks(branch_id,title,due_at,assigned_to,order_id,client_id,note,created_by)
  values(bid,p_data->>'title',(p_data->>'due_at')::timestamptz,rid,(p_data->>'order_id')::uuid,(p_data->>'client_id')::uuid,coalesce(p_data->>'note',''),p_user)
  returning to_jsonb(tasks.*) into result;
 when 'task.complete' then
  select branch_id,assigned_to into bid,rid from public.tasks where id=(p_data->>'task_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Напоминание не найдено';end if;
  perform public.crm_require(p_user,'tasks',bid);
  if rid<>p_user and actor.role::text not in ('admin','admin') then raise exception using errcode='42501',message='Это не ваше напоминание';end if;
  update public.tasks set status='done',completed_at=clock_timestamp() where id=(p_data->>'task_id')::uuid returning to_jsonb(tasks.*) into result;
 when 'order.defect' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'defects');
  if not exists(select 1 from public.catalog_entries c where c.kind='defect' and c.code=p_data->>'defect_code' and c.branch_id=o.branch_id and c.active) then raise exception using errcode='23514',message='Выберите тип дефекта';end if;
  if p_data->>'item_id' is not null and not exists(select 1 from public.order_items where id=(p_data->>'item_id')::uuid and order_id=o.id) then raise exception using errcode='23514',message='Ковёр не относится к этому заказу';end if;
  if p_data->>'photo_id' is not null and not exists(select 1 from public.order_photos p join public.order_items i on i.id=p.item_id where p.id=(p_data->>'photo_id')::uuid and i.order_id=o.id) then raise exception using errcode='23514',message='Фото не относится к этому заказу';end if;
  insert into public.order_defects(order_id,item_id,defect_code,note,photo_id,created_by) values(o.id,(p_data->>'item_id')::uuid,p_data->>'defect_code',p_data->>'note',(p_data->>'photo_id')::uuid,p_user) returning to_jsonb(order_defects.*) into result;
 when 'payment.record' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'payments');
  cap:=case when o.status='cancelled' then coalesce(o.completed_work_amount,0) else o.total end;
  if (p_data->>'amount')::numeric<=0 or (p_data->>'amount')::numeric<>trunc((p_data->>'amount')::numeric) or (p_data->>'amount')::numeric>cap-o.paid_amount then raise exception using errcode='23514',message='Сумма превышает задолженность или не является целой положительной суммой';end if;
  if p_data->>'method' not in ('cash','terminal','bank') then raise exception using errcode='23514',message='Онлайн-оплата подтверждается платёжным провайдером';end if;
  stage:=case when p_data->>'method'='cash' or actor.role::text='admin' then 'confirmed' else 'pending' end;
  insert into public.payments(order_id,branch_id,amount,method,state,received_by,note,confirmed_at,confirmed_by)
  values(o.id,o.branch_id,(p_data->>'amount')::numeric,p_data->>'method',stage,p_user,coalesce(p_data->>'note',''),case when stage='confirmed' then clock_timestamp() end,case when stage='confirmed' then p_user end)
  returning to_jsonb(payments.*) into result;
  if stage='confirmed' then update public.orders set paid_amount=paid_amount+(p_data->>'amount')::numeric where id=o.id;end if;
 when 'payment.confirm' then
  if actor.role::text not in ('admin','admin') then raise exception using errcode='42501',message='Подтверждение доступно администратору';end if;
  select order_id into rid from public.payments where id=(p_data->>'payment_id')::uuid;
  if not found then raise exception using errcode='P0002',message='Оплата не найдена';end if;
  o:=public.crm_order(rid,p_user,'payments');select * into payment from public.payments where id=(p_data->>'payment_id')::uuid for update;
  if payment.state<>'pending' then raise exception using errcode='55000',message='Оплата уже рассмотрена';end if;
  if coalesce((p_data->>'confirm')::boolean,true) then
   cap:=case when o.status='cancelled' then coalesce(o.completed_work_amount,0) else o.total end;
   if payment.amount>cap-o.paid_amount then raise exception using errcode='55000',message='Оплата превышает текущую задолженность';end if;
   update public.orders set paid_amount=paid_amount+payment.amount where id=o.id;
  end if;
  update public.payments set state=case when coalesce((p_data->>'confirm')::boolean,true) then 'confirmed' else 'rejected' end,confirmed_at=clock_timestamp(),confirmed_by=p_user where id=payment.id returning to_jsonb(payments.*) into result;
 when 'tariff.schedule' then
  if (p_data->>'code'='carpet' and coalesce(p_data->>'unit','m2')<>'m2') or (p_data->>'code' in ('blanket','tushak') and coalesce(p_data->>'unit','piece')<>'piece') then raise exception using errcode='23514',message='Проверьте единицу расчёта тарифа';end if;
  perform public.crm_require(p_user,'tariffs',bid);
  if (p_data->>'effective_at')::timestamptz<clock_timestamp()-interval '1 minute' then raise exception using errcode='23514',message='Тариф нельзя вводить задним числом';end if;
  insert into public.tariffs(code,name,price_per_m2,active) values(p_data->>'code',p_data->>'name',(p_data->>'price_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true)) on conflict(code) do nothing;
  insert into public.tariff_versions(code,branch_id,name,price_per_m2,active,effective_at,created_by,unit)
  values(p_data->>'code',bid,p_data->>'name',(p_data->>'price_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true),(p_data->>'effective_at')::timestamptz,p_user,coalesce(p_data->>'unit',case when p_data->>'code' in ('blanket','tushak') then 'piece' else 'm2' end)) returning to_jsonb(tariff_versions.*) into result;
 when 'setting.schedule' then
  perform public.crm_require(p_user,'tariffs',bid);
  if (p_data->>'effective_at')::timestamptz<clock_timestamp()-interval '1 minute' then raise exception using errcode='23514',message='Параметр нельзя вводить задним числом';end if;
  if (p_data->>'key' in ('urgent_pct','stains_pct') and (p_data->>'value')::numeric not between 0 and 2)
   or (p_data->>'key'='pensioner_pct' and (p_data->>'value')::numeric not between -1 and 0)
   or (p_data->>'key' in ('delivery_fee','free_delivery_from') and (p_data->>'value')::numeric<0) then raise exception using errcode='23514',message='Значение параметра вне допустимого диапазона';end if;
  insert into public.setting_versions(key,value,branch_id,effective_at,created_by) values(p_data->>'key',(p_data->>'value')::numeric,bid,(p_data->>'effective_at')::timestamptz,p_user) returning to_jsonb(setting_versions.*) into result;
 when 'catalog.save' then
  perform public.crm_require(p_user,'catalogs',bid);
  if p_data->>'kind'='cancel_reason' then
   insert into public.cancel_reasons(code,name_ru,name_uz,active,position) values(p_data->>'code',p_data->>'name_ru',p_data->>'name_uz',coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'position')::integer,0))
   on conflict(code) do update set name_ru=excluded.name_ru,name_uz=excluded.name_uz,active=excluded.active,position=excluded.position returning to_jsonb(cancel_reasons.*) into result;
  else
   insert into public.catalog_entries(kind,code,name_ru,name_uz,branch_id,active,position,config)
   values(p_data->>'kind',p_data->>'code',p_data->>'name_ru',p_data->>'name_uz',bid,coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'position')::integer,0),coalesce(p_data->'config','{}'))
   on conflict(kind,code,branch_id) do update set name_ru=excluded.name_ru,name_uz=excluded.name_uz,active=excluded.active,position=excluded.position,config=excluded.config returning to_jsonb(catalog_entries.*) into result;
  end if;
 when 'template.save' then
  perform public.crm_require(p_user,'catalogs',bid);
  insert into public.notification_templates(branch_id,code,channel,locale,body,active) values(bid,p_data->>'code',p_data->>'channel',coalesce(p_data->>'locale','ru'),p_data->>'body',coalesce((p_data->>'active')::boolean,true))
  on conflict(branch_id,code,channel,locale) do update set body=excluded.body,active=excluded.active returning to_jsonb(notification_templates.*) into result;
 when 'branch.save' then
  perform public.crm_require(p_user,'branches');
  insert into public.branches(code,name,address,phone,active,workshop_capacity_m2,sla_hours)
  values(p_data->>'code',p_data->>'name',coalesce(p_data->>'address',''),p_data->>'phone',coalesce((p_data->>'active')::boolean,true),coalesce((p_data->>'workshop_capacity_m2')::numeric,500),coalesce((p_data->>'sla_hours')::integer,72))
  on conflict(code) do update set name=excluded.name,address=excluded.address,phone=excluded.phone,active=excluded.active,workshop_capacity_m2=excluded.workshop_capacity_m2,sla_hours=excluded.sla_hours returning to_jsonb(branches.*) into result;
  insert into public.catalog_entries(kind,code,name_ru,name_uz,branch_id,active,position,config)
   select c.kind,c.code,c.name_ru,c.name_uz,(result->>'id')::uuid,c.active,c.position,c.config from public.catalog_entries c
   where c.branch_id='01000000-0000-4000-8000-000000000001' on conflict(kind,code,branch_id) do nothing;
 when 'staff.update' then
  if p_data->>'role' not in ('operator','driver','warehouse','washer','packer','admin') then raise exception using errcode='23514',message='Выберите действующую роль';end if;
  if p_data->>'role'='driver' and (jsonb_array_length(coalesce(p_data->'district_codes','[]'))=0 or exists(select 1 from jsonb_array_elements_text(p_data->'district_codes') x where not exists(select 1 from public.uz_districts d where d.code=x))) then raise exception using errcode='23514',message='Назначьте водителю районы из справочника';end if;
  perform public.crm_require(p_user,'staff');perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
  select * into target from public.profiles where id=(p_data->>'user_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Сотрудник не найден';end if;
  if target.role='admin' and (p_data->>'role'<>'admin' or not (p_data->>'active')::boolean) and not exists(select 1 from public.profiles where id<>target.id and active and role='admin') then
   raise exception using errcode='55000',message='Нельзя отключить последнего администратора';end if;
  if p_data->>'role'<>'admin' and not exists(select 1 from public.branches where id=(p_data->>'branch_id')::uuid and active) then raise exception using errcode='23514',message='Укажите действующий филиал';end if;
  update public.profiles set role=(p_data->>'role')::public.user_role,active=(p_data->>'active')::boolean,full_name=p_data->>'full_name',phone=p_data->>'phone',branch_id=(p_data->>'branch_id')::uuid
  where id=target.id returning to_jsonb(profiles.*) into result;
  update public.profiles set driver_color=coalesce(p_data->>'driver_color',driver_color) where id=target.id;
  delete from public.driver_districts where driver_id=target.id;
  if p_data->>'role'='driver' then insert into public.driver_districts(driver_id,district_code) select distinct target.id,x from jsonb_array_elements_text(p_data->'district_codes') x;end if;
  select to_jsonb(p)||jsonb_build_object('district_codes',(select coalesce(jsonb_agg(district_code),'[]') from public.driver_districts where driver_id=p.id)) into result from public.profiles p where p.id=target.id;
 else result:=public.crm_extension(p_command,p_data,p_user,p_ip);
 end case;
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);
 return result;
end $$;
create or replace function public.crm_extension(p_command text,p_data jsonb,p_user uuid,p_ip inet) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;o public.orders;bid uuid;rid uuid;cid uuid;obj jsonb;result jsonb;r public.discount_rules;a public.intake_acts;
 c public.complaints;m public.materials;job public.rewash_jobs;amount numeric;cap numeric;n integer;next_stage text;business_date date;qty numeric;
begin
 actor:=public.crm_require(p_user,'read');bid:=coalesce((p_data->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');
 case p_command
 when 'call.link' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'calls');
  select branch_id into bid from public.calls where id=(p_data->>'call_id')::uuid for update;
  if bid is null or bid<>o.branch_id then raise exception using errcode='42501',message='Звонок и заказ должны относиться к вашему филиалу';end if;
  update public.calls set order_id=o.id,client_id=o.client_id where id=(p_data->>'call_id')::uuid returning to_jsonb(calls.*) into result;
 when 'discount.rule' then
  perform public.crm_require(p_user,'discounts',bid);
  insert into public.discount_rules(branch_id,code,kind,percent,min_orders,min_total,max_uses,valid_from,valid_to,active)
  values(bid,upper(p_data->>'code'),p_data->>'kind',(p_data->>'percent')::numeric,coalesce((p_data->>'min_orders')::integer,0),coalesce((p_data->>'min_total')::numeric,0),(p_data->>'max_uses')::integer,(p_data->>'valid_from')::timestamptz,(p_data->>'valid_to')::timestamptz,coalesce((p_data->>'active')::boolean,true))
  on conflict(branch_id,code) do update set kind=excluded.kind,percent=excluded.percent,min_orders=excluded.min_orders,min_total=excluded.min_total,max_uses=excluded.max_uses,valid_from=excluded.valid_from,valid_to=excluded.valid_to,active=excluded.active returning to_jsonb(discount_rules.*) into result;
 when 'discount.apply' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'create');
  if o.status not in ('new','pickup_planned','warehouse') or o.pricing_state<>'priced' or o.washing_started_at is not null or o.pensioner or exists(select 1 from public.order_discounts where order_id=o.id) then raise exception using errcode='55000',message='Скидка недоступна на этом этапе или уже применена';end if;
  if exists(select 1 from public.payment_intents where order_id=o.id and state=1) then raise exception using errcode='55000',message='Сначала завершите или отмените онлайн-оплату';end if;
  select count(*) into n from public.orders where client_id=o.client_id and status='delivered' and deleted_at is null;
  select * into r from public.discount_rules where branch_id=o.branch_id and active and valid_from<=now() and valid_to>now()
   and min_orders<=n and min_total<=o.total and (max_uses is null or uses<max_uses)
   and ((nullif(p_data->>'code','') is not null and code=upper(p_data->>'code')) or (nullif(p_data->>'code','') is null and kind='loyalty')) order by percent desc,id limit 1 for update;
  if not found then raise exception using errcode='23514',message='Подходящее правило скидки не найдено';end if;
  amount:=round(greatest(o.total-o.delivery_fee,0)*r.percent/100);if o.total-amount<o.paid_amount then raise exception using errcode='55000',message='Скидка уменьшает цену ниже полученной оплаты';end if;
  update public.discount_rules set uses=uses+1 where id=r.id;
  insert into public.order_discounts(order_id,rule_id,original_total,amount,snapshot,created_by) values(o.id,r.id,o.total,amount,to_jsonb(r),p_user) returning to_jsonb(order_discounts.*) into result;
  update public.orders set adjustment=adjustment-amount,total=total-amount,pricing_snapshot=pricing_snapshot||jsonb_build_object('discount',result) where id=o.id;
 when 'payment.refund' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'payments');if actor.role::text<>'admin' then raise exception using errcode='42501',message='Возврат оформляет администратор';end if;
  amount:=(p_data->>'amount')::numeric;if amount<=0 or amount<>trunc(amount) or amount>o.paid_amount then raise exception using errcode='23514',message='Сумма возврата превышает оплату';end if;
  if p_data->>'method' not in ('cash','terminal','bank') then raise exception using errcode='23514',message='Онлайн-возврат подтверждается провайдером';end if;
  select coalesce(sum(case when pp.direction='payment' then pp.amount else -pp.amount end),0) into cap from public.payments pp where pp.order_id=o.id and pp.method=p_data->>'method' and pp.state='confirmed';
  if amount>cap then raise exception using errcode='23514',message='Недостаточно оплат выбранным способом';end if;
  insert into public.payments(order_id,branch_id,amount,method,direction,received_by,note,confirmed_at,confirmed_by) values(o.id,o.branch_id,amount,p_data->>'method','refund',p_user,p_data->>'note',clock_timestamp(),p_user) returning to_jsonb(payments.*) into result;
  update public.orders set paid_amount=paid_amount-amount where id=o.id;
 when 'cash.close' then
  perform public.crm_require(p_user,'payments',bid);if actor.role::text not in ('admin','admin') then raise exception using errcode='42501',message='Сверку подтверждает администратор';end if;
  rid:=(p_data->>'driver_id')::uuid;business_date:=(p_data->>'day')::date;
  if business_date> (now() at time zone 'Asia/Tashkent')::date or not exists(select 1 from public.profiles where id=rid and branch_id=bid and role='driver') then raise exception using errcode='23514',message='Проверьте дату и водителя филиала';end if;
  perform pg_advisory_xact_lock(hashtextextended('cash:'||rid::text||business_date::text,0));
  select coalesce(sum(case when pp.direction='payment' then pp.amount else -pp.amount end),0) into amount from public.payments pp where pp.method='cash' and pp.state='confirmed' and pp.received_by=rid and (pp.created_at at time zone 'Asia/Tashkent')::date=business_date;
  insert into public.cash_closings(branch_id,driver_id,day,expected,counted,difference,note,confirmed_by) values(bid,rid,business_date,amount,(p_data->>'counted')::numeric,(p_data->>'counted')::numeric-amount,p_data->>'note',p_user) returning to_jsonb(cash_closings.*) into result;
 when 'payment.intent' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'payments');amount:=(p_data->>'amount')::numeric;
  cap:=case when o.status='cancelled' then coalesce(o.completed_work_amount,0) else o.total end-o.paid_amount;
  if amount<=0 or amount<>trunc(amount) or amount>cap then raise exception using errcode='23514',message='Сумма превышает долг';end if;
  insert into public.payment_intents(order_id,provider,amount,created_by) values(o.id,p_data->>'provider',amount,p_user) returning to_jsonb(payment_intents.*) into result;
 when 'client.preferences' then
  perform public.crm_require(p_user,'clients',bid);cid:=(p_data->>'client_id')::uuid;
  if actor.role::text<>'admin' and not exists(select 1 from public.orders where client_id=cid and branch_id=bid and deleted_at is null) then raise exception using errcode='42501',message='Клиент не найден в филиале';end if;
  if p_data ? 'blacklisted' and actor.role::text<>'admin' then raise exception using errcode='42501',message='Чёрный список изменяет администратор';end if;
  if coalesce((p_data->>'blacklisted')::boolean,false) and length(btrim(coalesce(p_data->>'blacklist_reason','')))=0 then raise exception using errcode='23514',message='Укажите причину чёрного списка';end if;
  if p_data ? 'tags' and (jsonb_typeof(p_data->'tags')<>'array' or jsonb_array_length(p_data->'tags')>20) then raise exception using errcode='23514',message='Допустимо до 20 тегов';end if;
  update public.clients set tags=coalesce(p_data->'tags',tags),blacklisted=coalesce((p_data->>'blacklisted')::boolean,blacklisted),blacklist_reason=coalesce(p_data->>'blacklist_reason',blacklist_reason),sms_consent=coalesce((p_data->>'sms_consent')::boolean,sms_consent),telegram_consent=coalesce((p_data->>'telegram_consent')::boolean,telegram_consent),telegram_chat_id=coalesce(p_data->>'telegram_chat_id',telegram_chat_id) where id=cid returning jsonb_build_object('id',id,'tags',tags,'blacklisted',blacklisted,'sms_consent',sms_consent,'telegram_consent',telegram_consent) into result;
  if result is null then raise exception using errcode='P0002',message='Клиент не найден';end if;
 when 'intake.create' then
  if actor.role::text in ('warehouse','washer','packer') then raise exception using errcode='42501',message='Акт оформляет сотрудник приёмки или водитель';end if;
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'photos');if o.status not in ('pickup_assigned','warehouse') then raise exception using errcode='55000',message='Акт создаётся при приёмке';end if;
  if exists(select 1 from public.intake_acts where order_id=o.id and confirmed_at is null) then raise exception using errcode='55000',message='Уже есть неподтверждённый акт';end if;
  obj:=jsonb_build_object('code','K-'||o.number,'address',o.address,'total',o.total,'note',p_data->>'note','items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('photos',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.storage_path,'kind',p.kind)),'[]') from public.order_photos p where p.item_id=i.id)) order by i.seq),'[]') from public.order_items i where i.order_id=o.id),'defects',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.order_defects d where d.order_id=o.id));
  insert into public.intake_acts(order_id,snapshot,created_by) values(o.id,obj,p_user) returning jsonb_build_object('id',id,'snapshot',snapshot,'public_token',public_token,'confirmed_at',confirmed_at) into result;
  insert into public.audit_log(user_id,role,entity,entity_id,action,"after",ip) values(p_user,actor.role::text,'intake_acts',(result->>'id')::uuid,'created',result-'public_token',p_ip);
 when 'intake.challenge' then
  if actor.role::text in ('warehouse','washer','packer') then raise exception using errcode='42501',message='Код запрашивает сотрудник приёмки или водитель';end if;
  select order_id into rid from public.intake_acts where id=(p_data->>'act_id')::uuid;o:=public.crm_order(rid,p_user,'photos');
  select * into a from public.intake_acts where id=(p_data->>'act_id')::uuid for update;
  if a.confirmed_at is not null or (a.otp_expires is not null and a.otp_expires>now()+interval '3 minutes') then raise exception using errcode='55000',message='Акт уже подтверждён или код отправлен менее двух минут назад';end if;
  update public.intake_acts set otp_hash=p_data->>'otp_hash',otp_expires=now()+interval '5 minutes',otp_attempts=0 where id=a.id;
  insert into public.integration_outbox(branch_id,order_id,event_key,channel,destination,payload) select o.branch_id,o.id,'otp:'||gen_random_uuid(),'sms',phone,jsonb_build_object('encrypted',p_data->>'encrypted','expires_at',now()+interval '5 minutes') from public.clients where id=o.client_id;
  result:=jsonb_build_object('id',a.id,'expires_in',300);
 when 'complaint.create' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'complaints');rid:=coalesce((p_data->>'responsible_id')::uuid,p_user);
  if not exists(select 1 from public.profiles where id=rid and active and (branch_id=o.branch_id or role::text='admin')) then raise exception using errcode='23514',message='Ответственный не найден в филиале';end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'photo_ids','[]')) p where not exists(select 1 from public.order_photos ph join public.order_items i on i.id=ph.item_id where ph.id=p::uuid and i.order_id=o.id)) then raise exception using errcode='23514',message='Фото не относится к заказу';end if;
  insert into public.complaints(order_id,branch_id,reason,note,photo_ids,responsible_id,due_at,created_by) values(o.id,o.branch_id,p_data->>'reason',coalesce(p_data->>'note',''),coalesce(p_data->'photo_ids','[]'),rid,(p_data->>'due_at')::timestamptz,p_user) returning to_jsonb(complaints.*) into result;
 when 'complaint.resolve' then
  select order_id into rid from public.complaints where id=(p_data->>'complaint_id')::uuid;o:=public.crm_order(rid,p_user,'complaints');
  if actor.role::text<>'admin' then raise exception using errcode='42501',message='Решение по претензии утверждает администратор';end if;
  select * into c from public.complaints where id=(p_data->>'complaint_id')::uuid for update;
  if c.state='resolved' or c.resolution is not null then raise exception using errcode='55000',message='Решение уже зарегистрировано';end if;
  amount:=coalesce((p_data->>'amount')::numeric,0);
  if p_data->>'resolution'='discount' then
   if amount<=0 or o.status='cancelled' or amount>o.total-o.paid_amount then raise exception using errcode='23514',message='Скидка должна быть положительной и не превышать долг';end if;
   if exists(select 1 from public.payment_intents where order_id=o.id and state=1) then raise exception using errcode='55000',message='Сначала завершите онлайн-оплату';end if;
   update public.orders set total=total-amount,adjustment=adjustment-amount where id=o.id;
  elsif p_data->>'resolution'='compensation' then
   if amount<=0 then raise exception using errcode='23514',message='Укажите сумму компенсации';end if;
   insert into public.compensations(complaint_id,order_id,amount,kind,note,created_by) values(c.id,o.id,amount,'compensation',p_data->>'note',p_user);
  elsif p_data->>'resolution'='rewash' then insert into public.rewash_jobs(complaint_id,order_id) values(c.id,o.id);
  elsif p_data->>'resolution'<>'no_issue' then raise exception using errcode='23514',message='Неизвестное решение';end if;
  update public.complaints set resolution=p_data->>'resolution',resolution_note=p_data->>'note',adjustment_amount=amount,state=case when p_data->>'resolution'='rewash' then 'in_progress' else 'resolved' end,resolved_at=case when p_data->>'resolution'<>'rewash' then now() end where id=c.id returning to_jsonb(complaints.*) into result;
 when 'compensation.paid' then
  perform public.crm_require(p_user,'discounts');select o1.* into o from public.compensations x join public.orders o1 on o1.id=x.order_id where x.id=(p_data->>'compensation_id')::uuid;
  o:=public.crm_order(o.id,p_user,'discounts');
  update public.compensations set state='paid',paid_by=p_user,paid_at=now() where id=(p_data->>'compensation_id')::uuid and state='approved' returning to_jsonb(compensations.*) into result;
  if result is null then raise exception using errcode='55000',message='Выплата уже отмечена или не найдена';end if;
 when 'rewash.advance' then
  select order_id into rid from public.rewash_jobs where id=(p_data->>'job_id')::uuid;select * into o from public.orders where id=rid and deleted_at is null for update;
  if o.id is null then raise exception using errcode='P0002',message='Заказ не найден';end if;perform public.crm_require(p_user,'admin',o.branch_id);
  select * into job from public.rewash_jobs where id=(p_data->>'job_id')::uuid for update;
  if job.stage is distinct from p_data->>'expected_stage' or job.stage='ready' then raise exception using errcode='55000',message='Этап повторной стирки изменился';end if;
  next_stage:=case job.stage when 'received' then 'washing' when 'washing' then 'drying' when 'drying' then 'quality_check' when 'quality_check' then 'packing' when 'packing' then 'ready' end;
  if next_stage='washing' then perform public.crm_consume_materials(o.id,'rewash:'||job.id,p_user);end if;
  update public.rewash_jobs set stage=next_stage,assigned_to=p_user,completed_at=case when next_stage='ready' then now() end where id=job.id returning to_jsonb(rewash_jobs.*) into result;
  if next_stage='ready' then update public.complaints set state='resolved',resolved_at=now() where id=job.complaint_id;end if;
 when 'material.save' then
  perform public.crm_require(p_user,'inventory',bid);if actor.role::text<>'admin' then raise exception using errcode='42501',message='Нормы изменяет администратор';end if;
  insert into public.materials(branch_id,code,name,unit,norm_per_m2,active) values(bid,p_data->>'code',p_data->>'name',p_data->>'unit',(p_data->>'norm_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true)) on conflict(branch_id,code) do update set name=excluded.name,unit=excluded.unit,norm_per_m2=excluded.norm_per_m2,active=excluded.active returning to_jsonb(materials.*) into result;
 when 'stock.adjust' then
  select * into m from public.materials where id=(p_data->>'material_id')::uuid for update;perform public.crm_require(p_user,'inventory',m.branch_id);
  if actor.role::text<>'admin' or m.id is null then raise exception using errcode='42501',message='Приход и корректировку оформляет администратор';end if;
  qty:=(p_data->>'quantity')::numeric;if qty=0 or m.stock+qty<0 then raise exception using errcode='23514',message='Недопустимое изменение остатка';end if;
  update public.materials set stock=stock+qty where id=m.id;
  insert into public.stock_movements(material_id,quantity,source,note,created_by) values(m.id,qty,'adjust:'||gen_random_uuid(),p_data->>'note',p_user) returning to_jsonb(stock_movements.*) into result;
 when 'piece_rate.save' then
  perform public.crm_require(p_user,'staff',bid);
  if (p_data->>'effective_at')::timestamptz<now()-interval '1 minute' then raise exception using errcode='23514',message='Ставку нельзя менять задним числом';end if;
  if (p_data->>'role'='driver') is distinct from (p_data->>'event' in ('pickup','delivery')) then raise exception using errcode='23514',message='Событие не соответствует роли';end if;
  insert into public.piece_rates(branch_id,role,event,unit,rate,effective_at) values(bid,p_data->>'role',p_data->>'event',p_data->>'unit',(p_data->>'rate')::numeric,(p_data->>'effective_at')::timestamptz) returning to_jsonb(piece_rates.*) into result;
 when 'slot_limit.save' then
  perform public.crm_require(p_user,'staff',bid);
  if not exists(select 1 from public.catalog_entries where branch_id=bid and kind='zone' and code=p_data->>'zone_code' and active) or not exists(select 1 from public.catalog_entries where branch_id=bid and kind='slot' and code=p_data->>'slot_code' and active) then raise exception using errcode='23514',message='Район или окно недоступны';end if;
  insert into public.slot_limits(branch_id,day,zone_code,slot_code,capacity) values(bid,(p_data->>'day')::date,p_data->>'zone_code',p_data->>'slot_code',(p_data->>'capacity')::integer) on conflict(branch_id,day,zone_code,slot_code) do update set capacity=excluded.capacity returning to_jsonb(slot_limits.*) into result;
 when 'webhook.save' then
  perform public.crm_require(p_user,'integrations',bid);
  insert into public.webhook_subscriptions(branch_id,name,url,secret_env,active) values(bid,p_data->>'name',p_data->>'url',p_data->>'secret_env',coalesce((p_data->>'active')::boolean,false)) returning to_jsonb(webhook_subscriptions.*) into result;
 when 'outbox.retry' then
  perform public.crm_require(p_user,'integrations');
  update public.integration_outbox set state='pending',attempts=0,due_at=now(),lease_until=null,lease_token=null,last_error=null where id=(p_data->>'outbox_id')::uuid and state='dead' returning jsonb_build_object('id',id,'state',state) into result;
  if result is null then raise exception using errcode='55000',message='Запись не находится в ошибке';end if;
  insert into public.audit_log(user_id,role,entity,entity_id,action,"before","after",ip) values(p_user,actor.role::text,'integration_outbox',(result->>'id')::uuid,'updated',jsonb_build_object('state','dead'),result,p_ip);
 else raise exception using errcode='23514',message='Неизвестное действие';
 end case;
 return result;
end $$;
create or replace function public.cancel_order(p_order uuid,p_user uuid,p_reason text,p_comment text,
 p_work_amount numeric default null,p_payment_amount numeric default null,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; r text;
begin
 r:=public.lifecycle_actor(p_user,p_ip);
 perform public.crm_order(p_order,p_user,'cancel');
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 if r not in ('admin','operator') then raise exception using errcode='42501',message='Отменять заказы могут оператор и администратор';end if;
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
 perform set_config('app.order_action','cancelled',true);perform set_config('app.workflow_transition','cancelled',true);
 update public.orders set status='cancelled',cancel_reason_code=p_reason,cancel_comment=btrim(p_comment),
   cancelled_at=clock_timestamp(),cancelled_by=p_user,cancelled_from_status=o.status,
   completed_work_amount=coalesce(p_work_amount,0),cancellation_payment_amount=coalesce(p_payment_amount,0),
   paid_amount=paid_amount+coalesce(p_payment_amount,0)
 where id=p_order returning * into o;
 insert into public.status_history(order_id,status,changed_by,note) values(p_order,'cancelled',p_user,p_reason||': '||btrim(p_comment));
 return o;
end $$;

-- Drop obsolete guards which encode the former logistics and production model.
drop trigger if exists measured_order_guard on public.orders;
drop trigger if exists pickup_order_guard on public.orders;
drop trigger if exists measurement_immutable on public.item_measurements;
-- New immutable measurement trigger is installed with the workflow kernel.
-- KERNEL
create or replace function public.crm_require(p_user uuid,p_permission text,p_branch uuid default null) returns public.profiles language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;begin
 if exists(select 1 from public.settings where key='workflow_maintenance' and value=1) and current_setting('app.workflow_maintenance',true) is distinct from 'allowed' then raise exception using errcode='57P03',message='CRM обновляется. Повторите действие после завершения обновления.';end if;
 select * into a from public.profiles where id=p_user and active and role::text in ('operator','driver','warehouse','washer','packer','admin');
 if not found or not exists(select 1 from public.role_permissions where role=a.role::text and permissions ? p_permission) then raise exception using errcode='42501',message='Недостаточно прав';end if;
 if a.role::text<>'admin' and (a.branch_id is null or (p_branch is not null and a.branch_id is distinct from p_branch)) then raise exception using errcode='42501',message='Нет доступа к филиалу';end if;return a;
end $$;
create or replace function public.crm_order(p_order uuid,p_user uuid,p_permission text default 'read') returns public.orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;allowed boolean;begin
 select * into o from public.orders where id=p_order for update;if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден';end if;
 a:=public.crm_require(p_user,p_permission,o.branch_id);
 allowed:=case a.role::text when 'admin' then true when 'operator' then true
 when 'driver' then (p_permission='read' and o.status in ('new','ready_for_delivery')) or (o.status='pickup_planned' and o.pickup_driver_id=p_user) or (o.status in ('in_transit','delivered','postponed') and o.delivery_driver_id=p_user)
 when 'warehouse' then o.status='warehouse' when 'washer' then o.status='washing' when 'packer' then o.status='packing' else false end;
 if not coalesce(allowed,false) then raise exception using errcode='42501',message='Заказ недоступен этой роли';end if;return o;
end $$;
create or replace function public.crm_flow_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare expected text;begin
 if tg_op='INSERT' then if new.status<>'new' then raise exception using errcode='23514',message='Новый заказ начинается с этапа «Новые заказы»';end if;return new;end if;
 if new.status is distinct from old.status then
  expected:=current_setting('app.workflow_transition',true);
  if expected is distinct from new.status::text then raise exception using errcode='42501',message='Используйте действие передачи заказа';end if;
  if not(case old.status::text when 'new' then new.status in ('pickup_planned','cancelled') when 'pickup_planned' then new.status in ('warehouse','cancelled') when 'warehouse' then new.status in ('washing','cancelled') when 'washing' then new.status in ('packing','cancelled') when 'packing' then new.status in ('warehouse','ready_for_delivery','cancelled') when 'ready_for_delivery' then new.status in ('in_transit','cancelled') when 'in_transit' then new.status in ('delivered','postponed','cancelled') when 'postponed' then new.status in ('in_transit','cancelled') else false end) then raise exception using errcode='23514',message='Недопустимый переход этапа';end if;
  new.stage_entered_at:=clock_timestamp();
 end if;return new;
end $$;
create trigger workflow_graph before insert or update on public.orders for each row execute function public.crm_flow_guard();
create or replace function public.change_order_status(p_order uuid,p_status public.order_status,p_user uuid,p_note text default null) returns public.order_status language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception using errcode='42501',message='Переход выполняется только действием соответствующей роли';end $$;
create or replace function public.crm_flow_move(oid uuid,target public.order_status,u uuid,note text) returns public.orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;begin
 perform set_config('app.workflow_transition',target::text,true);
 update public.orders set status=target,production_stage=target::text where id=oid returning * into o;
 insert into public.status_history(order_id,status,changed_by,note) values(oid,target,u,note);return o;
end $$;
create or replace function public.create_order(p jsonb,p_user uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;oid uuid;cid uuid;it jsonb;rate jsonb;q jsonb;address_text text;seq integer:=0;n integer;j integer;begin
 a:=public.crm_require(p_user,'create');bid:=coalesce((p->>'branch_id')::uuid,a.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(p_user,'create',bid);
 if length(btrim(coalesce(p->>'name','')))=0 or p->>'phone'!~'^\+998[0-9]{9}$' or nullif(p->>'district_code','') is null then raise exception using errcode='23514',message='Укажите ФИО, телефон, область и район';end if;
 if p->>'latitude' is not null or p->>'longitude' is not null or exists(select 1 from jsonb_array_elements(p->'items')x where x ? 'length_m' or x ? 'width_m') then raise exception using errcode='42501',message='Оператор указывает только ориентировочные вид и количество';end if;
 address_text:=public.crm_format_address(p);
 if not exists(select 1 from public.uz_districts where code=p->>'district_code' and region_code=p->>'region_code') then raise exception using errcode='23514',message='Район не относится к области';end if;
 if not exists(select 1 from public.branches where id=bid and active and archived_at is null) then raise exception using errcode='23514',message='Филиал недоступен';end if;
 if not exists(select 1 from public.catalog_entries where kind='source' and branch_id=bid and code=p->>'source' and active) then raise exception using errcode='23514',message='Источник обращения недоступен';end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or not exists(select 1 from jsonb_array_elements(p->'items')) or (select sum(coalesce((z->>'quantity')::int,1)) from jsonb_array_elements(p->'items')z)>30 or exists(select 1 from jsonb_array_elements(p->'items')x where coalesce(x->>'tariff','') not in ('carpet','blanket','tushak')) then raise exception using errcode='23514',message='Выберите вид и количество изделий (всего до 30)';end if;
 q:=public.quote_order(p||jsonb_build_object('branch_id',bid));
 q:=jsonb_build_object('rates',q->'rates','factor',q->'factor','settings',q->'settings','items_count',q->'items_count','pending_measurements',true,'total',null,'price_basis','pending');
 insert into public.clients(name,phone,address) values(p->>'name',p->>'phone',address_text) on conflict(phone_key) do update set name=excluded.name,address=excluded.address returning id into cid;
 insert into public.orders(client_id,address,source,comment,pickup_date,pickup_slot,urgent,stains,pensioner,subtotal,adjustment,delivery_fee,total,created_by,branch_id,region_code,district_code,zone_code,street,house,apartment,landmark,private_house,route_address,measurement_mode,pricing_state,pricing_snapshot,promised_at)
 values(cid,address_text,p->>'source',p->>'comment',nullif(p->>'pickup_date','')::date,p->>'pickup_slot',coalesce((p->>'urgent')::boolean,false),coalesce((p->>'stains')::boolean,false),coalesce((p->>'pensioner')::boolean,false),0,0,0,0,p_user,bid,p->>'region_code',p->>'district_code',p->>'district_code',p->>'street',p->>'house',nullif(p->>'apartment',''),nullif(p->>'landmark',''),coalesce((p->>'private_house')::boolean,false),public.crm_format_address(p,true),'verified','awaiting_measurements',q,coalesce((p->>'promised_at')::timestamptz,now()+(select sla_hours*interval '1 hour' from public.branches where id=bid))) returning id into oid;
 for it in select * from jsonb_array_elements(p->'items') loop
  rate:=public.crm_tariff_info(it->>'tariff',bid);if not coalesce((rate->>'available')::boolean,false) then raise exception using errcode='23514',message='Тариф недоступен';end if;
  n:=coalesce((it->>'quantity')::int,1);if n not between 1 and 30 then raise exception using errcode='23514',message='Ориентировочное количество от 1 до 30';end if;
  for j in 1..case when it->>'tariff'='carpet' then n else 1 end loop seq:=seq+1;
   insert into public.order_items(order_id,seq,tariff_code,unit,unit_rate,quantity,price,note,measurement_origin) values(oid,seq,it->>'tariff',rate->>'unit',(rate->>'price_per_m2')::numeric,case when it->>'tariff'='carpet' then 1 else n end,0,it->>'note','pending');
  end loop;
 end loop;
 insert into public.status_history(order_id,status,changed_by) values(oid,'new',p_user);
 insert into public.client_addresses(client_id,address,region_code,district_code,street,house,apartment,landmark,private_house,created_by) values(cid,address_text,p->>'region_code',p->>'district_code',p->>'street',p->>'house',p->>'apartment',p->>'landmark',coalesce((p->>'private_house')::boolean,false),p_user) on conflict(client_id,address) do nothing;
 return oid;
end $$;
create or replace function public.crm_pickup_calculation(oid uuid,items jsonb) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare o public.orders;i public.order_items;x jsonb;l numeric;w numeric;qty int;sub numeric:=0;area numeric:=0;total_price numeric;fee numeric;s jsonb;lines jsonb:='[]';begin
 select * into o from public.orders where id=oid;s:=o.pricing_snapshot->'settings';
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)<>(select count(*) from public.order_items where order_id=oid) or jsonb_array_length(items)<>(select count(distinct z->>'item_id') from jsonb_array_elements(items)z) then raise exception using errcode='23514',message='Заполните каждое изделие';end if;
 for x in select * from jsonb_array_elements(items) loop
  select * into i from public.order_items where id=(x->>'item_id')::uuid and order_id=oid;if not found then raise exception using errcode='23514',message='Изделие не относится к заказу';end if;
  l:=(x->>'length_m')::numeric;w:=(x->>'width_m')::numeric;qty:=coalesce((x->>'quantity')::int,1);
  if i.unit='m2' then if l is null or w is null or l not between .3 and 20 or w not between .3 and 20 or l<>round(l,2) or w<>round(w,2) or qty<>1 then raise exception using errcode='23514',message='Ковёр: длина и ширина от 0,3 до 20 м с точностью до сантиметра';end if;area:=area+l*w;
  else if qty not between 1 and 1000 or l is not null or w is not null then raise exception using errcode='23514',message='Одеяло и тушак считаются в штуках';end if;end if;
  sub:=sub+case when i.unit='m2' then round(l*w*i.unit_rate) else qty*i.unit_rate end;
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',i.id,'length_m',l,'width_m',w,'quantity',qty,'price',case when i.unit='m2' then round(l*w*i.unit_rate) else qty*i.unit_rate end));
 end loop;
 total_price:=round(sub*(o.pricing_snapshot->>'factor')::numeric,-3);fee:=case when sub>0 and sub<(s->>'free_delivery_from')::numeric then (s->>'delivery_fee')::numeric else 0 end;
 return jsonb_build_object('subtotal',sub,'adjustment',total_price-sub,'delivery_fee',fee,'total',total_price+fee,'area_m2',area,'lines',lines,'price_basis','driver','pending_measurements',false);
end $$;
create or replace function public.crm_workflow_command(cmd text,d jsonb,u uuid,ip inet,p_key uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;o public.orders;receipt public.command_receipts;result jsonb;x jsonb;i public.order_items;driver_sample public.item_measurements;v jsonb;target public.order_status;note text;qty int;l numeric;w numeric;phase text;begin
 perform public.lifecycle_actor(u,ip);a:=public.crm_require(u,case when cmd like 'pickup.%' then 'pickup' when cmd like 'warehouse.%' then 'warehouse' when cmd like 'wash.%' then 'wash' when cmd like 'packing.%' then 'pack' when cmd like 'delivery.%' then 'delivery' else 'cancel' end);
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_key::text,0));select * into receipt from public.command_receipts where user_id=u and command_receipts.key=p_key;
 if found then if receipt.command<>cmd or receipt.payload is distinct from d then raise exception using errcode='55000',message='Ключ использован для другого действия';end if;perform public.crm_require(u,'read',(receipt.result->>'branch_id')::uuid);return receipt.result;end if;
 o:=public.crm_order((d->>'order_id')::uuid,u);
 case cmd
 when 'pickup.claim' then
  if a.role::text<>'driver' or o.status<>'new' or o.pickup_driver_id is not null then raise exception using errcode='55000',message='Заказ уже взят другим водителем';end if;
  if d->>'pickup_at' is null then raise exception using errcode='23514',message='Укажите дату и время забора';end if;
  update public.orders set pickup_driver_id=u,driver_id=u,pickup_at=(d->>'pickup_at')::timestamptz,pickup_date=((d->>'pickup_at')::timestamptz at time zone 'Asia/Tashkent')::date,pickup_slot=to_char((d->>'pickup_at')::timestamptz at time zone 'Asia/Tashkent','HH24:MI') where id=o.id;
  o:=public.crm_flow_move(o.id,'pickup_planned',u,'Водитель запланировал забор');
  insert into public.visits(order_id,branch_id,kind,scheduled_date,slot_code,zone_code,driver_id,created_by) values(o.id,o.branch_id,'pickup',o.pickup_date,'driver_time',o.district_code,u,u);
 when 'pickup.collect' then
  if a.role::text<>'driver' or o.status<>'pickup_planned' or o.pickup_driver_id<>u or o.pickup_state<>'pending' then raise exception using errcode='55000',message='Забор уже отмечен или недоступен';end if;
  v:=public.crm_pickup_calculation(o.id,d->'items');
  if exists(select 1 from public.order_items z where z.order_id=o.id and not exists(select 1 from public.order_photos p where p.item_id=z.id and p.kind='intake')) then raise exception using errcode='55000',message='Загрузите фото каждого изделия';end if;
  for x in select * from jsonb_array_elements(v->'lines') loop
   update public.order_items set length_m=(x->>'length_m')::numeric,width_m=(x->>'width_m')::numeric,quantity=(x->>'quantity')::int,price=(x->>'price')::numeric,measurement_origin='driver' where id=(x->>'item_id')::uuid;
   insert into public.item_measurements(item_id,source_role,length_m,width_m,quantity,measured_by,measured_name,production_cycle) values((x->>'item_id')::uuid,'driver',(x->>'length_m')::numeric,(x->>'width_m')::numeric,(x->>'quantity')::int,u,a.full_name,o.production_cycle);
  end loop;
  update public.orders set pickup_state='picked_up',picked_up_at=clock_timestamp(),picked_up_by=u,driver_measurement_closed_at=clock_timestamp(),subtotal=(v->>'subtotal')::numeric,adjustment=(v->>'adjustment')::numeric,delivery_fee=(v->>'delivery_fee')::numeric,total=(v->>'total')::numeric,pricing_state='priced',pricing_snapshot=pricing_snapshot||v where id=o.id returning * into o;
  insert into public.pickup_events(order_id,event,actor_id,snapshot) values(o.id,'collected',u,v);
  insert into public.status_history(order_id,status,changed_by,note) values(o.id,'pickup_planned',u,'Забрал');
  update public.visits set state='completed',completed_at=clock_timestamp() where order_id=o.id and kind='pickup' and state='planned';
  perform public.crm_award(o.id,u,'pickup','flow:pickup:'||o.id);
 when 'pickup.handover' then
  if a.role::text<>'driver' or o.status<>'pickup_planned' or o.pickup_state<>'picked_up' or o.pickup_driver_id<>u then raise exception using errcode='55000',message='Сначала отметьте «Забрал»';end if;
  update public.orders set pickup_state='handed_over',handed_over_at=clock_timestamp(),handed_over_by=u,warehouse_received_at=null,warehouse_verified_at=null where id=o.id;
  o:=public.crm_flow_move(o.id,'warehouse',u,'Передал на склад');insert into public.pickup_events(order_id,event,actor_id) values(o.id,'handed_over',u);
 when 'warehouse.receive' then
  if a.role::text<>'warehouse' or o.status<>'warehouse' or o.warehouse_received_at is not null then raise exception using errcode='55000',message='Приём склада уже отмечен или недоступен';end if;
  update public.orders set warehouse_received_at=clock_timestamp(),warehouse_received_by=u,pickup_state='accepted' where id=o.id returning * into o;
  insert into public.pickup_events(order_id,event,actor_id) values(o.id,'accepted',u);
 when 'warehouse.measure' then
  if a.role::text<>'warehouse' or o.status<>'warehouse' or o.warehouse_received_at is null then raise exception using errcode='55000',message='Сначала примите заказ на складе';end if;
  perform public.crm_pickup_calculation(o.id,d->'items');
  for x in select * from jsonb_array_elements(d->'items') loop
   select * into i from public.order_items where id=(x->>'item_id')::uuid and order_id=o.id;
   select * into driver_sample from public.item_measurements where item_id=i.id and source_role='driver' order by created_at desc,id desc limit 1;
   l:=(x->>'length_m')::numeric;w:=(x->>'width_m')::numeric;qty:=coalesce((x->>'quantity')::int,1);
   if (driver_sample.length_m is distinct from l or driver_sample.width_m is distinct from w or driver_sample.quantity is distinct from qty) and length(btrim(coalesce(x->>'reason','')))<3 then raise exception using errcode='23514',message='Укажите комментарий к расхождению с водителем';end if;
   insert into public.item_measurements(item_id,source_role,length_m,width_m,quantity,measured_by,measured_name,reason,production_cycle) values(i.id,'warehouse',l,w,qty,u,a.full_name,nullif(btrim(x->>'reason'),''),o.production_cycle);
   update public.order_items set length_m=l,width_m=w,quantity=qty,measurement_origin='warehouse' where id=i.id;
  end loop;
  update public.orders set warehouse_verified_at=clock_timestamp() where id=o.id returning * into o;
 when 'warehouse.to_wash' then
  if a.role::text<>'warehouse' or o.status<>'warehouse' or o.warehouse_received_at is null or o.warehouse_verified_at is null then raise exception using errcode='55000',message='Примите и сверьте все изделия';end if;
  update public.orders set wash_phase='acceptance',washer_id=null where id=o.id;o:=public.crm_flow_move(o.id,'washing',u,'Передал на мойку');
 when 'wash.accept' then
  if a.role::text<>'washer' or o.status<>'washing' or o.wash_phase<>'acceptance' then raise exception using errcode='55000',message='Приём мойщиком недоступен';end if;
  update public.orders set wash_phase='washing',washer_id=u where id=o.id returning * into o;
  perform public.crm_consume_materials(o.id,'flow:wash:'||o.id||':'||o.production_cycle,u);perform public.crm_award(o.id,u,'washing','flow:wash:'||o.id||':'||o.production_cycle);
 when 'wash.dry' then
  if a.role::text<>'washer' or o.status<>'washing' or o.wash_phase<>'washing' then raise exception using errcode='55000',message='Сначала выполните мойку';end if;
  update public.orders set wash_phase='drying' where id=o.id returning * into o;
 when 'wash.to_pack' then
  if a.role::text<>'washer' or o.status<>'washing' or o.wash_phase<>'drying' then raise exception using errcode='55000',message='Передача возможна после сушки';end if;
  update public.orders set packing_received_at=null,packing_received_by=null where id=o.id;o:=public.crm_flow_move(o.id,'packing',u,'Мойка и сушка завершены; передал на упаковку');
 when 'packing.accept' then
  if a.role::text<>'packer' or o.status<>'packing' or o.packing_received_at is not null then raise exception using errcode='55000',message='Приём упаковщиком недоступен';end if;
  update public.orders set packing_received_at=clock_timestamp(),packing_received_by=u where id=o.id returning * into o;
 when 'packing.return' then
  if a.role::text<>'packer' or o.status<>'packing' or length(btrim(coalesce(d->>'reason','')))<3 then raise exception using errcode='23514',message='Укажите причину возврата на склад';end if;
  update public.orders set production_cycle=production_cycle+1,warehouse_received_at=null,warehouse_received_by=null,warehouse_verified_at=null,packing_received_at=null,packing_received_by=null where id=o.id;
  o:=public.crm_flow_move(o.id,'warehouse',u,'Возврат по качеству: '||btrim(d->>'reason'));
 when 'packing.complete' then
  if a.role::text<>'packer' or o.status<>'packing' or o.packing_received_at is null then raise exception using errcode='55000',message='Сначала примите заказ в упаковку';end if;
  if not exists(select 1 from public.order_photos p join public.order_items z on z.id=p.item_id where z.order_id=o.id and p.kind='ready' and p.source_role='packer' and p.production_cycle=o.production_cycle and p.created_at>=o.packing_received_at) then raise exception using errcode='55000',message='Прикрепите фото-чек упаковки';end if;
  o:=public.crm_flow_move(o.id,'ready_for_delivery',u,'Упаковано; передал на склад готовых заказов');perform public.crm_award(o.id,u,'packing','flow:pack:'||o.id||':'||o.production_cycle);
 when 'delivery.claim' then
  if a.role::text<>'driver' or o.status<>'ready_for_delivery' then raise exception using errcode='55000',message='Заказ уже взят в доставку';end if;
  update public.orders set delivery_driver_id=u,driver_id=u where id=o.id;o:=public.crm_flow_move(o.id,'in_transit',u,'Водитель забрал готовый заказ');
  insert into public.visits(order_id,branch_id,kind,scheduled_date,slot_code,zone_code,driver_id,created_by,state,departed_at) values(o.id,o.branch_id,'delivery',(now() at time zone 'Asia/Tashkent')::date,'driver_time',o.district_code,u,u,'en_route',clock_timestamp());
 when 'delivery.postpone' then
  if a.role::text<>'driver' or o.status<>'in_transit' or o.delivery_driver_id<>u or length(btrim(coalesce(d->>'reason','')))<3 then raise exception using errcode='23514',message='Укажите причину отложенной доставки';end if;
  update public.orders set postponed_reason=btrim(d->>'reason') where id=o.id;o:=public.crm_flow_move(o.id,'postponed',u,'Доставка отложена: '||btrim(d->>'reason'));
  update public.visits set state='failed',completed_at=clock_timestamp(),note=btrim(d->>'reason') where order_id=o.id and kind='delivery' and state='en_route';
 when 'delivery.resume' then
  if a.role::text<>'driver' or o.status<>'postponed' or o.delivery_driver_id<>u then raise exception using errcode='55000',message='Отложенный заказ недоступен';end if;
  o:=public.crm_flow_move(o.id,'in_transit',u,coalesce(nullif(btrim(d->>'comment'),''),'Повторно в путь'));
  insert into public.visits(order_id,branch_id,kind,scheduled_date,slot_code,zone_code,driver_id,created_by,state,departed_at) values(o.id,o.branch_id,'delivery',(now() at time zone 'Asia/Tashkent')::date,'driver_time',o.district_code,u,u,'en_route',clock_timestamp());
 when 'delivery.complete' then
  if a.role::text<>'driver' or o.status<>'in_transit' or o.delivery_driver_id<>u then raise exception using errcode='55000',message='Доставка недоступна';end if;
  o:=public.crm_flow_move(o.id,'delivered',u,'Доставлен клиенту');update public.visits set state='completed',completed_at=clock_timestamp() where order_id=o.id and kind='delivery' and state='en_route';perform public.crm_award(o.id,u,'delivery','flow:delivered:'||o.id);
 when 'order.cancel' then
  o:=public.cancel_order(o.id,u,d->>'reason_code',d->>'comment',(d->>'completed_work_amount')::numeric,(d->>'payment_amount')::numeric,ip);
 else raise exception using errcode='23514',message='Неизвестное действие этапа';end case;
 if cmd in ('warehouse.measure','wash.accept','wash.dry','packing.accept') then insert into public.production_events(order_id,stage,actor_id,note) values(o.id,case cmd when 'warehouse.measure' then 'warehouse_verified' when 'wash.accept' then 'washing' when 'wash.dry' then 'drying' else 'packing_accepted' end,u,cmd);end if;
 result:=to_jsonb(o);insert into public.command_receipts(user_id,key,command,payload,result) values(u,p_key,cmd,d,result);return result;
end $$;
create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_command in ('intake.create','discount.apply','payment.intent') and exists(select 1 from public.orders where id=(p_data->>'order_id')::uuid and pricing_state='awaiting_measurements') then perform public.crm_order((p_data->>'order_id')::uuid,p_user);raise exception using errcode='55000',message='Сначала дождитесь замеров и стоимости от водителя';end if;
 if p_command in ('pickup.claim','pickup.collect','pickup.handover','warehouse.receive','warehouse.measure','warehouse.to_wash','wash.accept','wash.dry','wash.to_pack','packing.accept','packing.return','packing.complete','delivery.claim','delivery.postpone','delivery.resume','delivery.complete','order.cancel') then return public.crm_workflow_command(p_command,p_data,p_user,p_ip,p_key);end if;
 if p_command in ('visit.schedule','visit.event','visit.arrived','item.measure','order.measure','workshop.advance','workshop.accept','workshop.recover') then raise exception using errcode='42501',message='Прежний порядок действий отключён';end if;
 return public.crm_business_command(p_command,p_data,p_user,p_ip,p_key);
end $$;
create or replace function public.register_order_photo(p_item uuid,p_path text,p_kind text,p_user uuid,p_ip inet default null) returns public.order_photos language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;i public.order_items;a public.profiles;p public.order_photos;begin
 perform public.lifecycle_actor(p_user,p_ip);select * into i from public.order_items where id=p_item;if not found then raise exception using errcode='P0002',message='Изделие не найдено';end if;
 o:=public.crm_order(i.order_id,p_user,'photos');a:=public.crm_require(p_user,'photos',o.branch_id);
 if not(a.role::text='admin' or (a.role::text='driver' and o.status='pickup_planned' and o.pickup_driver_id=p_user and o.pickup_state='pending' and p_kind='intake') or (a.role::text='packer' and o.status='packing' and o.packing_received_at is not null and p_kind='ready')) then raise exception using errcode='42501',message='Загрузка фото на этом этапе недоступна';end if;
 if p_path!~('^'||o.id||'/'||i.id||'/[a-f0-9-]{36}\.jpg$') then raise exception using errcode='23514',message='Неверный путь фото';end if;
 insert into public.order_photos(item_id,storage_path,kind,created_by,source_role,production_cycle) values(i.id,p_path,p_kind,p_user,a.role::text,o.production_cycle) returning * into p;return p;
end $$;
create or replace function public.crm_measurements(oid uuid,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin perform public.crm_order(oid,u);return(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('measurements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc),'[]') from public.item_measurements m where m.item_id=i.id)) order by i.seq),'[]') from public.order_items i where i.order_id=oid);end $$;
create trigger measurement_immutable before update or delete on public.item_measurements for each row execute function public.crm_measurement_immutable();
-- BOARD_AND_MAINTENANCE

alter table public.orders alter column pickup_date drop not null;

drop trigger if exists business_status_effects on public.status_history;

create or replace function public.crm_award(oid uuid,u uuid,event_name text,source_key text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;r public.piece_rates;actor public.profiles;n numeric;
begin
 select * into o from public.orders where id=oid;select * into actor from public.profiles where id=u;
 if actor.role::text not in ('driver','warehouse','washer','packer') then return;end if;
 select * into r from public.piece_rates where active and branch_id=o.branch_id and role=actor.role::text and event=event_name and effective_at<=now() order by effective_at desc limit 1;
 if not found then return;end if;
 if r.unit='m2' then select coalesce(sum(area_m2),0) into n from public.order_items where order_id=oid;else n:=1;end if;
 insert into public.pay_accruals(branch_id,employee_id,order_id,event,role_snapshot,unit,units,rate,amount,source) values(o.branch_id,u,oid,event_name,actor.role::text,r.unit,n,r.rate,round(n*r.rate),source_key) on conflict(source) do nothing;
end $$;
drop trigger if exists visit_piecework on public.visits;
-- Scope is shared by the board, cards, photos and analytics. Only the server role can call RPCs.
create or replace function public.crm_visible(o public.orders,a public.profiles) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select a.active and o.deleted_at is null and (a.role::text='admin' or (a.branch_id is not null and a.branch_id=o.branch_id)) and
 case a.role::text when 'admin' then true when 'operator' then true
 when 'driver' then o.status in ('new','ready_for_delivery') or (o.status='pickup_planned' and o.pickup_driver_id=a.id) or (o.status in ('in_transit','delivered','postponed') and o.delivery_driver_id=a.id)
 when 'warehouse' then o.status='warehouse' when 'washer' then o.status='washing' when 'packer' then o.status='packing' else false end
$$;
create view public.crm_board_facts with(security_invoker=true) as
 select o.*,c.name client_name,c.phone client_phone,'K-'||o.number code,
 coalesce(i.carpet_m2,0) carpet_m2,coalesce(i.blankets,0)::bigint blankets,coalesce(i.tushaks,0)::bigint tushaks,
 coalesce(i.carpet_money,0) carpet_money,coalesce(i.blanket_money,0) blanket_money,coalesce(i.tushak_money,0) tushak_money,
 exists(select 1 from public.driver_districts d where d.driver_id=nullif(current_setting('app.board_user',true),'')::uuid and d.district_code=o.district_code) district_priority
 from public.orders o join public.clients c on c.id=o.client_id left join lateral(
  select sum(area_m2) filter(where tariff_code='carpet') carpet_m2,sum(quantity) filter(where tariff_code='blanket') blankets,sum(quantity) filter(where tariff_code='tushak') tushaks,
   sum(price) filter(where tariff_code='carpet') carpet_money,sum(price) filter(where tariff_code='blanket') blanket_money,sum(price) filter(where tariff_code='tushak') tushak_money
  from public.order_items where order_id=o.id)i on true where o.deleted_at is null;
create or replace function public.crm_board_rows(f jsonb,u uuid) returns setof public.crm_board_facts language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare a public.profiles;begin
 a:=public.crm_require(u,'read');
 return query select b.* from public.crm_board_facts b join public.orders o on o.id=b.id where public.crm_visible(o,a)
 and (f->>'status' is null or b.status::text=f->>'status') and (f->>'branch_id' is null or b.branch_id=(f->>'branch_id')::uuid)
 and (f->>'from' is null or b.stage_entered_at>=((f->>'from')::date::timestamp at time zone 'Asia/Tashkent'))
 and (f->>'to' is null or b.stage_entered_at<(((f->>'to')::date+1)::timestamp at time zone 'Asia/Tashkent'))
 and (f->>'district_code' is null or b.district_code=f->>'district_code')
 and (f->>'driver_id' is null or b.pickup_driver_id=(f->>'driver_id')::uuid or b.delivery_driver_id=(f->>'driver_id')::uuid)
 and (f->>'operator_id' is null or b.created_by=(f->>'operator_id')::uuid)
 and ((f->>'min_price' is null and f->>'max_price' is null) or b.pricing_state='priced')
 and (f->>'min_price' is null or b.total>=(f->>'min_price')::numeric) and (f->>'max_price' is null or b.total<=(f->>'max_price')::numeric)
 and (f->>'product' is null or exists(select 1 from public.order_items i where i.order_id=b.id and i.tariff_code=f->>'product'))
 and (coalesce(f->>'q','')='' or position(lower(f->>'q') in lower(b.client_name||' '||b.client_phone||' '||b.code))>0);
end $$;
create or replace function public.crm_board(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;stages text[];stage text;f jsonb;rows jsonb;totals jsonb;columns jsonb:='[]';lim int;off int;n bigint;begin
 a:=public.crm_require(p_user,'read');perform set_config('app.board_user',p_user::text,true);
 stages:=case a.role::text when 'driver' then array['new','pickup_planned','ready_for_delivery','in_transit','delivered','postponed'] when 'warehouse' then array['warehouse'] when 'washer' then array['washing'] when 'packer' then array['packing'] else array['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled'] end;
 foreach stage in array stages loop
  f:=(p_filters-'stages')||coalesce(p_filters->'stages'->stage,'{}')||jsonb_build_object('status',stage);
  if f->>'from' is not null and f->>'to' is not null and (f->>'from')::date>(f->>'to')::date then raise exception using errcode='23514',message='Проверьте период';end if;
  lim:=least(greatest(coalesce((f->>'limit')::int,30),1),100);off:=greatest(coalesce((f->>'offset')::int,0),0);
  select count(*),jsonb_build_object('orders',count(*),'carpet_m2',coalesce(sum(carpet_m2),0),'blankets',coalesce(sum(blankets),0),'tushaks',coalesce(sum(tushaks),0),'amount',coalesce(sum(total),0)) into n,totals from public.crm_board_rows(f,p_user);
  select coalesce(jsonb_agg(x order by priority desc,at,id),'[]') into rows from(
   select b.id,b.stage_entered_at at,case when a.role::text='driver' and stage in ('new','ready_for_delivery') then b.district_priority else false end priority,
    to_jsonb(b)-'track_token'-'delete_snapshot'||jsonb_build_object('client',jsonb_build_object('name',b.client_name,'phone',case when a.role::text in ('warehouse','washer','packer') then left(b.client_phone,4)||' ** *** ** '||right(b.client_phone,2) else b.client_phone end)) x
   from public.crm_board_rows(f,p_user)b order by priority desc,at,id limit lim offset off)q;
  -- Production cards do not expose the full phone embedded in the view.
  if a.role::text in ('warehouse','washer','packer') then select coalesce(jsonb_agg(x-'client_phone'),'[]') into rows from jsonb_array_elements(rows)x;end if;
  columns:=columns||jsonb_build_array(jsonb_build_object('status',stage,'totals',totals,'data',rows,'next_offset',case when off+lim<n then off+lim end,'filters',f));
 end loop;
 return jsonb_build_object('columns',columns,'driver_color',a.driver_color,'date_basis','stage_entered_at','at',clock_timestamp());
end $$;
create or replace function public.crm_order_metrics(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;rows jsonb;start_at timestamptz;end_at timestamptz;begin
 a:=public.crm_require(p_user,'reports');
 start_at:=coalesce((p_filters->>'from')::date,date_trunc('month',now() at time zone 'Asia/Tashkent')::date)::timestamp at time zone 'Asia/Tashkent';
 end_at:=(coalesce((p_filters->>'to')::date,(now() at time zone 'Asia/Tashkent')::date)+1)::timestamp at time zone 'Asia/Tashkent';
 if end_at<=start_at then raise exception using errcode='23514',message='Проверьте период';end if;
 select jsonb_object_agg(metric,stats) into rows from (
  select k.metric,jsonb_build_object('orders',count(b.id),'carpet_m2',coalesce(sum(b.carpet_m2),0),'blankets',coalesce(sum(b.blankets),0),'tushaks',coalesce(sum(b.tushaks),0),
   'amount',coalesce(sum(b.total),0),'carpet_money',coalesce(sum(b.carpet_money),0),'blanket_money',coalesce(sum(b.blanket_money),0),'tushak_money',coalesce(sum(b.tushak_money),0)) stats
  from unnest(array['washed','delivered','washing','ready_for_delivery']) k(metric) left join public.crm_board_facts b
   on b.created_at>=start_at and b.created_at<end_at and (p_filters->>'branch_id' is null or b.branch_id=(p_filters->>'branch_id')::uuid)
   and case k.metric when 'washed' then exists(select 1 from public.status_history h where h.order_id=b.id and h.status='packing') when 'delivered' then b.status='delivered' when 'washing' then b.status='washing' else b.status='ready_for_delivery' end
  group by k.metric)q;
 return jsonb_build_object('metrics',rows,'date_basis','order_created_at','from',start_at,'to',end_at);
end $$;

create or replace function public.crm_workspace(p_view text,p_filters jsonb,p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;rows jsonb:='[]';result jsonb;lim integer:=least(greatest(coalesce((p_filters->>'limit')::integer,50),1),100);
 at_cursor timestamptz:=(p_filters->>'cursor_at')::timestamptz;id_cursor uuid:=(p_filters->>'cursor_id')::uuid;
 day date:=coalesce((p_filters->>'date')::date,(now() at time zone 'Asia/Tashkent')::date);last_row jsonb;resolved_order public.orders;cid uuid;
begin
 actor:=public.crm_require(p_user,'read');bid:=coalesce((p_filters->>'branch_id')::uuid,actor.branch_id);
 if bid is not null then perform public.crm_require(p_user,'read',bid);end if;
 case p_view
 when 'bootstrap' then
  return jsonb_build_object('branches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.name),'[]') from public.branches b where actor.role::text='admin' or b.id=actor.branch_id),
   'catalogs',(select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.position,c.code),'[]') from public.catalog_entries c where (bid is null or c.branch_id=bid) and (c.active or actor.role::text='admin')),
   'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'full_name',s.full_name,'role',s.role,'active',s.active,'branch_id',s.branch_id,'driver_color',s.driver_color,'district_codes',(select coalesce(jsonb_agg(district_code),'[]') from public.driver_districts where driver_id=s.id)) order by s.full_name),'[]') from public.profiles s where actor.role::text='admin' or s.id=p_user or s.branch_id=actor.branch_id),
   'regions',(select jsonb_agg(to_jsonb(r) order by r.position) from public.uz_regions r),'districts',(select jsonb_agg(to_jsonb(d) order by d.kind,d.name_ru) from public.uz_districts d),
   'tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'name',v->>'name','price_per_m2',(v->>'price_per_m2')::numeric,'unit',v->>'unit','active',coalesce((v->>'available')::boolean,false)) order by t.code),'[]') from public.tariffs t cross join lateral(select public.crm_tariff_info(t.code,coalesce(bid,'01000000-0000-4000-8000-000000000001')) v) q where t.booking_enabled),
   'permissions',(select permissions from public.role_permissions where role=actor.role::text),'date',day);
 when 'client' then
  perform public.crm_require(p_user,'clients',bid);
  select id into cid from public.clients where id=(p_filters->>'client_id')::uuid or phone_key=right(regexp_replace(p_filters->>'phone','\D','','g'),9) limit 1;
  return jsonb_build_object('client',(select to_jsonb(c) from public.clients c where c.id=cid),
   'addresses',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]') from public.client_addresses a where a.client_id=cid),
   'orders',(select coalesce(jsonb_agg(x order by x->>'created_at' desc),'[]') from (select jsonb_build_object('id',o.id,'code','K-'||o.number,'status',o.status,'total',o.total,'created_at',o.created_at,'address',o.address,'items',(select jsonb_agg(jsonb_build_object('length_m',i.length_m,'width_m',i.width_m,'tariff',i.tariff_code,'note',i.note) order by i.seq) from public.order_items i where i.order_id=o.id)) x
     from public.orders o where o.client_id=cid and o.deleted_at is null and (bid is null or o.branch_id=bid) order by o.created_at desc,o.id desc limit 50) q));
 when 'leads' then
  perform public.crm_require(p_user,'leads',bid);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (select * from public.leads l where (bid is null or l.branch_id=bid)
   and (l.order_id is null or exists(select 1 from public.orders parent_order where parent_order.id=l.order_id and parent_order.deleted_at is null))
   and (at_cursor is null or (l.created_at,l.id)<(at_cursor,id_cursor)) order by l.created_at desc,l.id desc limit lim+1) q;
 when 'calls' then
  perform public.crm_require(p_user,'calls',bid);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (select * from public.calls c where (bid is null or c.branch_id=bid)
   and (c.order_id is null or exists(select 1 from public.orders parent_order where parent_order.id=c.order_id and parent_order.deleted_at is null))
   and (at_cursor is null or (c.created_at,c.id)<(at_cursor,id_cursor)) order by c.created_at desc,c.id desc limit lim+1) q;
 when 'tasks' then
  perform public.crm_require(p_user,'tasks',bid);
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (select * from public.tasks t where (bid is null or t.branch_id=bid)
   and (t.order_id is null or exists(select 1 from public.orders parent_order where parent_order.id=t.order_id and parent_order.deleted_at is null))
   and (actor.role::text in ('admin') or t.assigned_to=p_user)
   and (p_filters->>'status' is null or t.status=p_filters->>'status')
   and (at_cursor is null or (t.created_at,t.id)<(at_cursor,id_cursor)) order by t.created_at desc,t.id desc limit lim+1) q;
 when 'scan' then
  select * into resolved_order from public.orders where number=split_part(regexp_replace(p_filters->>'label','^K-','','i'),'-',1)::bigint;
  if not found then raise exception using errcode='P0002',message='Метка не найдена';end if;
  resolved_order:=public.crm_order(resolved_order.id,p_user);
  return jsonb_build_object('order_id',resolved_order.id,'code','K-'||resolved_order.number,'status',resolved_order.status,'stage',coalesce(resolved_order.production_stage,resolved_order.status::text),'item_id',
   (select id from public.order_items where order_id=resolved_order.id and seq=coalesce(nullif(split_part(regexp_replace(p_filters->>'label','^K-','','i'),'-',2),'')::integer,1)));
 when 'payments' then
  resolved_order:=public.crm_order((p_filters->>'order_id')::uuid,p_user,'read');
  if actor.role::text in ('warehouse','washer','packer') then raise exception using errcode='42501',message='Нет доступа к оплатам';end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc),'[]') into rows from public.payments p where p.order_id=resolved_order.id;
  return jsonb_build_object('data',rows,'next_cursor',null);
 when 'admin' then
 perform public.crm_require(p_user,'staff');
 return jsonb_build_object(
  'staff',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('district_codes',(select coalesce(jsonb_agg(district_code),'[]') from public.driver_districts where driver_id=p.id)) order by p.full_name),'[]') from public.profiles p),
  'branches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.name),'[]') from public.branches b),
  'catalogs',(select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.position,c.code),'[]') from public.catalog_entries c),
  'reasons',(select coalesce(jsonb_agg(to_jsonb(r) order by r.position,r.code),'[]') from public.cancel_reasons r),
  'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.code,t.channel,t.locale),'[]') from public.notification_templates t),
  'tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'branch_id',b.id,'name',v.name,'price_per_m2',v.price_per_m2,'active',v.active and v.effective_at<=now(),
   'unit',v.unit,'effective_at',v.effective_at,'archived_at',c.archived_at) order by b.name,t.code),'[]') from public.branches b cross join public.tariffs t
   left join public.tariff_controls c on c.branch_id=b.id and c.code=t.code
   join lateral(select * from public.tariff_versions x where x.code=t.code and (x.branch_id=b.id or x.branch_id is null)
    order by (x.effective_at<=now()) desc,(x.branch_id is not null) desc,x.effective_at desc,x.created_at desc,x.id desc limit 1)v on true),
  'tariff_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.tariff_versions order by effective_at desc limit 100)v),
  'role_reassignments',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.role_reassignments r),'setting_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.setting_versions order by effective_at desc limit 100)v)); else raise exception using errcode='23514',message='Неизвестный раздел';end case;
 last_row:=rows->(lim-1);
 result:=jsonb_build_object('data',case when jsonb_array_length(rows)>lim then rows- lim else rows end,
  'next_cursor',case when jsonb_array_length(rows)>lim then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id','priority',last_row->'urgent') else null end);
 return result;
end $$;
create or replace function public.crm_photo_gallery(d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;cid uuid;oid uuid;rows jsonb;lim integer:=least(greatest(coalesce((d->>'limit')::integer,50),1),100);last_row jsonb;
begin
 a:=public.crm_require(u,'read');bid:=coalesce((d->>'branch_id')::uuid,a.branch_id);oid:=(d->>'order_id')::uuid;cid:=(d->>'client_id')::uuid;
 if oid is not null then
  perform public.crm_order(oid,u);
  select client_id,branch_id into cid,bid from public.orders where id=oid and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Заказ не найден';end if;
 end if;
 if bid is not null then perform public.crm_require(u,'read',bid);end if;
 if a.role::text not in ('admin') and (a.branch_id is null or bid is distinct from a.branch_id) then raise exception using errcode='42501',message='Нет доступа к этому филиалу';end if;
 if cid is null or not exists(select 1 from public.orders where client_id=cid and deleted_at is null and (bid is null or branch_id=bid)) then raise exception using errcode='P0002',message='Клиент не найден в филиале';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from(
  select p.id,p.kind,p.created_at,p.storage_path,i.seq,i.order_id,'K-'||o.number code,i.tariff_code
  from public.order_photos p join public.order_items i on i.id=p.item_id join public.orders o on o.id=i.order_id
  where o.client_id=cid and public.crm_visible(o,a) and (oid is null or o.id=oid) and (bid is null or o.branch_id=bid)
   and (d->>'cursor_at' is null or (p.created_at,p.id)<((d->>'cursor_at')::timestamptz,(d->>'cursor_id')::uuid))
  order by p.created_at desc,p.id desc limit lim+1)q;
 last_row:=rows->(lim-1);
 return jsonb_build_object('data',case when jsonb_array_length(rows)>lim then rows-lim else rows end,'next_cursor',case when jsonb_array_length(rows)>lim then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id') else null end);
end $$;
create or replace function public.lifecycle_actor(p_user uuid,p_ip inet default null) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare r text;begin
 select role::text into r from public.profiles where id=p_user and active and role::text in ('operator','driver','warehouse','washer','packer','admin') for share;
 if r is null then raise exception using errcode='42501',message='Сотрудник неактивен или роль выведена из использования';end if;
 perform set_config('app.actor_id',p_user::text,true);perform set_config('app.actor_role',r,true);perform set_config('app.actor_ip',coalesce(p_ip::text,''),true);return r;
end $$;
create or replace function public.crm_pickup_preview(oid uuid,items jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;begin
 a:=public.crm_require(u,'pickup');o:=public.crm_order(oid,u);
 if a.role::text<>'driver' or o.status<>'pickup_planned' or o.pickup_driver_id<>u or o.pickup_state<>'pending' then raise exception using errcode='42501',message='Расчёт доступен водителю при заборе';end if;
 return public.crm_pickup_calculation(oid,items);
end $$;
-- The helper itself checks the active actor and prerequisites, including direct RPC invocation.
create or replace function public.crm_flow_move(oid uuid,target public.order_status,u uuid,note text) returns public.orders language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;ok boolean:=false;begin
 perform public.lifecycle_actor(u,nullif(current_setting('app.actor_ip',true),'')::inet);a:=public.crm_require(u,'read');o:=public.crm_order(oid,u);
 case target::text
 when 'pickup_planned' then ok:=a.role::text='driver' and o.status='new' and o.pickup_driver_id=u and o.pickup_at is not null;
 when 'warehouse' then ok:=(a.role::text='driver' and o.status='pickup_planned' and o.pickup_driver_id=u and o.pickup_state='handed_over') or (a.role::text='packer' and o.status='packing' and length(btrim(coalesce(note,'')))>=3);
 when 'washing' then ok:=a.role::text='warehouse' and o.status='warehouse' and o.warehouse_received_at is not null and o.warehouse_verified_at is not null;
 when 'packing' then ok:=a.role::text='washer' and o.status='washing' and o.wash_phase='drying';
 when 'ready_for_delivery' then ok:=a.role::text='packer' and o.status='packing' and o.packing_received_at is not null and exists(select 1 from public.order_photos p join public.order_items i on i.id=p.item_id where i.order_id=o.id and p.kind='ready' and p.source_role='packer' and p.production_cycle=o.production_cycle and p.created_at>=o.packing_received_at);
 when 'in_transit' then ok:=a.role::text='driver' and ((o.status='ready_for_delivery' and o.delivery_driver_id=u) or (o.status='postponed' and o.delivery_driver_id=u));
 when 'postponed' then ok:=a.role::text='driver' and o.status='in_transit' and o.delivery_driver_id=u and length(btrim(coalesce(o.postponed_reason,'')))>=3;
 when 'delivered' then ok:=a.role::text='driver' and o.status='in_transit' and o.delivery_driver_id=u;
 else ok:=false;end case;
 if not coalesce(ok,false) then raise exception using errcode='42501',message='Недостаточно прав или не завершён предыдущий шаг';end if;
 perform set_config('app.workflow_transition',target::text,true);
 update public.orders set status=target,production_stage=target::text,washing_started_at=case when target='washing' then coalesce(washing_started_at,clock_timestamp()) else washing_started_at end where id=oid returning * into o;
 insert into public.status_history(order_id,status,changed_by,note) values(oid,target,u,note);return o;
end $$;
-- Required address catalog and order quantities are validated in PostgreSQL, independently of JS.
create or replace function public.crm_booking_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.region_code is null or new.district_code is null or nullif(btrim(new.street),'') is null or nullif(btrim(new.house),'') is null or not exists(select 1 from public.uz_districts where code=new.district_code and region_code=new.region_code) then raise exception using errcode='23514',message='Укажите область, район, улицу и дом';end if;
 return new;
end $$;
create trigger booking_catalog_guard before insert or update of region_code,district_code,street,house on public.orders for each row execute function public.crm_booking_guard();
drop trigger if exists business_visit_award on public.visits;
create or replace function public.crm_quote(p jsonb,p_user uuid,p_ip inet default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;begin
 perform public.lifecycle_actor(p_user,p_ip);a:=public.crm_require(p_user,'quote');bid:=coalesce((p->>'branch_id')::uuid,a.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(p_user,'quote',bid);
 return (public.quote_order(p||jsonb_build_object('branch_id',bid))-'subtotal'-'adjustment'-'delivery_fee'-'area_m2')||jsonb_build_object('total',null,'pending_measurements',true);
end $$;
-- Preserve customized messages for the renamed stages; keep the originals and their history.
insert into public.notification_templates(branch_id,code,channel,locale,body,active)
 select t.branch_id,n.code,t.channel,t.locale,t.body,t.active from public.notification_templates t join(values('status_received','status_warehouse'),('status_ready','status_ready_for_delivery'),('status_delivering','status_in_transit'),('status_pickup_assigned','status_pickup_planned')) n(old_code,code) on t.code=n.old_code where t.archived_at is null on conflict(branch_id,code,channel,locale) do nothing;

create or replace function public.public_order_status(p_token text) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('code','K-'||o.number,'status',o.status,'total',o.total,'pricing_state',o.pricing_state,'updated_at',o.stage_entered_at) from public.orders o where track_token=p_token and deleted_at is null
$$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset') and to_regprocedure('public.crm_board(jsonb,uuid)') is not null and has_table_privilege(current_user,'public.driver_districts','select'),'schema',16)
$$;
-- Remove callable implementations of the retired workflow. Immutable migrations remain untouched.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname ~ '^crm_(command|workspace|create_order|public_status)_v[0-9]+$' or p.proname in ('crm_extension_v3','crm_schedule_visit','crm_schedule_visit_v2','crm_production_effects','crm_visit_award','crm_measure_item','crm_reprice_measured','crm_pickup_action','crm_pickup_progress','crm_workshop_recoverable','crm_workshop_intake','crm_reprice_workshop_recovery','crm_pickup_guard','crm_measured_order_guard','assign_order_driver','assign_driver_audited')) loop execute format('drop function %s cascade',f.signature);end loop;
end $$;
-- New tables are server-only. No client table access or public function execution is granted.
do $$declare t text;f record;begin
 foreach t in array array['driver_districts','role_reassignments','maintenance_cleanup_runs'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select,insert on public.%I to service_role',t);end loop;
 grant delete on public.driver_districts to service_role;
 revoke all on public.crm_board_facts,public.crm_report_facts,public.crm_stage_intervals from public,anon,authenticated;
 grant select on public.crm_board_facts,public.crm_report_facts,public.crm_stage_intervals to service_role;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'crm_%' or p.proname in ('create_order','create_order_audited','register_order_photo','cancel_order','change_order_status','public_order_status')) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
notify pgrst,'reload schema';
commit;
