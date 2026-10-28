begin;
alter table public.visits add column if not exists arrived_at timestamptz;
create table if not exists public.complaints (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),branch_id uuid not null references public.branches(id),
 reason text not null,note text not null default '',photo_ids jsonb not null default '[]',
 state text not null default 'open' check(state in ('open','in_progress','resolved')),
 resolution text check(resolution in ('rewash','discount','compensation','no_issue')),resolution_note text,
 responsible_id uuid references public.profiles(id),due_at timestamptz not null,created_by uuid,created_at timestamptz not null default now(),resolved_at timestamptz
);
create index if not exists complaints_order_idx on public.complaints(order_id,created_at);
create table if not exists public.feedback (
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),score integer not null check(score between 0 and 10),
 comment text not null default '',created_at timestamptz not null default now()
);
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
 left join lateral(select min(h.created_at) filter(where h.status='received') received_at,max(h.created_at) filter(where h.status='delivered') delivered_at from public.status_history h where h.order_id=o.id) history on true
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
   select t.name as tariff,count(*)::numeric as items,sum(i.area_m2) area_m2,sum(i.price) base_revenue
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

-- Раннее получение блокировки заказа сохраняет единый порядок order → visit при гонке с переносом.
do $$begin
 if to_regprocedure('public.crm_command_v2(text,jsonb,uuid,inet,uuid)') is null then
  alter function public.crm_command(text,jsonb,uuid,inet,uuid) rename to crm_command_v2;
 end if;
end $$;
create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare oid uuid;
begin
 if p_command='visit.event' then
  select order_id into oid from public.visits where id=(p_data->>'visit_id')::uuid;
  if oid is not null then perform public.crm_order(oid,p_user,'status');end if;
 end if;
 return public.crm_command_v2(p_command,p_data,p_user,p_ip,p_key);
end $$;

create or replace function public.crm_extension(p_command text,p_data jsonb,p_user uuid,p_ip inet) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.visits;o public.orders;actor public.profiles;
begin
 if p_command<>'visit.arrived' then raise exception using errcode='23514',message='Неизвестное действие';end if;
 select * into v from public.visits where id=(p_data->>'visit_id')::uuid;
 if not found then raise exception using errcode='P0002',message='Задание не найдено';end if;
 o:=public.crm_order(v.order_id,p_user,'status');select * into v from public.visits where id=v.id for update;
 select * into actor from public.profiles where id=p_user;
 if actor.role::text not in ('admin','dispatcher','driver') or (actor.role::text='driver' and v.driver_id is distinct from p_user) then raise exception using errcode='42501',message='Это не ваше задание';end if;
 if v.state<>'en_route' or v.arrived_at is not null then raise exception using errcode='55000',message='Прибытие уже отмечено или задание не в пути';end if;
 update public.visits set arrived_at=clock_timestamp() where id=v.id returning * into v;
 insert into public.visit_events(visit_id,event,actor_id) values(v.id,'arrived',p_user);return to_jsonb(v);
end $$;

do $$ declare t text;f record;begin
 foreach t in array array['complaints','feedback'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);execute format('revoke delete,truncate on public.%I from service_role',t);
  execute format('drop trigger if exists report_source_audit on public.%I',t);execute format('create trigger report_source_audit after insert or update on public.%I for each row execute function public.crm_audit_change()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crm_report','crm_report_cohort','crm_extension','crm_command','crm_command_v2') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke all on public.crm_report_facts,public.crm_stage_intervals from public,anon,authenticated;
grant select on public.crm_report_facts,public.crm_stage_intervals to service_role;
commit;
