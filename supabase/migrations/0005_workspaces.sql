begin;
create table if not exists public.branches (
 id uuid primary key default gen_random_uuid(),code text not null unique,name text not null,
 address text not null default '',phone text,active boolean not null default true,
 workshop_capacity_m2 numeric not null default 500 check(workshop_capacity_m2>0),
 sla_hours integer not null default 72 check(sla_hours>0),created_at timestamptz not null default now()
);
insert into public.branches(id,code,name) values('01000000-0000-4000-8000-000000000001','tashkent','Ташкент — основной') on conflict(code) do nothing;
alter table public.profiles add column if not exists branch_id uuid references public.branches(id);
update public.profiles set branch_id=(select id from public.branches where code='tashkent') where branch_id is null and role::text not in ('admin','manager');
-- DEFAULT заполняет старые строки без UPDATE, включая неизменяемые строки корзины.
alter table public.orders add column if not exists branch_id uuid not null default '01000000-0000-4000-8000-000000000001' references public.branches(id),
 add column if not exists zone_code text,add column if not exists latitude numeric check(latitude between -90 and 90),
 add column if not exists longitude numeric check(longitude between -180 and 180),
 add column if not exists production_stage text,
 add column if not exists promised_at timestamptz,add column if not exists pricing_snapshot jsonb;
create index if not exists orders_branch_list_idx on public.orders(branch_id,created_at desc,id desc) where deleted_at is null;
create index if not exists orders_workshop_idx on public.orders(branch_id,status,urgent desc,created_at,id) where deleted_at is null;

create table if not exists public.role_permissions(role text primary key,permissions jsonb not null check(jsonb_typeof(permissions)='array'));
-- GENERATED_PERMISSIONS_START
insert into public.role_permissions(role,permissions) values
('admin','["read", "create", "quote", "assign", "status", "cancel", "delete", "restore", "trash", "audit", "photos", "tariffs", "clients", "leads", "calls", "tasks", "dispatch", "payments", "workshop", "staff", "catalogs", "reports", "exports", "integrations", "inventory", "payroll", "complaints", "discounts", "branches"]'::jsonb),
('manager','["read", "quote", "cancel", "delete", "restore", "trash", "audit", "reports", "exports", "payroll"]'::jsonb),
('operator','["read", "create", "quote", "assign", "status", "cancel", "requestDeletion", "photos", "clients", "leads", "calls", "tasks", "complaints"]'::jsonb),
('dispatcher','["read", "assign", "status", "dispatch", "tasks", "calls", "photos", "payments"]'::jsonb),
('driver','["read", "status", "photos", "tasks", "payments"]'::jsonb),
('workshop','["read", "status", "photos", "workshop", "inventory"]'::jsonb)
on conflict(role) do update set permissions=excluded.permissions;
-- GENERATED_PERMISSIONS_END

create table if not exists public.catalog_entries (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('source','zone','slot','defect','failure','tag')),
 code text not null,name_ru text not null,name_uz text,branch_id uuid not null references public.branches(id),
 active boolean not null default true,position integer not null default 0,config jsonb not null default '{}',
 unique(kind,code,branch_id)
);
insert into public.catalog_entries(kind,code,name_ru,branch_id,position,config) values
 ('source','call_in','Входящий звонок','01000000-0000-4000-8000-000000000001',1,'{}'),
 ('source','call_out','Исходящий звонок','01000000-0000-4000-8000-000000000001',2,'{}'),
 ('source','instagram','Instagram','01000000-0000-4000-8000-000000000001',3,'{}'),
 ('source','telegram','Telegram','01000000-0000-4000-8000-000000000001',4,'{}'),
 ('zone','centre','Центр','01000000-0000-4000-8000-000000000001',1,'{}'),
 ('slot','morning','09:00–13:00','01000000-0000-4000-8000-000000000001',1,'{"start":"09:00","end":"13:00","capacity":20}'),
 ('slot','afternoon','13:00–18:00','01000000-0000-4000-8000-000000000001',2,'{"start":"13:00","end":"18:00","capacity":20}'),
 ('defect','stain','Пятно','01000000-0000-4000-8000-000000000001',1,'{}'),
 ('defect','tear','Повреждение','01000000-0000-4000-8000-000000000001',2,'{}'),
 ('failure','unreachable','Не дозвонились','01000000-0000-4000-8000-000000000001',1,'{}'),
 ('failure','absent','Клиента нет дома','01000000-0000-4000-8000-000000000001',2,'{}'),
 ('failure','rescheduled','Перенос по просьбе клиента','01000000-0000-4000-8000-000000000001',3,'{}')
on conflict(kind,code,branch_id) do nothing;

create table if not exists public.client_addresses (
 id uuid primary key default gen_random_uuid(),client_id uuid not null references public.clients(id),
 label text not null default '',address text not null,zone_code text,latitude numeric,longitude numeric,
 created_by uuid,created_at timestamptz not null default now(),unique(client_id,address)
);
insert into public.client_addresses(client_id,address) select id,address from public.clients where length(btrim(address))>0 on conflict do nothing;
create table if not exists public.leads (
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),
 client_id uuid references public.clients(id),phone text not null,name text not null default '',source text not null default 'call_in',
 outcome text not null check(outcome in ('new','callback','no_result','converted','refused')),reason_code text references public.cancel_reasons(code),
 comment text not null default '',callback_at timestamptz,order_id uuid references public.orders(id),
 created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists leads_branch_idx on public.leads(branch_id,created_at desc,id desc);
create table if not exists public.calls (
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),external_id text unique,
 phone text not null,direction text not null check(direction in ('in','out')),outcome text not null check(outcome in ('ringing','answered','missed','no_result')),
 source text not null default 'call_in',recording_url text,client_id uuid references public.clients(id),order_id uuid references public.orders(id),
 operator_id uuid,started_at timestamptz not null default now(),ended_at timestamptz,created_at timestamptz not null default now()
);
create index if not exists calls_branch_idx on public.calls(branch_id,started_at desc,id desc);
create table if not exists public.tasks (
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),title text not null,
 due_at timestamptz not null,assigned_to uuid not null references public.profiles(id),order_id uuid references public.orders(id),
 client_id uuid references public.clients(id),status text not null default 'open' check(status in ('open','done')),
 note text not null default '',created_by uuid,created_at timestamptz not null default now(),completed_at timestamptz
);
create index if not exists tasks_open_idx on public.tasks(assigned_to,due_at,id) where status='open';
create table if not exists public.visits (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),branch_id uuid not null references public.branches(id),
 kind text not null check(kind in ('pickup','delivery')),scheduled_date date not null,slot_code text not null,zone_code text,
 driver_id uuid references public.profiles(id),position integer not null default 0,
 state text not null default 'planned' check(state in ('planned','en_route','completed','failed','rescheduled')),
 failure_reason text,note text not null default '',departed_at timestamptz,completed_at timestamptz,
 created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists visits_one_active_idx on public.visits(order_id,kind) where state in ('planned','en_route');
create index if not exists visits_driver_day_idx on public.visits(driver_id,scheduled_date,position,id);
create index if not exists visits_schedule_idx on public.visits(branch_id,scheduled_date,slot_code,zone_code,id);
create table if not exists public.visit_events (
 id uuid primary key default gen_random_uuid(),visit_id uuid not null references public.visits(id),event text not null,
 actor_id uuid,at timestamptz not null default clock_timestamp(),note text,latitude numeric,longitude numeric
);
create index if not exists visit_events_visit_idx on public.visit_events(visit_id,at,id);
create table if not exists public.production_events (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),stage text not null,
 actor_id uuid,at timestamptz not null default clock_timestamp(),note text
);
create index if not exists production_events_order_idx on public.production_events(order_id,at,id);
create table if not exists public.order_defects (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),item_id uuid references public.order_items(id),
 defect_code text not null,note text not null,photo_id uuid references public.order_photos(id),created_by uuid,created_at timestamptz not null default now()
);
create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),branch_id uuid not null references public.branches(id),
 amount numeric(12,0) not null check(amount>0),method text not null check(method in ('cash','terminal','bank','payme','click','legacy')),
 direction text not null default 'payment' check(direction in ('payment','refund')),
 state text not null default 'confirmed' check(state in ('pending','confirmed','rejected')),
 received_by uuid,note text not null default '',provider_id text,created_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz,confirmed_by uuid,unique(method,provider_id)
);
create index if not exists payments_order_idx on public.payments(order_id,created_at,id);
create index if not exists payments_cash_idx on public.payments(received_by,created_at) where method='cash' and state='confirmed';
insert into public.payments(order_id,branch_id,amount,method,note,created_at,confirmed_at)
 select o.id,o.branch_id,o.paid_amount,'legacy','Перенос суммы из этапа 1',coalesce(o.payment_recorded_at,o.created_at),coalesce(o.payment_recorded_at,o.created_at)
 from public.orders o where o.paid_amount>0 and not exists(select 1 from public.payments p where p.order_id=o.id);
create table if not exists public.tariff_versions (
 id uuid primary key default gen_random_uuid(),code text not null references public.tariffs(code),branch_id uuid references public.branches(id),
 name text not null,price_per_m2 numeric(12,0) not null check(price_per_m2>=0),active boolean not null,
 effective_at timestamptz not null,created_by uuid,created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists tariff_versions_unique_idx on public.tariff_versions(code,coalesce(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_at);
create index if not exists tariff_versions_price_idx on public.tariff_versions(code,branch_id,effective_at desc);
insert into public.tariff_versions(code,name,price_per_m2,active,effective_at)
 select code,name,price_per_m2,active,'1970-01-01' from public.tariffs t where not exists(select 1 from public.tariff_versions v where v.code=t.code);
create table if not exists public.setting_versions (
 id uuid primary key default gen_random_uuid(),key text not null references public.settings(key),value numeric not null,
 branch_id uuid references public.branches(id),effective_at timestamptz not null,created_by uuid,created_at timestamptz not null default now()
);
create index if not exists setting_versions_lookup_idx on public.setting_versions(key,branch_id,effective_at desc);
insert into public.setting_versions(key,value,effective_at) select key,value,'1970-01-01' from public.settings s where not exists(select 1 from public.setting_versions v where v.key=s.key);
create table if not exists public.notification_templates (
 id uuid primary key default gen_random_uuid(),branch_id uuid not null references public.branches(id),code text not null,
 channel text not null check(channel in ('sms','telegram')),locale text not null default 'ru' check(locale in ('ru','uz')),
 body text not null,active boolean not null default true,unique(branch_id,code,channel,locale)
);
create table if not exists public.command_receipts (
 user_id uuid not null,key uuid not null,command text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(user_id,key)
);

create or replace function public.crm_require(p_user uuid,p_permission text,p_branch uuid default null) returns public.profiles
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;
begin
 select * into actor from public.profiles where id=p_user and active;
 if not found or not exists(select 1 from public.role_permissions rp where rp.role=actor.role::text and rp.permissions ? p_permission) then
  raise exception using errcode='42501',message='Недостаточно прав'; end if;
 if p_branch is not null and actor.role::text not in ('admin','manager') and actor.branch_id is distinct from p_branch then
  raise exception using errcode='42501',message='Нет доступа к этому филиалу'; end if;
 return actor;
end $$;
create or replace function public.crm_order(p_order uuid,p_user uuid,p_permission text default 'read') returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders; actor public.profiles;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.deleted_at is not null then raise exception using errcode='P0002',message='Заказ не найден'; end if;
 actor:=public.crm_require(p_user,p_permission,o.branch_id);
 if actor.role::text='driver' and o.driver_id is distinct from p_user and not exists(select 1 from public.visits v where v.order_id=o.id and v.driver_id=p_user and v.state in ('planned','en_route')) then
  raise exception using errcode='42501',message='Это не ваше задание'; end if;
 if actor.role::text='workshop' and o.status not in ('received','washing','drying','ready') then
  raise exception using errcode='42501',message='Заказ не находится в цехе'; end if;
 return o;
end $$;
create or replace function public.crm_audit_change() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare obj jsonb:=to_jsonb(new);before_obj jsonb;eid uuid;
begin
 if tg_op='UPDATE' then before_obj:=to_jsonb(old); end if;
 if before_obj is not distinct from obj then return new; end if;
 eid:=coalesce((obj->>'id')::uuid,md5(tg_table_name||':'||coalesce(obj->>'code',obj->>'key',''))::uuid);
 insert into public.audit_log(user_id,role,entity,entity_id,action,"before","after",ip)
 values(nullif(current_setting('app.actor_id',true),'')::uuid,coalesce(nullif(current_setting('app.actor_role',true),''),'system'),
 tg_table_name,eid,case when tg_op='INSERT' then 'created' else 'updated' end,before_obj,obj,nullif(current_setting('app.actor_ip',true),'')::inet);
 return new;
end $$;

create or replace function public.crm_rate(p_code text,p_branch uuid,p_at timestamptz default now()) returns numeric
language sql stable security invoker set search_path=public,pg_temp as $$
 select case when active then price_per_m2 end from public.tariff_versions where code=p_code and (branch_id=p_branch or branch_id is null)
 and effective_at<=p_at order by (branch_id is not null) desc,effective_at desc,created_at desc limit 1
$$;
create or replace function public.crm_setting(p_key text,p_branch uuid,p_at timestamptz default now()) returns numeric
language sql stable security invoker set search_path=public,pg_temp as $$
 select value from public.setting_versions where key=p_key and (branch_id=p_branch or branch_id is null) and effective_at<=p_at
 order by (branch_id is not null) desc,effective_at desc,created_at desc limit 1
$$;
create or replace function public.quote_order(p jsonb) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare it jsonb;rate numeric;area numeric:=0;sub numeric:=0;mult numeric;tot numeric;fee numeric:=0;
 bid uuid:=coalesce((p->>'branch_id')::uuid,'01000000-0000-4000-8000-000000000001');rates jsonb:='[]';
begin
 for it in select * from jsonb_array_elements(p->'items') loop
  rate:=public.crm_rate(it->>'tariff',bid);if rate is null then raise exception using errcode='23514',message='Тариф недоступен для филиала'; end if;
  area:=area+(it->>'length_m')::numeric*(it->>'width_m')::numeric;
  sub:=sub+round((it->>'length_m')::numeric*(it->>'width_m')::numeric*rate);
  rates:=rates||jsonb_build_array(jsonb_build_object('code',it->>'tariff','rate',rate));
 end loop;
 mult:=1+case when coalesce((p->>'urgent')::boolean,false) then public.crm_setting('urgent_pct',bid) else 0 end
  +case when coalesce((p->>'stains')::boolean,false) then public.crm_setting('stains_pct',bid) else 0 end
  +case when coalesce((p->>'pensioner')::boolean,false) then public.crm_setting('pensioner_pct',bid) else 0 end;
 tot:=round(sub*mult,-3);
 if sub>0 and sub<public.crm_setting('free_delivery_from',bid) then fee:=public.crm_setting('delivery_fee',bid);end if;
 return jsonb_build_object('area_m2',round(area,2),'subtotal',sub,'adjustment',tot-sub,'delivery_fee',fee,'total',tot+fee);
end $$;
create or replace function public.crm_quote(p jsonb,p_user uuid,p_ip inet default null) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;
begin
 perform public.lifecycle_actor(p_user,p_ip);actor:=public.crm_require(p_user,'quote');
 bid:=coalesce((p->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');
 perform public.crm_require(p_user,'quote',bid);return public.quote_order(p||jsonb_build_object('branch_id',bid));
end $$;

create or replace function public.create_order(p jsonb,p_user uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare cid uuid;oid uuid;q jsonb;it jsonb;i integer:=0;l numeric;w numeric;bid uuid;actor public.profiles;
begin
 actor:=public.crm_require(p_user,'create');bid:=coalesce((p->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');
 perform public.crm_require(p_user,'create',bid);q:=public.quote_order(p||jsonb_build_object('branch_id',bid));
 if not exists(select 1 from public.branches where id=bid and active) then raise exception using errcode='23514',message='Филиал недоступен';end if;
 if not exists(select 1 from public.catalog_entries c where c.branch_id=bid and c.kind='source' and c.code=coalesce(p->>'source','call_in') and c.active) then raise exception using errcode='23514',message='Источник обращения недоступен';end if;
 if p->>'zone_code' is not null and not exists(select 1 from public.catalog_entries c where c.branch_id=bid and c.kind='zone' and c.code=p->>'zone_code' and c.active) then raise exception using errcode='23514',message='Район недоступен';end if;
 insert into public.clients(name,phone,address) values(coalesce(p->>'name',''),p->>'phone',p->>'address')
 on conflict(phone_key) do update set name=coalesce(nullif(excluded.name,''),clients.name),address=coalesce(nullif(excluded.address,''),clients.address) returning id into cid;
 insert into public.orders(client_id,address,pickup_date,pickup_slot,source,comment,urgent,stains,pensioner,subtotal,adjustment,delivery_fee,total,created_by,branch_id,zone_code,latitude,longitude,promised_at,pricing_snapshot)
 values(cid,p->>'address',(p->>'pickup_date')::date,p->>'pickup_slot',coalesce(p->>'source','call_in'),p->>'comment',
 coalesce((p->>'urgent')::boolean,false),coalesce((p->>'stains')::boolean,false),coalesce((p->>'pensioner')::boolean,false),
 (q->>'subtotal')::numeric,(q->>'adjustment')::numeric,(q->>'delivery_fee')::numeric,(q->>'total')::numeric,p_user,bid,p->>'zone_code',
 (p->>'latitude')::numeric,(p->>'longitude')::numeric,coalesce((p->>'promised_at')::timestamptz,clock_timestamp()+(select sla_hours*interval '1 hour' from public.branches where id=bid)),q) returning id into oid;
 for it in select * from jsonb_array_elements(p->'items') loop
  i:=i+1;l:=(it->>'length_m')::numeric;w:=(it->>'width_m')::numeric;
  insert into public.order_items(order_id,seq,length_m,width_m,tariff_code,note,price) values(oid,i,l,w,it->>'tariff',it->>'note',round(l*w*public.crm_rate(it->>'tariff',bid)));
 end loop;
 insert into public.status_history(order_id,status,changed_by) values(oid,'new',p_user);
 insert into public.client_addresses(client_id,address,zone_code,latitude,longitude,created_by)
 values(cid,p->>'address',p->>'zone_code',(p->>'latitude')::numeric,(p->>'longitude')::numeric,p_user) on conflict(client_id,address) do nothing;
 return oid;
end $$;

create or replace function public.assign_order_driver(p_order uuid,p_user uuid,p_driver uuid default null,p_ip inet default null) returns public.orders
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;changed_visit uuid;
begin
 perform public.lifecycle_actor(p_user,p_ip);o:=public.crm_order(p_order,p_user,'assign');
 if o.status in ('cancelled','delivered') then raise exception using errcode='55000',message='Заказ уже закрыт'; end if;
 if p_driver is not null and not exists(select 1 from public.profiles where id=p_driver and active and role='driver' and branch_id=o.branch_id) then
  raise exception using errcode='23514',message='Водитель не найден в филиале'; end if;
 if exists(select 1 from public.visits where order_id=o.id and state='en_route' and driver_id is distinct from p_driver) then raise exception using errcode='55000',message='Водитель уже в пути. Сначала завершите или перенесите задание';end if;
 update public.orders set driver_id=p_driver where id=p_order returning * into o;
 for changed_visit in update public.visits set driver_id=p_driver,updated_at=clock_timestamp() where order_id=o.id and state='planned' and driver_id is distinct from p_driver returning id loop
  insert into public.visit_events(visit_id,event,actor_id,note) values(changed_visit,'assigned',p_user,'Изменён водитель');
 end loop;return o;
end $$;

create or replace function public.change_order_status(p_order uuid,p_status public.order_status,p_user uuid,p_note text default null)
returns public.order_status language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;actor public.profiles;a integer;b integer;flow public.order_status[]:=enum_range('new'::public.order_status,'delivered'::public.order_status);
begin
 perform public.lifecycle_actor(p_user,nullif(current_setting('app.actor_ip',true),'')::inet);o:=public.crm_order(p_order,p_user,'status');
 select * into actor from public.profiles where id=p_user;
 if p_status='cancelled' then raise exception using errcode='23514',message='Для отказа укажите причину через отмену заказа';end if;
 if actor.role::text not in ('admin','operator') and not(actor.role::text='dispatcher' and p_status in ('pickup_assigned','delivering'))
 and not(actor.role::text='driver' and p_status in ('received','delivering','delivered'))
 and not(actor.role::text='workshop' and p_status in ('washing','drying','ready')) then raise exception using errcode='42501',message='Эта смена статуса запрещена для вашей роли';end if;
 if o.status=p_status then return o.status;end if;
 if o.status in ('delivered','cancelled') then raise exception using errcode='55000',message='Заказ уже закрыт';end if;
 a:=array_position(flow,o.status);b:=array_position(flow,p_status);
 if a is null or b is null or abs(a-b)<>1 then raise exception using errcode='23514',message='Недопустимый переход статуса';end if;
 if p_status='pickup_assigned' and o.driver_id is null then raise exception using errcode='23514',message='Сначала назначьте водителя';end if;
 if actor.role::text='workshop' and p_status='ready' and o.production_stage is distinct from 'packing' then raise exception using errcode='23514',message='Сначала выполните контроль и упаковку';end if;
 update public.orders set status=p_status,production_stage=case when p_status in ('received','washing','drying','ready') then p_status::text else production_stage end where id=p_order;
 insert into public.status_history(order_id,status,changed_by,note) values(p_order,p_status,p_user,p_note);return p_status;
end $$;

create or replace function public.crm_extension(p_command text,p_data jsonb,p_user uuid,p_ip inet) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception using errcode='23514',message='Неизвестное действие';end $$;

-- COMMANDS_START
create or replace function public.crm_schedule_visit(d jsonb,u uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;v public.visits;previous public.visits;slot public.catalog_entries;driver uuid:=(d->>'driver_id')::uuid;
 day date:=(d->>'scheduled_date')::date;visit_kind text:=d->>'kind';capacity integer;used integer;
begin
 o:=public.crm_order((d->>'order_id')::uuid,u,'dispatch');
 if visit_kind not in ('pickup','delivery') or day is null then raise exception using errcode='23514',message='Укажите тип и дату задания';end if;
 if o.status in ('cancelled','delivered') or (visit_kind='delivery' and o.status not in ('ready','delivering')) or (visit_kind='pickup' and o.status not in ('new','pickup_assigned')) then
  raise exception using errcode='55000',message='Этап заказа не позволяет назначить это задание';end if;
 if driver is not null and not exists(select 1 from public.profiles where id=driver and active and role='driver' and branch_id=o.branch_id) then
  raise exception using errcode='23514',message='Водитель не найден в филиале';end if;
 select * into slot from public.catalog_entries where branch_id=o.branch_id and kind='slot' and code=d->>'slot_code' and active;
 if not found then raise exception using errcode='23514',message='Временное окно недоступно';end if;
 if d->>'zone_code' is not null and not exists(select 1 from public.catalog_entries c where c.kind='zone' and c.code=d->>'zone_code' and c.branch_id=o.branch_id and c.active) then
  raise exception using errcode='23514',message='Район недоступен';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.branch_id::text||day::text||slot.code,0));
 capacity:=coalesce((slot.config->>'capacity')::integer,20);
 select count(*) into used from public.visits scheduled join public.orders x on x.id=scheduled.order_id where scheduled.branch_id=o.branch_id
  and scheduled.scheduled_date=day and scheduled.slot_code=slot.code and scheduled.state in ('planned','en_route') and scheduled.order_id<>o.id and x.deleted_at is null and x.status not in ('cancelled','delivered');
 if used>=capacity then raise exception using errcode='55000',message='Во временном окне нет свободных мест';end if;
 select * into previous from public.visits where order_id=o.id and visits.kind=visit_kind and state in ('planned','en_route') for update;
 if found then
  if length(btrim(coalesce(d->>'note','')))=0 then raise exception using errcode='23514',message='Укажите причину переноса';end if;
  update public.visits set state='rescheduled',updated_at=clock_timestamp() where id=previous.id;
  insert into public.visit_events(visit_id,event,actor_id,note) values(previous.id,'rescheduled',u,d->>'note');
 end if;
 insert into public.visits(order_id,branch_id,kind,scheduled_date,slot_code,zone_code,driver_id,note,created_by,position)
 values(o.id,o.branch_id,visit_kind,day,slot.code,coalesce(d->>'zone_code',o.zone_code),driver,coalesce(d->>'note',''),u,coalesce((d->>'position')::integer,0)) returning * into v;
 if driver is not null then perform public.assign_order_driver(o.id,u,driver,nullif(current_setting('app.actor_ip',true),'')::inet);end if;
 if visit_kind='pickup' then
  update public.orders set pickup_date=day,pickup_slot=slot.name_ru,zone_code=v.zone_code where id=o.id;
  if driver is not null and o.status='new' then perform public.change_order_status(o.id,'pickup_assigned',u,'Назначен забор');end if;
 end if;
 insert into public.visit_events(visit_id,event,actor_id,note) values(v.id,'planned',u,v.note);
 return to_jsonb(v);
end $$;

create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb
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
  insert into public.client_addresses(client_id,label,address,zone_code,latitude,longitude,created_by)
  values((p_data->>'client_id')::uuid,coalesce(p_data->>'label',''),p_data->>'address',p_data->>'zone_code',(p_data->>'latitude')::numeric,(p_data->>'longitude')::numeric,p_user)
  on conflict(client_id,address) do update set label=excluded.label,zone_code=excluded.zone_code,latitude=excluded.latitude,longitude=excluded.longitude
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
  if rid<>p_user and actor.role::text not in ('admin','dispatcher') then raise exception using errcode='42501',message='Можно создавать напоминания только себе';end if;
  if not exists(select 1 from public.profiles where id=rid and active and (branch_id=bid or role::text in ('admin','manager'))) then raise exception using errcode='23514',message='Исполнитель не найден';end if;
  if p_data->>'order_id' is not null then o:=public.crm_order((p_data->>'order_id')::uuid,p_user);bid:=o.branch_id;end if;
  insert into public.tasks(branch_id,title,due_at,assigned_to,order_id,client_id,note,created_by)
  values(bid,p_data->>'title',(p_data->>'due_at')::timestamptz,rid,(p_data->>'order_id')::uuid,(p_data->>'client_id')::uuid,coalesce(p_data->>'note',''),p_user)
  returning to_jsonb(tasks.*) into result;
 when 'task.complete' then
  select branch_id,assigned_to into bid,rid from public.tasks where id=(p_data->>'task_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Напоминание не найдено';end if;
  perform public.crm_require(p_user,'tasks',bid);
  if rid<>p_user and actor.role::text not in ('admin','dispatcher') then raise exception using errcode='42501',message='Это не ваше напоминание';end if;
  update public.tasks set status='done',completed_at=clock_timestamp() where id=(p_data->>'task_id')::uuid returning to_jsonb(tasks.*) into result;
 when 'visit.schedule' then result:=public.crm_schedule_visit(p_data,p_user);
 when 'visit.event' then
  select * into v from public.visits where id=(p_data->>'visit_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Задание не найдено';end if;
  o:=public.crm_order(v.order_id,p_user,'status');
  if actor.role::text not in ('admin','dispatcher','driver') or (actor.role::text='driver' and v.driver_id is distinct from p_user) then raise exception using errcode='42501',message='Это не ваше задание';end if;
  if v.state is distinct from p_data->>'expected_state' then raise exception using errcode='55000',message='Задание изменилось. Обновите данные и проверьте действие';end if;
  if o.status in ('cancelled','delivered') then raise exception using errcode='55000',message='Заказ уже закрыт';end if;
  if p_data->>'event'='departed' then
   if v.state<>'planned' then raise exception using errcode='55000',message='Выезд уже отмечен или задание закрыто';end if;
   if v.kind='delivery' and o.status='ready' then perform public.change_order_status(o.id,'delivering',p_user,'Водитель выехал');end if;
   update public.visits set state='en_route',departed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id returning to_jsonb(visits.*) into result;
  elsif p_data->>'event'='completed' then
   if v.state<>'en_route' then raise exception using errcode='55000',message='Сначала отметьте выезд';end if;
   perform public.change_order_status(o.id,case when v.kind='pickup' then 'received'::public.order_status else 'delivered'::public.order_status end,p_user,coalesce(p_data->>'note','Задание выполнено'));
   update public.visits set state='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id returning to_jsonb(visits.*) into result;
  elsif p_data->>'event'='failed' then
   if v.state not in ('planned','en_route') then raise exception using errcode='55000',message='Задание уже закрыто';end if;
   if not exists(select 1 from public.catalog_entries c where c.kind='failure' and c.code=p_data->>'failure_reason' and c.branch_id=o.branch_id and c.active) then raise exception using errcode='23514',message='Укажите причину неудачного визита';end if;
   update public.visits set state='failed',failure_reason=p_data->>'failure_reason',note=coalesce(p_data->>'note',''),completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v.id returning to_jsonb(visits.*) into result;
  else raise exception using errcode='23514',message='Недопустимое действие с заданием';end if;
  insert into public.visit_events(visit_id,event,actor_id,note,latitude,longitude) values(v.id,p_data->>'event',p_user,p_data->>'note',(p_data->>'latitude')::numeric,(p_data->>'longitude')::numeric);
 when 'workshop.advance' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'workshop');
  stage:=coalesce(o.production_stage,o.status::text);
  if stage is distinct from p_data->>'expected_stage' then raise exception using errcode='55000',message='Этап изменился. Обновите заказ';end if;
  next_stage:=case stage when 'received' then 'washing' when 'washing' then 'drying' when 'drying' then 'quality_check' when 'quality_check' then 'packing' when 'packing' then 'ready' end;
  if next_stage is null then raise exception using errcode='55000',message='Дальнейший этап цеха недоступен';end if;
  if next_stage in ('washing','drying','ready') then perform public.change_order_status(o.id,next_stage::public.order_status,p_user,p_data->>'note');end if;
  update public.orders set production_stage=next_stage where id=o.id;
  insert into public.production_events(order_id,stage,actor_id,note) values(o.id,next_stage,p_user,p_data->>'note');
  result:=jsonb_build_object('order_id',o.id,'stage',next_stage);
 when 'workshop.defect' then
  o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'workshop');
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
  if actor.role::text not in ('admin','dispatcher') then raise exception using errcode='42501',message='Подтверждение доступно администратору и диспетчеру';end if;
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
  perform public.crm_require(p_user,'tariffs',bid);
  if (p_data->>'effective_at')::timestamptz<clock_timestamp()-interval '1 minute' then raise exception using errcode='23514',message='Тариф нельзя вводить задним числом';end if;
  insert into public.tariffs(code,name,price_per_m2,active) values(p_data->>'code',p_data->>'name',(p_data->>'price_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true)) on conflict(code) do nothing;
  insert into public.tariff_versions(code,branch_id,name,price_per_m2,active,effective_at,created_by)
  values(p_data->>'code',bid,p_data->>'name',(p_data->>'price_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true),(p_data->>'effective_at')::timestamptz,p_user) returning to_jsonb(tariff_versions.*) into result;
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
  perform public.crm_require(p_user,'staff');perform pg_advisory_xact_lock(hashtextextended('crm:staff:admins',0));
  select * into target from public.profiles where id=(p_data->>'user_id')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Сотрудник не найден';end if;
  if target.role='admin' and (p_data->>'role'<>'admin' or not (p_data->>'active')::boolean) and not exists(select 1 from public.profiles where id<>target.id and active and role='admin') then
   raise exception using errcode='55000',message='Нельзя отключить последнего администратора';end if;
  if p_data->>'role' not in ('admin','manager') and not exists(select 1 from public.branches where id=(p_data->>'branch_id')::uuid and active) then raise exception using errcode='23514',message='Укажите действующий филиал';end if;
  update public.profiles set role=(p_data->>'role')::public.user_role,active=(p_data->>'active')::boolean,full_name=p_data->>'full_name',phone=p_data->>'phone',branch_id=(p_data->>'branch_id')::uuid
  where id=target.id returning to_jsonb(profiles.*) into result;
 else result:=public.crm_extension(p_command,p_data,p_user,p_ip);
 end case;
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);
 return result;
end $$;

create or replace function public.crm_cancellation_payment() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if old.status<>'cancelled' and new.status='cancelled' and coalesce(new.cancellation_payment_amount,0)>0 then
  insert into public.payments(order_id,branch_id,amount,method,state,received_by,note,confirmed_at,confirmed_by)
  values(new.id,new.branch_id,new.cancellation_payment_amount,'legacy','confirmed',new.cancelled_by,'Оплата при отказе; способ не указан',new.cancelled_at,new.cancelled_by);
 end if;return new;
end $$;
drop trigger if exists cancellation_payment_ledger on public.orders;
create trigger cancellation_payment_ledger after update on public.orders for each row execute function public.crm_cancellation_payment();

-- Сохраняем совместимость старого PUT тарифов и новую историю цены.
create or replace function public.save_tariff_audited(p_code text,p_data jsonb,p_user uuid,p_ip inet default null) returns public.tariffs
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.tariffs;
begin
 perform public.lifecycle_actor(p_user,p_ip);perform public.crm_require(p_user,'tariffs');
 insert into public.tariffs(code,name,price_per_m2,active) values(p_code,p_data->>'name',(p_data->>'price_per_m2')::numeric,(p_data->>'active')::boolean)
 on conflict(code) do update set name=excluded.name,price_per_m2=excluded.price_per_m2,active=excluded.active returning * into result;
 insert into public.tariff_versions(code,name,price_per_m2,active,effective_at,created_by) values(p_code,result.name,result.price_per_m2,result.active,clock_timestamp(),p_user);
 return result;
end $$;


-- COMMANDS_END
-- WORKSPACE_START
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
  return jsonb_build_object('branches',(select coalesce(jsonb_agg(to_jsonb(b) order by b.name),'[]') from public.branches b where actor.role::text in ('admin','manager') or b.id=actor.branch_id),
   'catalogs',(select coalesce(jsonb_agg(to_jsonb(c) order by c.kind,c.position,c.code),'[]') from public.catalog_entries c where (bid is null or c.branch_id=bid) and (c.active or actor.role='admin')),
   'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'full_name',s.full_name,'role',s.role,'active',s.active,'branch_id',s.branch_id) order by s.full_name),'[]') from public.profiles s
    where actor.role::text in ('admin','manager') or s.id=p_user or (actor.role::text in ('dispatcher','operator') and s.branch_id=actor.branch_id)),
   'tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'name',t.name,'price_per_m2',public.crm_rate(t.code,coalesce(bid,'01000000-0000-4000-8000-000000000001')),'active',public.crm_rate(t.code,coalesce(bid,'01000000-0000-4000-8000-000000000001')) is not null)),'[]') from public.tariffs t),
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
   and (actor.role::text in ('admin','dispatcher') or t.assigned_to=p_user)
   and (p_filters->>'status' is null or t.status=p_filters->>'status')
   and (at_cursor is null or (t.created_at,t.id)<(at_cursor,id_cursor)) order by t.created_at desc,t.id desc limit lim+1) q;
 when 'dispatch','driver' then
  if p_view='dispatch' then perform public.crm_require(p_user,'dispatch',bid);elsif actor.role::text not in ('driver','admin') then raise exception using errcode='42501',message='Нет доступа к заданиям водителя';end if;
  select coalesce(jsonb_agg(q.x order by q.created_at desc,q.id desc),'[]') into rows from (
   select v.id,v.created_at,to_jsonb(v)||jsonb_build_object('code','K-'||o.number,'status',o.status,'address',o.address,'latitude',o.latitude,'longitude',o.longitude,
    'client_name',c.name,'phone',c.phone,'total',o.total,'paid_amount',o.paid_amount,'urgent',o.urgent) x
   from public.visits v join public.orders o on o.id=v.order_id join public.clients c on c.id=o.client_id
   where o.deleted_at is null and o.status<>'cancelled' and (bid is null or v.branch_id=bid) and v.scheduled_date=day
   and (p_view<>'driver' or v.driver_id=p_user) and (p_filters->>'driver_id' is null or v.driver_id=(p_filters->>'driver_id')::uuid)
   and (at_cursor is null or (v.created_at,v.id)<(at_cursor,id_cursor)) order by v.created_at desc,v.id desc limit lim+1) q;
 when 'workshop' then
  perform public.crm_require(p_user,'workshop',bid);
  select coalesce(jsonb_agg(q.x order by q.urgent desc,q.created_at,q.id),'[]') into rows from (
   select o.id,o.urgent,o.created_at,jsonb_build_object('id',o.id,'code','K-'||o.number,'status',o.status,'stage',coalesce(o.production_stage,o.status::text),
    'urgent',o.urgent,'created_at',o.created_at,'promised_at',o.promised_at,'branch_id',o.branch_id,
    'area_m2',(select sum(i.area_m2) from public.order_items i where i.order_id=o.id),
    'stage_at',coalesce((select max(e.at) from public.production_events e where e.order_id=o.id),(select max(h.created_at) from public.status_history h where h.order_id=o.id)),
    'items',(select jsonb_agg(jsonb_build_object('id',i.id,'seq',i.seq,'label','K-'||o.number||'-'||i.seq,'length_m',i.length_m,'width_m',i.width_m,'note',i.note) order by i.seq) from public.order_items i where i.order_id=o.id)) x
   from public.orders o where o.deleted_at is null and o.status in ('received','washing','drying','ready') and (bid is null or o.branch_id=bid)
   and (p_filters->>'stage' is null or coalesce(o.production_stage,o.status::text)=p_filters->>'stage')
   and (at_cursor is null or ((case when o.urgent then 0 else 1 end),o.created_at,o.id)>((case when (p_filters->>'cursor_priority')::boolean then 0 else 1 end),at_cursor,id_cursor))
   order by o.urgent desc,o.created_at,o.id limit lim+1) q;
 when 'scan' then
  select * into resolved_order from public.orders where number=split_part(regexp_replace(p_filters->>'label','^K-','','i'),'-',1)::bigint;
  if not found then raise exception using errcode='P0002',message='Метка не найдена';end if;
  resolved_order:=public.crm_order(resolved_order.id,p_user);
  return jsonb_build_object('order_id',resolved_order.id,'code','K-'||resolved_order.number,'status',resolved_order.status,'stage',coalesce(resolved_order.production_stage,resolved_order.status::text),'item_id',
   (select id from public.order_items where order_id=resolved_order.id and seq=coalesce(nullif(split_part(regexp_replace(p_filters->>'label','^K-','','i'),'-',2),'')::integer,1)));
 when 'payments' then
  resolved_order:=public.crm_order((p_filters->>'order_id')::uuid,p_user,'read');
  if actor.role::text='workshop' then raise exception using errcode='42501',message='Нет доступа к оплатам';end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc),'[]') into rows from public.payments p where p.order_id=resolved_order.id;
  return jsonb_build_object('data',rows,'next_cursor',null);
 when 'admin' then
  perform public.crm_require(p_user,'staff');
  return jsonb_build_object('staff',(select coalesce(jsonb_agg(to_jsonb(p) order by p.full_name),'[]') from public.profiles p),
   'tariff_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.tariff_versions order by effective_at desc limit 100) v),
   'setting_versions',(select coalesce(jsonb_agg(to_jsonb(v) order by v.effective_at desc),'[]') from (select * from public.setting_versions order by effective_at desc limit 100) v),
   'templates',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.notification_templates t));
 else raise exception using errcode='23514',message='Неизвестный раздел';end case;
 last_row:=rows->(lim-1);
 result:=jsonb_build_object('data',case when jsonb_array_length(rows)>lim then rows- lim else rows end,
  'next_cursor',case when jsonb_array_length(rows)>lim then jsonb_build_object('at',last_row->>'created_at','id',last_row->>'id','priority',last_row->'urgent') else null end);
 return result;
end $$;

create or replace function public.crm_scope_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare uid uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 if uid is not null then perform public.crm_require(uid,'read',new.branch_id);end if;return new;
end $$;
drop trigger if exists orders_scope_guard on public.orders;
create trigger orders_scope_guard before insert or update on public.orders for each row execute function public.crm_scope_guard();

create or replace function public.crm_staff_access_audit(p_target uuid,p_user uuid,p_ip inet default null) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.lifecycle_actor(p_user,p_ip);perform public.crm_require(p_user,'staff');
 if not exists(select 1 from public.profiles where id=p_target) then raise exception using errcode='P0002',message='Сотрудник не найден';end if;
 insert into public.audit_log(user_id,role,entity,entity_id,action,"after",ip)
 values(p_user,'admin','profile',p_target,'access_link_generated',jsonb_build_object('target',p_target),p_ip);return true;
end $$;

create or replace function public.guard_order_child() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare oid uuid;previous_oid uuid;parent_row public.orders;uid uuid:=nullif(current_setting('app.actor_id',true),'')::uuid;
begin
 if tg_table_name='order_photos' then
  select order_id into oid from public.order_items where id=new.item_id;
  if tg_op='UPDATE' then select order_id into previous_oid from public.order_items where id=old.item_id;end if;
 else oid:=new.order_id;if tg_op='UPDATE' then previous_oid:=old.order_id;end if;end if;
 for parent_row in select * from public.orders where id in (oid,previous_oid) order by id for update loop
  if parent_row.deleted_at is not null then raise exception using errcode='55000',message='Нельзя менять данные удалённого заказа';end if;
  if uid is not null then perform public.crm_require(uid,'read',parent_row.branch_id);end if;
 end loop;return new;
end $$;

-- WORKSPACE_END

do $$ declare t text;begin
 foreach t in array array['branches','role_permissions','catalog_entries','cancel_reasons','client_addresses','leads','calls','tasks','visits','visit_events',
 'production_events','order_defects','payments','tariff_versions','setting_versions','notification_templates','command_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
  execute format('revoke delete,truncate on public.%I from service_role',t);
  if t not in ('role_permissions','command_receipts') then
   execute format('drop trigger if exists workspace_audit on public.%I',t);
   execute format('create trigger workspace_audit after insert or update on public.%I for each row execute function public.crm_audit_change()',t);
  end if;
 end loop;
 grant usage,select on all sequences in schema public to service_role;
end $$;
drop trigger if exists profiles_workspace_audit on public.profiles;
create trigger profiles_workspace_audit after insert or update on public.profiles for each row execute function public.crm_audit_change();
revoke update on public.command_receipts,public.tariff_versions,public.setting_versions from service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'crm_%' or p.proname in ('create_order','quote_order','assign_order_driver','change_order_status')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
