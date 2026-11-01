-- DESTRUCTIVE, ONCE ONLY. Stop API/worker writes; verify DB and private Storage backups first.
-- Apply only after 0014 COMMIT and 0015 COMMIT. Never run from application startup.
begin;
lock table public.orders in access exclusive mode;
do $$declare preview jsonb;counts jsonb;manifest jsonb;guard_record record;sequence_name text;begin
 if exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset') then raise notice 'Cleanup already completed; no rows removed';return;end if;
 -- All order dependencies are known explicitly. An unexpected FK fails closed instead of cascading into a new table.
 if exists(select 1 from pg_constraint c where c.contype='f' and c.confrelid='public.orders'::regclass and c.conrelid::regclass::text not in ('order_items','status_history','visits','payments','order_defects','complaints','feedback','order_creation_keys','production_events','tasks','leads','calls','integration_outbox','stock_movements','order_discounts','payment_intents','intake_acts','rewash_jobs','compensations','pay_accruals','pickup_events')) then raise exception 'Unexpected FK referencing orders; review cleanup manifest';end if;
 with related_ids as (select id from public.orders union all select id from public.order_items union all select id from public.order_photos union all select id from public.visits union all select id from public.payments union all select id from public.payment_intents union all select id from public.intake_acts union all select id from public.complaints union all select id from public.rewash_jobs union all select id from public.compensations union all select id from public.order_discounts union all select id from public.pay_accruals union all select id from public.pickup_events union all select id from public.item_measurements union all select id from public.production_events)
select jsonb_build_object('counts',jsonb_build_object('visit_events',(select count(*) from public.visit_events),'visits',(select count(*) from public.visits),'order_defects',(select count(*) from public.order_defects),'item_measurements',(select count(*) from public.item_measurements),'order_photos',(select count(*) from public.order_photos),'pickup_events',(select count(*) from public.pickup_events),'status_history',(select count(*) from public.status_history),'production_events',(select count(*) from public.production_events),'payments',(select count(*) from public.payments),'payment_intents',(select count(*) from public.payment_intents),'intake_acts',(select count(*) from public.intake_acts),'rewash_jobs',(select count(*) from public.rewash_jobs),'compensations',(select count(*) from public.compensations),'complaints',(select count(*) from public.complaints),'feedback',(select count(*) from public.feedback),'order_discounts',(select count(*) from public.order_discounts),'pay_accruals',(select count(*) from public.pay_accruals),'order_creation_keys',(select count(*) from public.order_creation_keys),'order_items',(select count(*) from public.order_items),'orders',(select count(*) from public.orders),'cash_closings',(select count(*) from public.cash_closings),'system_jobs',(select count(*) from public.system_jobs),'tasks',(select count(*) from public.tasks where order_id is not null),'leads',(select count(*) from public.leads where order_id is not null),'integration_outbox',(select count(*) from public.integration_outbox where order_id is not null),'stock_movements',(select count(*) from public.stock_movements where order_id is not null),'calls_detached',(select count(*) from public.calls where order_id is not null),'command_receipts',(select count(*) from public.command_receipts r where exists(select 1 from related_ids i where position(i.id::text in (r.payload::text||r.result::text))>0))),'storage_manifest',(select coalesce(jsonb_agg(jsonb_build_object('path',storage_path)),'[]') from public.order_photos),'retired_staff',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'role',role,'active',active)),'[]') from public.profiles where role::text not in ('operator','driver','warehouse','washer','packer','admin')),'audit_preserved',(select count(*) from public.audit_log)) into preview;
 counts:=preview->'counts';manifest:=preview->'storage_manifest';
 -- Save exact trigger states; only delete guards on order data are relaxed. audit_log is never touched.
 create temporary table cleanup_guard_states on commit drop as
 select t.tgrelid,t.tgname,t.tgenabled from pg_trigger t join pg_proc f on f.oid=t.tgfoid where not t.tgisinternal and t.tgrelid<>'public.audit_log'::regclass and f.proname in ('reject_destructive_mutation','crm_measurement_immutable','crm_pickup_immutable') and t.tgrelid in ('public.orders'::regclass,'public.item_measurements'::regclass,'public.pickup_events'::regclass);
 for guard_record in select * from cleanup_guard_states loop execute format('alter table %s disable trigger %I',guard_record.tgrelid::regclass,guard_record.tgname);end loop;
with related_ids as (select id from public.orders union all select id from public.order_items union all select id from public.order_photos union all select id from public.visits union all select id from public.payments union all select id from public.payment_intents union all select id from public.intake_acts union all select id from public.complaints union all select id from public.rewash_jobs union all select id from public.compensations union all select id from public.order_discounts union all select id from public.pay_accruals union all select id from public.pickup_events union all select id from public.item_measurements union all select id from public.production_events)
delete from public.command_receipts r where exists(select 1 from related_ids i where position(i.id::text in (r.payload::text||r.result::text))>0);
update public.calls set order_id=null where order_id is not null;
-- Reset only usage represented by the order discount rows being removed.
update public.discount_rules r set uses=greatest(uses-(select count(*) from public.order_discounts d where d.rule_id=r.id),0);
delete from public.visit_events;
delete from public.rewash_jobs;
delete from public.compensations;
delete from public.order_defects;
delete from public.item_measurements;
delete from public.order_photos;
delete from public.pickup_events;
delete from public.status_history;
delete from public.production_events;
delete from public.payments;
delete from public.payment_intents;
delete from public.intake_acts;
delete from public.feedback;
delete from public.order_discounts;
delete from public.pay_accruals;
delete from public.order_creation_keys;
delete from public.complaints;
delete from public.visits;
delete from public.tasks where order_id is not null;
delete from public.leads where order_id is not null;
delete from public.integration_outbox where order_id is not null;
delete from public.stock_movements where order_id is not null;
delete from public.order_items;
delete from public.orders;
delete from public.cash_closings;
delete from public.system_jobs;
-- Preserve the actual material balance. Rebase removed order movements into an independent opening entry.
 insert into public.stock_movements(material_id,quantity,source,note)
 select m.id,m.stock-coalesce(s.quantity,0),'workflow_v2_opening','Остаток при переходе на новый процесс' from public.materials m left join lateral(select sum(quantity) quantity from public.stock_movements where material_id=m.id)s on true where m.stock<>coalesce(s.quantity,0);
 -- Client order aggregates are query-derived in schema 0013: no stored counters/FKs need resetting.
 for guard_record in select * from cleanup_guard_states loop
  execute format('alter table %s %s trigger %I',guard_record.tgrelid::regclass,case guard_record.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,guard_record.tgname);
 end loop;
 -- ALTER SEQUENCE RESTART is transactional, unlike setval; a rollback preserves the old sequence.
 sequence_name:=pg_get_serial_sequence('public.orders','number');execute format('alter sequence %s restart with 1',sequence_name);
 alter table public.orders validate constraint current_workflow_status;
 alter table public.item_measurements validate constraint measurement_roles;
 alter table public.order_items validate constraint measurement_origin_roles;
 insert into public.maintenance_cleanup_runs(key,counts,storage_manifest) values('workflow_v2_reset',counts,manifest);
 insert into public.audit_log(user_id,role,entity,entity_id,action,"after") values(null,'maintenance','maintenance',gen_random_uuid(),'legacy_orders_cleared',jsonb_build_object('event','очистка старых заказов','counts',counts,'storage_files',jsonb_array_length(manifest)));
end $$;
notify pgrst,'reload schema';
commit;
