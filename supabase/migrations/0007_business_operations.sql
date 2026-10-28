begin;
alter table public.clients add column if not exists tags jsonb not null default '[]';
alter table public.clients add column if not exists blacklisted boolean not null default false;
alter table public.clients add column if not exists blacklist_reason text;
alter table public.clients add column if not exists sms_consent boolean not null default false;
alter table public.clients add column if not exists telegram_chat_id text;
alter table public.clients add column if not exists telegram_consent boolean not null default false;
alter table public.tasks add column if not exists escalation_key text;
create unique index if not exists tasks_escalation_unique on public.tasks(escalation_key) where escalation_key is not null;
create table if not exists public.discount_rules(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),code text not null,
 kind text not null check(kind in ('promo','loyalty')),percent numeric not null check(percent>0 and percent<=50),
 min_orders integer not null default 0 check(min_orders>=0),min_total numeric not null default 0 check(min_total>=0),
 max_uses integer check(max_uses>0),uses integer not null default 0,valid_from timestamptz not null,valid_to timestamptz not null,
 active boolean not null default true,unique(branch_id,code),check(valid_to>valid_from)
);
create table if not exists public.order_discounts(
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.orders(id),rule_id uuid not null references public.discount_rules(id),
 original_total numeric not null,amount numeric not null check(amount>=0),snapshot jsonb not null,created_by uuid,created_at timestamptz not null default now()
);
create table if not exists public.cash_closings(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),driver_id uuid not null references public.profiles(id),
 day date not null,expected numeric not null,counted numeric not null check(counted>=0),difference numeric not null,note text not null,
 confirmed_by uuid,confirmed_at timestamptz not null default now(),unique(driver_id,day)
);
create table if not exists public.payment_intents(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),provider text not null check(provider in ('payme','click')),
 amount numeric(12,0) not null check(amount>0),state integer not null default 0 check(state in (0,1,2,-1,-2)),
 provider_id text,provider_time bigint,create_time bigint not null default 0,perform_time bigint not null default 0,cancel_time bigint not null default 0,reason integer,
 created_by uuid,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '12 hours',unique(provider,provider_id)
);
create index if not exists payment_intents_order_idx on public.payment_intents(order_id,state);
create table if not exists public.intake_acts(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),snapshot jsonb not null,
 public_token text not null unique default encode(gen_random_bytes(24),'hex'),otp_hash text,otp_expires timestamptz,otp_attempts integer not null default 0,
 confirmed_at timestamptz,confirmation_method text,created_by uuid,created_at timestamptz not null default now()
);
create index if not exists intake_acts_order_idx on public.intake_acts(order_id,created_at desc);
create table if not exists public.rewash_jobs(
 id uuid primary key default gen_random_uuid(),complaint_id uuid not null unique references public.complaints(id),order_id uuid not null references public.orders(id),
 stage text not null default 'received' check(stage in ('received','washing','drying','quality_check','packing','ready')),
 assigned_to uuid references public.profiles(id),created_at timestamptz not null default now(),completed_at timestamptz
);
alter table public.complaints add column if not exists adjustment_amount numeric not null default 0;
create table if not exists public.compensations(
 id uuid primary key default gen_random_uuid(),complaint_id uuid not null unique references public.complaints(id),order_id uuid not null references public.orders(id),
 amount numeric not null check(amount>=0),kind text not null check(kind in ('discount','compensation')),state text not null default 'approved' check(state in ('approved','paid')),
 note text not null,created_by uuid,created_at timestamptz not null default now(),paid_by uuid,paid_at timestamptz
);
create table if not exists public.materials(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),code text not null,name text not null,unit text not null,
 norm_per_m2 numeric(12,6) not null check(norm_per_m2>=0),stock numeric(14,6) not null default 0 check(stock>=0),active boolean not null default true,unique(branch_id,code)
);
create table if not exists public.stock_movements(
 id uuid primary key default gen_random_uuid(),material_id uuid not null references public.materials(id),order_id uuid references public.orders(id),
 quantity numeric(14,6) not null check(quantity<>0),source text not null,note text not null default '',norm_snapshot numeric,
 created_by uuid,created_at timestamptz not null default now(),unique(material_id,source)
);
create table if not exists public.piece_rates(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),role text not null check(role in ('driver','workshop')),
 event text not null check(event in ('pickup','delivery','washing','packing')),unit text not null check(unit in ('order','m2')),
 rate numeric not null check(rate>=0),effective_at timestamptz not null,unique(branch_id,role,event,effective_at)
);
create table if not exists public.pay_accruals(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),employee_id uuid not null references public.profiles(id),
 order_id uuid not null references public.orders(id),event text not null,role_snapshot text not null,unit text not null check(unit in ('order','m2')),units numeric not null,rate numeric not null,amount numeric not null,source text not null unique,
 created_at timestamptz not null default now()
);
create index if not exists pay_accruals_period_idx on public.pay_accruals(branch_id,created_at,employee_id);
create table if not exists public.slot_limits(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),day date not null,zone_code text not null,slot_code text not null,
 capacity integer not null check(capacity>0),unique(branch_id,day,zone_code,slot_code)
);
create table if not exists public.webhook_subscriptions(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),name text not null,url text not null,
 secret_env text not null check(secret_env ~ '^WEBHOOK_SECRET_[A-Z0-9_]+$'),active boolean not null default false
);
create table if not exists public.integration_outbox(
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),order_id uuid references public.orders(id),
 event_key text not null,channel text not null check(channel in ('sms','telegram','webhook')),destination text not null,payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','processing','sent','dead','skipped')),attempts integer not null default 0,
 due_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,last_error text,provider_id text,
 created_at timestamptz not null default now(),sent_at timestamptz,unique(event_key,channel,destination)
);
create index if not exists outbox_pending_idx on public.integration_outbox(due_at,id) where state in ('pending','processing');
create table if not exists public.system_jobs(id uuid primary key default gen_random_uuid(),key text not null unique,created_at timestamptz not null default now());

-- Платёжные и согласовательные записи изменяются только через закрытый серверный API.
create or replace function public.crm_client_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.clients where id=new.client_id and blacklisted) then raise exception using errcode='55000',message='Клиент в чёрном списке. Обратитесь к администратору';end if;
 return new;
end $$;
-- Чтение новых рабочих мест: роли и филиал проверяются повторно в SQL.
create or replace function public.crm_operations(view_name text,f jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;result jsonb;items jsonb:='[]';business_date date;start_day date;end_day date;perm text;
begin
 perm:=case view_name when 'stock' then 'inventory' when 'quality' then 'complaints' when 'rewash' then 'workshop' when 'loyalty' then 'discounts' when 'payroll' then 'payroll' when 'integrations' then 'integrations' when 'cash' then 'payments' when 'planning' then 'read' when 'documents' then 'read' when 'alerts' then 'reports' else null end;
 if perm is null then raise exception using errcode='23514',message='Неизвестный раздел';end if;
 actor:=public.crm_require(u,perm);bid:=coalesce((f->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(u,perm,bid);
 business_date:=coalesce((f->>'date')::date,(now() at time zone 'Asia/Tashkent')::date);start_day:=coalesce((f->>'from')::date,business_date-30);end_day:=coalesce((f->>'to')::date,business_date);
 if end_day<start_day or end_day-start_day>366 then raise exception using errcode='23514',message='Выберите период до одного года';end if;
 case view_name
 when 'alerts' then
  select jsonb_build_object('tasks',coalesce(jsonb_agg(to_jsonb(x) order by due_at,id),'[]')) into result from(select t.* from public.tasks t join public.orders o on o.id=t.order_id where t.branch_id=bid and t.assigned_to=u and t.escalation_key is not null and t.status='open' and o.deleted_at is null and (o.status not in ('cancelled','delivered') or t.escalation_key like 'complaint:%') order by t.due_at,t.id limit 100)x;
 when 'stock' then
  select coalesce(jsonb_agg(to_jsonb(m) order by code),'[]') into items from public.materials m where branch_id=bid;
  result:=jsonb_build_object('materials',items,'movements',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id desc),'[]') from(select s.* from public.stock_movements s join public.materials m on m.id=s.material_id where m.branch_id=bid and (f->>'cursor_at' is null or (s.created_at,s.id)<((f->>'cursor_at')::timestamptz,(f->>'cursor_id')::uuid)) order by s.created_at desc,s.id desc limit 101)x));
 when 'loyalty' then select jsonb_build_object('rules',coalesce(jsonb_agg(to_jsonb(r) order by code),'[]')) into result from public.discount_rules r where branch_id=bid;
 when 'quality' then select jsonb_build_object('complaints',coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id desc),'[]'),'compensations',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.compensations c join public.orders o on o.id=c.order_id where o.branch_id=bid and o.deleted_at is null and c.state='approved')) into result from(select c.*,'K-'||o.number code from public.complaints c join public.orders o on o.id=c.order_id where c.branch_id=bid and o.deleted_at is null and (f->>'cursor_at' is null or (c.created_at,c.id)<((f->>'cursor_at')::timestamptz,(f->>'cursor_id')::uuid)) order by c.created_at desc,c.id desc limit 101)x;
 when 'rewash' then select jsonb_build_object('jobs',coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]')) into result from(select j.*,'K-'||o.number code,c.reason from public.rewash_jobs j join public.orders o on o.id=j.order_id join public.complaints c on c.id=j.complaint_id where o.branch_id=bid and o.deleted_at is null and j.completed_at is null order by j.created_at,j.id limit 100)x;
 when 'cash' then
  if actor.role::text not in ('admin','dispatcher','driver') then raise exception using errcode='42501',message='Нет доступа к кассе';end if;
  result:=jsonb_build_object('day',business_date,'cash',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select p.received_by,pf.full_name,sum(case when p.direction='payment' then p.amount else -p.amount end) expected,count(*) operations from public.payments p left join public.profiles pf on pf.id=p.received_by where p.branch_id=bid and p.method='cash' and p.state='confirmed' and (p.created_at at time zone 'Asia/Tashkent')::date=business_date and (actor.role::text<>'driver' or p.received_by=u) group by p.received_by,pf.full_name)x),
  'closings',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.cash_closings c where c.branch_id=bid and c.day=business_date and (actor.role::text<>'driver' or c.driver_id=u)));
 when 'payroll' then
  result:=jsonb_build_object('from',start_day,'to',end_day,'accruals',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select a.employee_id,p.full_name,a.role_snapshot role,sum(a.amount) amount,count(*) operations from public.pay_accruals a join public.profiles p on p.id=a.employee_id where a.branch_id=bid and a.created_at>=start_day::timestamp at time zone 'Asia/Tashkent' and a.created_at<(end_day+1)::timestamp at time zone 'Asia/Tashkent' group by a.employee_id,p.full_name,a.role_snapshot)x),
  'operators',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select p.id,p.full_name,count(o.id) orders,count(o.id) filter(where o.status='cancelled') cancellations,count(o.id) filter(where o.status='delivered') delivered,sum(o.total) filter(where o.status='delivered') issued_total from public.profiles p left join public.orders o on o.created_by=p.id and o.branch_id=bid and o.deleted_at is null and o.created_at>=start_day::timestamp at time zone 'Asia/Tashkent' and o.created_at<(end_day+1)::timestamp at time zone 'Asia/Tashkent' where p.role='operator' and p.branch_id=bid group by p.id,p.full_name)x),
  'rates',(select coalesce(jsonb_agg(to_jsonb(r) order by effective_at desc),'[]') from public.piece_rates r where r.branch_id=bid));
 when 'integrations' then
  result:=jsonb_build_object('subscriptions',(select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.webhook_subscriptions w where branch_id=bid),
  'outbox',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id desc),'[]') from(select id,event_key,channel,state,attempts,due_at,last_error,created_at from public.integration_outbox where branch_id=bid and (f->>'cursor_at' is null or (created_at,id)<((f->>'cursor_at')::timestamptz,(f->>'cursor_id')::uuid)) order by created_at desc,id desc limit 101)x));
 when 'documents' then
  if actor.role::text='workshop' then raise exception using errcode='42501',message='Нет доступа к документам клиента';end if;
  perform public.crm_order((f->>'order_id')::uuid,u);
  result:=jsonb_build_object('acts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'snapshot',snapshot,'public_token',public_token,'created_at',created_at,'confirmed_at',confirmed_at) order by created_at desc),'[]') from public.intake_acts where order_id=(f->>'order_id')::uuid),
   'intents',(select coalesce(jsonb_agg(to_jsonb(t)-'provider_id'),'[]') from public.payment_intents t where order_id=(f->>'order_id')::uuid),
   'discount',(select to_jsonb(d) from public.order_discounts d where order_id=(f->>'order_id')::uuid));
 when 'planning' then
  if actor.role::text not in ('admin','dispatcher','operator') then raise exception using errcode='42501',message='Нет доступа к планированию';end if;
  result:=jsonb_build_object('slots',(select coalesce(jsonb_agg(to_jsonb(x) order by date,position),'[]') from(
   select d::date date,c.code slot_code,c.name_ru,c.position,greatest(0,least(coalesce((c.config->>'capacity')::integer,20)-(select count(*) from public.visits v join public.orders o on o.id=v.order_id where v.branch_id=bid and v.scheduled_date=d::date and v.slot_code=c.code and v.state in ('planned','en_route') and o.deleted_at is null and o.status not in ('cancelled','delivered')),
   coalesce((select capacity from public.slot_limits l where l.branch_id=bid and l.day=d::date and l.slot_code=c.code and l.zone_code=coalesce(f->>'zone_code','')),5000)-(select count(*) from public.visits v join public.orders o on o.id=v.order_id where v.branch_id=bid and v.scheduled_date=d::date and v.slot_code=c.code and coalesce(v.zone_code,'')=coalesce(f->>'zone_code','') and v.state in ('planned','en_route') and o.deleted_at is null and o.status not in ('cancelled','delivered')))) remaining,
   greatest(0,b.workshop_capacity_m2-(select coalesce(sum(i.area_m2),0) from public.order_items i join public.orders o on o.id=i.order_id where o.branch_id=bid and o.pickup_date=d::date and o.deleted_at is null and o.status not in ('cancelled','delivered'))) workshop_remaining_m2
   from generate_series(business_date::timestamp,(business_date+13)::timestamp,interval '1 day') d cross join public.catalog_entries c join public.branches b on b.id=c.branch_id where c.branch_id=bid and c.kind='slot' and c.active)x),
  'route',(select coalesce(jsonb_agg(to_jsonb(x) order by zone_code,slot_code,position,id),'[]') from(select v.id,v.order_id,'K-'||o.number code,v.zone_code,v.slot_code,v.position,v.driver_id,o.address,o.latitude,o.longitude from public.visits v join public.orders o on o.id=v.order_id where v.branch_id=bid and v.scheduled_date=business_date and v.state in ('planned','en_route') and o.deleted_at is null and o.status not in ('cancelled','delivered') order by v.zone_code,v.slot_code,v.position,v.id limit 100)x));
 end case;
 return result;
end $$;
drop trigger if exists crm_client_blacklist on public.orders;
create trigger crm_client_blacklist before insert on public.orders for each row execute function public.crm_client_guard();

create or replace function public.crm_cash_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.method='cash' and new.state='confirmed' then
  perform pg_advisory_xact_lock(hashtextextended('cash:'||new.received_by::text||(new.created_at at time zone 'Asia/Tashkent')::date::text,0));
  if exists(select 1 from public.cash_closings where driver_id=new.received_by and day=(new.created_at at time zone 'Asia/Tashkent')::date) then raise exception using errcode='55000',message='Касса за этот день уже сверена';end if;
 end if;
 return new;
end $$;
drop trigger if exists cash_closed_guard on public.payments;
create trigger cash_closed_guard before insert or update on public.payments for each row execute function public.crm_cash_guard();

create or replace function public.crm_consume_materials(oid uuid,source_key text,u uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;m public.materials;area numeric;qty numeric;
begin
 select * into o from public.orders where id=oid;select coalesce(sum(area_m2),0) into area from public.order_items where order_id=oid;
 for m in select * from public.materials where branch_id=o.branch_id and active and norm_per_m2>0 order by id for update loop
  if exists(select 1 from public.stock_movements where material_id=m.id and source=source_key) then continue;end if;
  qty:=round(area*m.norm_per_m2,6);if qty=0 then continue;end if;
  if m.stock<qty then raise exception using errcode='55000',message='Недостаточный остаток: '||m.name;end if;
  update public.materials set stock=stock-qty where id=m.id;
  insert into public.stock_movements(material_id,order_id,quantity,source,norm_snapshot,created_by) values(m.id,oid,-qty,source_key,m.norm_per_m2,u);
 end loop;
end $$;
create or replace function public.crm_award(oid uuid,u uuid,event_name text,source_key text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;r public.piece_rates;actor public.profiles;n numeric;
begin
 select * into o from public.orders where id=oid;select * into actor from public.profiles where id=u;
 if actor.role::text not in ('driver','workshop') then return;end if;
 select * into r from public.piece_rates where branch_id=o.branch_id and role=actor.role::text and event=event_name and effective_at<=now() order by effective_at desc limit 1;
 if not found then return;end if;
 if r.unit='m2' then select coalesce(sum(area_m2),0) into n from public.order_items where order_id=oid;else n:=1;end if;
 insert into public.pay_accruals(branch_id,employee_id,order_id,event,role_snapshot,unit,units,rate,amount,source) values(o.branch_id,u,oid,event_name,actor.role::text,r.unit,n,r.rate,round(n*r.rate),source_key) on conflict(source) do nothing;
end $$;
create or replace function public.crm_production_effects() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.status='washing' then perform public.crm_consume_materials(new.order_id,'washing:'||new.order_id,new.changed_by);perform public.crm_award(new.order_id,new.changed_by,'washing','washing:'||new.order_id);end if;
 if new.status='ready' then perform public.crm_award(new.order_id,new.changed_by,'packing','packing:'||new.order_id);end if;
 return new;
end $$;
drop trigger if exists business_status_effects on public.status_history;
create trigger business_status_effects after insert on public.status_history for each row execute function public.crm_production_effects();
create or replace function public.crm_visit_award() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.state='completed' and old.state is distinct from 'completed' then perform public.crm_award(new.order_id,new.driver_id,new.kind,'visit:'||new.id);end if;return new;
end $$;
drop trigger if exists business_visit_award on public.visits;
create trigger business_visit_award after update on public.visits for each row execute function public.crm_visit_award();

-- Расширение сохраняет контракт ранее опубликованных действий.
do $$ begin
 if to_regprocedure('public.crm_extension_v3(text,jsonb,uuid,inet)') is null then alter function public.crm_extension(text,jsonb,uuid,inet) rename to crm_extension_v3;end if;
 if to_regprocedure('public.crm_schedule_visit_v2(jsonb,uuid)') is null then alter function public.crm_schedule_visit(jsonb,uuid) rename to crm_schedule_visit_v2;end if;
 if to_regprocedure('public.crm_create_order_v2(jsonb,uuid)') is null then alter function public.create_order(jsonb,uuid) rename to crm_create_order_v2;end if;
end $$;
create or replace function public.create_order(p jsonb,p_user uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;area numeric;used numeric;cap numeric;day date:=(p->>'pickup_date')::date;
begin
 actor:=public.crm_require(p_user,'create');bid:=coalesce((p->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(p_user,'create',bid);
 perform pg_advisory_xact_lock(hashtextextended('capacity:'||bid::text||day::text,0));
 select sum((i->>'length_m')::numeric*(i->>'width_m')::numeric) into area from jsonb_array_elements(p->'items') i;
 select coalesce(sum(i.area_m2),0) into used from public.order_items i join public.orders o on o.id=i.order_id where o.branch_id=bid and o.pickup_date=day and o.deleted_at is null and o.status not in ('cancelled','delivered');
 select workshop_capacity_m2 into cap from public.branches where id=bid;
 if used+area>cap then raise exception using errcode='55000',message='На этот день превышена мощность цеха. Выберите другую дату';end if;
 return public.crm_create_order_v2(p,p_user);
end $$;
create or replace function public.crm_schedule_visit(d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;area numeric;used numeric;cap numeric;zone text;business_date date:=(d->>'scheduled_date')::date;
begin
 o:=public.crm_order((d->>'order_id')::uuid,u,'dispatch');zone:=coalesce(d->>'zone_code',o.zone_code,'');
 perform pg_advisory_xact_lock(hashtextextended('capacity:'||o.branch_id::text||business_date::text,0));
 select capacity into cap from public.slot_limits where branch_id=o.branch_id and slot_limits.day=business_date and zone_code=zone and slot_code=d->>'slot_code';
 if cap is not null then
  select count(*) into used from public.visits v join public.orders x on x.id=v.order_id where v.branch_id=o.branch_id and v.scheduled_date=business_date and v.slot_code=d->>'slot_code' and coalesce(v.zone_code,'')=zone and v.state in ('planned','en_route') and v.order_id<>o.id and x.deleted_at is null and x.status not in ('cancelled','delivered');
  if used>=cap then raise exception using errcode='55000',message='Лимит района и дня исчерпан';end if;
 end if;
 if d->>'kind'='pickup' then
  select coalesce(sum(area_m2),0) into area from public.order_items where order_id=o.id;
  select coalesce(sum(i.area_m2),0) into used from public.order_items i join public.orders x on x.id=i.order_id where x.branch_id=o.branch_id and x.pickup_date=business_date and x.deleted_at is null and x.status not in ('cancelled','delivered') and x.id<>o.id;
  select workshop_capacity_m2 into cap from public.branches where id=o.branch_id;
  if used+area>cap then raise exception using errcode='55000',message='Превышена суточная мощность цеха';end if;
 end if;
 return public.crm_schedule_visit_v2(d,u);
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
  if o.status not in ('new','pickup_assigned','received') or o.washing_started_at is not null or o.pensioner or exists(select 1 from public.order_discounts where order_id=o.id) then raise exception using errcode='55000',message='Скидка недоступна на этом этапе или уже применена';end if;
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
  perform public.crm_require(p_user,'payments',bid);if actor.role::text not in ('admin','dispatcher') then raise exception using errcode='42501',message='Сверку подтверждает администратор или диспетчер';end if;
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
  if actor.role::text='workshop' then raise exception using errcode='42501',message='Акт оформляет сотрудник приёмки или водитель';end if;
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'photos');if o.status not in ('pickup_assigned','received') then raise exception using errcode='55000',message='Акт создаётся при приёмке';end if;
  if exists(select 1 from public.intake_acts where order_id=o.id and confirmed_at is null) then raise exception using errcode='55000',message='Уже есть неподтверждённый акт';end if;
  obj:=jsonb_build_object('code','K-'||o.number,'address',o.address,'total',o.total,'note',p_data->>'note','items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('photos',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'path',p.storage_path,'kind',p.kind)),'[]') from public.order_photos p where p.item_id=i.id)) order by i.seq),'[]') from public.order_items i where i.order_id=o.id),'defects',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.order_defects d where d.order_id=o.id));
  insert into public.intake_acts(order_id,snapshot,created_by) values(o.id,obj,p_user) returning jsonb_build_object('id',id,'snapshot',snapshot,'public_token',public_token,'confirmed_at',confirmed_at) into result;
  insert into public.audit_log(user_id,role,entity,entity_id,action,"after",ip) values(p_user,actor.role::text,'intake_acts',(result->>'id')::uuid,'created',result-'public_token',p_ip);
 when 'intake.challenge' then
  if actor.role::text='workshop' then raise exception using errcode='42501',message='Код запрашивает сотрудник приёмки или водитель';end if;
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
  if o.id is null then raise exception using errcode='P0002',message='Заказ не найден';end if;perform public.crm_require(p_user,'workshop',o.branch_id);
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
  perform public.crm_require(p_user,'dispatch',bid);
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
 else return public.crm_extension_v3(p_command,p_data,p_user,p_ip);
 end case;
 return result;
end $$;

alter table public.payment_intents add column if not exists click_prepare_id bigint generated by default as identity;
create unique index if not exists payment_intents_click_prepare_idx on public.payment_intents(click_prepare_id);
create or replace function public.crm_provider(p_provider text,p_operation text,d jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare t public.payment_intents;o public.orders;rid uuid;ms bigint:=floor(extract(epoch from clock_timestamp())*1000);cap numeric;amt numeric;result jsonb;
begin
 perform set_config('app.actor_id','',true);perform set_config('app.actor_role','system',true);perform set_config('app.actor_ip','',true);
 if p_provider not in ('payme','click') then raise exception using errcode='23514',message='Неизвестный провайдер';end if;
 if p_operation='statement' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',provider_id,'time',provider_time,'amount',amount*100,'account',jsonb_build_object('intent_id',id),'create_time',create_time,'perform_time',perform_time,'cancel_time',cancel_time,'transaction',id::text,'state',state,'reason',reason) order by create_time) from public.payment_intents where provider=p_provider and state<>0 and provider_time between (d->>'from')::bigint and (d->>'to')::bigint),'[]');
 end if;
 if p_operation in ('check','create') then
  begin rid:=(d->>'intent_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('error_code',-31050);end;
  select order_id into rid from public.payment_intents where id=rid and provider=p_provider;
 else select order_id into rid from public.payment_intents where provider=p_provider and provider_id=d->>'provider_id';end if;
 select * into o from public.orders where id=rid for update;
 if not found or o.deleted_at is not null then return jsonb_build_object('error_code',case when p_operation in ('check','create') then -31050 else -31003 end);end if;
 if p_operation in ('check','create') then select * into t from public.payment_intents where id=(d->>'intent_id')::uuid and provider=p_provider for update;
 else select * into t from public.payment_intents where provider=p_provider and provider_id=d->>'provider_id' for update;end if;
 if p_provider='click' and d->>'intent_id' is not null and t.id::text is distinct from d->>'intent_id' then return jsonb_build_object('error_code',-31003);end if;
 if t.state=1 and t.expires_at<=now() and p_operation in ('check','create','perform') then
  update public.payment_intents set state=-1,cancel_time=ms,reason=4 where id=t.id;return jsonb_build_object('error_code',-31008);
 end if;
 if p_operation in ('check','create') then
  amt:=(d->>'amount')::numeric;
  if amt is null or amt<>t.amount or (p_provider='payme' and coalesce((d->>'amount_tiyin')::numeric,amt*100)<>t.amount*100) then return jsonb_build_object('error_code',-31001);end if;
  if t.provider_id is not null and (p_operation='create' and t.provider_id is distinct from d->>'provider_id') then return jsonb_build_object('error_code',-31008);end if;
  if t.state in (-1,-2) or t.expires_at<=now() then return jsonb_build_object('error_code',-31008);end if;
  if t.state=0 then
   cap:=case when o.status='cancelled' then coalesce(o.completed_work_amount,0) else o.total end-o.paid_amount;
   if amt>cap then return jsonb_build_object('error_code',-31001);end if;
   if exists(select 1 from public.payment_intents where order_id=o.id and state=1 and id<>t.id) then return jsonb_build_object('error_code',-31008);end if;
  end if;
  if p_operation='check' then return jsonb_build_object('allow',true);end if;
  if t.state=0 then
   perform pg_advisory_xact_lock(hashtextextended(p_provider||':'||(d->>'provider_id'),0));
   if exists(select 1 from public.payment_intents where provider=p_provider and provider_id=d->>'provider_id' and id<>t.id) then return jsonb_build_object('error_code',-31008);end if;
   update public.payment_intents set provider_id=d->>'provider_id',provider_time=coalesce((d->>'time')::bigint,ms),create_time=ms,state=1 where id=t.id returning * into t;
  end if;
 elsif p_operation='perform' then
  if t.state not in (1,2) then return jsonb_build_object('error_code',-31008);end if;
  if t.state=1 then
   if p_provider='click' and ((d->>'prepare_id')::bigint is distinct from t.click_prepare_id or (d->>'amount')::numeric is distinct from t.amount) then return jsonb_build_object('error_code',-31001);end if;
   cap:=case when o.status='cancelled' then coalesce(o.completed_work_amount,0) else o.total end-o.paid_amount;
   if t.amount>cap then return jsonb_build_object('error_code',-31001);end if;
   update public.payment_intents set state=2,perform_time=ms where id=t.id returning * into t;
   insert into public.payments(order_id,branch_id,amount,method,state,provider_id,confirmed_at,note) values(o.id,o.branch_id,t.amount,p_provider,'confirmed',t.provider_id,now(),'Подтверждено провайдером');
   update public.orders set paid_amount=paid_amount+t.amount where id=o.id;
  end if;
 elsif p_operation='cancel' then
  if t.state not in (-1,-2) then
   if t.state=2 and o.status='delivered' then return jsonb_build_object('error_code',-31007);end if;
   if t.state=2 then
    if o.paid_amount<t.amount then return jsonb_build_object('error_code',-31007);end if;
    insert into public.payments(order_id,branch_id,amount,method,state,direction,provider_id,confirmed_at,note) values(o.id,o.branch_id,t.amount,p_provider,'confirmed','refund',t.provider_id||':refund',now(),'Отмена провайдером');
    update public.orders set paid_amount=paid_amount-t.amount where id=o.id;
   end if;
   update public.payment_intents set state=case when state=2 then -2 else -1 end,cancel_time=ms,reason=(d->>'reason')::integer where id=t.id returning * into t;
  end if;
 elsif p_operation<>'status' then raise exception using errcode='23514',message='Неизвестная операция';end if;
 return jsonb_build_object('transaction',t.id::text,'create_time',t.create_time,'perform_time',t.perform_time,'cancel_time',t.cancel_time,'state',t.state,'reason',t.reason,'prepare_id',t.click_prepare_id,'amount',t.amount,'intent_id',t.id);
end $$;

create or replace function public.crm_payment_hold_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare reserved numeric;
begin
 if new.total is distinct from old.total or new.paid_amount is distinct from old.paid_amount or new.status is distinct from old.status then
  select coalesce(sum(amount),0) into reserved from public.payment_intents where order_id=new.id and state=1;
  if reserved>0 and reserved>(case when new.status='cancelled' then coalesce(new.completed_work_amount,0) else new.total end-new.paid_amount) then raise exception using errcode='55000',message='Сумма зарезервирована онлайн-платежом. Завершите или отмените его';end if;
 end if;return new;
end $$;
drop trigger if exists payment_hold_guard on public.orders;
create trigger payment_hold_guard before update on public.orders for each row execute function public.crm_payment_hold_guard();

create or replace function public.crm_intake_public(token text,hash text default null,p_ip inet default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.intake_acts;o public.orders;oid uuid;
begin
 select order_id into oid from public.intake_acts where public_token=token;
 select * into o from public.orders where id=oid for update;
 if o.id is null or o.deleted_at is not null then return null;end if;
 select * into a from public.intake_acts where public_token=token for update;
 if hash is not null then
  if a.confirmed_at is not null then return jsonb_build_object('confirmed',true);end if;
  if a.otp_hash is null or a.otp_expires<=now() or a.otp_attempts>=5 then return jsonb_build_object('confirmed',false,'code','OTP_UNAVAILABLE');end if;
  update public.intake_acts set otp_attempts=otp_attempts+1 where id=a.id;
  if hash<>a.otp_hash then
   insert into public.audit_log(role,entity,entity_id,action,"after",ip) values('client','intake_acts',a.id,'updated',jsonb_build_object('confirmation_failed',true,'attempts',a.otp_attempts+1),p_ip);
   return jsonb_build_object('confirmed',false,'code','OTP_INVALID');
  end if;
  update public.intake_acts set confirmed_at=now(),confirmation_method='sms_otp',otp_hash=null where id=a.id;
  insert into public.audit_log(role,entity,entity_id,action,"after",ip) values('client','intake_acts',a.id,'updated',jsonb_build_object('confirmed_at',now(),'confirmation_method','sms_otp'),p_ip);
  return jsonb_build_object('confirmed',true);
 end if;
 return jsonb_build_object('id',a.id,'snapshot',a.snapshot,'created_at',a.created_at,'confirmed_at',a.confirmed_at);
end $$;
create or replace function public.crm_feedback(token text,score integer,note text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare oid uuid;
begin
 select id into oid from public.orders where track_token=token and deleted_at is null and status='delivered' for update;
 if oid is null then return null;end if;
 if score not between 0 and 10 then raise exception using errcode='23514',message='Оценка от 0 до 10';end if;
 insert into public.feedback(order_id,score,comment) values(oid,score,coalesce(note,'')) on conflict(order_id) do nothing;
 return jsonb_build_object('saved',true);
end $$;

create or replace function public.crm_notifications(oid uuid,event_name text,event_id text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;c public.clients;t public.notification_templates;w public.webhook_subscriptions;body text;
begin
 select * into o from public.orders where id=oid and deleted_at is null;if not found then return;end if;
 select * into c from public.clients where id=o.client_id;
 for t in select * from public.notification_templates where branch_id=o.branch_id and code=event_name and active and locale='ru' loop
  body:=replace(replace(replace(t.body,'{code}','K-'||o.number),'{status}',o.status::text),'{token}',o.track_token);
  if (t.channel='sms' and c.sms_consent) or (t.channel='telegram' and c.telegram_consent and c.telegram_chat_id is not null) then
   insert into public.integration_outbox(branch_id,order_id,event_key,channel,destination,payload) values(o.branch_id,o.id,event_id,t.channel,case when t.channel='sms' then c.phone else c.telegram_chat_id end,jsonb_build_object('text',body,'visit_id',case when event_name='pickup_reminder' then split_part(event_id,':',2) end,'expected_status',case when event_name like 'status_%' or event_name='feedback' then o.status::text end)) on conflict do nothing;
  end if;
 end loop;
 for w in select * from public.webhook_subscriptions where branch_id=o.branch_id and active loop
  insert into public.integration_outbox(branch_id,order_id,event_key,channel,destination,payload) values(o.branch_id,o.id,event_id,'webhook',w.id::text,jsonb_build_object('event',event_name,'order_id',o.id,'code','K-'||o.number,'status',o.status,'at',clock_timestamp())) on conflict do nothing;
 end loop;
end $$;
create or replace function public.crm_status_notifications() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.crm_notifications(new.order_id,'status_'||new.status,'status:'||new.id);
 if new.status='delivered' then perform public.crm_notifications(new.order_id,'feedback','feedback:'||new.id);end if;return new;
end $$;
drop trigger if exists business_notifications on public.status_history;
create trigger business_notifications after insert on public.status_history for each row execute function public.crm_status_notifications();
insert into public.notification_templates(branch_id,code,channel,locale,body)
 select b.id,s.code,c.channel,'ru',s.body from public.branches b cross join(values
 ('status_new','Заказ {code} принят. {base_url}/track/{token}'),('status_received','Ковры заказа {code} приняты в цех. {base_url}/track/{token}'),
 ('status_ready','Заказ {code} готов к выдаче. {base_url}/track/{token}'),('status_delivering','Заказ {code} передан на доставку.'),
 ('status_cancelled','По заказу {code} зарегистрирован отказ. Для уточнения свяжитесь с оператором.'),('pickup_reminder','Напоминание о заборе заказа {code}. Ожидайте звонка водителя.'),
 ('feedback','Оцените заказ {code}: {base_url}/feedback/{token}')) s(code,body) cross join(values('sms'),('telegram')) c(channel) on conflict do nothing;

create or replace function public.crm_tick() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v record;n integer:=0;
begin
 perform set_config('app.actor_id','',true);perform set_config('app.actor_role','system',true);perform set_config('app.actor_ip','',true);
 for v in select v1.id,v1.order_id from public.visits v1 join public.orders o on o.id=v1.order_id where v1.kind='pickup' and v1.state='planned' and v1.scheduled_date=(now() at time zone 'Asia/Tashkent')::date+1 and o.status in ('new','pickup_assigned') and o.deleted_at is null and not exists(select 1 from public.system_jobs j where j.key='pickup:'||v1.id) order by v1.id limit 1000 loop
  perform public.crm_notifications(v.order_id,'pickup_reminder','pickup:'||v.id);insert into public.system_jobs(key) values('pickup:'||v.id) on conflict do nothing;
 end loop;
 insert into public.tasks(branch_id,title,due_at,assigned_to,order_id,note,escalation_key)
 select o.branch_id,'Просрочен SLA: K-'||o.number,now(),p.id,o.id,'Проверьте срок и причину задержки','sla:'||o.id||':'||p.id
 from public.orders o join public.profiles p on p.active and p.role::text in ('manager','admin') and (p.branch_id is null or p.branch_id=o.branch_id)
 where o.deleted_at is null and o.status not in ('delivered','cancelled') and o.promised_at<now() and not exists(select 1 from public.tasks t where t.escalation_key='sla:'||o.id||':'||p.id) limit 1000 on conflict(escalation_key) where escalation_key is not null do nothing;
 get diagnostics n=row_count;
 insert into public.tasks(branch_id,title,due_at,assigned_to,order_id,note,escalation_key)
 select c.branch_id,'Просрочена претензия',now(),p.id,c.order_id,c.reason,'complaint:'||c.id||':'||p.id from public.complaints c
 join public.orders o on o.id=c.order_id join public.profiles p on p.active and p.role::text in ('manager','admin') and (p.branch_id is null or p.branch_id=c.branch_id)
 where c.state<>'resolved' and c.due_at<now() and o.deleted_at is null and not exists(select 1 from public.tasks t where t.escalation_key='complaint:'||c.id||':'||p.id) limit 1000 on conflict(escalation_key) where escalation_key is not null do nothing;
 update public.payment_intents set state=-1,cancel_time=floor(extract(epoch from now())*1000),reason=4 where state=1 and expires_at<=now();
 update public.tasks t set status='done',completed_at=now() where t.status='open' and ((t.escalation_key like 'sla:%' and exists(select 1 from public.orders o where o.id=t.order_id and (o.deleted_at is not null or o.status in ('delivered','cancelled')))) or (t.escalation_key like 'complaint:%' and exists(select 1 from public.complaints c join public.orders o on o.id=c.order_id where c.id::text=split_part(t.escalation_key,':',2) and (c.state='resolved' or o.deleted_at is not null))));
 return jsonb_build_object('escalations',n);
end $$;
create or replace function public.crm_outbox_claim(channels jsonb,maximum integer default 20) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 with claimed as(select id from public.integration_outbox where channel in(select jsonb_array_elements_text(channels)) and due_at<=now() and (state='pending' or (state='processing' and lease_until<now())) order by due_at,id for update skip locked limit least(greatest(maximum,1),50)),
 changed as(update public.integration_outbox set state='processing',lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=attempts+1 where id in(select id from claimed) returning *)
 select coalesce(jsonb_agg(to_jsonb(changed)),'[]') into result from changed;return result;
end $$;
create or replace function public.crm_outbox_finish(oid uuid,lease uuid,success boolean,provider text default null,error_code text default null) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update public.integration_outbox set state=case when success and provider like 'skip:%' then 'skipped' when success then 'sent' when attempts>=8 then 'dead' else 'pending' end,
 sent_at=case when success then now() end,provider_id=case when success then provider end,last_error=case when success then null else left(error_code,120) end,
 due_at=now()+least(3600,power(2,attempts)::integer*15)*interval '1 second',lease_until=null,lease_token=null
 where id=oid and state='processing' and lease_token=lease;return found;
end $$;

create or replace function public.crm_telephony(d jsonb,u uuid,ip inet) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;previous public.calls;cid uuid;result jsonb;
begin
 perform public.lifecycle_actor(u,ip);actor:=public.crm_require(u,'calls');bid:=coalesce((d->>'branch_id')::uuid,actor.branch_id);perform public.crm_require(u,'calls',bid);
 if bid is null or not exists(select 1 from public.branches where id=bid and active) then raise exception using errcode='23514',message='Укажите активный филиал';end if;
 perform pg_advisory_xact_lock(hashtextextended('call:'||(d->>'external_id'),0));
 select * into previous from public.calls where external_id=d->>'external_id' for update;
 if previous.id is not null and (previous.branch_id<>bid or previous.phone<>d->>'phone') then raise exception using errcode='55000',message='Идентификатор звонка уже занят';end if;
 select id into cid from public.clients where phone_key=right(regexp_replace(d->>'phone','\D','','g'),9);
 if d->>'order_id' is not null then perform public.crm_order((d->>'order_id')::uuid,u);end if;
 if previous.id is not null and previous.outcome<>'ringing' and d->>'outcome'='ringing' then return to_jsonb(previous);end if;
 insert into public.calls(branch_id,external_id,phone,direction,outcome,source,recording_url,client_id,order_id,operator_id,ended_at)
 values(bid,d->>'external_id',d->>'phone',d->>'direction',d->>'outcome','call_in',d->>'recording_url',cid,(d->>'order_id')::uuid,u,case when d->>'outcome'<>'ringing' then now() end)
 on conflict(external_id) do update set outcome=excluded.outcome,recording_url=coalesce(excluded.recording_url,calls.recording_url),order_id=coalesce(excluded.order_id,calls.order_id),ended_at=coalesce(calls.ended_at,excluded.ended_at) returning to_jsonb(calls.*) into result;
 return result;
end $$;

create or replace function public.crm_import(kind text,rows_data jsonb,u uuid,ip inet,key uuid,dry_run boolean default true) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d jsonb;actor public.profiles;ids jsonb:='[]';rid uuid;previous public.command_receipts;payload jsonb:=jsonb_build_object('kind',kind,'rows',rows_data);
begin
 perform public.lifecycle_actor(u,ip);actor:=public.crm_require(u,'integrations');
 if kind not in ('clients','orders') or jsonb_array_length(rows_data) not between 1 and 100 then raise exception using errcode='23514',message='Допустимо от 1 до 100 строк';end if;
 if dry_run then return jsonb_build_object('valid',true,'rows',jsonb_array_length(rows_data));end if;
 if key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||key::text,0));select * into previous from public.command_receipts where user_id=u and command_receipts.key=crm_import.key;
 if found then if previous.command<>'import' or previous.payload is distinct from payload then raise exception using errcode='55000',message='Ключ использован для другого импорта';end if;return previous.result;end if;
 for d in select * from jsonb_array_elements(rows_data) loop
  if kind='clients' then
   if d->>'phone' !~ '^\+998[0-9]{9}$' then raise exception using errcode='23514',message='Неверный телефон';end if;
   insert into public.clients(name,phone,address) values(d->>'name',d->>'phone',d->>'address') on conflict(phone_key) do update set name=excluded.name,address=excluded.address returning id into rid;
   insert into public.client_addresses(client_id,address,created_by) values(rid,d->>'address',u) on conflict do nothing;
  else rid:=public.create_order(d,u);end if;
  ids:=ids||jsonb_build_array(rid);
 end loop;
 payload:=jsonb_build_object('kind',kind,'rows',rows_data);ids:=jsonb_build_object('ids',ids,'imported',jsonb_array_length(ids));
 insert into public.command_receipts(user_id,key,command,payload,result) values(u,key,'import',payload,ids);return ids;
end $$;

create or replace function public.crm_export_clients(f jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;result jsonb;
begin
 actor:=public.crm_require(u,'exports');
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into result from(select c.id,c.name,c.phone,c.address,c.tags,c.blacklisted from public.clients c
 where (f->>'cursor_id' is null or c.id>(f->>'cursor_id')::uuid) and exists(select 1 from public.orders o where o.client_id=c.id and o.deleted_at is null and (f->>'branch_id' is null or o.branch_id=(f->>'branch_id')::uuid)) order by c.id limit 1001)x;
 return result;
end $$;

create or replace function public.crm_intake_challenge(act_id uuid,u uuid,ip inet,request_key uuid,hash text,ciphertext text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.intake_acts;previous public.command_receipts;result jsonb;payload jsonb:=jsonb_build_object('act_id',act_id);
begin
 perform public.lifecycle_actor(u,ip);select * into a from public.intake_acts where id=act_id;perform public.crm_order(a.order_id,u,'photos');
 if request_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text||request_key::text,0));select * into previous from public.command_receipts where user_id=u and key=request_key;
 if found then if previous.command<>'intake.challenge' or previous.payload is distinct from payload then raise exception using errcode='55000',message='Ключ использован для другого действия';end if;return previous.result;end if;
 result:=public.crm_extension('intake.challenge',jsonb_build_object('act_id',act_id,'otp_hash',hash,'encrypted',ciphertext),u,ip);
 insert into public.command_receipts(user_id,key,command,payload,result) values(u,request_key,'intake.challenge',payload,result);
 insert into public.audit_log(user_id,role,entity,entity_id,action,"after",ip) values(u,(select role::text from public.profiles where id=u),'intake_acts',act_id,'updated',jsonb_build_object('otp_requested',true),ip);
 return result;
end $$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$select jsonb_build_object('ok',to_regprocedure('public.crm_provider(text,text,jsonb)') is not null and to_regclass('public.integration_outbox') is not null,'schema',7)$$;

do $$ declare t text;f record;begin
 foreach t in array array['discount_rules','order_discounts','cash_closings','payment_intents','intake_acts','rewash_jobs','compensations','materials','stock_movements','piece_rates','pay_accruals','slot_limits','webhook_subscriptions','integration_outbox','system_jobs'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert,update on public.%I to service_role',t);execute format('revoke delete,truncate on public.%I from service_role',t);
  if t not in ('intake_acts','integration_outbox','system_jobs') then execute format('drop trigger if exists business_audit on public.%I',t);execute format('create trigger business_audit after insert or update on public.%I for each row execute function public.crm_audit_change()',t);end if;
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'crm_%' or p.proname='create_order') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant usage,select on sequence public.payment_intents_click_prepare_id_seq to service_role;
commit;
