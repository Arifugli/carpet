import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {database,call,create,ids,input} from './helpers/database.js';
let db;const bid='01000000-0000-4000-8000-000000000001';
const command=(name,data,role='admin',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],null,key]);
const query=(s,p=[])=>db.query(s,p),today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
const provider=(name,op,data)=>call(db,'crm_provider',[name,op,JSON.stringify(data)]);
const move=async(id,to)=>{await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);for(const status of ['pickup_assigned','received','washing','drying','ready','delivering','delivered']){await call(db,'change_order_status',[id,status,ids.admin,null]);if(status===to)return;}};
before(async()=>{db=await database();});after(async()=>db?.close());

test('скидка SQL: права, лимит, идемпотентность, цена и исторический снимок',async()=>{
 const id=await create(db);await command('discount.rule',{branch_id:bid,code:'TEST10',kind:'promo',percent:10,min_orders:0,min_total:0,max_uses:1,valid_from:new Date(Date.now()-1000).toISOString(),valid_to:new Date(Date.now()+86400000).toISOString()});
 await assert.rejects(command('discount.rule',{branch_id:bid},'operator'),e=>e.code==='42501');
 const key=randomUUID(),a=await command('discount.apply',{order_id:id,code:'TEST10'},'operator',key);assert.equal(a.amount,18000);assert.deepEqual(await command('discount.apply',{order_id:id,code:'TEST10'},'operator',key),a);
 assert.equal((await query('select total from orders where id=$1',[id])).rows[0].total,'162000');
 await assert.rejects(command('discount.apply',{order_id:await create(db),code:'TEST10'},'operator'),e=>e.code==='23514');
});
test('Payme: check/create/perform/cancel атомарны и повторяемы, возврат сохраняет след оплаты',async()=>{
 const id=await create(db),intent=await command('payment.intent',{order_id:id,provider:'payme',amount:50000}),data={intent_id:intent.id,provider_id:randomUUID(),amount:50000,amount_tiyin:5000000,time:Date.now()};
 assert.equal((await provider('payme','check',data)).allow,true);
 const first=await provider('payme','create',data);assert.equal(first.state,1);assert.deepEqual(await provider('payme','create',data),first);
 await assert.rejects(command('payment.record',{order_id:id,amount:150000,method:'cash'}),e=>e.code==='55000');
 const paid=await provider('payme','perform',data);assert.equal(paid.state,2);assert.deepEqual(await provider('payme','perform',data),paid);
 const cancelled=await provider('payme','cancel',{...data,reason:1});assert.equal(cancelled.state,-2);assert.deepEqual(await provider('payme','cancel',{...data,reason:1}),cancelled);
 const o=(await query('select paid_amount,payment_recorded_at from orders where id=$1',[id])).rows[0];assert.equal(o.paid_amount,'0');assert.ok(o.payment_recorded_at);
 assert.equal((await query('select count(*) from payments where order_id=$1',[id])).rows[0].count,2);
 await assert.rejects(call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),e=>e.code==='55000');
});
test('Click: правильный prepare_id, точная сумма, чужой intent и таймаут не проводят оплату',async()=>{
 const id=await create(db),t=await command('payment.intent',{order_id:id,provider:'click',amount:10000}),data={intent_id:t.id,provider_id:randomUUID(),amount:10000};
 assert.equal((await provider('click','create',{...data,amount:9999})).error_code,-31001);
 const prepared=await provider('click','create',data);assert.equal(prepared.state,1);
 assert.equal((await provider('click','perform',{...data,prepare_id:prepared.prepare_id+1})).error_code,-31001);
 const done=await provider('click','perform',{...data,prepare_id:prepared.prepare_id});assert.equal(done.state,2);
 const expired=await command('payment.intent',{order_id:id,provider:'payme',amount:10000}),eid=randomUUID();await provider('payme','create',{intent_id:expired.id,provider_id:eid,amount:10000,time:Date.now()});
 await query("update payment_intents set expires_at=now()-interval '1 minute' where id=$1",[expired.id]);assert.equal((await provider('payme','perform',{provider_id:eid})).error_code,-31008);
 assert.equal((await query('select state,reason from payment_intents where id=$1',[expired.id])).rows[0].state,-1);
});
test('наличные: сверка по Ташкенту, разница, закрытый день и права',async()=>{
 const id=await create(db);await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);await command('payment.record',{order_id:id,amount:30000,method:'cash'},'driver');
 const view=await call(db,'crm_operations',['cash',JSON.stringify({date:today()}),ids.driver]);assert.equal(view.cash[0].expected,30000);
 await assert.rejects(command('cash.close',{branch_id:bid,driver_id:ids.driver,day:today(),counted:29000,note:'Недостача'},'driver'),e=>e.code==='42501');
 const close=await command('cash.close',{branch_id:bid,driver_id:ids.driver,day:today(),counted:29000,note:'Недостача'},'dispatcher');assert.equal(close.difference,-1000);
 await assert.rejects(command('payment.record',{order_id:id,amount:1000,method:'cash'},'driver'),e=>e.code==='55000');
});
test('приёмка: неизменяемый снимок, пять попыток OTP сохраняются после ошибок',async()=>{
 const id=await create(db);await move(id,'received');const a=await command('intake.create',{order_id:id,note:'Пятна отмечены'},'admin');assert.equal(a.snapshot.items.length,1);
 const hash=createHash('sha256').update('123456').digest('hex');await command('intake.challenge',{act_id:a.id,otp_hash:hash,encrypted:'ciphertext'});
 for(let i=0;i<5;i++)assert.equal((await call(db,'crm_intake_public',[a.public_token,'wrong'])).confirmed,false);
 assert.equal((await query('select otp_attempts from intake_acts where id=$1',[a.id])).rows[0].otp_attempts,5);
 assert.equal((await call(db,'crm_intake_public',[a.public_token,hash])).code,'OTP_UNAVAILABLE');
 await query("update intake_acts set otp_expires=now()-interval '1 minute' where id=$1",[a.id]);await command('intake.challenge',{act_id:a.id,otp_hash:hash,encrypted:'ciphertext2'});
 assert.equal((await call(db,'crm_intake_public',[a.public_token,hash])).confirmed,true);assert.equal((await call(db,'crm_intake_public',[a.public_token])).snapshot.note,'Пятна отмечены');
});
test('склад: нехватка откатывает этап, списание по норме единожды, зарплата хранит ставку',async()=>{
 const mat=await command('material.save',{branch_id:bid,code:'shampoo',name:'Шампунь',unit:'л',norm_per_m2:.1});
 await command('stock.adjust',{material_id:mat.id,quantity:.3,note:'Приход'});
 const id=await create(db);await move(id,'received');await assert.rejects(command('workshop.advance',{order_id:id,expected_stage:'received'},'workshop'),e=>e.code==='55000');
 assert.equal((await query('select status from orders where id=$1',[id])).rows[0].status,'received');
 await command('stock.adjust',{material_id:mat.id,quantity:5,note:'Приход'});
 await command('piece_rate.save',{branch_id:bid,role:'workshop',event:'washing',unit:'m2',rate:1000,effective_at:new Date().toISOString()});
 const key=randomUUID(),r=await command('workshop.advance',{order_id:id,expected_stage:'received'},'workshop',key);await command('workshop.advance',{order_id:id,expected_stage:'received'},'workshop',key);
 assert.equal((await query('select quantity from stock_movements where order_id=$1',[id])).rows[0].quantity,'-0.600000');
 assert.equal((await query('select amount from pay_accruals where order_id=$1',[id])).rows[0].amount,'6000');
 const payroll=await call(db,'crm_operations',['payroll','{}',ids.manager]);assert.ok(payroll.accruals.some(x=>x.employee_id===ids.workshop&&x.amount===6000));
 await command('material.save',{branch_id:bid,code:'shampoo',name:'Шампунь',unit:'л',norm_per_m2:0});
});
test('претензия: повторная стирка сохраняет delivered, скидка и компенсация разделены',async()=>{
 const id=await create(db);await move(id,'delivered');const complaint=await command('complaint.create',{order_id:id,reason:'Пятна',due_at:new Date().toISOString()},'operator');
 await assert.rejects(command('complaint.resolve',{complaint_id:complaint.id,resolution:'rewash',note:'Повторно'},'operator'),e=>e.code==='42501');
 await command('complaint.resolve',{complaint_id:complaint.id,resolution:'rewash',note:'Повторно'});
 const jobs=await call(db,'crm_operations',['rewash','{}',ids.workshop]);const job=jobs.jobs.find(x=>x.order_id===id);for(const stage of ['received','washing','drying','quality_check','packing'])await command('rewash.advance',{job_id:job.id,expected_stage:stage},'workshop');
 assert.equal((await query('select status from orders where id=$1',[id])).rows[0].status,'delivered');assert.equal((await query('select state from complaints where id=$1',[complaint.id])).rows[0].state,'resolved');
});
test('планирование: подсказки, лимит района/дня и мощность цеха',async()=>{
 const day='2027-03-01';await command('catalog.save',{branch_id:bid,kind:'zone',code:'center',name_ru:'Центр'});await command('slot_limit.save',{branch_id:bid,day,zone_code:'center',slot_code:'morning',capacity:1},'dispatcher');
 const a=await create(db),b=await create(db);await command('visit.schedule',{order_id:a,kind:'pickup',scheduled_date:day,slot_code:'morning',zone_code:'center'},'dispatcher');
 await assert.rejects(command('visit.schedule',{order_id:b,kind:'pickup',scheduled_date:day,slot_code:'morning',zone_code:'center'},'dispatcher'),e=>e.code==='55000');
 const hints=await call(db,'crm_operations',['planning',JSON.stringify({date:day,zone_code:'center'}),ids.operator]);assert.equal(hints.slots.find(s=>s.date===day&&s.slot_code==='morning').remaining,0);
 await query('update branches set workshop_capacity_m2=5 where id=$1',[bid]);try{await assert.rejects(create(db,{pickup_date:'2028-03-01'}),e=>e.code==='55000');}finally{await query('update branches set workshop_capacity_m2=500 where id=$1',[bid]);}
});
test('уведомления: opt-in, lease, повторы и защита от старого воркера',async()=>{
 const id=await create(db),client=(await query('select client_id from orders where id=$1',[id])).rows[0].client_id;
 await command('client.preferences',{client_id:client,sms_consent:true,telegram_consent:true,telegram_chat_id:'12345'},'operator');await move(id,'received');
 const items=await call(db,'crm_outbox_claim',[JSON.stringify(['sms','telegram']),50]);assert.ok(items.some(x=>x.order_id===id&&x.channel==='telegram'));const row=items[0];
 assert.equal(await call(db,'crm_outbox_finish',[row.id,randomUUID(),true,'123',null]),false);assert.equal(await call(db,'crm_outbox_finish',[row.id,row.lease_token,false,null,'PROVIDER_TIMEOUT']),true);
 assert.equal((await query('select state,attempts from integration_outbox where id=$1',[row.id])).rows[0].state,'pending');
});
test('SLA: эскалации идемпотентны; чёрный список запрещает новые заказы',async()=>{
 const id=await create(db,{phone:'+998901234588'});await query("update orders set promised_at=now()-interval '1 day' where id=$1",[id]);await call(db,'crm_tick',[]);await call(db,'crm_tick',[]);
 assert.equal((await query("select count(*) from tasks where order_id=$1 and escalation_key like 'sla:%'",[id])).rows[0].count,2);
 const cid=(await query('select client_id from orders where id=$1',[id])).rows[0].client_id;
 await assert.rejects(command('client.preferences',{client_id:cid,blacklisted:true,blacklist_reason:'Споры'},'operator'),e=>e.code==='42501');
 await command('client.preferences',{client_id:cid,blacklisted:true,blacklist_reason:'Споры'});await assert.rejects(create(db,{phone:'+998901234588'}),e=>e.code==='55000');
});
test('импорт: preview не пишет, commit атомарен и не дублируется; телефония обновляет один звонок',async()=>{
 const rows=[{name:'Импорт',phone:'+998901234599',address:'Ташкент, 1'}],key=randomUUID();await call(db,'crm_import',['clients',JSON.stringify(rows),ids.admin,null,key,true]);
 assert.equal((await query("select count(*) from clients where phone='+998901234599'")).rows[0].count,0);
 const a=await call(db,'crm_import',['clients',JSON.stringify(rows),ids.admin,null,key,false]);assert.deepEqual(await call(db,'crm_import',['clients',JSON.stringify(rows),ids.admin,null,key,false]),a);
 const d={branch_id:bid,external_id:randomUUID(),phone:input.phone,direction:'in',outcome:'ringing'};const c=await call(db,'crm_telephony',[JSON.stringify(d),ids.operator,null]);const ended=await call(db,'crm_telephony',[JSON.stringify({...d,outcome:'missed'}),ids.operator,null]);assert.equal(c.id,ended.id);assert.equal(ended.outcome,'missed');
});
test('новая миграция повторяется; RLS и закрытые системные функции',async()=>{
 await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/0007_business_operations.sql',import.meta.url),'utf8'));await db.exec('set role service_role');
 const bad=(await query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'crm_%' and has_function_privilege('anon',p.oid,'execute')")).rows;assert.deepEqual(bad,[]);
 assert.equal((await query("select relrowsecurity from pg_class where oid='public.payment_intents'::regclass")).rows[0].relrowsecurity,true);
});
