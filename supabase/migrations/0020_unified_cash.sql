-- Daily cash statements: driver hand-in, administrator receipt, immutable month snapshots.
-- Old orders, payments, audit and closings are preserved. Only new schema is created.
begin;
-- Owner confirmed: all driver cash, including advances, belongs to its receipt day.
create table public.cash_day_handovers(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),
 driver_id uuid not null references public.profiles(id),business_day date not null,
 amount numeric(12,0) not null check(amount>0),deliveries_count bigint not null check(deliveries_count>=0),
 deliveries_total numeric not null check(deliveries_total>=0),snapshot jsonb not null,
 state text not null default 'pending' check(state in ('pending','accepted','rejected','cancelled')),
 reason text not null default '' check(length(reason)<=1000),created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,resolved_by uuid references public.profiles(id),
 check((state='pending' and resolved_at is null and resolved_by is null) or (state<>'pending' and resolved_at is not null and resolved_by is not null))
);
create table public.cash_month_closures(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),
 month_start date not null check(month_start=date_trunc('month',month_start)::date),
 snapshot jsonb not null,closed_at timestamptz not null default clock_timestamp(),unique(branch_id,month_start)
);
create index cash_handovers_day_idx on public.cash_day_handovers(branch_id,business_day,driver_id,state);
create index cash_handovers_pending_idx on public.cash_day_handovers(branch_id,created_at,id) where state='pending';
create index cash_payment_report_idx on public.payments(branch_id,created_at,received_by,id) where method='cash' and state='confirmed';
create index cash_payment_audit_role_idx on public.audit_log(entity_id,id) where entity='payments' and action='created';
create index cash_deliveries_idx on public.status_history(order_id,created_at) where status='delivered';
alter table public.cash_day_handovers enable row level security;
alter table public.cash_month_closures enable row level security;
revoke all on public.cash_day_handovers,public.cash_month_closures from public,anon,authenticated;
grant select,insert,update on public.cash_day_handovers to service_role;
grant select,insert on public.cash_month_closures to service_role;
revoke delete,truncate on public.cash_day_handovers,public.cash_month_closures from service_role;

create function public.crm_cash_basis() returns text language sql stable security invoker set search_path=public,pg_temp as $$select 'receipt'::text$$;
create function public.crm_cash_day_of(received timestamptz) returns date
language sql stable security invoker set search_path=public,pg_temp as $$
 select (received at time zone 'Asia/Tashkent')::date
$$;
create function public.crm_cash_period_lock(b uuid,d date) returns void language sql volatile security invoker set search_path=public,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended('cash-month:'||b::text||':'||date_trunc('month',d)::date::text,0))
$$;
create view public.crm_cash_deliveries with(security_invoker=true) as
 select o.id as order_id,o.branch_id,o.delivery_driver_id as driver_id,'K-'||o.number as code,
 h.delivered_at,(h.delivered_at at time zone 'Asia/Tashkent')::date as business_day,o.total,o.paid_amount,
 greatest(o.total-o.paid_amount,0) as client_debt
 from public.orders o join lateral(select min(created_at) as delivered_at from public.status_history where order_id=o.id and status='delivered') h on h.delivered_at is not null
 where o.status='delivered';
create view public.crm_cash_receipts with(security_invoker=true) as
 select p.id as payment_id,p.order_id,p.branch_id,p.received_by as driver_id,'K-'||o.number as code,
 p.created_at as received_at,case when p.direction='refund' then -p.amount else p.amount end as amount,
 coalesce(case when audit.role in ('driver','admin') then audit.role end,pf.role::text) as receiver_role,
 d.delivered_at,public.crm_cash_day_of(p.created_at) as business_day
 from public.payments p join public.orders o on o.id=p.order_id left join public.profiles pf on pf.id=p.received_by
 left join public.crm_cash_deliveries d on d.order_id=p.order_id
 left join lateral(select role from public.audit_log where entity='payments' and entity_id=p.id and action='created' order by id limit 1) audit on true
 where p.method='cash' and p.state='confirmed';
revoke all on public.crm_cash_deliveries,public.crm_cash_receipts from public,anon,authenticated;
grant select on public.crm_cash_deliveries,public.crm_cash_receipts to service_role;

create function public.crm_cash_period_rows(b uuid,d1 date,d2 date) returns table(
 driver_id uuid,driver_name text,deliveries_count bigint,deliveries_total numeric,collected numeric,
 accepted numeric,pending numeric,to_hand numeric,outstanding numeric,client_debt numeric)
language sql stable security invoker set search_path=public,pg_temp as $$
 with deliveries as(select d.driver_id,count(*) n,sum(d.total) amount,sum(d.client_debt) client_debt from public.crm_cash_deliveries d
  where d.branch_id=b and d.business_day between d1 and d2 group by d.driver_id),
 receipts as(select r.driver_id,sum(r.amount) amount from public.crm_cash_receipts r
  where r.branch_id=b and r.business_day between d1 and d2 and r.receiver_role='driver' group by r.driver_id),
 handovers as(select x.driver_id,sum(x.accepted) accepted,sum(x.pending) pending from(
  select h.driver_id,case when h.state='accepted' then h.amount else 0 end accepted,case when h.state='pending' then h.amount else 0 end pending
   from public.cash_day_handovers h where h.branch_id=b and h.business_day between d1 and d2
  union all select c.driver_id,c.counted,0 from public.cash_closings c where c.branch_id=b and c.day between d1 and d2)x group by x.driver_id),
 people as(select p.id from public.profiles p where p.role='driver' and p.active and p.branch_id=b
  union select driver_id from deliveries union select driver_id from receipts union select driver_id from handovers)
 select p.id,p.full_name,coalesce(d.n,0),coalesce(d.amount,0),coalesce(r.amount,0),
 coalesce(h.accepted,0),coalesce(h.pending,0),
 greatest(coalesce(r.amount,0)-coalesce(h.accepted,0)-coalesce(h.pending,0),0),
 greatest(coalesce(r.amount,0)-coalesce(h.accepted,0),0),coalesce(d.client_debt,0)
 from people c join public.profiles p on p.id=c.id left join deliveries d on d.driver_id=p.id
 left join receipts r on r.driver_id=p.id left join handovers h on h.driver_id=p.id order by p.full_name,p.id
$$;

create function public.crm_cash_delivery_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare b uuid;begin
 if new.status='delivered' then
  -- Timestamp the actual transition, not the start of a transaction crossing midnight.
  new.created_at:=clock_timestamp();select branch_id into b from public.orders where id=new.order_id;
  perform public.crm_cash_period_lock(b,(new.created_at at time zone 'Asia/Tashkent')::date);
 end if;return new;
end $$;
create trigger cash_delivery_period before insert on public.status_history for each row execute function public.crm_cash_delivery_guard();
create or replace function public.crm_cash_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' and old.method='cash' and old.state='confirmed' then
  if tg_op='DELETE' then raise exception using errcode='55000',message='Наличную оплату удалять нельзя';end if;
  if (new.id,new.order_id,new.branch_id,new.received_by,new.amount,new.method,new.direction,new.state,new.created_at) is distinct from
     (old.id,old.order_id,old.branch_id,old.received_by,old.amount,old.method,old.direction,old.state,old.created_at) then
   raise exception using errcode='55000',message='Наличную оплату меняют отдельным возвратом';end if;
 end if;
 if tg_op<>'DELETE' and new.method='cash' and new.state='confirmed' then
  if new.received_by is null then raise exception using errcode='23514',message='Укажите получателя наличных';end if;
  if tg_op='INSERT' then new.created_at:=clock_timestamp();end if;
  perform public.crm_cash_period_lock(new.branch_id,(new.created_at at time zone 'Asia/Tashkent')::date);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger cash_closed_guard on public.payments;
create trigger cash_closed_guard before insert or update or delete on public.payments for each row execute function public.crm_cash_guard();
create function public.crm_cash_legacy_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception using errcode='55000',message='Используйте передачу денег за рабочий день в новой кассе';end $$;
create trigger cash_legacy_guard before insert or update or delete on public.cash_closings for each row execute function public.crm_cash_legacy_guard();

create function public.crm_cash_handover_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;who uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='Историю кассы удалять нельзя';end if;
 if current_setting('app.cash_write',true) is distinct from 'allowed' then raise exception using errcode='42501',message='Используйте кнопки передачи и приёма кассы';end if;
 a:=public.crm_require(who,'payments',new.branch_id);
 if tg_op='INSERT' then
  if a.role::text<>'driver' or new.driver_id<>who or new.state<>'pending' or new.business_day>(clock_timestamp() at time zone 'Asia/Tashkent')::date then
   raise exception using errcode='42501',message='Водитель передаёт только свою кассу';end if;
 else
  if (new.id,new.branch_id,new.driver_id,new.business_day,new.amount,new.deliveries_count,new.deliveries_total,new.snapshot,new.created_at) is distinct from
     (old.id,old.branch_id,old.driver_id,old.business_day,old.amount,old.deliveries_count,old.deliveries_total,old.snapshot,old.created_at)
   or old.state<>'pending' or new.state='pending' or new.resolved_by<>who then raise exception using errcode='55000',message='Передача уже рассмотрена или изменяются её суммы';end if;
  if (new.state='cancelled' and (who<>old.driver_id or a.role::text<>'driver')) or (new.state in ('accepted','rejected') and a.role::text<>'admin') then
   raise exception using errcode='42501',message='Нет доступа к этой передаче';end if;
 end if;return new;
end $$;
create trigger cash_handover_guard before insert or update or delete on public.cash_day_handovers for each row execute function public.crm_cash_handover_guard();
create trigger cash_handover_audit after insert or update on public.cash_day_handovers for each row execute function public.crm_audit_change();

create function public.crm_cash_command(p_action text,p_data jsonb,p_user uuid,p_ip inet,p_key uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;h public.cash_day_handovers;prev public.command_receipts;b uuid;d date;dayrow record;result jsonb;begin
 a:=public.crm_require(p_user,'payments');perform public.crm_cash_basis();
 if a.role::text not in ('admin','driver') then raise exception using errcode='42501',message='Нет доступа к кассе';end if;
 if p_key is null or p_action is null or p_action not in ('hand_in','accept','reject','cancel') then raise exception using errcode='23514',message='Проверьте действие кассы';end if;
 perform public.lifecycle_actor(p_user,p_ip);perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));
 select * into prev from public.command_receipts where user_id=p_user and key=p_key;
 if found then
  if prev.command<>('cash.'||p_action) or prev.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ уже использован для другого действия';end if;return prev.result;
 end if;
 if p_action='hand_in' then
  b:=(p_data->>'branch_id')::uuid;d:=(p_data->>'day')::date;perform public.crm_require(p_user,'payments',b);
  if a.role::text<>'driver' then raise exception using errcode='42501',message='Передачу отмечает водитель';end if;
  if b is null or d is null or d>(clock_timestamp() at time zone 'Asia/Tashkent')::date then raise exception using errcode='23514',message='Выберите рабочий день';end if;
  perform public.crm_cash_period_lock(b,d);
  perform pg_advisory_xact_lock(hashtextextended('cash-day:'||b::text||':'||p_user::text||':'||d::text,0));
  select * into dayrow from public.crm_cash_period_rows(b,d,d) where driver_id=p_user;
  if not found or dayrow.to_hand<=0 then raise exception using errcode='55000',message='Наличных к передаче за этот день нет';end if;
  if (p_data->>'expected_amount')::numeric is distinct from dayrow.to_hand then raise exception using errcode='55000',message='Сумма кассы изменилась. Обновите данные и повторите передачу';end if;
  perform set_config('app.cash_write','allowed',true);
  insert into public.cash_day_handovers(branch_id,driver_id,business_day,amount,deliveries_count,deliveries_total,snapshot)
  values(b,p_user,d,dayrow.to_hand,dayrow.deliveries_count,dayrow.deliveries_total,
   jsonb_build_object('totals',to_jsonb(dayrow),'basis',public.crm_cash_basis(),
    'orders',(select coalesce(jsonb_agg(jsonb_build_object('order_id',x.order_id,'code',x.code,'total',x.total) order by x.delivered_at,x.order_id),'[]') from public.crm_cash_deliveries x where x.branch_id=b and x.driver_id=p_user and x.business_day=d))) returning * into h;
 else
  select * into h from public.cash_day_handovers where id=(p_data->>'handover_id')::uuid;
  if not found then raise exception using errcode='P0002',message='Передача не найдена';end if;
  perform public.crm_require(p_user,'payments',h.branch_id);
  if (p_action='cancel' and (a.role::text<>'driver' or h.driver_id<>p_user)) or (p_action<>'cancel' and a.role::text<>'admin') then raise exception using errcode='42501',message='Нет доступа к этой передаче';end if;
  perform public.crm_cash_period_lock(h.branch_id,h.business_day);
  perform pg_advisory_xact_lock(hashtextextended('cash-day:'||h.branch_id::text||':'||h.driver_id::text||':'||h.business_day::text,0));
  select * into h from public.cash_day_handovers where id=h.id for update;
  if h.state<>'pending' and h.state<>(case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'cancelled' end) then raise exception using errcode='55000',message='Передача уже рассмотрена';end if;
  if h.state='pending' then
   perform set_config('app.cash_write','allowed',true);
   update public.cash_day_handovers set state=case p_action when 'accept' then 'accepted' when 'reject' then 'rejected' else 'cancelled' end,
    reason=coalesce(p_data->>'reason',''),resolved_at=clock_timestamp(),resolved_by=p_user where id=h.id returning * into h;
  end if;
 end if;
 perform set_config('app.cash_write','',true);result:=to_jsonb(h);
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,'cash.'||p_action,p_data,result);return result;
end $$;

create function public.crm_cash_day(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;b uuid;d date;rows jsonb;self jsonb;totals jsonb;pending_rows jsonb;admin_cash numeric;begin
 a:=public.crm_require(p_user,'payments');perform public.crm_cash_basis();
 b:=(p_filters->>'branch_id')::uuid;d:=coalesce((p_filters->>'day')::date,(clock_timestamp() at time zone 'Asia/Tashkent')::date);
 if b is null or not exists(select 1 from public.branches where id=b) or d>(clock_timestamp() at time zone 'Asia/Tashkent')::date then raise exception using errcode='23514',message='Проверьте филиал и рабочий день';end if;
 perform public.crm_require(p_user,'payments',b);
 with visible as materialized(select * from public.crm_cash_period_rows(b,d,d) where a.role::text='admin' or driver_id=p_user)
 select (select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_name,x.driver_id),'[]') from visible x),
 (select to_jsonb(x) from visible x where driver_id=p_user),
 (select jsonb_build_object('deliveries_count',coalesce(sum(deliveries_count),0),'deliveries_total',coalesce(sum(deliveries_total),0),'collected',coalesce(sum(collected),0),'accepted',coalesce(sum(accepted),0),'pending',coalesce(sum(pending),0),'outstanding',coalesce(sum(outstanding),0),'client_debt',coalesce(sum(client_debt),0)) from visible)
 into rows,self,totals;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.business_day,x.created_at,x.id),'[]') into pending_rows from(
  select h.*,p.full_name as driver_name from public.cash_day_handovers h join public.profiles p on p.id=h.driver_id
  where h.branch_id=b and h.state='pending' and (a.role::text='admin' or h.driver_id=p_user) order by h.business_day,h.created_at,h.id limit 100)x;
 select coalesce(sum(r.amount),0) into admin_cash from public.crm_cash_receipts r where r.branch_id=b and r.driver_id=p_user and r.receiver_role='admin'
  and (r.received_at at time zone 'Asia/Tashkent')::date=d;
 return jsonb_build_object('branch_id',b,'day',d,'rows',rows,'self',coalesce(self,jsonb_build_object('deliveries_count',0,'deliveries_total',0,'collected',0,'accepted',0,'pending',0,'to_hand',0,'outstanding',0,'client_debt',0)),
  'totals',totals,'pending',pending_rows,'admin_cash',admin_cash,'generated_at',clock_timestamp());
end $$;
create function public.crm_cash_details(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;b uuid;d date;who uuid;off int;n bigint;rows jsonb;other jsonb;begin
 a:=public.crm_require(p_user,'payments');perform public.crm_cash_basis();
 b:=(p_filters->>'branch_id')::uuid;d:=(p_filters->>'day')::date;who:=(p_filters->>'driver_id')::uuid;off:=greatest(coalesce((p_filters->>'offset')::int,0),0);
 perform public.crm_require(p_user,'payments',b);
 if b is null or d is null or who is null or (a.role::text<>'admin' and who<>p_user) then raise exception using errcode='42501',message='Нет доступа к чужой кассе';end if;
 select count(*) into n from public.crm_cash_deliveries x where x.branch_id=b and x.driver_id=who and x.business_day=d;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.delivered_at,x.order_id),'[]') into rows from(
  select v.*,coalesce((select sum(r.amount) from public.crm_cash_receipts r where r.order_id=v.order_id and r.driver_id=who and r.receiver_role='driver' and r.business_day=d),0) as driver_cash,
   public.crm_visible(o,a) as can_open from public.crm_cash_deliveries v join public.orders o on o.id=v.order_id
  where v.branch_id=b and v.driver_id=who and v.business_day=d order by v.delivered_at,v.order_id limit 50 offset off)x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.received_at,x.payment_id),'[]') into other from(
  select r.* from public.crm_cash_receipts r where r.branch_id=b and r.driver_id=who and r.receiver_role='driver' and r.business_day=d
   and not exists(select 1 from public.crm_cash_deliveries v where v.order_id=r.order_id and v.driver_id=who and v.business_day=d)
  order by r.received_at,r.payment_id limit 50 offset off)x;
 return jsonb_build_object('driver_id',who,'day',d,'deliveries',rows,'other_cash',other,'next_offset',case when off+50<n or jsonb_array_length(other)=50 then off+50 end);
end $$;

create function public.crm_cash_close_month(b uuid,m date) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare snap jsonb;newid uuid;begin
 perform public.crm_cash_basis();
 if m is null or m<>date_trunc('month',m)::date or m>=date_trunc('month',clock_timestamp() at time zone 'Asia/Tashkent')::date then raise exception using errcode='23514',message='Закрывают только завершённый месяц';end if;
 perform public.crm_cash_period_lock(b,m);
 if exists(select 1 from public.cash_month_closures where branch_id=b and month_start=m) then return false;end if;
 select jsonb_build_object('basis',public.crm_cash_basis(),'rows',coalesce(jsonb_agg(to_jsonb(x) order by x.driver_name,x.driver_id),'[]'),
  'deliveries',(select coalesce(jsonb_agg(to_jsonb(v) order by v.delivered_at,v.order_id),'[]') from public.crm_cash_deliveries v where v.branch_id=b and v.business_day>=m and v.business_day<(m+interval '1 month')::date))
 into snap from public.crm_cash_period_rows(b,m,(m+interval '1 month - 1 day')::date)x;
 perform set_config('app.cash_month_write','allowed',true);
 insert into public.cash_month_closures(branch_id,month_start,snapshot) values(b,m,snap) returning id into newid;
 perform set_config('app.cash_month_write','',true);
 insert into public.audit_log(role,entity,entity_id,action,"after") values('cash_automation','cash_month_closures',newid,'cash_month_closed',jsonb_build_object('branch_id',b,'month',m,'snapshot',snap));
 return true;
end $$;
create function public.crm_cash_month_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op<>'INSERT' or current_setting('app.cash_month_write',true) is distinct from 'allowed' then raise exception using errcode='55000',message='Закрытый итог месяца защищён от изменений';end if;return new;
end $$;
create trigger cash_month_guard before insert or update or delete on public.cash_month_closures for each row execute function public.crm_cash_month_guard();
create function public.crm_cash_close_due_months() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b record;m date;last_month date;closed int:=0;begin
 perform public.crm_cash_basis();last_month:=(date_trunc('month',clock_timestamp() at time zone 'Asia/Tashkent')-interval '1 month')::date;
 for b in select id,created_at from public.branches loop
  for m in select generate_series(date_trunc('month',b.created_at at time zone 'Asia/Tashkent')::date,last_month,interval '1 month')::date loop
   if public.crm_cash_close_month(b.id,m) then closed:=closed+1;end if;
  end loop;
 end loop;return jsonb_build_object('closed',closed,'at',clock_timestamp());
end $$;
create function public.crm_cash_month(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;b uuid;m date;closure public.cash_month_closures;rows jsonb;totals jsonb;begin
 a:=public.crm_require(p_user,'payments');perform public.crm_cash_basis();b:=(p_filters->>'branch_id')::uuid;
 if coalesce(p_filters->>'month','')!~'^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then raise exception using errcode='23514',message='Выберите месяц';end if;
 m:=((p_filters->>'month')||'-01')::date;perform public.crm_require(p_user,'payments',b);
 if b is null or m>date_trunc('month',clock_timestamp() at time zone 'Asia/Tashkent')::date then raise exception using errcode='23514',message='Проверьте филиал и месяц';end if;
 select * into closure from public.cash_month_closures where branch_id=b and month_start=m;
 if found then
  select coalesce(jsonb_agg(x||jsonb_build_object('accepted',coalesce(cur.accepted,0),'outstanding',greatest((x->>'collected')::numeric-coalesce(cur.accepted,0),0)) order by x->>'driver_name'),'[]') into rows
  from jsonb_array_elements(closure.snapshot->'rows')x left join public.crm_cash_period_rows(b,m,(m+interval '1 month - 1 day')::date)cur on cur.driver_id=(x->>'driver_id')::uuid
  where a.role::text='admin' or (x->>'driver_id')::uuid=p_user;
 else
  select coalesce(jsonb_agg(to_jsonb(x) order by x.driver_name,x.driver_id),'[]') into rows from public.crm_cash_period_rows(b,m,(m+interval '1 month - 1 day')::date)x where a.role::text='admin' or x.driver_id=p_user;
 end if;
 select jsonb_build_object('deliveries_count',coalesce(sum((x->>'deliveries_count')::bigint),0),'deliveries_total',coalesce(sum((x->>'deliveries_total')::numeric),0),'collected',coalesce(sum((x->>'collected')::numeric),0),'accepted',coalesce(sum((x->>'accepted')::numeric),0),'outstanding',coalesce(sum((x->>'outstanding')::numeric),0)) into totals from jsonb_array_elements(rows)x;
 return jsonb_build_object('month',m,'closed',closure.id is not null,'closed_at',closure.closed_at,'is_current',m=date_trunc('month',clock_timestamp() at time zone 'Asia/Tashkent')::date,'rows',rows,'totals',totals);
end $$;

-- Each financial fact is append-only. Helpers are server-only; entry RPCs enforce active profiles.
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crm_cash_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end $$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset')
 and to_regprocedure('public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)') is not null
 and to_regprocedure('public.crm_queue(jsonb,uuid,boolean)') is not null
 and has_function_privilege(current_user,'public.crm_queue(jsonb,uuid,boolean)','execute')
 and to_regprocedure('public.crm_cash_day(jsonb,uuid)') is not null
 and has_function_privilege(current_user,'public.crm_cash_day(jsonb,uuid)','execute')
 and to_regprocedure('public.crm_cash_close_due_months()') is not null
 and to_regclass('public.cash_month_closures') is not null,'schema',20)
$$;
notify pgrst,'reload schema';
commit;

