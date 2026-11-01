import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database as legacyDatabase,create as createLegacy,ids as oldIds} from './helpers/legacy-database.js';
import {call,ids} from './helpers/database.js';
import {cleanupStorage,parseManifest} from '../scripts/cleanup-storage.mjs';
const sql=async n=>readFile(new URL('../supabase/migrations/'+n,import.meta.url),'utf8');
test('очистка старой модели: все зависимости, сохранение клиентов/настроек/аудита, перезапуск номеров и повтор безопасен',async()=>{
 const db=await legacyDatabase({through:'0013_workshop_intake.sql'});try{
  const id=await createLegacy(db),item=(await db.query('select id from order_items where order_id=$1',[id])).rows[0].id;
  const path=`${id}/${item}/${crypto.randomUUID()}.jpg`;await db.query('insert into order_photos(item_id,storage_path) values($1,$2)',[item,path]);
  await db.query("insert into item_measurements(item_id,source_role,length_m,width_m,measured_by,measured_name) values($1,'driver',3,2,$2,'Водитель')",[item,ids.driver]);
  await db.query("insert into pickup_events(order_id,event,actor_id) values($1,'collected',$2)",[id,ids.driver]);
  await db.query("insert into tasks(branch_id,title,due_at,assigned_to,order_id) values('01000000-0000-4000-8000-000000000001','Задача заказа',now(),$1,$2)",[ids.operator,id]);
  await db.query("insert into calls(branch_id,phone,direction,outcome,order_id) values('01000000-0000-4000-8000-000000000001','+998901234567','in','answered',$1)",[id]);
  const material=crypto.randomUUID();await db.query("insert into materials(id,branch_id,code,name,unit,norm_per_m2,stock) values($1,'01000000-0000-4000-8000-000000000001','test','Материал','л',.1,1)",[material]);await db.query("insert into stock_movements(material_id,quantity,source) values($1,2,'adjust:test')",[material]);await db.query("insert into stock_movements(material_id,order_id,quantity,source) values($1,$2,-1,'washing:test')",[material,id]);
  const before=(await db.query('select id,"before","after",at from audit_log order by id')).rows,clients=(await db.query('select id from clients')).rows;
  await db.exec('reset role');await db.exec(await sql('0014_workflow_enums.sql'));await db.exec(await sql('0015_order_workflow.sql'));await db.exec(await sql('0016_clear_legacy_orders.sql'));
  for(const table of ['orders','order_items','order_photos','item_measurements','pickup_events','status_history','tasks','order_creation_keys'])assert.equal((await db.query('select count(*) from '+table)).rows[0].count,0,table);
  assert.deepEqual((await db.query('select id,"before","after",at from audit_log order by id limit $1',[before.length])).rows,before);assert.deepEqual((await db.query('select id from clients')).rows,clients);
  assert.equal((await db.query('select order_id from calls')).rows[0].order_id,null);assert.equal((await db.query('select count(*) from auth.users')).rows[0].count,Object.keys(oldIds).length);
  assert.equal(Number((await db.query('select stock from materials where id=$1',[material])).rows[0].stock),1);assert.equal(Number((await db.query('select sum(quantity) n from stock_movements where material_id=$1',[material])).rows[0].n),1);
  const run=(await db.query('select * from maintenance_cleanup_runs')).rows[0];assert.equal(run.counts.orders,1);assert.equal(run.storage_manifest[0].path,path);
  assert.equal((await db.query("select count(*) from role_reassignments")).rows[0].count,3);assert.equal((await db.query("select count(*) from profiles where active and role::text not in ('admin','driver','operator','warehouse','washer','packer')")).rows[0].count,0);
  const events=(await db.query("select count(*) from audit_log where action='legacy_orders_cleared'")).rows[0].count;await db.exec(await sql('0016_clear_legacy_orders.sql'));assert.equal((await db.query("select count(*) from audit_log where action='legacy_orders_cleared'")).rows[0].count,events);
  const seq=(await db.query("select pg_get_serial_sequence('orders','number') seq")).rows[0].seq;assert.equal((await db.query('select nextval($1)',[seq])).rows[0].nextval,1);
  await db.exec('set role service_role');await assert.rejects(db.query('delete from orders'),e=>e.code==='42501');await assert.rejects(db.query('delete from item_measurements'),e=>e.code==='42501');await assert.rejects(db.query('delete from pickup_events'),e=>e.code==='42501');await db.exec('reset role');
  await assert.rejects(db.query('update audit_log set action=action'),e=>e.code==='42501');await assert.rejects(db.query('delete from audit_log'),e=>e.code==='42501');await assert.rejects(db.query('truncate audit_log'),e=>e.code==='42501');
 }finally{await db.close();}
});
test('после ошибочной очистки транзакция восстанавливает запреты удаления',async()=>{
 const db=await legacyDatabase({through:'0014_workflow_enums.sql'});try{await db.exec('reset role');await db.exec(await sql('0015_order_workflow.sql'));
  const bad=(await sql('0016_clear_legacy_orders.sql')).replace('delete from public.orders;','delete from public.orders; select 1/0;');await assert.rejects(db.exec(bad));await db.exec('rollback');await assert.rejects(db.query('delete from orders'),e=>e.code==='42501');assert.equal((await db.query('select count(*) from maintenance_cleanup_runs')).rows[0].count,0);
 }finally{await db.close();}
});
test('Storage: dry-run не обращается к удалению; явное подтверждение ограничено манифестом и текущими ссылками',async()=>{
 const path=Array.from({length:3},()=>crypto.randomUUID()).join('/')+'.jpg';let calls=0;const storage={remove:async paths=>{calls++;assert.deepEqual(paths,[path]);return {error:null};}};
 assert.equal((await cleanupStorage({manifest:[{path}],storage})).dry_run,true);assert.equal(calls,0);
 await cleanupStorage({manifest:[path],storage,dryRun:false});assert.equal(calls,1);
 await assert.rejects(cleanupStorage({manifest:[path],storage,dryRun:false,livePaths:[path]}),/referenced/);assert.equal(calls,1);assert.throws(()=>parseManifest(['../other.jpg']),/Invalid/);
});
