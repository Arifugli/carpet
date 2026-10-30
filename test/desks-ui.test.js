import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {workflowServer} from './helpers/workflow-server.js';
import {ids} from './helpers/database.js';

test('экраны: повторный заказ, перезвон, доска диспетчера, водитель и очередь цеха',async()=>{
 const fixture=await workflowServer();let dom;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw new Error('UI timeout: '+dom.window.document.body.textContent);};
 try{
  const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(f=>readFile(new URL(`../public/${f}`,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:fixture.url,runScripts:'outside-only'});const w=dom.window,d=w.document;
  Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,fixture.url),args);
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(files.slice(1).map(code=>code.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const click=selector=>{assert.ok(d.querySelector(selector),selector);d.querySelector(selector).click();};
  const login=async role=>{await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value=`${role}@example.test`;d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('nav'));};
  await login('operator');await wait(()=>d.querySelector('.card'));
  click('[data-view=clients]');await wait(()=>d.querySelector('[data-desk-filter]'));d.querySelector('[name=phone]').value='+998901234567';submit('[data-desk-filter]');
  await wait(()=>d.querySelector('[data-desk=repeat]'));click('[data-desk=repeat]');await wait(()=>d.querySelector('#action[open] [data-form=create]'));
  assert.equal(d.querySelector('#action [name=phone]').value,'+998901234567');assert.equal(d.querySelector('#action [name=length_m]'),null);assert.equal(d.querySelector('#action [name=quantity]').value,'1');
  for(const [key,value] of Object.entries({district_code:'fergana_city',street:'Тестовая',house:'1',apartment:'2'}))d.querySelector(`#action [name=${key}]`).value=value;
  d.querySelector('#action [name=pickup_date]').value='2026-10-30';click('[data-action=quote]');await wait(()=>d.querySelector('#quote-result').textContent.includes('Стоимость после замера'));
  click('[data-action=close-action]');click('[data-view=leads]');await wait(()=>d.querySelector('[data-form-name="lead.save"]'));
  click('[data-form-name="lead.save"]');d.querySelector('#action [name=phone]').value='+998901234567';d.querySelector('#action [name=outcome]').value='callback';d.querySelector('#action [name=callback_at]').value='2026-10-30T11:00';submit('[data-desk-form="lead.save"]');
  await wait(()=>!d.querySelector('#action[open]'));click('[data-view=tasks]');await wait(()=>d.querySelector('[data-desk=task-complete]'));
  click('[data-action=logout]');await login('dispatcher');await wait(()=>d.querySelector('[data-form-name="visit.schedule"]'));
  click('[data-form-name="visit.schedule"]');await wait(()=>d.querySelector('[data-desk-form="visit.schedule"]'));
  d.querySelector('#action [name=order_id]').value=fixture.orderId;d.querySelector('#action [name=driver_id]').value=ids.driver;d.querySelector('#action [name=slot_code]').value='morning';d.querySelector('#action [name=scheduled_date]').value='2026-10-30';submit('[data-desk-form="visit.schedule"]');
  await wait(()=>!d.querySelector('#action[open]'));click('[data-action=logout]');await login('driver');await wait(()=>d.querySelector('[data-desk-filter]'));
  d.querySelector('[data-desk-filter] [name=date]').value='2026-10-30';submit('[data-desk-filter]');await wait(()=>d.querySelector('[data-event=departed]'));
  click('[data-event=departed]');await wait(()=>d.querySelector('[data-event=completed]'));click('[data-event=completed]');await wait(()=>!d.querySelector('[data-event=completed]'));
  click('[data-action=logout]');await login('workshop');await wait(()=>d.querySelector('[data-desk=advance]'));click('[data-desk=advance]');
  await wait(()=>d.querySelector('#desk-list')?.textContent.includes('Стирка'));
  assert.equal((await fixture.sql.query('select status from orders where id=$1',[fixture.orderId])).rows[0].status,'washing');
 }finally{dom?.window.close();await fixture.close();}
});
