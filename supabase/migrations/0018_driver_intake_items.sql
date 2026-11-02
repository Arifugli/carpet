-- Orders can be accepted without estimated products; the assigned driver records the actual composition.
-- Explicit, additive deployment after 0017. No existing orders or agreed prices are changed.
begin;
create or replace function public.create_order(p jsonb,p_user uuid) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;bid uuid;oid uuid;cid uuid;it jsonb;rate jsonb;q jsonb;address_text text;seq integer:=0;n integer;j integer;begin
 p:=jsonb_set(p,'{items}',coalesce(p->'items','[]'::jsonb));
 a:=public.crm_require(p_user,'create');bid:=coalesce((p->>'branch_id')::uuid,a.branch_id,'01000000-0000-4000-8000-000000000001');perform public.crm_require(p_user,'create',bid);
 if length(btrim(coalesce(p->>'name','')))=0 or p->>'phone'!~'^\+998[0-9]{9}$' or nullif(p->>'district_code','') is null then raise exception using errcode='23514',message='Укажите ФИО, телефон, область и район';end if;
 if p->>'latitude' is not null or p->>'longitude' is not null or exists(select 1 from jsonb_array_elements(p->'items')x where x ? 'length_m' or x ? 'width_m') then raise exception using errcode='42501',message='Оператор указывает только ориентировочные вид и количество';end if;
 address_text:=public.crm_format_address(p);
 if not exists(select 1 from public.uz_districts where code=p->>'district_code' and region_code=p->>'region_code') then raise exception using errcode='23514',message='Район не относится к области';end if;
 if not exists(select 1 from public.branches where id=bid and active and archived_at is null) then raise exception using errcode='23514',message='Филиал недоступен';end if;
 if not exists(select 1 from public.catalog_entries where kind='source' and branch_id=bid and code=p->>'source' and active) then raise exception using errcode='23514',message='Источник обращения недоступен';end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or (select sum(coalesce((z->>'quantity')::int,1)) from jsonb_array_elements(p->'items')z)>30 or exists(select 1 from jsonb_array_elements(p->'items')x where coalesce(x->>'tariff','') not in ('carpet','blanket','tushak')) then raise exception using errcode='23514',message='Выберите вид и количество изделий (всего до 30)';end if;
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
 if not exists(select 1 from public.order_items where order_id=oid) then raise exception using errcode='23514',message='Сначала добавьте изделия у клиента';end if;
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
create or replace function public.crm_save_pickup_items(oid uuid,items jsonb,flags jsonb,u uuid,p_key uuid,p_ip inet default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;receipt public.command_receipts;x jsonb;i public.order_items;rate jsonb;payload jsonb;
 result jsonb;previous jsonb;kept uuid[]:='{}';item_id uuid;qty integer;next_seq integer;factor numeric;new_urgent boolean;new_stains boolean;new_pensioner boolean;
begin
 perform public.lifecycle_actor(u,p_ip);a:=public.crm_require(u,'pickup');
 if a.role::text<>'driver' then raise exception using errcode='42501',message='Состав заказа заполняет водитель';end if;
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 payload:=jsonb_build_object('order_id',oid,'items',items,'flags',flags);
 perform pg_advisory_xact_lock(hashtextextended(u::text||p_key::text,0));
 select * into receipt from public.command_receipts where user_id=u and key=p_key;
 if found then
  if receipt.command<>'pickup.items' or receipt.payload is distinct from payload then raise exception using errcode='55000',message='Ключ использован для другого действия';end if;
  perform public.crm_require(u,'read',(receipt.result->>'branch_id')::uuid);return receipt.result;
 end if;
 o:=public.crm_order(oid,u,'pickup');
 if o.status<>'pickup_planned' or o.pickup_driver_id<>u or o.pickup_state<>'pending' or o.pricing_state<>'awaiting_measurements' then raise exception using errcode='55000',message='Состав можно менять только до отметки «Забрал»';end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 30 then raise exception using errcode='23514',message='Добавьте от 1 до 30 позиций изделий';end if;
 if flags is null or jsonb_typeof(flags)<>'object' or exists(select 1 from jsonb_object_keys(flags) k where k not in ('urgent','stains','pensioner')) then raise exception using errcode='23514',message='Неверные признаки заказа';end if;
 if exists(select 1 from jsonb_array_elements(items) r group by r->>'item_id' having r->>'item_id' is not null and count(*)>1) then raise exception using errcode='23514',message='Изделие указано дважды';end if;
 select coalesce(jsonb_agg(to_jsonb(z) order by z.seq),'[]') into previous from public.order_items z where order_id=oid;
 if exists(select 1 from public.order_items z where z.order_id=oid and not exists(select 1 from jsonb_array_elements(items) r where r->>'item_id'=z.id::text)
  and (exists(select 1 from public.order_photos p where p.item_id=z.id) or exists(select 1 from public.item_measurements m where m.item_id=z.id))) then raise exception using errcode='55000',message='Изделие с фото или замерами нельзя удалить из состава';end if;
 perform set_config('app.pickup_items_edit',oid::text,true);
 delete from public.order_items z where z.order_id=oid and not exists(select 1 from jsonb_array_elements(items) r where r->>'item_id'=z.id::text);
 perform set_config('app.pickup_items_edit','',true);
 select coalesce(max(seq),0) into next_seq from public.order_items where order_id=oid;
 for x in select * from jsonb_array_elements(items) loop
  if jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('item_id','tariff','quantity','note')) or coalesce(x->>'tariff','') not in ('carpet','blanket','tushak') then raise exception using errcode='23514',message='Выберите вид изделия';end if;
  qty:=coalesce((x->>'quantity')::integer,1);
  if qty not between 1 and 1000 or (x->>'tariff'='carpet' and qty<>1) or length(coalesce(x->>'note',''))>300 then raise exception using errcode='23514',message='Каждый ковёр добавляется отдельно; количество изделий от 1 до 1000';end if;
  item_id:=nullif(x->>'item_id','')::uuid;
  if item_id is not null then
   select * into i from public.order_items where id=item_id and order_id=oid;
   if not found then raise exception using errcode='23514',message='Изделие не относится к заказу';end if;
   if i.tariff_code<>x->>'tariff' then
    if exists(select 1 from public.order_photos p where p.item_id=i.id) or exists(select 1 from public.item_measurements m where m.item_id=i.id) then raise exception using errcode='55000',message='Тип изделия с фото или замерами менять нельзя';end if;
    rate:=public.crm_tariff_info(x->>'tariff',o.branch_id);
    if not coalesce((rate->>'available')::boolean,false) then raise exception using errcode='23514',message='Тариф недоступен';end if;
    update public.order_items set tariff_code=x->>'tariff',unit=rate->>'unit',unit_rate=(rate->>'price_per_m2')::numeric where id=i.id;
   end if;
   update public.order_items set quantity=qty,note=case when x ? 'note' then x->>'note' else note end where id=item_id;
  else
   rate:=public.crm_tariff_info(x->>'tariff',o.branch_id);
   if not coalesce((rate->>'available')::boolean,false) then raise exception using errcode='23514',message='Тариф недоступен';end if;
   next_seq:=next_seq+1;
   insert into public.order_items(order_id,seq,tariff_code,unit,unit_rate,quantity,price,note,measurement_origin)
   values(oid,next_seq,x->>'tariff',rate->>'unit',(rate->>'price_per_m2')::numeric,qty,0,x->>'note','pending') returning id into item_id;
  end if;
  kept:=array_append(kept,item_id);
 end loop;
 new_urgent:=coalesce((flags->>'urgent')::boolean,o.urgent);new_stains:=coalesce((flags->>'stains')::boolean,o.stains);new_pensioner:=coalesce((flags->>'pensioner')::boolean,o.pensioner);
 factor:=1+case when new_urgent then (o.pricing_snapshot#>>'{settings,urgent_pct}')::numeric else 0 end
  +case when new_stains then (o.pricing_snapshot#>>'{settings,stains_pct}')::numeric else 0 end
  +case when new_pensioner then (o.pricing_snapshot#>>'{settings,pensioner_pct}')::numeric else 0 end;
 update public.orders set urgent=new_urgent,stains=new_stains,pensioner=new_pensioner,
  pricing_snapshot=pricing_snapshot||jsonb_build_object('factor',factor,'items_count',(select sum(quantity) from public.order_items where order_id=oid),
   'rates',(select jsonb_agg(jsonb_build_object('code',z.tariff_code,'rate',z.unit_rate,'unit',z.unit) order by z.seq) from public.order_items z where order_id=oid))
 where id=oid;
 result:=jsonb_build_object('order_id',oid,'branch_id',o.branch_id,'items',(select jsonb_agg(to_jsonb(z) order by z.seq) from public.order_items z where order_id=oid));
 insert into public.audit_log(user_id,role,entity,entity_id,action,"before","after",ip) values(u,a.role::text,'order',oid,'pickup_items_saved',previous,result,p_ip);
 insert into public.command_receipts(user_id,key,command,payload,result) values(u,p_key,'pickup.items',payload,result);
 return result;
end $$;
revoke all on function public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet) from public,anon,authenticated;
grant execute on function public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet) to service_role;
-- Only unconfirmed, photo-free draft lines may be removed by the driver RPC.
create or replace function public.crm_pending_item_delete() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;
begin
 select * into o from public.orders where id=old.order_id for update;
 select * into a from public.profiles where id=nullif(current_setting('app.actor_id',true),'')::uuid and active;
 if current_setting('app.pickup_items_edit',true) is distinct from old.order_id::text
  or a.id is null or a.role::text<>'driver' or a.id is distinct from o.pickup_driver_id
  or o.deleted_at is not null or a.branch_id is distinct from o.branch_id
  or o.status<>'pickup_planned' or o.pickup_state<>'pending' or o.pricing_state<>'awaiting_measurements'
  or exists(select 1 from public.order_photos where item_id=old.id) or exists(select 1 from public.item_measurements where item_id=old.id) then
  raise exception using errcode='42501',message='Удалять можно только черновик изделия при заборе';
 end if;return old;
end $$;
create trigger pickup_item_delete_guard before delete on public.order_items for each row execute function public.crm_pending_item_delete();
revoke all on function public.crm_pending_item_delete() from public,anon,authenticated;
grant execute on function public.crm_pending_item_delete() to service_role;
grant delete on public.order_items to service_role;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset')
  and to_regprocedure('public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)') is not null
  and has_function_privilege(current_user,'public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)','execute'),'schema',18)
$$;
commit;
