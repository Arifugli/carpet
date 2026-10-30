import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {database,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
const booking={name:'Тест приёмки',phone:'+998901234572',pickup_date:'2026-10-30',region_code:'fergana',district_code:'fergana_city',street:'Тестовая',house:'15',private_house:true,items:[{tariff:'carpet',quantity:1},{tariff:'blanket',quantity:1}]};
const cmd=(db,name,d,role='workshop',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(d),ids[role],null,key]);
async function oldOrder(db){const id=await call(db,'create_order_audited',[JSON.stringify(booking),ids.operator,null,randomUUID()]);await call(db,'assign_order_driver',[id,ids.operator,ids.driver,null]);await call(db,'change_order_status',[id,'pickup_assigned',ids.operator,null]);await call(db,'change_order_status',[id,'received',ids.driver,null]);return id;}
async function upgrade(db){await db.exec('reset role');for(const file of ['0012_driver_intake.sql','0013_workshop_intake.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));await db.exec('set role service_role');}
const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('приёмка прежнего received: явное подтверждение цехом, без выдуманных замеров/передачи водителя, расчёт с честным источником',async()=>{
 const db=await database({through:'0011_booking_measurements.sql'});try{
  const id=await oldOrder(db);await upgrade(db);let c=await call(db,'crm_workshop_intake',[id,ids.workshop]);assert.equal(c.can_recover,true);assert.equal(c.can_measure,false);assert.equal(c.can_advance,false);
  const rows=await call(db,'crm_measurements',[id,ids.workshop]);await fails(()=>cmd(db,'item.measure',{item_id:rows[0].id,length_m:3,width_m:2}),'55000');
  const key=randomUUID(),body={order_id:id,expected_state:'picked_up'};await cmd(db,'workshop.recover',body,'workshop',key);await cmd(db,'workshop.recover',body,'workshop',key);
  const o=(await db.query('select * from orders where id=$1',[id])).rows[0];assert.equal(o.pickup_state,'accepted');assert.equal(o.handed_over_at,null);assert.equal(o.picked_up_at,null);assert.equal(o.pricing_snapshot.price_basis,'workshop_recovery');assert.equal(Number(o.total),0);
  assert.equal((await db.query('select count(*) n from pickup_events where order_id=$1',[id])).rows[0].n,1);assert.equal((await call(db,'crm_workshop_intake',[id,ids.workshop])).can_measure,true);
  const result=await cmd(db,'order.measure',{order_id:id,items:rows.map(i=>({item_id:i.id,expected_id:null,...(i.unit==='m2'?{length_m:3,width_m:2}:{})}))});assert.equal(result.total,122000);
  assert.equal((await db.query("select count(*) n from item_measurements m join order_items i on i.id=m.item_id where i.order_id=$1 and source_role='driver'",[id])).rows[0].n,0);
  assert.equal((await call(db,'crm_workshop_intake',[id,ids.workshop])).can_advance,true);await cmd(db,'workshop.advance',{order_id:id,expected_stage:'received'});assert.equal((await call(db,'crm_workshop_intake',[id,ids.workshop])).can_measure,false);
 }finally{await db.close();}
});
test('восстановление приёмки недоступно оператору, чужому филиалу и новым заказам; миграция не принимает заказ сама',async()=>{
 const db=await database({through:'0011_booking_measurements.sql'});try{
  const id=await oldOrder(db),before=(await db.query('select total,paid_amount,status from orders where id=$1',[id])).rows[0];await upgrade(db);assert.deepEqual((await db.query('select total,paid_amount,status from orders where id=$1',[id])).rows[0],before);assert.equal((await db.query('select count(*) n from pickup_events')).rows[0].n,0);
  await fails(()=>cmd(db,'workshop.recover',{order_id:id,expected_state:'picked_up'},'operator'),'42501');
  const current=await call(db,'create_order_audited',[JSON.stringify({...booking,phone:'+998901234573'}),ids.operator,null,randomUUID()]);await fails(()=>cmd(db,'workshop.recover',{order_id:current,expected_state:'picked_up'}),'42501');
  const b=await cmd(db,'branch.save',{code:'shop_other',name:'Другой филиал'},'admin');await db.query('update profiles set branch_id=$1 where id=$2',[b.id,ids.workshop]);await fails(()=>cmd(db,'workshop.recover',{order_id:id,expected_state:'picked_up'}),'42501');
 }finally{await db.close();}
});

async function domFixture(f){
 const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8'))),dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'}),w=dom.window,d=w.document;
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,f.url),args);w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
 const wait=async fn=>{for(let n=0;n<250;n++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);},submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value='workshop@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('nav'));return {dom,w,d,wait,submit};
}
test('DOM → HTTP → SQL: карточка прежнего заказа показывает поля, «Принял» их открывает, цех сохраняет размеры прямо в карточке',async()=>{
 const f=await workflowServer({}, {through:'0011_booking_measurements.sql'});let ui;try{
  const id=await oldOrder(f.sql);await upgrade(f.sql);ui=await domFixture(f);const {w,d,wait,submit}=ui;
  d.querySelector('[data-view=orders]').click();await wait(()=>d.querySelector('[data-action=details][data-id="'+id+'"]'));d.querySelector('[data-action=details][data-id="'+id+'"]').click();await wait(()=>d.querySelector('#detail [data-inline-workshop]'));
  let form=d.querySelector('[data-inline-workshop]');assert.ok(form.querySelector('[name=length_m]'));assert.equal(form.querySelector('[name=length_m]').matches(':disabled'),true);assert.equal(d.querySelector('[data-desk=advance-detail]').disabled,true);assert.match(d.querySelector('#detail').textContent,/прежней схеме/);
  d.querySelector('[data-desk=accept-in-card]').click();await wait(()=>d.querySelector('[data-inline-workshop] [name=length_m]')&&!d.querySelector('[data-inline-workshop] [name=length_m]').matches(':disabled'));
  form=d.querySelector('[data-inline-workshop]');assert.equal(form.querySelector('[name=length_m]').value,'');form.querySelector('[name=length_m]').value='3';form.querySelector('[name=width_m]').value='2';form.querySelector('[name=confirm_piece]').checked=true;submit('[data-inline-workshop]');
  await wait(()=>d.querySelector('[data-desk=advance-detail]')&&!d.querySelector('[data-desk=advance-detail]').disabled);assert.equal(Number((await f.sql.query('select total from orders where id=$1',[id])).rows[0].total),122000);assert.match(d.querySelector('[data-measurements]').textContent,/Цех/);
  d.querySelector('[data-desk=advance-detail]').click();await wait(()=>d.querySelector('#detail [data-measurements]')?.textContent.includes('workshop')&&!d.querySelector('[data-inline-workshop]'));assert.equal((await f.sql.query('select status from orders where id=$1',[id])).rows[0].status,'washing');
 }finally{await new Promise(r=>setTimeout(r,100));ui?.dom.window.close();await f.close();}
});
test('обычная передача: цех принимает из карточки заказа и видит открытые поля без перехода на другую доску',async()=>{
 const f=await workflowServer();let ui;try{
  const id=await call(f.sql,'create_order_audited',[JSON.stringify(booking),ids.operator,null,randomUUID()]);await call(f.sql,'assign_order_driver',[id,ids.operator,ids.driver,null]);await call(f.sql,'change_order_status',[id,'pickup_assigned',ids.operator,null]);const list=await call(f.sql,'crm_measurements',[id,ids.driver]);
  await cmd(f.sql,'order.measure',{order_id:id,items:list.map(i=>({item_id:i.id,...(i.unit==='m2'?{length_m:3,width_m:2}:{})}))},'driver');for(const i of list)await call(f.sql,'register_order_photo',[i.id,`${id}/${i.id}/${randomUUID()}.jpg`,'intake',ids.driver,null]);await cmd(f.sql,'pickup.collect',{order_id:id,expected_state:'pending'},'driver');await cmd(f.sql,'pickup.handover',{order_id:id,expected_state:'picked_up'},'driver');
  ui=await domFixture(f);const {w,d,wait}=ui;await wait(()=>d.querySelector('[data-desk=order][data-order="'+id+'"]'));d.querySelector('[data-desk=order][data-order="'+id+'"]').click();await wait(()=>d.querySelector('#detail [data-desk=accept-in-card]'));d.querySelector('#detail [data-desk=accept-in-card]').click();await wait(()=>d.querySelector('[data-inline-workshop] [name=length_m]')&&!d.querySelector('[data-inline-workshop] [name=length_m]').matches(':disabled'));
  assert.equal(d.querySelector('[data-inline-workshop] [name=length_m]').value,'');assert.equal(Number((await f.sql.query('select total from orders where id=$1',[id])).rows[0].total),122000);assert.equal((await call(f.sql,'crm_workshop_intake',[id,ids.workshop])).recovery_pricing,false);
 }finally{await new Promise(r=>setTimeout(r,100));ui?.dom.window.close();await f.close();}
});
