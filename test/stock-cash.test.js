import {test} from 'node:test';import assert from 'node:assert/strict';
import {database,create,createPriced,advance,call,command,ids} from './helpers/database.js';
const bid='01000000-0000-4000-8000-000000000001';
test('мойка: нехватка материалов откатывает фазу и начисления; успешная приёмка списывает/начисляет ровно один раз',async()=>{
 const db=await database();try{
  const m=await command(db,'material.save',{branch_id:bid,code:'soap',name:'Моющее средство',unit:'л',norm_per_m2:.1,active:true});await command(db,'stock.adjust',{material_id:m.id,quantity:.3,note:'Приход'});
  await command(db,'piece_rate.save',{branch_id:bid,role:'washer',event:'washing',unit:'m2',rate:1000,effective_at:new Date().toISOString()});
  const id=await create(db,{items:[{tariff:'carpet',quantity:1}]});await advance(db,id,'washing');
  await assert.rejects(command(db,'wash.accept',{order_id:id},'washer'),e=>e.code==='55000');assert.equal((await db.query('select wash_phase from orders where id=$1',[id])).rows[0].wash_phase,'acceptance');assert.equal((await db.query('select count(*) from pay_accruals where order_id=$1',[id])).rows[0].count,0);
  await command(db,'stock.adjust',{material_id:m.id,quantity:1,note:'Пополнение'});const k=crypto.randomUUID();await command(db,'wash.accept',{order_id:id},'washer',k);await command(db,'wash.accept',{order_id:id},'washer',k);
  assert.equal(Number((await db.query('select stock from materials where id=$1',[m.id])).rows[0].stock),.7);assert.equal((await db.query('select count(*) from stock_movements where order_id=$1',[id])).rows[0].count,1);assert.equal((await db.query('select amount from pay_accruals where order_id=$1',[id])).rows[0].amount,'6000');
 }finally{await db.close();}
});
test('касса: прежняя оплата driver сохраняется, подтверждение/сверка доступны только admin',async()=>{
 const db=await database();try{
  const id=await createPriced(db);await command(db,'payment.record',{order_id:id,amount:30000,method:'cash'},'driver');
  const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date()),view=await call(db,'crm_operations',['cash',JSON.stringify({date:day}),ids.driver]);assert.equal(view.cash[0].expected,30000);
  await assert.rejects(command(db,'cash.close',{branch_id:bid,driver_id:ids.driver,day,counted:29000,note:'Расхождение'},'driver'),e=>e.code==='42501');
  const close=await command(db,'cash.close',{branch_id:bid,driver_id:ids.driver,day,counted:29000,note:'Расхождение'});assert.equal(close.difference,-1000);await assert.rejects(command(db,'payment.record',{order_id:id,amount:1000,method:'cash'},'driver'),e=>e.code==='55000');
 }finally{await db.close();}
});
test('уведомления: сохранённый шаблон нового этапа, opt-in, lease и защита от чужого завершения',async()=>{
 const db=await database();try{
  const id=await create(db),cid=(await db.query('select client_id from orders where id=$1',[id])).rows[0].client_id;
  await command(db,'client.preferences',{client_id:cid,sms_consent:true,telegram_consent:true,telegram_chat_id:'12345'},'operator');await advance(db,id,'warehouse');
  const items=await call(db,'crm_outbox_claim',[JSON.stringify(['sms','telegram']),50]);assert.ok(items.some(x=>x.order_id===id&&x.channel==='telegram'));const row=items[0];
  assert.equal(await call(db,'crm_outbox_finish',[row.id,crypto.randomUUID(),true,'123',null]),false);assert.equal(await call(db,'crm_outbox_finish',[row.id,row.lease_token,false,null,'PROVIDER_TIMEOUT']),true);
 }finally{await db.close();}
});
