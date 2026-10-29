import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database,call,create,ids,input} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
const branch='01000000-0000-4000-8000-000000000001';
const command=(db,name,data,role='admin',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],null,key]);
const admin=(db,name,data,role='admin',key=randomUUID())=>call(db,'crm_admin_command',['admin.'+name,JSON.stringify(data),ids[role],null,key]);
const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);

test('управление: только admin, повтор запроса не дублирует архив и аудит',async()=>{
 const db=await database();try{
  const b=await command(db,'branch.save',{code:'test_admin',name:'Тестовый'}),target={entity:'branch',id:b.id},key=randomUUID();
  for(const role of ['manager','operator','dispatcher','driver','workshop'])await fails(()=>admin(db,'archive',target,role),'42501');
  const first=await admin(db,'archive',target,'admin',key),audit=(await db.query('select count(*) from audit_log where entity_id=$1',[b.id])).rows[0].count;
  assert.ok(first.archived_at);assert.equal(first.active,false);assert.deepEqual(await admin(db,'archive',target,'admin',key),first);
  assert.equal((await db.query('select count(*) from audit_log where entity_id=$1',[b.id])).rows[0].count,audit);
  await fails(()=>admin(db,'restore',target,'admin',key),'55000');await admin(db,'restore',target);
  assert.equal((await db.query('select active from branches where id=$1',[b.id])).rows[0].active,true);
 }finally{await db.close();}
});

test('управление: филиал меняется по id, архив блокирует новые заказы и защищает текущую работу',async()=>{
 const db=await database();try{
  await fails(()=>admin(db,'archive',{entity:'branch',id:branch}),'55000');
  const b=await command(db,'branch.save',{code:'empty',name:'Пустой'});
  const changed=await admin(db,'update',{entity:'branch',id:b.id,code:'renamed',name:'Переименован',address:'Новый адрес',active:true,workshop_capacity_m2:100,sla_hours:48});
  assert.equal(changed.id,b.id);assert.equal(changed.code,'renamed');assert.equal(changed.address,'Новый адрес');
  const id=await call(db,'create_order_audited',[JSON.stringify({...input,branch_id:b.id}),ids.admin,null]);
  await fails(()=>admin(db,'archive',{entity:'branch',id:b.id}),'55000');await call(db,'cancel_order',[id,ids.admin,'other','Тест',0,0,null]);
  await admin(db,'archive',{entity:'branch',id:b.id});await fails(()=>call(db,'create_order_audited',[JSON.stringify({...input,branch_id:b.id}),ids.admin,null]),'23514');
  await fails(()=>command(db,'branch.save',{code:'renamed',name:'Обход',active:true}),'55000');
  await admin(db,'restore',{entity:'branch',id:b.id});assert.equal((await db.query('select status from orders where id=$1',[id])).rows[0].status,'cancelled');
 }finally{await db.close();}
});

test('управление: сотрудник теряет доступ, восстанавливается неактивным; последнего admin и назначенного водителя удалить нельзя',async()=>{
 const db=await database();try{
  await fails(()=>admin(db,'archive',{entity:'staff',id:ids.admin}),'55000');
  const id=await create(db);await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);
  await fails(()=>admin(db,'archive',{entity:'staff',id:ids.driver}),'55000');
  await admin(db,'archive',{entity:'staff',id:ids.operator});
  await fails(()=>create(db),'42501');await fails(()=>command(db,'staff.update',{user_id:ids.operator,full_name:'Оператор',role:'operator',active:true,branch_id:branch}),'55000');
  const restored=await admin(db,'restore',{entity:'staff',id:ids.operator});assert.equal(restored.active,false);assert.equal(restored.archived_at,null);
  await command(db,'staff.update',{user_id:ids.operator,full_name:'Оператор',role:'operator',active:true,branch_id:branch});assert.ok(await create(db));
  assert.equal((await db.query('select created_by from orders where id=$1',[id])).rows[0].created_by,ids.operator);
 }finally{await db.close();}
});

test('управление: запись справочника и причина отказа редактируются, архивируются и восстанавливаются',async()=>{
 const db=await database();try{
  const c=await command(db,'catalog.save',{kind:'source',code:'special',name_ru:'Источник'});
  const changed=await admin(db,'update',{entity:'catalog',id:c.id,kind:'source',code:'special',branch_id:branch,name_ru:'Изменён',active:true});assert.equal(changed.id,c.id);
  const id=await create(db,{source:'special'});await admin(db,'archive',{entity:'catalog',id:c.id});await fails(()=>create(db,{source:'special'}),'23514');
  await fails(()=>command(db,'catalog.save',{kind:'source',code:'special',name_ru:'Обход',active:true}),'55000');
  await admin(db,'restore',{entity:'catalog',id:c.id});assert.ok(await create(db,{source:'special'}));assert.equal((await db.query('select source from orders where id=$1',[id])).rows[0].source,'special');
  await fails(()=>admin(db,'update',{entity:'catalog',id:c.id,kind:'source',code:'changed',branch_id:branch,name_ru:'Нет',active:true}),'23514');
  await admin(db,'update',{entity:'reason',code:'other',name_ru:'Другая причина',active:true});await admin(db,'archive',{entity:'reason',code:'other'});
  await fails(()=>call(db,'cancel_order',[id,ids.admin,'other','Причина',0,0,null]),'23514');await admin(db,'restore',{entity:'reason',code:'other'});
  await call(db,'cancel_order',[id,ids.admin,'other','Причина',0,0,null]);
 }finally{await db.close();}
});

test('управление: архив тарифа действует только в выбранном филиале и блокирует будущие версии, цена старого заказа сохраняется',async()=>{
 const db=await database();try{
  const id=await create(db),original=(await db.query('select total from orders where id=$1',[id])).rows[0].total;
  const b=await command(db,'branch.save',{code:'tariff_branch',name:'Другой'});
  await command(db,'tariff.schedule',{branch_id:branch,code:'wool',name:'Новая шерсть',price_per_m2:35000,active:true,effective_at:new Date().toISOString()});
  const meta=await call(db,'crm_workspace',['bootstrap','{}',ids.operator]);assert.equal(meta.tariffs.find(t=>t.code==='wool').name,'Новая шерсть');
  await command(db,'tariff.schedule',{branch_id:branch,code:'wool',name:'Будущий',price_per_m2:45000,active:true,effective_at:new Date(Date.now()+7200000).toISOString()});
  await admin(db,'archive',{entity:'tariff',code:'wool',branch_id:branch});await fails(()=>create(db),'23514');
  assert.equal(await call(db,'crm_rate',['wool',branch,new Date(Date.now()+10800000).toISOString()]),null);
  assert.equal((await call(db,'crm_quote',[JSON.stringify({...input,branch_id:b.id}),ids.admin,null])).total,180000);
  await admin(db,'restore',{entity:'tariff',code:'wool',branch_id:branch});assert.equal((await call(db,'crm_quote',[JSON.stringify(input),ids.operator,null])).total,210000);
  assert.equal((await db.query('select total from orders where id=$1',[id])).rows[0].total,original);
 }finally{await db.close();}
});

test('управление: шаблон изменяется по id, архив не удаляет историю',async()=>{
 const db=await database();try{
  const t=await command(db,'template.save',{code:'ready_test',channel:'sms',locale:'ru',body:'Готово',active:true});
  const changed=await admin(db,'update',{entity:'template',id:t.id,branch_id:branch,code:'ready_test',channel:'sms',locale:'ru',body:'Ваш заказ готов',active:true});assert.equal(changed.id,t.id);
  await admin(db,'archive',{entity:'template',id:t.id});assert.equal((await db.query('select body,active from notification_templates where id=$1',[t.id])).rows[0].active,false);
  await admin(db,'restore',{entity:'template',id:t.id});assert.equal((await db.query('select body from notification_templates where id=$1',[t.id])).rows[0].body,'Ваш заказ готов');
  assert.ok(Number((await db.query('select count(*) from audit_log where entity_id=$1',[t.id])).rows[0].count)>=4);
  assert.equal((await db.query("select has_table_privilege('anon','tariff_controls','select') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('HTTP управление: роли/валидация проверяются сервером, удалённый сотрудник не входит с прежним токеном',async()=>{
 const fixture=await workflowServer();try{
  const request=(role,path,body)=>fetch(fixture.url+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+role,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('operator','/actions/admin.archive',{entity:'staff',id:ids.manager})).status,403);
  assert.equal((await request('admin','/actions/admin.archive',{entity:'staff',id:ids.operator,active:true})).status,400);
  assert.equal((await request('admin','/actions/admin.archive',{entity:'staff',id:ids.operator})).status,200);
  assert.equal((await request('operator','/me')).status,403);
  assert.equal((await request('admin','/actions/admin.restore',{entity:'staff',id:ids.operator})).status,200);
  assert.equal((await request('operator','/me')).status,403);
 }finally{await fixture.close();}
});
