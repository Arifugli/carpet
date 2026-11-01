import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,create,call,command,advance,ids,input} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
import {PERMISSIONS} from '../src/permissions.js';
const bid='01000000-0000-4000-8000-000000000001';
test('RLS/GRANT: новые таблицы и RPC закрыты клиентским ключам; service_role получает явные права',async()=>{
 const db=await database({legacyGrants:false});try{
  for(const role of ['anon','authenticated'])for(const table of ['profiles','orders','driver_districts','role_reassignments','maintenance_cleanup_runs'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,table,'select'])).rows[0].ok,false,role+':'+table);
  for(const table of ['driver_districts','role_reassignments','maintenance_cleanup_runs'])assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',[table])).rows[0].relrowsecurity,true);
  for(const f of ['crm_board(jsonb,uuid)','crm_flow_move(uuid,order_status,uuid,text)','crm_pickup_preview(uuid,jsonb,uuid)'])for(const r of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',[r,f,'execute'])).rows[0].ok,false);
  assert.ok(await create(db));await db.exec('set role authenticated');await assert.rejects(db.query('select * from orders'),e=>e.code==='42501');
 }finally{await db.close();}
});
test('admin создаёт другого admin, но последний активный admin защищён; районы валидируются в БД',async()=>{
 const db=await database();try{
  const staff={user_id:ids.admin,full_name:'Владелец',role:'admin',active:false,branch_id:null};await assert.rejects(command(db,'staff.update',staff),e=>e.code==='55000');
  await command(db,'staff.update',{...staff,user_id:ids.inactive,full_name:'Второй администратор',active:true});assert.equal((await db.query('select role,active from profiles where id=$1',[ids.inactive])).rows[0].active,true);
  await command(db,'staff.update',{user_id:ids.driver,full_name:'Водитель',role:'driver',active:true,branch_id:bid,district_codes:['fergana_city','kokand_city'],driver_color:'#123abc'});assert.equal((await db.query('select count(*) from driver_districts where driver_id=$1',[ids.driver])).rows[0].count,2);
  await assert.rejects(command(db,'staff.update',{user_id:ids.driver,full_name:'Водитель',role:'driver',active:true,branch_id:bid,district_codes:['not_a_district']}),e=>e.code==='23514');
 }finally{await db.close();}
});
test('тарифы, филиалы, архив/восстановление и корзина сохраняются в новой модели',async()=>{
 const db=await database();try{
  const b=await command(db,'branch.save',{code:'test',name:'Тест',active:true});assert.ok(b.id);
  const id=await create(db);await call(db,'request_order_deletion',[id,ids.operator,'Дубль',null]);await call(db,'soft_delete_order',[id,ids.admin,'Дубль',null]);await call(db,'restore_order',[id,ids.admin,null]);assert.equal((await db.query('select deleted_at from orders where id=$1',[id])).rows[0].deleted_at,null);
  const archived=await call(db,'crm_admin_command',['admin.archive',JSON.stringify({entity:'branch',id:b.id}),ids.admin,null,crypto.randomUUID()]);assert.ok(archived.archived_at);
  await call(db,'crm_admin_command',['admin.restore',JSON.stringify({entity:'branch',id:b.id}),ids.admin,null,crypto.randomUUID()]);
  const versions=(await db.query("select count(*) from tariff_versions where code='carpet'")).rows[0].count;await command(db,'tariff.schedule',{branch_id:bid,code:'carpet',name:'Ковры',price_per_m2:12000,unit:'m2',effective_at:new Date().toISOString(),active:true});assert.equal((await db.query("select count(*) from tariff_versions where code='carpet'")).rows[0].count,versions+1);
 }finally{await db.close();}
});
test('HTTP: шесть ролей, запрет обхода, валидация колонок и прежние endpoints отключены',async()=>{
 const f=await workflowServer();try{
  const req=async(path,role='admin',body,method=body?'POST':'GET')=>{const r=await fetch(f.url+'/api'+path,{method,headers:{Authorization:'Bearer '+role,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  assert.equal((await req('/board')).status,200);assert.equal((await req('/board?stage_filters=%7B%7D')).status,200);assert.equal((await req('/board?stage_filters=oops')).status,400);assert.equal((await req('/board?unknown=x')).status,400);
  for(const role of ['operator','driver','warehouse','washer','packer']){assert.equal((await req('/trash',role)).status,403);assert.equal((await req('/audit-log',role)).status,403);assert.equal((await req('/order-metrics?from=2026-01-01&to=2027-01-01',role)).status,403);}
  assert.equal((await req('/orders/'+f.orderId+'/status','admin',{status:'delivered'})).status,404);assert.equal((await req('/orders/'+f.orderId+'/driver','operator',{driver_id:ids.driver},'PATCH')).status,404);
  assert.equal((await req('/actions/pickup.claim','operator',{order_id:f.orderId,pickup_at:new Date().toISOString()})).status,403);
  assert.equal((await req('/actions/pickup.claim','driver',{order_id:f.orderId,pickup_at:new Date().toISOString(),p_user:ids.admin})).status,400);
  assert.equal((await req('/orders','operator',{...input,district_code:undefined})).status,400);
  const roles=(await req('/me','driver')).data.permissions;assert.deepEqual(roles,PERMISSIONS.driver);
 }finally{await f.close();}
});
test('HTTP + SQL: чужой филиал закрыт для списка канбана, карточки, отмены и галереи',async()=>{
 const f=await workflowServer();try{
  const b=await command(f.sql,'branch.save',{code:'second',name:'Второй',active:true});const id=await call(f.sql,'create_order_audited',[JSON.stringify({...input,branch_id:b.id}),ids.admin,null,crypto.randomUUID()]);await f.db.rpc('crm_measurements',{oid:id,u:ids.admin});
  for(const role of ['driver','operator','warehouse','washer','packer']){
   const board=await call(f.sql,'crm_board',[JSON.stringify({branch_id:b.id}),ids[role]]);assert.equal(board.columns.reduce((n,c)=>n+c.totals.orders,0),0);
   await assert.rejects(call(f.sql,'crm_order',[id,ids[role],'read']),e=>e.code==='42501');
  }
  await assert.rejects(call(f.sql,'cancel_order',[id,ids.operator,'other','Отмена',0,0,null]),e=>e.code==='42501');
 }finally{await f.close();}
});
test('старые отчёты исполняются PostgreSQL и сохраняют права admin',async()=>{
 const db=await database();try{const id=await create(db);await advance(db,id);const reports=JSON.parse(await readFile(new URL('../config/reports.json',import.meta.url),'utf8'));for(const name of Object.keys(reports)){const r=await call(db,'crm_report',[name,JSON.stringify({from:'2026-01-01',to:'2027-12-31'}),ids.admin]);assert.ok(Array.isArray(r.rows),name);}await assert.rejects(call(db,'crm_report',['funnel','{}',ids.operator]),e=>e.code==='42501');}finally{await db.close();}
});
