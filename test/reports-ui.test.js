import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {workflowServer} from './helpers/workflow-server.js';
test('руководитель: дашборд, смена отчёта, фильтры и доступность экспорта',async()=>{
 const fixture=await workflowServer();let dom;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw new Error(dom.window.document.body.textContent);};
 try{
  const files=await Promise.all(['index.html','i18n.js','workspaces.js','reports.js','app.js'].map(name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:fixture.url,runScripts:'outside-only'});const w=dom.window,d=w.document;
  w.fetch=(path,args)=>fetch(new URL(path,fixture.url),args);w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.eval(files.slice(1).map(code=>code.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  d.querySelector('[name=email]').value='manager@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');
  await wait(()=>d.querySelector('[data-report-form]'));await wait(()=>d.querySelector('.report-kpis'));
  assert.ok(d.querySelector('[data-view=reports]'));assert.equal(d.querySelector('[data-view=adminDesk]'),null);
  d.querySelector('[name=report_name]').value='debt';submit('[data-report-form]');
  await wait(()=>d.querySelector('#report-result').textContent.includes('180'));
  assert.equal(d.querySelector('[data-report-export]').disabled,false);assert.match(d.querySelector('#report-result').textContent,/K-1041/);
 }finally{dom?.window.close();await fixture.close();}
});
