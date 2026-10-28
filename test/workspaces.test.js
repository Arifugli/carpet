import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {database,call,create,ids,input} from './helpers/database.js';
import {PERMISSIONS} from '../src/permissions.js';
let db;
before(async()=>{db=await database();});
after(async()=>{await db?.close();});
const branch='01000000-0000-4000-8000-000000000001';
const cmd=(name,data,role='admin',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],'127.0.0.1',key]);
const view=(name,filters={},role='admin')=>call(db,'crm_workspace',[name,JSON.stringify(filters),ids[role]]);
const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);

test('этап 2: матрица API совпадает с SQL; менеджер не редактирует рабочие данные',async()=>{
 const rows=(await db.query('select * from role_permissions')).rows;
 assert.deepEqual(Object.fromEntries(rows.map(r=>[r.role,r.permissions])),PERMISSIONS);
 await fails(()=>cmd('lead.save',{phone:input.phone,outcome:'new'},'manager'),'42501');
 await fails(()=>cmd('branch.save',{code:'bad',name:'Нет'},'operator'),'42501');
});
test('этап 2: филиалы изолированы в чтении, цене, отказе и изменении заказа',async()=>{
 const b=await cmd('branch.save',{code:'samarkand',name:'Самарканд'});
 const id=await call(db,'create_order_audited',[JSON.stringify({...input,branch_id:b.id}),ids.admin,null]);
 await fails(()=>view('bootstrap',{branch_id:b.id},'operator'),'42501');
 await fails(()=>call(db,'crm_quote',[JSON.stringify({...input,branch_id:b.id}),ids.operator,null]),'42501');
 await fails(()=>call(db,'cancel_order',[id,ids.operator,'other','Нет доступа',0,0,null]),'42501');
 assert.equal((await db.query('select status from orders where id=$1',[id])).rows[0].status,'new');
});
test('этап 2: обращения, перезвон и адреса; водитель не видит чужие напоминания',async()=>{
 const lead=await cmd('lead.save',{phone:input.phone,name:'Дилноза',outcome:'callback',callback_at:'2026-10-30T10:00:00+05:00',comment:'Перезвонить'},'operator');
 assert.equal(lead.created_by,ids.operator);
 assert.ok((await view('tasks',{},'operator')).data.some(t=>t.title.includes(input.phone)));
 assert.equal((await view('tasks',{},'driver')).data.length,0);
 await fails(()=>cmd('lead.save',{phone:input.phone,outcome:'refused',reason_code:'missing'},'operator'),'23514');
 const id=await create(db),o=(await db.query('select * from orders where id=$1',[id])).rows[0];
 await cmd('client.address',{client_id:o.client_id,address:'Ташкент, второй адрес',label:'Дом'},'operator');
 const c=await view('client',{phone:input.phone},'operator');assert.ok(c.addresses.some(a=>a.label==='Дом'));assert.ok(c.orders.some(x=>x.id===id));
 await cmd('lead.convert',{lead_id:lead.id,order_id:id},'operator');
});
test('этап 2: диспетчер → водитель; повторная доставка действия не дублирует события',async()=>{
 const id=await create(db),v=await cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:'2026-10-30',slot_code:'morning',driver_id:ids.driver},'dispatcher');
 assert.equal((await db.query('select status from orders where id=$1',[id])).rows[0].status,'pickup_assigned');
 const key=randomUUID(),data={visit_id:v.id,event:'departed',expected_state:'planned'};
 await cmd('visit.event',data,'driver',key);await cmd('visit.event',data,'driver',key);
 await fails(()=>cmd('visit.event',{...data,note:'Другие данные'},'driver',key),'55000');
 assert.equal((await db.query("select count(*)::int n from visit_events where visit_id=$1 and event='departed'",[v.id])).rows[0].n,1);
 await cmd('visit.event',{visit_id:v.id,event:'completed',expected_state:'en_route'},'driver');
 assert.equal((await db.query('select status from orders where id=$1',[id])).rows[0].status,'received');
 await fails(()=>cmd('visit.event',{visit_id:v.id,event:'completed',expected_state:'en_route'},'driver'),'55000');
 assert.ok((await view('driver',{date:'2026-10-30'},'driver')).data.some(x=>x.id===v.id));
});
test('этап 2: вместимость окна и перенос с сохранением предыдущего задания',async()=>{
 await cmd('catalog.save',{kind:'slot',code:'small',name_ru:'Тестовое окно',config:{start:'08:00',end:'09:00',capacity:1}});
 const id=await create(db),second=await create(db);
 const v=await cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:'2026-11-01',slot_code:'small',driver_id:ids.driver},'dispatcher');
 await fails(()=>cmd('visit.schedule',{order_id:second,kind:'pickup',scheduled_date:'2026-11-01',slot_code:'small',driver_id:ids.driver},'dispatcher'),'55000');
 await fails(()=>cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:'2026-11-02',slot_code:'small',driver_id:ids.driver},'dispatcher'),'23514');
 await cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:'2026-11-02',slot_code:'small',driver_id:ids.driver,note:'Клиент попросил перенести'},'dispatcher');
 assert.equal((await db.query('select state from visits where id=$1',[v.id])).rows[0].state,'rescheduled');
});
test('этап 2: цех проходит контроль и упаковку; QR не раскрывает чужой филиал',async()=>{
 const id=await create(db);await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);
 await call(db,'change_order_status',[id,'pickup_assigned',ids.admin,null]);await call(db,'change_order_status',[id,'received',ids.driver,null]);
 for(const stage of ['received','washing','drying','quality_check','packing']) {
  if(stage==='drying')await fails(()=>call(db,'change_order_status',[id,'ready',ids.workshop,null]),'23514');
  await cmd('workshop.advance',{order_id:id,expected_stage:stage},'workshop');
 }
 const o=(await db.query('select * from orders where id=$1',[id])).rows[0];assert.equal(o.status,'ready');
 assert.equal((await db.query('select count(*)::int n from production_events where order_id=$1',[id])).rows[0].n,5);
 assert.equal((await view('scan',{label:`K-${o.number}-1`},'workshop')).order_id,id);
 assert.ok((await view('workshop',{},'workshop')).data.every(row=>row.phone===undefined));
});
test('этап 2: наличные, проверка безналичной оплаты, защита от переплаты',async()=>{
 const id=await create(db);await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);
 const p=await cmd('payment.record',{order_id:id,amount:10000,method:'cash'},'driver');assert.equal(p.state,'confirmed');
 const pending=await cmd('payment.record',{order_id:id,amount:5000,method:'terminal'},'driver');assert.equal(pending.state,'pending');
 assert.equal((await db.query('select paid_amount from orders where id=$1',[id])).rows[0].paid_amount,'10000');
 await fails(()=>cmd('payment.confirm',{payment_id:pending.id,confirm:true},'driver'),'42501');
 await cmd('payment.confirm',{payment_id:pending.id,confirm:true},'dispatcher');
 assert.equal((await db.query('select paid_amount from orders where id=$1',[id])).rows[0].paid_amount,'15000');
 await fails(()=>cmd('payment.record',{order_id:id,amount:999999,method:'cash'},'driver'),'23514');
 await fails(()=>call(db,'soft_delete_order',[id,ids.admin,'Нет',null]),'55000');
});
test('этап 2: тарифы вступают в силу по дате, заказ хранит прежнюю цену',async()=>{
 const id=await create(db),original=(await db.query('select total from orders where id=$1',[id])).rows[0].total;
 await cmd('tariff.schedule',{branch_id:branch,code:'wool',name:'Шерсть',price_per_m2:45000,effective_at:new Date(Date.now()+7200000).toISOString()});
 assert.equal((await call(db,'crm_quote',[JSON.stringify(input),ids.operator,null])).total,180000);
 await cmd('tariff.schedule',{branch_id:branch,code:'wool',name:'Шерсть',price_per_m2:35000,effective_at:new Date().toISOString()});
 assert.equal((await call(db,'crm_quote',[JSON.stringify(input),ids.operator,null])).total,210000);
 assert.equal((await db.query('select total from orders where id=$1',[id])).rows[0].total,original);
});
test('этап 2: последний администратор и права управления сотрудниками защищены',async()=>{
 await fails(()=>cmd('staff.update',{user_id:ids.admin,role:'operator',active:false,full_name:'Нет',branch_id:branch}),'55000');
 await fails(()=>cmd('staff.update',{user_id:ids.driver,role:'admin',active:true,full_name:'Нет'},'operator'),'42501');
 await cmd('staff.update',{user_id:ids.driver,role:'driver',active:false,full_name:'Водитель',branch_id:branch});
 await fails(()=>view('driver',{},'driver'),'42501');
 await cmd('staff.update',{user_id:ids.driver,role:'driver',active:true,full_name:'Водитель',branch_id:branch});
});
test('этап 2: новая миграция повторяется без изменения корзины и исходной цены',async()=>{
 const copy=await database({stage:2});try{
 const id=await create(copy);await call(copy,'soft_delete_order',[id,ids.admin,'Тест',null]);
 const original=(await copy.query('select delete_snapshot,total from orders where id=$1',[id])).rows[0];
 await copy.exec('reset role');await copy.exec(await readFile(new URL('../supabase/migrations/0005_workspaces.sql',import.meta.url),'utf8'));await copy.exec('set role service_role');
 const current=(await copy.query('select delete_snapshot,total from orders where id=$1',[id])).rows[0];assert.deepEqual(current,original);
 }finally{await copy.close();}
});
