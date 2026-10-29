import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {phone} from '../src/validation.js';
import {orderInput} from '../src/routes/orders.js';
import {workflowServer} from './helpers/workflow-server.js';
import {ids,input} from './helpers/database.js';

test('телефон: местный и полный номера нормализуются, неверные цифры/страны/буквы отклоняются',()=>{
 for(const value of ['901234567','998901234567','+998901234567',' 90 123-45-67 ','+998 (90) 123-45-67'])assert.equal(phone.parse(value),'+998901234567');
 for(const value of ['90123456','9012345671','+79012345671','abc901234567','90/1234567','+998+901234567','',901234567])assert.equal(phone.safeParse(value).success,false,String(value));
 assert.equal(orderInput.parse({...input,phone:'901234567'}).phone,'+998901234567');
});

test('HTTP филиал: формат данных со скриншота принимаются; ошибка указывает телефон и не создаёт запись',async()=>{
 const f=await workflowServer();try{
  const post=(name,data,key=randomUUID())=>fetch(f.url+'/api/actions/'+name,{method:'POST',headers:{Authorization:'Bearer admin','Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(data)});
  const body={code:'40',name:'Тестовый филиал',address:'Тестовый город, улица 1',phone:'901234567',active:true,workshop_capacity_m2:500,sla_hours:72},key=randomUUID();
  let r=await post('branch.save',{...body,phone:'90123456'});assert.equal(r.status,400);const error=await r.json();assert.deepEqual(error.fields,['phone']);assert.match(error.error,/Телефон/);assert.match(error.error,/9 цифр/);assert.equal((await f.sql.query("select count(*) n from branches where code='40'")).rows[0].n,0);
  r=await post('branch.save',body,key);assert.equal(r.status,200);const b=await r.json();assert.equal(b.phone,'+998901234567');assert.equal((await (await post('branch.save',body,key)).json()).id,b.id);
  r=await post('admin.update',{...body,entity:'branch',id:b.id,phone:'90 123-45-68'});assert.equal(r.status,200);assert.equal((await r.json()).phone,'+998901234568');
  r=await post('staff.update',{user_id:ids.inactive,full_name:'Сотрудник',role:'operator',active:false,branch_id:b.id,phone:'998901234569'});assert.equal(r.status,200);assert.equal((await r.json()).phone,'+998901234569');
 }finally{await f.close();}
});

test('DOM + HTTP + SQL: ошибка телефона выделяет поле, исправление на 9 цифр сохраняет заполненный филиал',async()=>{
 const f=await workflowServer();let dom;
 try{
  const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'});const w=dom.window,d=w.document;
  Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,f.url),args);
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const wait=async fn=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);};
  const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value='admin@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');
  await wait(()=>d.querySelector('[data-view=adminDesk]'));d.querySelector('[data-view=adminDesk]').click();await wait(()=>d.querySelector('[data-form-name="branch.save"]'));d.querySelector('[data-form-name="branch.save"]').click();
  const form=d.querySelector('[data-desk-form="branch.save"]');for(const [key,value] of Object.entries({code:'40',name:'Тестовый филиал',address:'Тестовый город, улица 1',phone:'90123456'}))form.elements[key].value=value;
  submit('[data-desk-form="branch.save"]');await wait(()=>form.elements.phone.getAttribute('aria-invalid')==='true');assert.match(form.querySelector('[data-desk-error]').textContent,/Телефон/);assert.equal(d.activeElement,form.elements.phone);assert.equal(form.elements.name.value,'Тестовый филиал');assert.equal(form.elements.code.value,'40');assert.match(form.textContent,/Код \+998 добавится автоматически/);
  await wait(()=>!form.querySelector('button.primary').disabled);form.elements.phone.value='901234567';form.elements.phone.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(form.elements.phone.hasAttribute('aria-invalid'),false);
  submit('[data-desk-form="branch.save"]');await wait(()=>!d.querySelector('#action[open]'));const b=(await f.sql.query("select * from branches where code='40'")).rows[0];assert.equal(b.phone,'+998901234567');assert.equal(b.name,'Тестовый филиал');assert.equal(b.workshop_capacity_m2,'500');assert.equal(b.sla_hours,72);
 }finally{dom?.window.close();await f.close();}
});
