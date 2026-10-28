import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {workflowServer} from './helpers/workflow-server.js';
import {ids} from './helpers/database.js';

test('DOM + HTTP + SQL: оператор запрашивает удаление и отменяет; admin удаляет, находит в корзине, восстанавливает; аудит хранит четыре события',async()=>{
 const fixture=await workflowServer();let dom;
 const wait=async(predicate)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error(`Ожидание UI истекло: ${dom?.window.document.body.textContent}`);};
 try {
  const [html,dict,app]=await Promise.all(['index.html','i18n.js','app.js'].map(name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8')));
  dom=new JSDOM(html,{url:fixture.url,runScripts:'outside-only'});
  const {window}=dom,d=window.document;
  window.fetch=(path,args)=>fetch(new URL(path,fixture.url),args);
  window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  // Только модульная оболочка снята для jsdom, весь код интерфейса выполняется без подмены.
  window.eval(`${dict.replace(/\bexport /g,'')}\n${app.replace(/^import .*;\r?\n/,'')}`);
  const click=(action)=>{const el=d.querySelector(`[data-action="${action}"]`);assert.ok(el,action);el.click();};
  const submit=kind=>d.querySelector(`[data-form="${kind}"]`).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const login=async role=>{
   await wait(()=>d.querySelector('[data-form="login"]'));d.querySelector('[name=email]').value=`${role}@example.test`;d.querySelector('[name=password]').value='test';submit('login');
   await wait(()=>d.querySelector('.card'));
  };
  await login('operator');assert.equal(d.querySelector('[data-view="trash"]'),null);
  click('details');await wait(()=>d.querySelector('#detail[open]'));
  assert.equal(d.querySelector('[data-action="delete"]'),null);click('request-deletion');
  d.querySelector('#action [name=reason]').value='Дубликат';submit('request-deletion');
  await wait(()=>!d.querySelector('#action[open]')&&d.querySelector('.card')?.textContent.includes('Ожидает решения'));
  click('details');await wait(()=>d.querySelector('#detail[open]'));click('cancel');
  d.querySelector('[name=reason_code]').value='other';d.querySelector('[name=comment]').value='Дубликат подтверждён';submit('cancel');
  await wait(()=>!d.querySelector('#action[open]')&&d.querySelector('.card .pill.cancelled'));
  click('logout');await login('admin');click('details');await wait(()=>d.querySelector('#detail[open]'));click('delete');
  d.querySelector('#action [name=reason]').value='Дубликат, проверен';submit('delete');
  await wait(()=>!d.querySelector('#action[open]')&&!d.querySelector('.card'));
  d.querySelector('[data-view=trash]').click();await wait(()=>d.querySelector('.card'));
  assert.match(d.querySelector('.card').textContent,/Дубликат, проверен/);assert.match(d.querySelector('.card').textContent,/\+998901234567/);
  d.querySelector('[name=deleted_by]').value=ids.admin;d.querySelector('[name=reason]').value='Дубликат';submit('filters');
  await wait(()=>d.querySelector('.card'));click('details');await wait(()=>d.querySelector('#detail[open]'));
  assert.match(d.querySelector('#detail').textContent,/Сохранённый состав заказа/);click('restore');
  await wait(()=>!d.querySelector('#detail[open]')&&!d.querySelector('.card'));
  d.querySelector('[data-view=orders]').click();await wait(()=>d.querySelector('.card .pill.cancelled'));
  d.querySelector('[data-view=audit]').click();await wait(()=>d.querySelector('.event'));
  for(const text of ['Заявка на удаление','Отказ клиента','Удаление в корзину','Восстановление']) assert.ok(d.querySelector('.events').textContent.includes(text),text);
  const order=(await fixture.sql.query('select status,restored_by from orders where id=$1',[fixture.orderId])).rows[0];
  assert.equal(order.status,'cancelled');assert.equal(order.restored_by,ids.admin);
 }finally{dom?.window.close();await fixture.close();}
});
