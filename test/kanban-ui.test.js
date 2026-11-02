import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {workflowServer} from './helpers/workflow-server.js';
import {advance,call,ids} from './helpers/database.js';
async function browser(f){
 const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','reports.js','operations.js','kanban.js','dashboard.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
 const dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'}),w=dom.window,d=w.document;Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,f.url),args);
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
 const wait=async fn=>{for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);};
 const submit=selector=>{const form=typeof selector==='string'?d.querySelector(selector):selector;assert.ok(form,selector);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));};
 const login=async(role,view='kanban')=>{if(d.querySelector('[data-action=logout]')){d.querySelector('[data-action=logout]').click();await wait(()=>d.querySelector('[data-form=login]'));}await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value=role+'@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('[data-work-view=home]'));if(view!=='home')await w.crmUI.navigate(view);await wait(()=>view==='kanban'?d.querySelector('[data-column]'):d.querySelector('[data-order-table]'));};
 return {dom,w,d,wait,submit,login,close:async()=>{await new Promise(r=>setTimeout(r,150));dom.window.close();}};
}
test('DOM + HTTP + SQL: водитель действует в боковой карточке; склад получает форму замеров',async()=>{
 const f=await workflowServer();let b;try{
  b=await browser(f);const {d,w,login,wait,submit}=b;
  const open=async()=>{d.querySelector('[data-card="'+f.orderId+'"] [data-flow=open]').click();await wait(()=>d.querySelector('#detail').open);};
  await login('driver');assert.equal(d.querySelectorAll('[data-column]').length,6);
  await open();d.querySelector('[data-command="pickup.claim"]').click();await wait(()=>d.querySelector('[data-flow-command]'));d.querySelector('[name=pickup_at]').value='2026-11-02T10:00';submit('[data-flow-command]');await wait(()=>!d.querySelector('#action').open);await open();await wait(()=>d.querySelector('[data-command="pickup.collect"]'));
  const items=(await f.sql.query('select id from order_items where order_id=$1',[f.orderId])).rows;for(const i of items)await call(f.sql,'register_order_photo',[i.id,f.orderId+'/'+i.id+'/'+randomUUID()+'.jpg','intake',ids.driver,null]);await f.db.rpc('crm_measurements',{oid:f.orderId,u:ids.driver});
  d.querySelector('[data-command="pickup.collect"]').click();await wait(()=>d.querySelector('[data-intake-composition]'));submit('[data-intake-composition]');await wait(()=>d.querySelector('[data-flow-measure]'));let form=d.querySelector('[data-flow-measure]');form.querySelector('[name=length_m]').value='3';form.querySelector('[name=width_m]').value='2';form.querySelector('[data-flow=preview]').click();await wait(()=>form.querySelector('[data-flow-price]').textContent.includes('162'));submit(form);
  await wait(()=>!d.querySelector('#action').open);await open();await wait(()=>d.querySelector('[data-command="pickup.handover"]'));d.querySelector('[data-command="pickup.handover"]').click();await wait(()=>!d.querySelector('[data-card="'+f.orderId+'"]'));
  await login('warehouse');await open();await wait(()=>d.querySelector('[data-command="warehouse.receive"]'));d.querySelector('[data-command="warehouse.receive"]').click();await wait(()=>d.querySelector('[data-command="warehouse.measure"]'));d.querySelector('[data-command="warehouse.measure"]').click();await wait(()=>d.querySelector('[data-flow-measure="warehouse.measure"]'));
  form=d.querySelector('[data-flow-measure]');assert.ok(form.querySelector('[name=length_m]'));assert.ok(form.querySelector('[name=quantity]'));submit(form);await wait(()=>!d.querySelector('#action').open);await open();await wait(()=>d.querySelector('[data-command="warehouse.to_wash"]'));
 }finally{if(b)await b.close();await f.close();}
});

test('DOM Dashboard: главная, таблица, боковая карточка и клиент сохраняют фильтр и права роли',async()=>{
 const f=await workflowServer();let b;try{
  b=await browser(f);const {d,w,login,wait,submit}=b;await login('operator','home');
  assert.equal(d.querySelector('[data-view=reports]'),null);assert.equal(d.querySelector('[data-view=adminDesk]'),null);
  assert.ok(d.querySelector('[data-order-table]'));assert.equal(d.querySelectorAll('.home-tile').length,3);
  const search=d.querySelector('[data-dashboard-filter] [name=q]');search.value='K-1';submit('[data-dashboard-filter]');await wait(()=>d.querySelector('[data-order-table] tbody tr'));
  d.querySelector('[data-dashboard=open]').click();await wait(()=>d.querySelector('#detail').open);
  assert.ok(d.body.classList.contains('detail-visible'));assert.equal(d.querySelector('[data-flow-detail]').open,false);assert.equal(d.querySelector('[data-photo-gallery]').open,false);
  d.querySelector('[data-detail-tab=client]').click();await wait(()=>d.querySelector('.client-overview'));assert.match(d.querySelector('.client-overview').textContent,/Дилноза/);
  d.querySelector('[data-action=close-detail]').click();assert.equal(d.body.classList.contains('detail-visible'),false);assert.equal(d.querySelector('[name=q]').value,'K-1');
  d.querySelector('[data-view=clients]').click();await wait(()=>d.querySelector('[data-client-table]'));d.querySelector('[data-dashboard=client]').click();await wait(()=>d.querySelector('.client-overview'));
  assert.equal(d.querySelectorAll('[data-photo-gallery]').length,1);
  d.querySelector('[data-action=close-detail]').click();await login('warehouse','home');assert.equal(d.querySelector('[data-view=clients]'),null);assert.equal(d.querySelector('[data-view=reports]'),null);
 }finally{if(b)await b.close();await f.close();}
});

test('DOM: телефон первый, клиент и адрес заполняются по номеру, черновик восстанавливается; заказ создаётся без изделий',async()=>{
 const f=await workflowServer();let b;try{
  b=await browser(f);const {d,w,login,wait,submit}=b;await login('operator');
  d.querySelector('[data-flow=create]').click();await wait(()=>d.querySelector('[data-form=create]'));
  let form=d.querySelector('[data-form=create]');assert.equal(form.querySelector('input').name,'phone');assert.equal(form.querySelectorAll('[data-item]').length,0);assert.equal(form.querySelector('[name=urgent]'),null);assert.equal(form.querySelector('[data-action=quote]'),null);
  form.elements.phone.value='901234567';form.elements.phone.dispatchEvent(new w.Event('input',{bubbles:true}));
  await wait(()=>form.elements.name.value==='Дилноза'&&form.elements.street.value==='Навои');
  assert.equal(form.elements.house.value,'14');assert.equal(form.elements.district_code.value,'fergana_city');assert.equal(form.elements.private_house.checked,true);
  await wait(()=>w.sessionStorage.getItem('crm:new-order:'+ids.operator)?.includes('Навои'));
  const key=form.dataset.idempotencyKey;d.querySelector('[data-action=close-action]').click();d.querySelector('[data-flow=create]').click();await wait(()=>d.querySelector('[data-form=create]'));
  form=d.querySelector('[data-form=create]');assert.equal(form.elements.phone.value,'901234567');assert.equal(form.dataset.idempotencyKey,key);
  assert.ok(form.querySelector('[data-action=discard-order-draft]'));d.querySelector('[data-action=discard-order-draft]').click();assert.equal(d.querySelector('[name=phone]').value,'+998');d.querySelector('[data-action=undo-order-draft]').click();
  form=d.querySelector('[data-form=create]');assert.equal(form.elements.phone.value,'901234567');submit(form);
  await wait(()=>!d.querySelector('#action').open);const orders=(await f.sql.query('select id from orders order by number')).rows;assert.equal(orders.length,2);assert.equal((await f.sql.query('select count(*) from order_items where order_id=$1',[orders[1].id])).rows[0].count,0);assert.equal(w.sessionStorage.getItem('crm:new-order:'+ids.operator),null);
 }finally{if(b)await b.close();await f.close();}
});

test('DOM: поздний поиск старого номера не подменяет данные нового клиента',async()=>{
 const f=await workflowServer();let b;try{
  b=await browser(f);const {d,w,login,wait}=b;await login('operator');d.querySelector('[data-flow=create]').click();await wait(()=>d.querySelector('[data-form=create]'));
  const form=d.querySelector('[data-form=create]'),original=w.fetch;let release;
  w.fetch=async(path,args)=>{if(String(path).includes('/workspaces/client?')){
   const number=new URL(String(path),f.url).searchParams.get('phone');
   if(number==='901111111')return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({client:{name:'Старый клиент'},addresses:[],orders:[]}),{headers:{'content-type':'application/json'}}));});
   if(number==='902222222')return new Response(JSON.stringify({client:{name:'Новый клиент'},addresses:[],orders:[]}),{headers:{'content-type':'application/json'}});
  }return original(path,args);};
  form.elements.phone.value='901111111';form.elements.phone.dispatchEvent(new w.Event('input',{bubbles:true}));await wait(()=>release);
  form.elements.phone.value='902222222';form.elements.phone.dispatchEvent(new w.Event('input',{bubbles:true}));await wait(()=>form.elements.name.value==='Новый клиент');release();await new Promise(resolve=>setTimeout(resolve,80));assert.equal(form.elements.name.value,'Новый клиент');
 }finally{if(b)await b.close();await f.close();}
});

test('DOM: язык переключается до входа и после него, сохраняет введённый логин, роль и выбранный раздел',async()=>{
 const f=await workflowServer();let b;try{
  b=await browser(f);const {d,w,login,wait}=b;
  await wait(()=>d.querySelector('[data-form=login]'));
  d.querySelector('[name=email]').value='operator@example.test';d.querySelector('[name=password]').value='draft-password';
  const change=async value=>{const el=d.querySelector('[data-language]');el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>d.documentElement.lang===value);};
  await change('uz');await wait(()=>d.querySelector('h1')?.textContent==='Xodimlar uchun kirish');
  assert.equal(d.querySelector('[name=email]').value,'operator@example.test');assert.equal(d.querySelector('[name=password]').value,'draft-password');assert.equal(w.localStorage.getItem('crm_locale'),'uz');
  await login('operator');assert.equal(d.querySelectorAll('[data-column]').length,10);assert.equal(d.querySelector('[data-column=new] h2').textContent,'Yangi buyurtmalar');
  d.querySelector('[data-flow=create]').click();await wait(()=>d.querySelector('[data-form=create]'));assert.match(d.querySelector('[data-form=create]').textContent,/Mijozning F.I.Sh./);assert.equal(d.querySelector('[name=source]').type,'hidden');assert.match(d.querySelector('[name=region_code]').textContent,/Farg/);
  d.querySelector('[data-action=close-action]').click();
  await change('ru');await wait(()=>d.querySelector('[data-column=new] h2')?.textContent==='Новые заказы');
  assert.equal(d.querySelectorAll('[data-column]').length,10);assert.equal(w.localStorage.getItem('crm_locale'),'ru');assert.equal(d.querySelector('[data-view=adminDesk]'),null);
  await change('uz');await wait(()=>d.querySelector('[data-column=new] h2')?.textContent==='Yangi buyurtmalar');
  d.querySelector('[data-action=logout]').click();await wait(()=>d.querySelector('[data-form=login]'));assert.equal(d.documentElement.lang,'uz');assert.deepEqual(Object.keys(w.localStorage),['crm_locale']);
 }finally{if(b)await b.close();await f.close();}
});
test('DOM: оператор — 10 этапов и обязательный район, без замеров/фото; администратор назначает районы/цвет',async()=>{
 const f=await workflowServer();let b;try{b=await browser(f);const {d,login,wait}=b;await login('operator');assert.equal(d.querySelectorAll('[data-column]').length,10);d.querySelector('[data-flow=create]').click();await wait(()=>d.querySelector('[data-form=create]'));const form=d.querySelector('[data-form=create]');assert.equal(form.elements.name.required,true);assert.equal(form.elements.district_code.required,true);assert.equal(form.elements.comment,undefined);assert.equal(form.querySelector('[data-item]'),null);assert.equal(form.querySelector('[data-action=quote]'),null);assert.equal(form.querySelector('input').name,'phone');assert.equal(form.querySelector('[name=length_m]'),null);assert.equal(form.querySelector('input[type=file]'),null);
  d.querySelector('[data-action=close-action]').click();await login('admin');d.querySelector('[data-view=adminDesk]').click();await wait(()=>d.querySelector('[data-form-name="staff.create"]'));d.querySelector('[data-form-name="staff.create"]').click();const staff=d.querySelector('[data-desk-form="staff.create"]');assert.ok(staff.elements.district_codes);assert.ok(staff.elements.driver_color);staff.elements.role.value='driver';staff.elements.role.dispatchEvent(new b.w.Event('change',{bubbles:true}));assert.equal(staff.elements.district_codes.required,true);assert.equal(staff.elements.district_codes.multiple,true);
 }finally{if(b)await b.close();await f.close();}
});
test('DOM: итоговые цифры фильтруются SQL, галерея закрыта по умолчанию, упаковщик получает фото-чек',async()=>{
 const f=await workflowServer();let b;try{await advance(f.sql,f.orderId,'pack_accepted');await f.db.rpc('crm_measurements',{oid:f.orderId,u:ids.admin});b=await browser(f);const {d,login,wait,submit}=b;await login('packer');assert.equal(d.querySelectorAll('[data-column]').length,1);
  d.querySelector('[data-flow=open]').click();await wait(()=>d.querySelector('[data-photo-gallery]'));assert.ok(d.querySelector('[data-flow=pack-photo]'));assert.equal(d.querySelectorAll('#detail [data-photo-gallery]').length,1);const gallery=d.querySelector('[data-photo-gallery]');assert.equal(gallery.open,false);assert.equal(gallery.dataset.url,'/orders/'+f.orderId+'/photos');assert.equal(gallery.querySelectorAll('img').length,0);gallery.open=true;gallery.dispatchEvent(new b.w.Event('toggle'));await wait(()=>gallery.querySelector('[data-gallery-photo]'));assert.ok(gallery.querySelector('[data-gallery-photo]').src.startsWith('https://example.test/private/'));d.querySelector('[data-action=close-detail]').click();
  const filter=d.querySelector('[data-stage-filter]');filter.querySelector('[name=min_price]').value='999999';submit(filter);await wait(()=>!d.querySelector('[data-card]'));assert.equal(d.querySelector('[data-column-totals] dd').textContent,'0');
 }finally{if(b)await b.close();await f.close();}
});

