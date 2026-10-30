begin;
-- Только заказы, оставшиеся на прежнем этапе received без новой передачи.
create or replace function public.crm_workshop_recoverable(oid uuid) returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.orders o where o.id=oid and o.deleted_at is null and o.measurement_mode='verified' and o.status='received' and o.pickup_state='picked_up'
  and o.washing_started_at is null and o.driver_measurement_closed_at is null
  and not exists(select 1 from public.pickup_events e where e.order_id=o.id)
  and not exists(select 1 from public.item_measurements m join public.order_items i on i.id=m.item_id where i.order_id=o.id and m.source_role='workshop'))
$$;
create or replace function public.crm_workshop_intake(oid uuid,u uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;can_measure boolean;recovery boolean;accepted boolean;complete boolean;
begin
 o:=public.crm_order(oid,u);a:=public.crm_require(u,'read',o.branch_id);recovery:=public.crm_workshop_recoverable(o.id);
 accepted:=o.pickup_state='accepted';can_measure:=a.role::text='workshop' and accepted and o.status='received' and o.washing_started_at is null;
 complete:=exists(select 1 from public.order_items where order_id=o.id) and not exists(select 1 from public.order_items where order_id=o.id and measurement_origin<>'workshop');
 return jsonb_build_object('can_measure',can_measure,'can_recover',a.role::text in ('workshop','admin') and recovery,
  'can_accept',a.role::text in ('workshop','admin') and o.pickup_state='handed_over' and o.status in ('pickup_assigned','received') and o.washing_started_at is null,
  'accepted',accepted,'can_advance',case when o.status='received' then accepted and complete and o.pricing_state='priced' else o.status in ('washing','drying') end,
  'recovery_pricing',o.pricing_snapshot->>'price_basis'='workshop_recovery',
  'blocked_reason',case when o.washing_started_at is not null then 'Замеры закрыты после начала стирки' when not accepted then 'Сначала подтвердите приём изделий кнопкой «Принял»' when not complete then 'Введите размеры и подтвердите количество всех изделий' when o.pricing_state<>'priced' then 'Стоимость заказа ещё не определена' else null end);
end $$;
create or replace function public.crm_reprice_workshop_recovery(oid uuid) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;sub numeric;area numeric;pending boolean;total_price numeric;fee numeric;s jsonb;
begin
 select * into o from public.orders where id=oid for update;
 if o.pricing_state<>'awaiting_measurements' or o.pricing_snapshot->>'price_basis' is distinct from 'workshop_recovery' then return;end if;
 s:=o.pricing_snapshot->'settings';
 select coalesce(sum(price),0),coalesce(sum(area_m2),0),coalesce(bool_or(unit='m2' and measurement_origin<>'workshop'),false) into sub,area,pending from public.order_items where order_id=oid;
 total_price:=round(sub*(o.pricing_snapshot->>'factor')::numeric,-3);fee:=case when sub>0 and sub<(s->>'free_delivery_from')::numeric then (s->>'delivery_fee')::numeric else 0 end;
 update public.orders set subtotal=sub,adjustment=total_price-sub,delivery_fee=case when pending then 0 else fee end,total=case when pending then 0 else total_price+fee end,
  pricing_state=case when pending then 'awaiting_measurements' else 'priced' end,
  pricing_snapshot=pricing_snapshot||jsonb_build_object('subtotal',sub,'area_m2',area,'adjustment',total_price-sub,'delivery_fee',case when pending then 0 else fee end,'total',case when pending then null else total_price+fee end,'pending_measurements',pending,'workshop_recovered_at',clock_timestamp()) where id=oid;
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
  if o.pricing_state='awaiting_measurements' and o.pricing_snapshot->>'price_basis'='workshop_recovery' then
   if o.payment_recorded_at is not null or o.paid_amount>0 or exists(select 1 from public.payments where order_id=o.id and state in ('confirmed','pending')) or exists(select 1 from public.order_discounts where order_id=o.id) then raise exception using errcode='55000',message='Нельзя пересчитать прежний заказ после оплаты или скидки';end if;
   update public.order_items set price=case when unit='piece' then unit_rate else round(l*w*unit_rate) end where id=i.id;
   perform public.crm_reprice_workshop_recovery(o.id);
  end if;
 end if;
 return to_jsonb(m);
end $$;
do $$begin if to_regprocedure('public.crm_command_v12(text,jsonb,uuid,inet,uuid)') is null then alter function public.crm_command(text,jsonb,uuid,inet,uuid) rename to crm_command_v12;end if;end $$;
create or replace function public.crm_command(p_command text,p_data jsonb,p_user uuid,p_ip inet default null,p_key uuid default null) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.orders;a public.profiles;r public.command_receipts;result jsonb;
begin
 if p_command<>'workshop.recover' then return public.crm_command_v12(p_command,p_data,p_user,p_ip,p_key);end if;
 perform public.lifecycle_actor(p_user,p_ip);a:=public.crm_require(p_user,'workshop');
 if a.role::text not in ('workshop','admin') then raise exception using errcode='42501',message='Приём подтверждает сотрудник цеха';end if;
 if p_key is null then raise exception using errcode='23514',message='Требуется ключ повторного запроса';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_key::text,0));select * into r from public.command_receipts where user_id=p_user and key=p_key;
 if found then if r.command<>p_command or r.payload is distinct from p_data then raise exception using errcode='55000',message='Ключ уже использован для другого действия';end if;return r.result;end if;
 o:=public.crm_order((p_data->>'order_id')::uuid,p_user,'workshop');
 if o.pickup_state is distinct from p_data->>'expected_state' or not public.crm_workshop_recoverable(o.id) then raise exception using errcode='55000',message='Этот заказ не требует восстановления приёмки. Обновите карточку';end if;
 update public.orders set pickup_state='accepted',workshop_accepted_at=clock_timestamp(),workshop_accepted_by=p_user,driver_measurement_closed_at=clock_timestamp(),
  pricing_snapshot=pricing_snapshot||jsonb_build_object('workshop_intake_recovery',true)||case when pricing_state='awaiting_measurements' then jsonb_build_object('price_basis','workshop_recovery') else '{}'::jsonb end where id=o.id returning * into o;
 insert into public.pickup_events(order_id,event,actor_id,snapshot) values(o.id,'accepted',p_user,jsonb_build_object('recovery',true,'missing_driver_quote',o.pricing_state='awaiting_measurements','note','Сотрудник подтвердил фактический приём заказа из прежней версии CRM'));
 result:=to_jsonb(o);insert into public.command_receipts(user_id,key,command,payload,result) values(p_user,p_key,p_command,p_data,result);return result;
end $$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',to_regprocedure('public.crm_workshop_intake(uuid,uuid)') is not null and has_table_privilege(current_user,'public.pickup_events','insert'),'schema',13)
$$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('crm_workshop_recoverable','crm_workshop_intake','crm_reprice_workshop_recovery','crm_measure_item','crm_command','crm_command_v12','crm_ready') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';
commit;
