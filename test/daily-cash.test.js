import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,create,advance,command,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
const bid='01000000-0000-4000-8000-000000000001';
const day=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
const view=(db,role='driver',date=day())=>call(db,'crm_cash_day',[JSON.stringify({branch_id:bid,day:date}),ids[role]]);
const act=(db,action,data,role='driver',key=crypto.randomUUID())=>call(db,'crm_cash_command',[action,JSON.stringify(data),ids[role],'127.0.0.1',key]);
async function ready(db,{driver='driver',cash=20000,adminCash=10000,deliver=true}={}){
 const id=await create(db,{items:[{tariff:'blanket',quantity:1}]});await advance(db,id,'collected',{driver});
 if(cash)await command(db,'payment.record',{order_id:id,amount:cash,method:'cash'},driver);
 if(adminCash)await command(db,'payment.record',{order_id:id,amount:adminCash,method:'cash'},'admin');
 if(deliver)await advance(db,id,'delivered',{driver});return id;
}
async function install(db){
 await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/0020_unified_cash.sql',import.meta.url),'utf8'));
 await db.exec('set role service_role');
}
test('касса за день: доставки и фактические наличные разделены, сдача и приём не создают повторную оплату',async()=>{
 const db=await database();try{
  const id=await ready(db);const v=await view(db);assert.equal(v.self.deliveries_count,1);assert.equal(v.self.deliveries_total,30000);assert.equal(v.self.collected,20000);assert.equal(v.self.to_hand,20000);
  assert.equal(v.admin_cash,0);assert.equal((await view(db,'admin')).admin_cash,10000);
  const detail=await call(db,'crm_cash_details',[JSON.stringify({branch_id:bid,day:day(),driver_id:ids.driver}),ids.driver]);assert.equal(detail.deliveries[0].driver_cash,20000);assert.equal(detail.deliveries[0].client_debt,0);
  const key=crypto.randomUUID(),body={branch_id:bid,day:day(),expected_amount:20000};const h=await act(db,'hand_in',body,'driver',key);
  assert.equal((await act(db,'hand_in',body,'driver',key)).id,h.id);assert.equal((await view(db)).self.pending,20000);assert.equal((await view(db)).self.to_hand,0);
  await assert.rejects(act(db,'accept',{handover_id:h.id}),e=>e.code==='42501');
  const accepted=await act(db,'accept',{handover_id:h.id},'admin');assert.equal(accepted.state,'accepted');await act(db,'accept',{handover_id:h.id},'admin');
  const after=await view(db);assert.equal(after.self.accepted,20000);assert.equal(after.self.outstanding,0);
  assert.equal((await db.query('select paid_amount from orders where id=$1',[id])).rows[0].paid_amount,'30000');assert.equal((await db.query('select count(*) from payments')).rows[0].count,2);
  assert.equal((await db.query("select count(*) from audit_log where entity='cash_day_handovers' and entity_id=$1",[h.id])).rows[0].count,2);
 }finally{await db.close();}
});
test('касса: повторная сдача, отказ, отмена, свежие оплаты и защита суммы',async()=>{
 const db=await database();try{
  await ready(db);await assert.rejects(act(db,'hand_in',{branch_id:bid,day:day(),expected_amount:19999}),e=>e.code==='55000');assert.equal((await db.query('select count(*) from cash_day_handovers')).rows[0].count,0);
  const body={branch_id:bid,day:day(),expected_amount:20000};
  const attempts=await Promise.allSettled([act(db,'hand_in',body),act(db,'hand_in',body)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);const h=attempts.find(x=>x.status==='fulfilled').value;
  await act(db,'reject',{handover_id:h.id,reason:'Деньги не получены'},'admin');assert.equal((await view(db)).self.to_hand,20000);
  const retry=await act(db,'hand_in',body);await act(db,'cancel',{handover_id:retry.id});assert.equal((await view(db)).self.to_hand,20000);
  const final=await act(db,'hand_in',body);await act(db,'accept',{handover_id:final.id},'admin');
  await ready(db,{cash:10000,adminCash:20000});const v=await view(db);assert.equal(v.self.deliveries_count,2);assert.equal(v.self.to_hand,10000);assert.equal(v.self.accepted,20000);
  const last=await act(db,'hand_in',{branch_id:bid,day:day(),expected_amount:10000});assert.equal(last.amount,10000);
  await assert.rejects(act(db,'cancel',{handover_id:final.id}),e=>e.code==='55000');
  await assert.rejects(db.query("update cash_day_handovers set amount=1 where id=$1",[last.id]),e=>['42501','55000'].includes(e.code));
 }finally{await db.close();}
});
test('касса: права, филиалы, неактивные сотрудники, закрытые клиентские ключи и неизменяемые наличные',async()=>{
 const db=await database({legacyGrants:false});try{
  const id=await ready(db);
  for(const role of ['operator','warehouse','washer','packer','inactive'])await assert.rejects(view(db,role),e=>e.code==='42501');
  const h=await act(db,'hand_in',{branch_id:bid,day:day(),expected_amount:20000});
  await assert.rejects(act(db,'cancel',{handover_id:h.id},'driver2'),e=>e.code==='42501');
  await assert.rejects(call(db,'crm_cash_details',[JSON.stringify({branch_id:bid,day:day(),driver_id:ids.driver}),ids.driver2]),e=>e.code==='42501');
  await assert.rejects(call(db,'crm_cash_day',[JSON.stringify({branch_id:crypto.randomUUID(),day:day()}),ids.driver]),e=>['42501','23514'].includes(e.code));
  for(const role of ['anon','authenticated']){
   for(const table of ['cash_day_handovers','cash_month_closures','crm_cash_receipts'])assert.equal((await db.query("select has_table_privilege($1,$2,'select') ok",[role,table])).rows[0].ok,false);
   assert.equal((await db.query("select has_function_privilege($1,'public.crm_cash_close_due_months()','execute') ok",[role])).rows[0].ok,false);
  }
  await assert.rejects(db.query('update payments set amount=1 where order_id=$1',[id]),e=>e.code==='55000');
  const another=await create(db,{items:[]});
  await assert.rejects(db.query('update payments set order_id=$1 where order_id=$2',[another,id]),e=>e.code==='55000');
  await assert.rejects(command(db,'cash.close',{branch_id:bid,driver_id:ids.driver,day:day(),counted:20000,note:'Старая форма'}),e=>e.code==='55000');
  assert.equal((await db.query('select relrowsecurity from pg_class where oid=$1::regclass',['cash_day_handovers'])).rows[0].relrowsecurity,true);
 }finally{await db.close();}
});
test('касса: аванс сдаётся в день получения, день по Узбекистану, предоплата администратора не попадает водителю',async()=>{
 const db=await database({cashbook:false});try{
  const id=await ready(db,{deliver:false});await db.query("update payments set created_at=created_at-interval '1 day' where order_id=$1 and received_by=$2",[id,ids.driver]);await advance(db,id);
  const dates=(await db.query("select (now() at time zone 'Asia/Tashkent')::date::text today,((now() at time zone 'Asia/Tashkent')::date-1)::text yesterday")).rows[0];
  await install(db);assert.equal((await view(db,'driver',dates.today)).self.collected,0);assert.equal((await view(db,'driver',dates.yesterday)).self.collected,20000);
  const detail=await call(db,'crm_cash_details',[JSON.stringify({branch_id:bid,day:dates.today,driver_id:ids.driver}),ids.driver]);assert.equal(detail.deliveries[0].driver_cash,0);
  const midnight=await db.query("select crm_cash_day_of('2026-11-02 18:59:59+00') a,crm_cash_day_of('2026-11-02 19:00:00+00') b");assert.equal(new Date(midnight.rows[0].a).toISOString().slice(0,10),'2026-11-02');assert.equal(new Date(midnight.rows[0].b).toISOString().slice(0,10),'2026-11-03');
 }finally{await db.close();}
});
test('касса: итог завершённого месяца неизменяем, повтор безопасен, поздний приём денег не подделывает закрытый отчёт',async()=>{
 const db=await database({cashbook:false});try{
  const id=await ready(db,{cash:20000,adminCash:10000});await db.exec('reset role');
  const m=(await db.query("select (date_trunc('month',now() at time zone 'Asia/Tashkent')-interval '1 month')::date::text m,(date_trunc('month',now() at time zone 'Asia/Tashkent')-interval '1 day')::date::text d")).rows[0];
  await db.exec('alter table status_history disable trigger user');
  await db.query("update status_history set created_at=$1::date::timestamp at time zone 'Asia/Tashkent' where order_id=$2 and status='delivered'",[m.d,id]);
  await db.exec('alter table status_history enable trigger user');
  await db.query("update payments set created_at=$1::date::timestamp at time zone 'Asia/Tashkent' where order_id=$2",[m.d,id]);
  await db.query('update branches set created_at=$1::date where id=$2',[m.m,bid]);await db.exec('set role service_role');await install(db);
  const h=await act(db,'hand_in',{branch_id:bid,day:m.d,expected_amount:20000});
  assert.equal(await call(db,'crm_cash_close_month',[bid,m.m]),true);assert.equal(await call(db,'crm_cash_close_month',[bid,m.m]),false);
  const snap=(await db.query('select snapshot from cash_month_closures where branch_id=$1 and month_start=$2',[bid,m.m])).rows[0].snapshot;assert.equal(snap.rows.find(r=>r.driver_id===ids.driver).accepted,0);
  assert.equal((await db.query('select state from cash_day_handovers where id=$1',[h.id])).rows[0].state,'pending');
  await act(db,'accept',{handover_id:h.id},'admin');
  const month=await call(db,'crm_cash_month',[JSON.stringify({branch_id:bid,month:m.m.slice(0,7)}),ids.driver]);assert.equal(month.closed,true);assert.equal(month.totals.deliveries_count,1);assert.equal(month.totals.collected,20000);assert.equal(month.totals.accepted,20000);assert.equal(month.totals.outstanding,0);
  assert.deepEqual((await db.query('select snapshot from cash_month_closures where branch_id=$1 and month_start=$2',[bid,m.m])).rows[0].snapshot,snap);
  await assert.rejects(db.query("update cash_month_closures set snapshot='{}'"),e=>['42501','55000'].includes(e.code));
  const current=(await db.query("select date_trunc('month',now() at time zone 'Asia/Tashkent')::date::text m")).rows[0].m;await assert.rejects(call(db,'crm_cash_close_month',[bid,current]),e=>e.code==='23514');
  assert.equal((await db.query("select count(*) from audit_log where action='cash_month_closed'")).rows[0].count,1);
  assert.equal((await call(db,'crm_cash_close_due_months',[])).closed,0);
 }finally{await db.close();}
});
test('HTTP: касса доступна только нужным ролям, чужую сдачу нельзя подтвердить, сумма/дата валидируются',async()=>{
 const f=await workflowServer();try{
  const req=async(path,role='driver',body)=>{const r=await fetch(f.url+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+role,...(body?{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const id=await ready(f.sql);await f.db.rpc('crm_ready',{});
  assert.equal((await req('/cash?branch_id='+bid)).status,200);assert.equal((await req('/cash?branch_id='+bid,'operator')).status,403);
  assert.equal((await req('/cash/hand-in','driver',{branch_id:bid,day:day(),expected_amount:20000,driver_id:ids.driver2})).status,400);
  const h=await req('/cash/hand-in','driver',{branch_id:bid,day:day(),expected_amount:20000});assert.equal(h.status,200);
  assert.equal((await req('/cash/'+h.data.id+'/accept','driver',{})).status,403);assert.equal((await req('/cash/'+h.data.id+'/accept','admin',{})).status,200);
  assert.equal((await req('/cash/month?branch_id='+bid+'&month=2026-99')).status,400);assert.ok(id);
 }finally{await f.close();}
});

