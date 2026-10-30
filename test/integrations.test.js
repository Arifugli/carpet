import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';
import {workflowServer} from './helpers/workflow-server.js';
import {create,call,ids,input} from './helpers/database.js';
import {sign,encrypt,decrypt,webhookURL} from '../src/integration-security.js';
import {importRows,parseCsv,exportCsv} from '../src/import-data.js';
import {publicAddress,createSender} from '../src/outbound.js';
import {createOutboxWorker} from '../src/outbox-worker.js';
const bid='01000000-0000-4000-8000-000000000001';
test('CSV/XLSX: кавычки и Unicode, формулы/zip bomb отвергаются, CSV-экспорт безопасен',async()=>{
 assert.deepEqual(parseCsv('name,phone,address\r\n"Имя, тест",+998901234567,"Ташкент\nДом 1"'),[['name','phone','address'],['Имя, тест','+998901234567','Ташкент\nДом 1']]);
 const csv='name,phone,address\nДилноза,+998901234567,Ташкент 1';assert.equal(importRows({format:'csv',data:Buffer.from(csv).toString('base64'),kind:'clients',branch_id:bid})[0].phone,input.phone);
 const xml='<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>phone</t></is></c><c r="C1" t="inlineStr"><is><t>address</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Имя</t></is></c><c r="B2" t="inlineStr"><is><t>+998901234567</t></is></c><c r="C2" t="inlineStr"><is><t>Ташкент 1</t></is></c></row></sheetData></worksheet>';
 const xlsx=xml=>Buffer.from(zipSync({'xl/worksheets/sheet1.xml':strToU8(xml)})).toString('base64');assert.equal(importRows({format:'xlsx',data:xlsx(xml),kind:'clients'})[0].name,'Имя');
 assert.throws(()=>importRows({format:'xlsx',data:xlsx(xml.replace('<t>Имя</t>','<t>Имя</t>').replace('<c r="A2"','<c r="A2"').replace('<is><t>Имя</t></is>','<f>1+1</f><v>2</v>')),kind:'clients'}),/Формулы/);
 assert.throws(()=>importRows({format:'xlsx',data:xlsx(' '.repeat(5000001)),kind:'clients'}),/велик/);
 assert.match(exportCsv([{name:'=HYPERLINK("bad")'}],['name']),/'=HYPERLINK/);assert.throws(()=>parseCsv('a\n"broken'),/кавычка/);
});
test('HTTP: подпись формы, идемпотентный REST intake, права новых действий и импорт',async()=>{
 const intake={name:'Тест',phone:'+998901234569',pickup_date:'2026-10-30',region_code:'fergana',district_code:'fergana_city',street:'Тестовая',house:'1',private_house:true,items:[{tariff:'blanket',quantity:2}]};
 const fixture=await workflowServer({externalSecret:'test-secret',externalActor:ids.operator});try{
  const send=async(path,body,{role,secret,key=randomUUID()}={})=>{const raw=JSON.stringify(body),ts=String(Math.floor(Date.now()/1000));return fetch(fixture.url+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(role?{Authorization:'Bearer '+role}:{}),...(secret?{'X-CRM-Timestamp':ts,'X-CRM-Signature':sign(secret,`${ts}.${path==='/integrations/orders'?key+'.':''}${raw}`)}:{})},body:raw});};
  assert.equal((await send('/integrations/orders',intake,{secret:'bad'})).status,401);
  const key=randomUUID(),first=await(await send('/integrations/orders',intake,{secret:'test-secret',key})).json();assert.ok(first.id);assert.deepEqual(await(await send('/integrations/orders',intake,{secret:'test-secret',key})).json(),first);
  assert.equal((await send('/actions/payment.refund',{order_id:first.id,amount:1,method:'cash',note:'Причина'},{role:'operator'})).status,403);
  assert.equal((await fetch(fixture.url+'/api/ops/stock',{headers:{Authorization:'Bearer operator'}})).status,403);
  const body={format:'csv',data:Buffer.from('name,phone,address\nИмпорт,+998901234570,Ташкент 5').toString('base64'),branch_id:bid,dry_run:true},preview=await(await send('/imports/clients',body,{role:'admin',key})).json();assert.equal(preview.rows,1);
  const committed=await(await send('/imports/clients',{...body,dry_run:false},{role:'admin',key})).json();assert.equal(committed.imported,1);
  const file=await fetch(fixture.url+'/api/exports/clients?format=xlsx',{headers:{Authorization:'Bearer manager'}});assert.equal(file.status,200);assert.ok(unzipSync(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']);
  assert.equal((await fetch(fixture.url+'/ready')).status,200);
 }finally{await fixture.close();}
});
test('HTTP Payme/Click: поддельные callbacks, точные суммы и повтор не создаёт вторую оплату',async()=>{
 const f=await workflowServer({paymeKey:'payme-test-key',clickSecret:'click-test-key',clickServiceId:'123'});try{
  const id=await create(f.sql),intent=await call(f.sql,'crm_command',['payment.intent',JSON.stringify({order_id:id,provider:'payme',amount:10000}),ids.admin,null,randomUUID()]);
  const p=async(method,params,key='payme-test-key')=>{const r=await fetch(f.url+'/api/providers/payme',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from('Paycom:'+key).toString('base64')},body:JSON.stringify({id:1,method,params})});return r.json();};
  const data={id:'payme-http-1',time:Date.now(),amount:1000000,account:{intent_id:intent.id}};
  assert.equal((await p('CreateTransaction',data,'bad')).error.code,-32504);assert.equal((await p('CheckPerformTransaction',{amount:1000001,account:data.account})).error.code,-31001);
  assert.equal((await p('CreateTransaction',data)).result.state,1);const paid=await p('PerformTransaction',{id:data.id});assert.equal(paid.result.state,2);assert.deepEqual(await p('PerformTransaction',{id:data.id}),paid);
  assert.equal((await f.sql.query('select count(*) from payments where order_id=$1',[id])).rows[0].count,1);
  const clickIntent=await call(f.sql,'crm_command',['payment.intent',JSON.stringify({order_id:id,provider:'click',amount:20000}),ids.admin,null,randomUUID()]);
  const click=async(action,prepare,wrong=false)=>{const b={click_trans_id:'click-http-1',click_paydoc_id:'1',service_id:'123',merchant_trans_id:clickIntent.id,amount:'20000.00',action:String(action),error:'0',sign_time:'2026-10-28 17:00:00',...(prepare?{merchant_prepare_id:String(prepare)}:{})};b.sign_string=createHash('md5').update(b.click_trans_id+b.service_id+'click-test-key'+b.merchant_trans_id+(action===1?b.merchant_prepare_id:'')+b.amount+b.action+b.sign_time).digest('hex');if(wrong)b.sign_string='0'.repeat(32);const r=await fetch(f.url+'/api/providers/click',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(b)});return r.json();};
  assert.equal((await click(0,null,true)).error,-1);const prepared=await click(0);assert.equal(prepared.error,0);const result=await click(1,prepared.merchant_prepare_id);assert.equal(result.error,0);assert.equal((await click(1,prepared.merchant_prepare_id)).error,0);
 }finally{await f.close();}
});
test('HTTP акт/печать: код не раскрывается, encrypted outbox, OTP challenge повторяем',async()=>{
 const config={otpSecret:'otp-test-key',notificationKey:'ab'.repeat(32),smsToken:'test-token'},f=await workflowServer(config);try{
  await call(f.sql,'assign_order_driver',[f.orderId,ids.admin,ids.driver,null]);await call(f.sql,'change_order_status',[f.orderId,'pickup_assigned',ids.admin,null]);
  const request=async(path,body,key=randomUUID())=>fetch(f.url+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer admin',...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const a=await(await request('/actions/intake.create',{order_id:f.orderId,note:'Есть пятна'})).json(),key=randomUUID();assert.ok(a.public_token);const first=await(await request(`/intake/${a.id}/challenge`,{},key)).json();assert.deepEqual(await(await request(`/intake/${a.id}/challenge`,{},key)).json(),first);assert.equal(first.code,undefined);
  const row=(await f.sql.query("select payload from integration_outbox where order_id=$1 and event_key like 'otp:%'",[f.orderId])).rows;assert.equal(row.length,1);const message=decrypt(row[0].payload.encrypted,config.notificationKey),code=message.match(/\d{6}/)[0];
  const r=await fetch(f.url+`/api/public/intake/${a.public_token}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});assert.equal(r.status,200);assert.equal((await r.json()).confirmed,true);
  const print=await request(`/orders/${f.orderId}/print/labels`);assert.equal(print.status,200);assert.match(await print.text(),/<svg/);
  assert.equal((await fetch(f.url+`/api/ops/documents?order_id=${f.orderId}`,{headers:{Authorization:'Bearer workshop'}})).status,403);
 }finally{await f.close();}
});
test('исходящие адаптеры: подписи, allowlist/private IP, ошибки без секретов и worker lease',async()=>{
 assert.equal(publicAddress('127.0.0.1'),false);assert.equal(publicAddress('10.2.3.4'),false);assert.equal(publicAddress('::1'),false);assert.equal(publicAddress('8.8.8.8'),true);assert.throws(()=>webhookURL('https://evil.test','example.test'));
 const text='Код 123456',secret='ab'.repeat(32);assert.equal(decrypt(encrypt(text,secret),secret),text);const generated=Buffer.from(secret,'hex').toString('base64');assert.equal(decrypt(encrypt(text,generated),generated),text);
 const requests=[],db={from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{url:'https://example.test/hooks',secret_env:'WEBHOOK_SECRET_TEST',active:true}})})};
 const sender=createSender({db,config:{smsToken:'secret-sms',smsFrom:'4546',telegramToken:'secret-tg',webhookHosts:'example.test',webhookSecrets:{WEBHOOK_SECRET_TEST:'webhook-test'}},fetcher:async(url,args)=>{requests.push({url,args});return {ok:true,json:async()=>url.includes('telegram')?{ok:true,result:{message_id:123}}:{id:'sms-id'}};},webhook:async(url,body,headers)=>{assert.equal(headers['X-CRM-Signature'],sign('webhook-test',`${headers['X-CRM-Timestamp']}.${body}`));return {id:null};}});
 await sender({id:'1',channel:'sms',destination:input.phone,payload:{text:'Принят'}});await sender({id:'2',channel:'telegram',destination:'123',payload:{text:'Готов'}});await sender({id:'3',channel:'webhook',destination:randomUUID(),payload:{event:'status_ready'}});assert.equal(requests.length,2);
 const calls=[],logs=[],row={id:randomUUID(),lease_token:randomUUID(),channel:'sms'};const worker=createOutboxWorker({channels:['sms'],log:v=>logs.push(v),send:async()=>{throw Error('secret-key-in-provider-response');},db:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='crm_outbox_claim'?[row]:true,error:null};}}});await worker.once();assert.equal(calls.at(-1).args.error_code,'PROVIDER_FAILED');assert.ok(!logs.join('').includes('secret-key'));worker.stop();await worker.once();assert.equal(calls.length,3);
});
