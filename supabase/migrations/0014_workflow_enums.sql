-- Enum additions commit before migration 0015 uses them. No data is removed here.
alter type public.user_role add value if not exists 'warehouse';
alter type public.user_role add value if not exists 'washer';
alter type public.user_role add value if not exists 'packer';
alter type public.order_status add value if not exists 'pickup_planned';
alter type public.order_status add value if not exists 'warehouse';
alter type public.order_status add value if not exists 'packing';
alter type public.order_status add value if not exists 'ready_for_delivery';
alter type public.order_status add value if not exists 'in_transit';
alter type public.order_status add value if not exists 'postponed';

-- Maintenance is explicitly enabled/disabled by the release operator. The default is open.
-- This also blocks provider callbacks and old API writes while schema/cleanup are being applied.
insert into public.settings(key,value) values('workflow_maintenance',0) on conflict(key) do nothing;
create or replace function public.crm_workflow_maintenance_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.settings where key='workflow_maintenance' and value=1) and current_setting('app.workflow_maintenance',true) is distinct from 'allowed' then raise exception using errcode='57P03',message='CRM обновляется. Повторите действие после завершения обновления.';end if;
 return null;
end $$;
do $$declare t text;begin
 foreach t in array array['orders','order_items','order_photos','item_measurements','status_history','pickup_events','visits','visit_events','payments','payment_intents','intake_acts','order_defects','production_events','tasks','leads','calls','integration_outbox','complaints','feedback','rewash_jobs','compensations','order_discounts','stock_movements','pay_accruals','order_creation_keys'] loop
  execute format('create trigger workflow_maintenance_guard before insert or update or delete on public.%I for each statement execute function public.crm_workflow_maintenance_guard()',t);
 end loop;
end $$;
revoke all on function public.crm_workflow_maintenance_guard() from public,anon,authenticated;
grant execute on function public.crm_workflow_maintenance_guard() to service_role;
