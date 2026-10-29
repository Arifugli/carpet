import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {workflowServer} from './helpers/workflow-server.js';
import {ids} from './helpers/database.js';
const branch='01000000-0000-4000-8000-000000000001';

test('DOM + HTTP + SQL: admin изменяет, удаляет и восстанавливает все пять видов записей',async()=>{
 const f=await workflowServer();let dom;
 try{
  const command=async(name,data)=>{const r=await f.db.rpc('crm_command',{p_command:name,p_data:data,p_user:ids.admin,p_ip:null,p_key:randomUUID()});assert.equal(r.error,null);return r.data;};
  const b=await command('branch.save',{code:'ui_branch',name:'UI филиал'}),c=await command('catalog.save',{kind:'source',code:'ui_source',name_ru:'UI источник'}),template=await command('template.save',{code:'ui_ready',channel:'sms',locale:'ru',body:'UI шаблон',active:true});
  const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'});const w=dom.window,d=w.document;
  Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,f.url),args);
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const wait=async fn=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);};
  const click=selector=>{assert.ok(d.querySelector(selector),selector);d.querySelector(selector).click();};
  const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value='admin@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');
  await wait(()=>d.querySelector('[data-view=adminDesk]'));click('[data-view=adminDesk]');await wait(()=>d.querySelector('[data-desk=admin-tab]'));
  assert.equal(d.querySelector(`[data-admin-entity=staff][data-admin-id="${ids.admin}"] [data-desk=admin-archive]`).disabled,true);
  const cases=[
   {tab:'staff',entity:'staff',id:ids.inactive,field:'full_name',value:'UI сотрудник',check:()=>f.sql.query('select full_name value from profiles where id=$1',[ids.inactive])},
   {tab:'branches',entity:'branch',id:b.id,field:'name',value:'UI новый филиал',check:()=>f.sql.query('select name value from branches where id=$1',[b.id])},
   {tab:'catalogs',entity:'catalog',id:c.id,field:'name_ru',value:'UI новый источник',check:()=>f.sql.query('select name_ru value from catalog_entries where id=$1',[c.id])},
   {tab:'templates',entity:'template',id:template.id,field:'body',value:'UI новый шаблон',check:()=>f.sql.query('select body value from notification_templates where id=$1',[template.id])},
   {tab:'tariffs',entity:'tariff',id:'wool',field:'price_per_m2',value:'37000',check:()=>f.sql.query("select price_per_m2::text value from tariff_versions where code='wool' and branch_id=$1 order by created_at desc limit 1",[branch]),primary:true},
  ];
  for(const x of cases){
   click(`[data-desk=admin-tab][data-tab=${x.tab}]`);
   const card=()=>[...d.querySelectorAll(`[data-admin-entity=${x.entity}][data-admin-id="${x.id}"]`)].find(e=>!x.primary||e.textContent.includes('Ташкент'));
   assert.ok(card(),x.entity);card().querySelector('[data-desk=admin-edit]').click();await wait(()=>d.querySelector('#action[open] form'));
   d.querySelector(`#action [name=${x.field}]`).value=x.value;submit('#action form');await wait(()=>!d.querySelector('#action[open]'));await wait(()=>card()?.querySelector('[data-desk=admin-archive]'));
   assert.equal((await x.check()).rows[0].value,x.value,x.entity);
   card().querySelector('[data-desk=admin-archive]').click();await wait(()=>d.querySelector('[data-desk-form="admin.archive"]'));
   assert.ok(d.querySelector('#action .notice'));submit('[data-desk-form="admin.archive"]');await wait(()=>!d.querySelector('#action[open]'));
   await wait(()=>!card()||card().querySelector('[data-desk=admin-restore]'));
   const toggle=d.querySelector('[data-admin-archived]');toggle.checked=true;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>card()?.querySelector('[data-desk=admin-restore]'));
   card().querySelector('[data-desk=admin-restore]').click();await wait(()=>card()?.querySelector('[data-desk=admin-edit]'));
  }
  assert.equal((await f.sql.query('select active from profiles where id=$1',[ids.inactive])).rows[0].active,false);
 }finally{dom?.window.close();await f.close();}
});
