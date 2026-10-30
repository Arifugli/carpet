begin;
create table if not exists public.uz_regions(code text primary key,name_ru text not null,name_uz text not null,position integer not null default 0);
create table if not exists public.uz_districts(code text primary key,region_code text not null references public.uz_regions(code),kind text not null check(kind in ('city','district')),name_ru text not null,name_uz text not null);
create index if not exists uz_districts_region_idx on public.uz_districts(region_code);
insert into public.uz_regions(code,name_ru,name_uz,position) select x.code,x.name_ru,x.name_uz,n::int from jsonb_array_elements('[{"code":"karakalpakstan","name_ru":"Республика Каракалпакстан","name_uz":"Qoraqalpog‘iston Respublikasi"},{"code":"andijan","name_ru":"Андижанская область","name_uz":"Andijon viloyati"},{"code":"bukhara","name_ru":"Бухарская область","name_uz":"Buxoro viloyati"},{"code":"jizzakh","name_ru":"Джизакская область","name_uz":"Jizzax viloyati"},{"code":"kashkadarya","name_ru":"Кашкадарьинская область","name_uz":"Qashqadaryo viloyati"},{"code":"navoi","name_ru":"Навоийская область","name_uz":"Navoiy viloyati"},{"code":"namangan","name_ru":"Наманганская область","name_uz":"Namangan viloyati"},{"code":"samarkand","name_ru":"Самаркандская область","name_uz":"Samarqand viloyati"},{"code":"surkhandarya","name_ru":"Сурхандарьинская область","name_uz":"Surxondaryo viloyati"},{"code":"syrdarya","name_ru":"Сырдарьинская область","name_uz":"Sirdaryo viloyati"},{"code":"tashkent_region","name_ru":"Ташкентская область","name_uz":"Toshkent viloyati"},{"code":"fergana","name_ru":"Ферганская область","name_uz":"Farg‘ona viloyati"},{"code":"khorezm","name_ru":"Хорезмская область","name_uz":"Xorazm viloyati"},{"code":"tashkent_city","name_ru":"Город Ташкент","name_uz":"Toshkent shahri"}]'::jsonb) with ordinality a(value,n) cross join lateral jsonb_to_record(a.value) x(code text,name_ru text,name_uz text) on conflict(code) do nothing;
insert into public.uz_districts(code,region_code,kind,name_ru,name_uz) select * from jsonb_to_recordset('[{"code":"fergana_city","region_code":"fergana","kind":"city","name_ru":"г. Фергана","name_uz":"Farg‘ona shahri"},{"code":"kokand_city","region_code":"fergana","kind":"city","name_ru":"г. Коканд","name_uz":"Qo‘qon shahri"},{"code":"margilan_city","region_code":"fergana","kind":"city","name_ru":"г. Маргилан","name_uz":"Marg‘ilon shahri"},{"code":"kuvasay_city","region_code":"fergana","kind":"city","name_ru":"г. Кувасай","name_uz":"Quvasoy shahri"},{"code":"altiariq","region_code":"fergana","kind":"district","name_ru":"Алтыарыкский район","name_uz":"Oltiariq tumani"},{"code":"baghdad","region_code":"fergana","kind":"district","name_ru":"Багдадский район","name_uz":"Bag‘dod tumani"},{"code":"beshariq","region_code":"fergana","kind":"district","name_ru":"Бешарыкский район","name_uz":"Beshariq tumani"},{"code":"buvayda","region_code":"fergana","kind":"district","name_ru":"Бувайдинский район","name_uz":"Buvayda tumani"},{"code":"dangara","region_code":"fergana","kind":"district","name_ru":"Дангаринский район","name_uz":"Dang‘ara tumani"},{"code":"yazyavan","region_code":"fergana","kind":"district","name_ru":"Язъяванский район","name_uz":"Yozyovon tumani"},{"code":"quva","region_code":"fergana","kind":"district","name_ru":"Кувинский район","name_uz":"Quva tumani"},{"code":"qushtepa","region_code":"fergana","kind":"district","name_ru":"Куштепинский район","name_uz":"Qo‘shtepa tumani"},{"code":"rishtan","region_code":"fergana","kind":"district","name_ru":"Риштанский район","name_uz":"Rishton tumani"},{"code":"sokh","region_code":"fergana","kind":"district","name_ru":"Сохский район","name_uz":"So‘x tumani"},{"code":"tashlaq","region_code":"fergana","kind":"district","name_ru":"Ташлакский район","name_uz":"Toshloq tumani"},{"code":"uchkuprik","region_code":"fergana","kind":"district","name_ru":"Учкуприкский район","name_uz":"Uchko‘prik tumani"},{"code":"uzbekistan","region_code":"fergana","kind":"district","name_ru":"Узбекистанский район","name_uz":"O‘zbekiston tumani"},{"code":"fergana_district","region_code":"fergana","kind":"district","name_ru":"Ферганский район","name_uz":"Farg‘ona tumani"},{"code":"furqat","region_code":"fergana","kind":"district","name_ru":"Фуркатский район","name_uz":"Furqat tumani"}]'::jsonb) x(code text,region_code text,kind text,name_ru text,name_uz text) on conflict(code) do nothing;

alter table public.tariffs add column if not exists booking_enabled boolean not null default true;
alter table public.tariff_versions add column if not exists unit text not null default 'm2' check(unit in ('m2','piece'));
insert into public.tariffs(code,name,price_per_m2,active) values('carpet','Ковры',12000,true),('blanket','Одеяло',30000,true),('tushak','Тушак',30000,true) on conflict(code) do nothing;
update public.tariffs set booking_enabled=(code in ('carpet','blanket','tushak'));
insert into public.tariff_versions(code,branch_id,name,price_per_m2,active,effective_at,unit)
 select t.code,b.id,t.name,t.price,true,clock_timestamp(),t.unit from public.branches b cross join(values('carpet','Ковры',12000,'m2'),('blanket','Одеяло',30000,'piece'),('tushak','Тушак',30000,'piece'))t(code,name,price,unit)
 where not exists(select 1 from public.tariff_versions v where v.code=t.code and v.branch_id=b.id and v.name=t.name and v.price_per_m2=t.price and v.unit=t.unit);
insert into public.tariff_versions(code,name,price_per_m2,unit,active,effective_at) select t.code,t.name,t.price,t.unit,true,'1970-01-01' from(values('carpet','Ковры',12000,'m2'),('blanket','Одеяло',30000,'piece'),('tushak','Тушак',30000,'piece'))t(code,name,price,unit) where not exists(select 1 from public.tariff_versions v where v.code=t.code and v.branch_id is null);
insert into public.catalog_entries(kind,code,name_ru,name_uz,branch_id,position,config)
 select 'zone',d.code,d.name_ru,d.name_uz,b.id,20,jsonb_build_object('region_code',d.region_code,'district_code',d.code,'kind',d.kind) from public.uz_districts d cross join public.branches b on conflict(kind,code,branch_id) do nothing;
alter table public.orders add column if not exists region_code text references public.uz_regions(code),add column if not exists district_code text references public.uz_districts(code),
 add column if not exists street text,add column if not exists house text,add column if not exists apartment text,add column if not exists landmark text,
 add column if not exists private_house boolean not null default false,add column if not exists route_address text,
 add column if not exists measurement_mode text not null default 'legacy' check(measurement_mode in ('legacy','verified')),
 add column if not exists pricing_state text not null default 'priced' check(pricing_state in ('priced','awaiting_measurements'));
alter table public.client_addresses add column if not exists region_code text,add column if not exists district_code text,
 add column if not exists street text,add column if not exists house text,add column if not exists apartment text,add column if not exists landmark text,add column if not exists private_house boolean not null default false;
alter table public.order_items alter column length_m drop not null,alter column width_m drop not null;
alter table public.order_items add column if not exists unit text not null default 'm2' check(unit in ('m2','piece')),
 add column if not exists unit_rate numeric,add column if not exists measurement_origin text not null default 'legacy' check(measurement_origin in ('legacy','pending','workshop'));
do $$ begin if not exists(select 1 from pg_constraint where conname='item_dimensions_pair' and conrelid='public.order_items'::regclass) then
 alter table public.order_items add constraint item_dimensions_pair check((length_m is null)=(width_m is null));end if;end $$;
create table if not exists public.item_measurements(
 id uuid primary key default gen_random_uuid(),item_id uuid not null references public.order_items(id),source_role text not null check(source_role in ('driver','workshop')),
 length_m numeric(5,2),width_m numeric(5,2),area_m2 numeric generated always as(length_m*width_m) stored,
 measured_by uuid not null references public.profiles(id),measured_name text not null,reason text,created_at timestamptz not null default clock_timestamp(),
 check((length_m is null)=(width_m is null)),check(length_m between .3 and 20),check(width_m between .3 and 20)
);
create index if not exists item_measurements_latest_idx on public.item_measurements(item_id,source_role,created_at desc,id desc);
create index if not exists item_measurements_actor_idx on public.item_measurements(measured_by);

create or replace function public.crm_tariff_info(p_code text,p_branch uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select to_jsonb(v)||jsonb_build_object('booking_enabled',t.booking_enabled,'available',v.active and not exists(select 1 from public.tariff_controls c where c.branch_id=p_branch and c.code=p_code and c.archived_at is not null))
 from public.tariffs t join lateral(select * from public.tariff_versions x where x.code=t.code and (x.branch_id=p_branch or x.branch_id is null) and x.effective_at<=now()
 order by (x.branch_id is not null) desc,x.effective_at desc,x.created_at desc,x.id desc limit 1)v on true where t.code=p_code
$$;
create or replace function public.quote_order(p jsonb) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare it jsonb;t jsonb;bid uuid:=coalesce((p->>'branch_id')::uuid,'01000000-0000-4000-8000-000000000001');sub numeric:=0;area numeric:=0;quantity integer;total_count integer:=0;
 pending boolean:=false;rate numeric;factor numeric;tot numeric;fee numeric;rates jsonb:='[]';settings_data jsonb;
begin
 for it in select * from jsonb_array_elements(p->'items') loop
  quantity:=coalesce((it->>'quantity')::integer,1);total_count:=total_count+quantity;
  if quantity not between 1 and 30 or total_count>30 then raise exception using errcode='23514',message='Допустимо до 30 изделий в заказе';end if;
  t:=public.crm_tariff_info(it->>'tariff',bid);if t is null or not (t->>'available')::boolean then raise exception using errcode='23514',message='Тариф недоступен для филиала';end if;
  rate:=(t->>'price_per_m2')::numeric;rates:=rates||jsonb_build_array(jsonb_build_object('code',it->>'tariff','rate',rate,'unit',t->>'unit','name',t->>'name'));
  if t->>'unit'='piece' then sub:=sub+rate*quantity;
  elsif it->>'length_m' is null or it->>'width_m' is null then pending:=true;
  else area:=area+(it->>'length_m')::numeric*(it->>'width_m')::numeric*quantity;sub:=sub+round((it->>'length_m')::numeric*(it->>'width_m')::numeric*rate)*quantity;end if;
 end loop;
 settings_data:=jsonb_build_object('urgent_pct',public.crm_setting('urgent_pct',bid),'stains_pct',public.crm_setting('stains_pct',bid),'pensioner_pct',public.crm_setting('pensioner_pct',bid),'delivery_fee',public.crm_setting('delivery_fee',bid),'free_delivery_from',public.crm_setting('free_delivery_from',bid));
 factor:=1+case when coalesce((p->>'urgent')::boolean,false) then (settings_data->>'urgent_pct')::numeric else 0 end
  +case when coalesce((p->>'stains')::boolean,false) then (settings_data->>'stains_pct')::numeric else 0 end
  +case when coalesce((p->>'pensioner')::boolean,false) then (settings_data->>'pensioner_pct')::numeric else 0 end;
 tot:=round(sub*factor,-3);fee:=case when sub>0 and sub<(settings_data->>'free_delivery_from')::numeric then (settings_data->>'delivery_fee')::numeric else 0 end;
 return jsonb_build_object('area_m2',round(area,2),'subtotal',sub,'adjustment',tot-sub,'delivery_fee',case when pending then 0 else fee end,
  'total',case when pending then null else tot+fee end,'pending_measurements',pending,'rates',rates,'factor',factor,'settings',settings_data,'items_count',total_count);
end $$;

create or replace function public.crm_format_address(p jsonb,route_only boolean default false) returns text
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare region_name text;district_name text;
begin
 select name_ru into region_name from public.uz_regions where code=p->>'region_code';
 if region_name is null then raise exception using errcode='23514',message='Выберите область Узбекистана';end if;
 if nullif(p->>'district_code','') is not null then
  select name_ru into district_name from public.uz_districts where code=p->>'district_code' and region_code=p->>'region_code';
  if district_name is null then raise exception using errcode='23514',message='Район не относится к выбранной области';end if;
 elsif p->>'region_code'='fergana' then raise exception using errcode='23514',message='Выберите район или город Ферганской области';end if;
 if length(btrim(coalesce(p->>'street','')))=0 or length(btrim(coalesce(p->>'house','')))=0 then raise exception using errcode='23514',message='Укажите улицу и дом';end if;
 if not coalesce((p->>'private_house')::boolean,false) and length(btrim(coalesce(p->>'apartment','')))=0 then raise exception using errcode='23514',message='Укажите квартиру или выберите частный дом';end if;
 return concat_ws(', ','Узбекистан',region_name,district_name,'ул. '||btrim(p->>'street'),'д. '||btrim(p->>'house'),
  case when not route_only and nullif(btrim(p->>'apartment'),'') is not null then 'кв. '||btrim(p->>'apartment') end,
  case when not route_only and nullif(btrim(p->>'landmark'),'') is not null then 'ориентир: '||btrim(p->>'landmark') end);
end $$;

do $$ begin if to_regprocedure('public.crm_create_order_v10(jsonb,uuid)') is null then alter function public.create_order(jsonb,uuid) rename to crm_create_order_v10;end if;end $$;
create or replace function public.create_order(p jsonb,p_user uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;bid uuid;cid uuid;oid uuid;q jsonb;it jsonb;rate_data jsonb;seq integer:=0;line_no integer:=0;copies integer;i integer;full_address text;route_text text;
begin
 actor:=public.crm_require(p_user,'create');bid:=coalesce((p->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(p_user,'create',bid);
 if actor.role::text='operator' and exists(select 1 from jsonb_array_elements(p->'items') x where x->>'length_m' is not null or x->>'width_m' is not null) then raise exception using errcode='42501',message='Замеры выполняют водитель и цех';end if;
 -- Совместимость административного импорта исторических измеренных заказов.
 if actor.role::text='admin' and p->>'region_code' is null and not exists(select 1 from jsonb_array_elements(p->'items') x join public.tariffs t on t.code=x->>'tariff' where t.booking_enabled) then return public.crm_create_order_v10(p,p_user);end if;
 if exists(select 1 from jsonb_array_elements(p->'items') x where x->>'length_m' is not null or x->>'width_m' is not null) then raise exception using errcode='42501',message='При создании укажите вид и количество; замеры выполнят водитель и цех';end if;
 if p->>'latitude' is not null or p->>'longitude' is not null then raise exception using errcode='23514',message='Используйте поля адреса вместо координат';end if;
 perform pg_advisory_xact_lock(hashtextextended('capacity:'||bid::text||coalesce(p->>'pickup_date',''),0));
 perform 1 from public.branches where id=bid and active and archived_at is null for key share;if not found then raise exception using errcode='23514',message='Филиал недоступен';end if;
 full_address:=public.crm_format_address(p);route_text:=public.crm_format_address(p,true);
 if not exists(select 1 from public.catalog_entries where branch_id=bid and kind='source' and code=coalesce(p->>'source','call_in') and active) then raise exception using errcode='23514',message='Источник обращения недоступен';end if;
 if exists(select 1 from jsonb_array_elements(p->'items') x left join public.tariffs t on t.code=x->>'tariff' where not coalesce(t.booking_enabled,false)) then raise exception using errcode='23514',message='Выберите действующий вид изделия';end if;
 q:=public.quote_order(p||jsonb_build_object('branch_id',bid));
 insert into public.clients(name,phone,address) values(coalesce(p->>'name',''),p->>'phone',full_address)
 on conflict(phone_key) do update set name=coalesce(nullif(excluded.name,''),clients.name),address=excluded.address returning id into cid;
 insert into public.orders(client_id,address,pickup_date,pickup_slot,source,comment,urgent,stains,pensioner,subtotal,adjustment,delivery_fee,total,created_by,branch_id,zone_code,promised_at,pricing_snapshot,
  region_code,district_code,street,house,apartment,landmark,private_house,route_address,measurement_mode,pricing_state)
 values(cid,full_address,(p->>'pickup_date')::date,p->>'pickup_slot',coalesce(p->>'source','call_in'),p->>'comment',coalesce((p->>'urgent')::boolean,false),coalesce((p->>'stains')::boolean,false),coalesce((p->>'pensioner')::boolean,false),
  (q->>'subtotal')::numeric,(q->>'adjustment')::numeric,(q->>'delivery_fee')::numeric,coalesce((q->>'total')::numeric,0),p_user,bid,p->>'district_code',coalesce((p->>'promised_at')::timestamptz,clock_timestamp()+(select sla_hours*interval '1 hour' from public.branches where id=bid)),q,
  p->>'region_code',nullif(p->>'district_code',''),btrim(p->>'street'),btrim(p->>'house'),nullif(btrim(p->>'apartment'),''),nullif(btrim(p->>'landmark'),''),coalesce((p->>'private_house')::boolean,false),route_text,'verified',case when (q->>'pending_measurements')::boolean then 'awaiting_measurements' else 'priced' end) returning id into oid;
 for it in select * from jsonb_array_elements(p->'items') loop
  rate_data:=q->'rates'->line_no;line_no:=line_no+1;copies:=coalesce((it->>'quantity')::integer,1);
  for i in 1..copies loop seq:=seq+1;
   insert into public.order_items(order_id,seq,length_m,width_m,tariff_code,note,price,unit,unit_rate,measurement_origin)
   values(oid,seq,null,null,it->>'tariff',it->>'note',case when rate_data->>'unit'='piece' then (rate_data->>'rate')::numeric else 0 end,rate_data->>'unit',(rate_data->>'rate')::numeric,'pending');
  end loop;
 end loop;
 insert into public.status_history(order_id,status,changed_by) values(oid,'new',p_user);
 insert into public.client_addresses(client_id,address,zone_code,created_by,region_code,district_code,street,house,apartment,landmark,private_house)
 values(cid,full_address,p->>'district_code',p_user,p->>'region_code',nullif(p->>'district_code',''),p->>'street',p->>'house',nullif(p->>'apartment',''),nullif(p->>'landmark',''),coalesce((p->>'private_house')::boolean,false)) on conflict(client_id,address) do nothing;
 return oid;
end $$;

create or replace function public.crm_reprice_measured(oid uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;sub numeric;area numeric;pending boolean;tot numeric;fee numeric;s jsonb;
begin
 select * into o from public.orders where id=oid for update;s:=o.pricing_snapshot->'settings';
 select coalesce(sum(price),0),coalesce(sum(area_m2),0),coalesce(bool_or(unit='m2' and measurement_origin<>'workshop'),false) into sub,area,pending from public.order_items where order_id=oid;
 tot:=round(sub*(o.pricing_snapshot->>'factor')::numeric,-3);
 fee:=case when sub>0 and sub<(s->>'free_delivery_from')::numeric then (s->>'delivery_fee')::numeric else 0 end;
 update public.orders set subtotal=sub,adjustment=tot-sub,delivery_fee=case when pending then 0 else fee end,total=case when pending then 0 else tot+fee end,
 pricing_state=case when pending then 'awaiting_measurements' else 'priced' end,
 pricing_snapshot=pricing_snapshot||jsonb_build_object('subtotal',sub,'area_m2',area,'adjustment',tot-sub,'delivery_fee',case when pending then 0 else fee end,'total',case when pending then null else tot+fee end,'pending_measurements',pending,'measured_at',clock_timestamp()) where id=oid;
end $$;

create or replace function public.crm_measure_item(d jsonb,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;o public.orders;i public.order_items;previous public.item_measurements;driver_sample public.item_measurements;m public.item_measurements;oid uuid;l numeric;w numeric;
begin
 actor:=public.crm_require(u,'read');if actor.role::text not in ('driver','workshop') then raise exception using errcode='42501',message='Замеры выполняют водитель и цех';end if;
 select order_id into oid from public.order_items where id=(d->>'item_id')::uuid;
 if oid is null then raise exception using errcode='P0002',message='Изделие не найдено';end if;
 o:=public.crm_order(oid,u);select * into i from public.order_items where id=(d->>'item_id')::uuid for update;
 if o.measurement_mode<>'verified' or o.status in ('cancelled','delivered','washing','drying','ready','delivering') or o.washing_started_at is not null then raise exception using errcode='55000',message='Замеры этого заказа уже закрыты';end if;
 if actor.role::text='driver' and (o.status not in ('pickup_assigned','received') or exists(select 1 from public.item_measurements x join public.order_items z on z.id=x.item_id where z.order_id=o.id and x.source_role='workshop')) then raise exception using errcode='55000',message='Цех уже начал приёмку; замер водителя закрыт';end if;
 if actor.role::text='workshop' and o.status<>'received' then raise exception using errcode='55000',message='Замер цеха доступен при приёмке';end if;
 l:=(d->>'length_m')::numeric;w:=(d->>'width_m')::numeric;
 if l<>round(l,2) or w<>round(w,2) then raise exception using errcode='23514',message='Укажите размеры с точностью до сантиметра';end if;
 if (l is null)<>(w is null) or (i.unit='m2' and l is null) or l not between .3 and 20 or w not between .3 and 20 then raise exception using errcode='23514',message='Укажите длину и ширину от 0,3 до 20 м';end if;
 if i.unit='m2' and (o.payment_recorded_at is not null or o.paid_amount>0 or exists(select 1 from public.payments where order_id=o.id and state in ('confirmed','pending')) or exists(select 1 from public.order_discounts where order_id=o.id)) then raise exception using errcode='55000',message='После оплаты или скидки изменять площадь нельзя';end if;
 select * into previous from public.item_measurements where item_id=i.id and source_role=actor.role::text order by created_at desc,id desc limit 1;
 if d ? 'expected_id' and previous.id is distinct from (d->>'expected_id')::uuid then raise exception using errcode='55000',message='Замер изменился. Обновите карточку';end if;
 select * into driver_sample from public.item_measurements where item_id=i.id and source_role='driver' order by created_at desc,id desc limit 1;
 if (previous.id is not null or (actor.role::text='workshop' and driver_sample.area_m2 is not null and abs(driver_sample.area_m2-l*w)>.01)) and length(btrim(coalesce(d->>'reason','')))<3 then raise exception using errcode='23514',message='Укажите причину исправления или расхождения замеров';end if;
 insert into public.item_measurements(item_id,source_role,length_m,width_m,measured_by,measured_name,reason) values(i.id,actor.role::text,l,w,u,actor.full_name,nullif(btrim(d->>'reason'),'')) returning * into m;
 if actor.role::text='workshop' then
  update public.order_items set length_m=l,width_m=w,measurement_origin='workshop',price=case when unit='piece' then unit_rate else round(l*w*unit_rate) end where id=i.id;
  if i.unit='m2' then perform public.crm_reprice_measured(o.id);end if;
 end if;
 return to_jsonb(m);
end $$;

create or replace function public.crm_measurements(oid uuid,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.crm_order(oid,u);
 return (select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('measurements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc),'[]') from public.item_measurements m where m.item_id=i.id)) order by i.seq),'[]') from public.order_items i where i.order_id=oid);
end $$;
create or replace function public.crm_measurement_immutable() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin raise exception using errcode='55000',message='История замеров неизменяема; внесите новый замер с причиной';end $$;
drop trigger if exists measurement_immutable on public.item_measurements;
create trigger measurement_immutable before update or delete on public.item_measurements for each row execute function public.crm_measurement_immutable();
drop trigger if exists measurement_audit on public.item_measurements;
create trigger measurement_audit after insert on public.item_measurements for each row execute function public.crm_audit_change();
create or replace function public.crm_measured_order_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.measurement_mode='verified' then
  if new.status in ('washing','drying','ready','delivering','delivered') and (new.pricing_state<>'priced' or exists(select 1 from public.order_items where order_id=new.id and measurement_origin<>'workshop')) then raise exception using errcode='55000',message='Цех должен подтвердить каждое изделие и измерить ковры';end if;
  if new.pricing_state='awaiting_measurements' and new.paid_amount>old.paid_amount then raise exception using errcode='55000',message='Оплата доступна после замера ковров в цехе';end if;
 end if;return new;
end $$;
drop trigger if exists measured_order_guard on public.orders;
create trigger measured_order_guard before update on public.orders for each row execute function public.crm_measured_order_guard();
create or replace function public.crm_measured_payment_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.orders where id=new.order_id and pricing_state='awaiting_measurements' and status<>'cancelled') then raise exception using errcode='55000',message='Оплата доступна после замера ковров в цехе';end if;return new;
end $$;
drop trigger if exists measured_payment_guard on public.payments;
create trigger measured_payment_guard before insert on public.payments for each row execute function public.crm_measured_payment_guard();

-- Совместимый старый API тарифа также сохраняет единицу расчёта.
create or replace function public.save_tariff_audited(p_code text,p_data jsonb,p_user uuid,p_ip inet default null) returns public.tariffs language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.tariffs;unit_text text;
begin
 perform public.lifecycle_actor(p_user,p_ip);perform public.crm_require(p_user,'tariffs');
 unit_text:=case when p_code in ('blanket','tushak') then 'piece' else 'm2' end;
 insert into public.tariffs(code,name,price_per_m2,active) values(p_code,p_data->>'name',(p_data->>'price_per_m2')::numeric,(p_data->>'active')::boolean)
 on conflict(code) do update set name=excluded.name,price_per_m2=excluded.price_per_m2,active=excluded.active returning * into result;
 insert into public.tariff_versions(code,name,price_per_m2,unit,active,effective_at,created_by) values(p_code,result.name,result.price_per_m2,unit_text,result.active,clock_timestamp(),p_user);return result;
end $$;

do $$ begin if to_regprocedure('public.crm_command_v10(text,jsonb,uuid,inet,uuid)') is null then alter function public.crm_command(text,jsonb,uuid,inet,uuid) rename to crm_command_v10;end if;end $$;
create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.profiles;previous public.command_receipts;bid uuid;result jsonb;unit_text text;address_text text;
begin
 if p_command in ('intake.create','discount.apply','payment.intent') and exists(select 1 from public.orders where id=(p_data->>'order_id')::uuid and pricing_state='awaiting_measurements') then perform public.crm_order((p_data->>'order_id')::uuid,p_user);raise exception using errcode='55000',message='Сначала дождитесь замера ковров в цехе';end if;
 if p_command not in ('item.measure','tariff.schedule') and not (p_command='client.address' and p_data ? 'region_code') then return public.crm_command_v10(p_command,p_data,p_user,p_ip,p_key);end if;
 perform public.lifecycle_actor(p_user,p_ip);actor:=public.crm_require(p_user,'read');
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));select * into previous from public.command_receipts where user_id=p_user and key=p_key;
 if found then if previous.command<>p_command or previous.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ уже использован для другого действия';end if;return previous.result;end if;
 bid:=coalesce((p_data->>'branch_id')::uuid,actor.branch_id,'01000000-0000-4000-8000-000000000001');
 if p_command='item.measure' then result:=public.crm_measure_item(p_data,p_user);
 elsif p_command='client.address' then
  perform public.crm_require(p_user,'clients',bid);address_text:=public.crm_format_address(p_data);
  insert into public.client_addresses(client_id,label,address,zone_code,created_by,region_code,district_code,street,house,apartment,landmark,private_house)
  values((p_data->>'client_id')::uuid,coalesce(p_data->>'label',''),address_text,p_data->>'district_code',p_user,p_data->>'region_code',nullif(p_data->>'district_code',''),p_data->>'street',p_data->>'house',nullif(p_data->>'apartment',''),nullif(p_data->>'landmark',''),coalesce((p_data->>'private_house')::boolean,false))
  on conflict(client_id,address) do update set label=excluded.label returning to_jsonb(client_addresses.*) into result;
 else
  perform public.crm_require(p_user,'tariffs',bid);unit_text:=coalesce(p_data->>'unit',public.crm_tariff_info(p_data->>'code',bid)->>'unit','m2');
  if unit_text not in ('m2','piece') or (p_data->>'code'='carpet' and unit_text<>'m2') or (p_data->>'code' in ('blanket','tushak') and unit_text<>'piece') or (p_data->>'effective_at')::timestamptz<clock_timestamp()-interval '1 minute' then raise exception using errcode='23514',message='Проверьте единицу расчёта и дату тарифа';end if;
  insert into public.tariffs(code,name,price_per_m2,active) values(p_data->>'code',p_data->>'name',(p_data->>'price_per_m2')::numeric,coalesce((p_data->>'active')::boolean,true)) on conflict(code) do nothing;
  insert into public.tariff_versions(code,branch_id,name,price_per_m2,unit,active,effective_at,created_by) values(p_data->>'code',bid,p_data->>'name',(p_data->>'price_per_m2')::numeric,unit_text,coalesce((p_data->>'active')::boolean,true),(p_data->>'effective_at')::timestamptz,p_user) returning to_jsonb(tariff_versions.*) into result;
 end if;
 insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);return result;
end $$;

do $$ begin if to_regprocedure('public.crm_workspace_v10(text,jsonb,uuid)') is null then alter function public.crm_workspace(text,jsonb,uuid) rename to crm_workspace_v10;end if;end $$;
create or replace function public.crm_workspace(p_view text,p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare data jsonb;bid uuid;rows jsonb;
begin
 data:=public.crm_workspace_v10(p_view,p_filters,p_user);bid:=coalesce((p_filters->>'branch_id')::uuid,(select branch_id from public.profiles where id=p_user),'01000000-0000-4000-8000-000000000001');
 if p_view='bootstrap' then
  data:=data||jsonb_build_object('regions',(select jsonb_agg(to_jsonb(r) order by r.position) from public.uz_regions r),'districts',(select jsonb_agg(to_jsonb(d) order by d.kind,d.name_ru) from public.uz_districts d),
   'tariffs',(select coalesce(jsonb_agg(jsonb_build_object('code',t.code,'name',v->>'name','price_per_m2',(v->>'price_per_m2')::numeric,'unit',v->>'unit','active',coalesce((v->>'available')::boolean,false)) order by case t.code when 'carpet' then 1 when 'blanket' then 2 else 3 end),'[]') from public.tariffs t cross join lateral(select public.crm_tariff_info(t.code,bid) v) q where t.booking_enabled));
 elsif p_view='admin' then
  select coalesce(jsonb_agg(x||jsonb_build_object('unit',coalesce(public.crm_tariff_info(x->>'code',(x->>'branch_id')::uuid)->>'unit','m2'))),'[]') into rows from jsonb_array_elements(data->'tariffs') x join public.tariffs t on t.code=x->>'code' where t.booking_enabled;data:=jsonb_set(data,'{tariffs}',rows);
 elsif p_view in ('driver','dispatch','workshop','client') then
  select coalesce(jsonb_agg(x||jsonb_build_object('pricing_state',o.pricing_state,'measurement_mode',o.measurement_mode,'route_address',o.route_address,'region_code',o.region_code,'district_code',o.district_code,'street',o.street,'house',o.house,'apartment',o.apartment,'landmark',o.landmark,'private_house',o.private_house) order by n),'[]') into rows
  from jsonb_array_elements(coalesce(data->case when p_view='client' then 'orders' else 'data' end,'[]')) with ordinality a(x,n) join public.orders o on o.id=case when p_view in ('driver','dispatch') then (x->>'order_id')::uuid else (x->>'id')::uuid end;
  data:=jsonb_set(data,array[case when p_view='client' then 'orders' else 'data' end],rows);
 end if;return data;
end $$;

-- Публичный трекинг показывает честный статус цены без адреса или замеров.
do $$ begin if to_regprocedure('public.crm_public_status_v10(text)') is null then alter function public.public_order_status(text) rename to crm_public_status_v10;end if;end $$;
create or replace function public.public_order_status(p_token text) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare data jsonb;ps text;begin data:=public.crm_public_status_v10(p_token);if data is null then return null;end if;select pricing_state into ps from public.orders where track_token=p_token and deleted_at is null;return data||jsonb_build_object('pricing_state',ps);end $$;

create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',to_regprocedure('public.crm_measurements(uuid,uuid)') is not null and has_table_privilege(current_user,'public.item_measurements','insert') and has_table_privilege(current_user,'public.profiles','select'),'schema',11)
$$;
do $$ declare t text;f record;begin
 foreach t in array array['uz_regions','uz_districts','item_measurements'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select,insert on public.%I to service_role',t);execute format('revoke update,delete,truncate on public.%I from service_role',t);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'crm_%' or p.proname in ('create_order','quote_order','public_order_status')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';

commit;
