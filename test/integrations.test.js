import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {input} from './helpers/database.js';
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
});test('исходящие адаптеры: подписи, allowlist/private IP, ошибки без секретов и worker lease',async()=>{
 assert.equal(publicAddress('127.0.0.1'),false);assert.equal(publicAddress('10.2.3.4'),false);assert.equal(publicAddress('::1'),false);assert.equal(publicAddress('8.8.8.8'),true);assert.throws(()=>webhookURL('https://evil.test','example.test'));
 const text='Код 123456',secret='ab'.repeat(32);assert.equal(decrypt(encrypt(text,secret),secret),text);const generated=Buffer.from(secret,'hex').toString('base64');assert.equal(decrypt(encrypt(text,generated),generated),text);
 const requests=[],db={from:()=>({select(){return this;},eq(){return this;},single:async()=>({data:{url:'https://example.test/hooks',secret_env:'WEBHOOK_SECRET_TEST',active:true}})})};
 const sender=createSender({db,config:{smsToken:'secret-sms',smsFrom:'4546',telegramToken:'secret-tg',webhookHosts:'example.test',webhookSecrets:{WEBHOOK_SECRET_TEST:'webhook-test'}},fetcher:async(url,args)=>{requests.push({url,args});return {ok:true,json:async()=>url.includes('telegram')?{ok:true,result:{message_id:123}}:{id:'sms-id'}};},webhook:async(url,body,headers)=>{assert.equal(headers['X-CRM-Signature'],sign('webhook-test',`${headers['X-CRM-Timestamp']}.${body}`));return {id:null};}});
 await sender({id:'1',channel:'sms',destination:input.phone,payload:{text:'Принят'}});await sender({id:'2',channel:'telegram',destination:'123',payload:{text:'Готов'}});await sender({id:'3',channel:'webhook',destination:randomUUID(),payload:{event:'status_ready_for_delivery'}});assert.equal(requests.length,2);
 const calls=[],logs=[],row={id:randomUUID(),lease_token:randomUUID(),channel:'sms'};const worker=createOutboxWorker({channels:['sms'],log:v=>logs.push(v),send:async()=>{throw Error('secret-key-in-provider-response');},db:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='crm_outbox_claim'?[row]:true,error:null};}}});await worker.once();assert.equal(calls.at(-1).args.error_code,'PROVIDER_FAILED');assert.ok(!logs.join('').includes('secret-key'));worker.stop();await worker.once();assert.equal(calls.length,3);
});
