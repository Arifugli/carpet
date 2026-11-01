-- Pricing correction: disable the inherited default delivery surcharge.
-- Run explicitly after 0016. Existing agreed prices and tariff versions are preserved.
begin;
lock table public.settings,public.setting_versions,public.orders in share row exclusive mode;
do $$
declare previous_fee numeric;changed_orders integer;new_version uuid;
begin
 if exists(select 1 from public.audit_log where entity='settings' and action='default_delivery_fee_disabled') then
  raise notice 'Delivery pricing correction already applied';return;
 end if;
 perform set_config('app.actor_id','',true);
 perform set_config('app.actor_role','system',true);
 perform set_config('app.actor_ip','',true);
 select value into strict previous_fee from public.settings where key='delivery_fee';
 update public.settings set value=0 where key='delivery_fee';
 -- Append a version: crm_setting() reads setting_versions, not the legacy settings row.
 insert into public.setting_versions(key,value,branch_id,effective_at)
 values('delivery_fee',0,null,clock_timestamp()) returning id into new_version;
 -- Pending orders already contain a frozen settings snapshot; refresh only this field.
 -- Never reprice collected orders or touch their quotes, payments, tariffs or modifiers.
 update public.orders set pricing_snapshot=jsonb_set(pricing_snapshot,'{settings,delivery_fee}','0'::jsonb)
 where pricing_state='awaiting_measurements' and pickup_state='pending'
  and status in ('new','pickup_planned') and deleted_at is null
  and coalesce((pricing_snapshot#>>'{settings,delivery_fee}')::numeric,0)<>0;
 get diagnostics changed_orders=row_count;
 insert into public.audit_log(role,entity,entity_id,action,"before","after")
 values('system','settings',md5('settings:delivery_fee')::uuid,'default_delivery_fee_disabled',
  jsonb_build_object('delivery_fee',previous_fee),
  jsonb_build_object('delivery_fee',0,'pending_orders_updated',changed_orders,'setting_version_id',new_version,
   'reason','Убрать автоматическую доплату за доставку из стоимости услуги','migration','0017'));
end $$;
commit;
