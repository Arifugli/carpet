import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';

async function environment(){
 const dom=new JSDOM('',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;
 w.eval(await readFile(new URL('../public/offline.js',import.meta.url),'utf8'));
 return {dom,w,queue:w.CRMOffline};
}
test('PWA: потерянный ответ не создаёт вторую оплату, повтор использует прежний ключ',async()=>{
 const {dom,queue}=await environment();try{
  const key=randomUUID();await queue.enqueue('driver-a','payment.record',{amount:5000},{id:key});
  const committed=new Set();let calls=0;
  const api=async(_path,options)=>{calls++;assert.equal(options.idempotencyKey,key);if(!committed.has(key)){committed.add(key);throw Object.assign(new Error('Сеть'),{network:true});}return {ok:true};};
  await queue.sync('driver-a',api);assert.equal((await queue.list('driver-a')).length,1);
  await queue.sync('driver-a',api);assert.equal((await queue.list('driver-a')).length,0);assert.equal(committed.size,1);assert.equal(calls,2);
 }finally{dom.window.close();}
});
test('PWA: смена пользователя останавливает очередь; снимки и действия изолированы',async()=>{
 const {dom,w,queue}=await environment();try{
  let current='a';w.crmUI={user:()=>({id:current})};
  await queue.snapshot('a','jobs',{private:true});assert.equal(await queue.read('b','jobs'),undefined);
  await queue.enqueue('a','visit.event',{visit_id:'1'});await queue.enqueue('a','visit.event',{visit_id:'2'});
  let calls=0;await queue.sync('a',async()=>{calls++;current='b';return {ok:true};});
  assert.equal(calls,1);assert.equal((await queue.list('a')).length,1);assert.equal((await queue.list('b')).length,0);
 }finally{dom.window.close();}
});
test('PWA: конфликт сохраняет действие для проверки и не отправляет следующие действия',async()=>{
 const {dom,queue}=await environment();try{
  const first=await queue.enqueue('a','workshop.advance',{expected_stage:'washing'});await queue.enqueue('a','workshop.advance',{expected_stage:'drying'});
  let calls=0;await queue.sync('a',async()=>{calls++;throw Object.assign(new Error('Этап изменился'),{status:409});});
  assert.equal(calls,1);assert.equal((await queue.list('a')).find(e=>e.id===first.id).state,'review');
  await queue.sync('a',async()=>{calls++;});assert.equal(calls,1);
  await queue.discard(first.id,'another-user');assert.equal((await queue.list('a')).length,2);
  await queue.discard(first.id,'a');assert.equal((await queue.list('a')).length,1);
 }finally{dom.window.close();}
});
