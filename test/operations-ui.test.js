import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {workflowServer} from './helpers/workflow-server.js';
test('экраны этапа 4: склад, нормы, планирование и ограничения руководителя',async()=>{
 const f=await workflowServer();let dom;const wait=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error(dom.window.document.body.textContent);};
 try{
  const files=await Promise.all(['index.html','i18n.js','workspaces.js','reports.js','operations.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'});const w=dom.window,d=w.document;
  w.fetch=(path,args)=>fetch(new URL(path,f.url),args);w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(files.slice(1).map(code=>code.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const login=async role=>{d.querySelector('[name=email]').value=role+'@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('[data-action=logout]'));};
  await login('admin');await wait(()=>d.querySelector('[data-view=stockroom]'));d.querySelector('[data-view=stockroom]').click();await wait(()=>d.querySelector('[data-form="material.save"]'));d.querySelector('[data-form="material.save"]').click();await wait(()=>d.querySelector('[data-desk-form="material.save"]'));
  const form=d.querySelector('[data-desk-form="material.save"]');form.elements.code.value='ui_chemical';form.elements.name.value='Химия UI';form.elements.unit.value='л';form.elements.norm_per_m2.value='.05';submit('[data-desk-form="material.save"]');await wait(()=>!d.querySelector('#action').hasAttribute('open'));await wait(()=>d.querySelector('#operations-result')?.textContent.includes('Химия UI'));assert.ok(d.querySelector('[data-ops=adjust]'));
  d.querySelector('[data-view=planningDesk]').click();await wait(()=>d.querySelector('#operations-result')?.textContent.includes('Свободно'));assert.match(d.querySelector('#operations-result').textContent,/Дорожное время/);
  d.querySelector('[data-action=logout]').click();await login('manager');await wait(()=>d.querySelector('[data-view=alerts]'));await wait(()=>d.querySelector('.report-kpis'));assert.equal(d.querySelector('[data-view=stockroom]'),null);assert.equal(d.querySelector('[data-view=integrationsDesk]'),null);assert.ok(d.querySelector('[data-view=payrollDesk]'));
 }finally{dom?.window.close();await f.close();}
});
