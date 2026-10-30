import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {database,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';

export const booking={name:'Тестовый клиент',phone:'+998901234568',pickup_date:'2026-10-30',region_code:'fergana',district_code:'fergana_city',street:'Тестовая',house:'10',apartment:'5',landmark:'У парка',items:[{tariff:'carpet',quantity:1}]};
const branch='01000000-0000-4000-8000-000000000001';
const command=(db,name,data,role='admin',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],'127.0.0.1',key]);
const create=(db,data=booking,role='operator',key=randomUUID())=>call(db,'create_order_audited',[JSON.stringify(data),ids[role],'127.0.0.1',key]);
const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const status=(db,id,value)=>call(db,'change_order_status_audited',[id,value,ids.admin,null,null]);
async function assign(db,id){await call(db,'assign_order_driver',[id,ids.operator,ids.driver,null]);await status(db,id,'pickup_assigned');}

test('новая запись: 14 регионов, 19 территорий Ферганы, структурированный адрес и отсутствие выдуманных размеров',async()=>{
 const db=await database();try{
  const meta=await call(db,'crm_workspace',['bootstrap','{}',ids.operator]);assert.equal(meta.regions.length,14);assert.equal(meta.districts.length,19);assert.equal(meta.districts.filter(d=>d.kind==='district').length,15);assert.ok(meta.districts.every(d=>d.region_code==='fergana'));
  assert.deepEqual(meta.tariffs.map(t=>[t.code,t.price_per_m2,t.unit]),[['carpet',12000,'m2'],['blanket',30000,'piece'],['tushak',30000,'piece']]);
  const key=randomUUID(),id=await create(db,booking,'operator',key);assert.equal(await create(db,booking,'operator',key),id);
  const o=(await db.query('select * from orders where id=$1',[id])).rows[0];assert.equal(o.pricing_state,'awaiting_measurements');assert.equal(Number(o.total),0);assert.match(o.address,/кв. 5/);assert.match(o.address,/У парка/);assert.doesNotMatch(o.route_address,/кв\.|парк/);assert.equal(o.latitude,null);
  const i=(await db.query('select * from order_items where order_id=$1',[id])).rows[0];assert.equal(i.length_m,null);assert.equal(i.area_m2,null);assert.equal(i.unit_rate,'12000');
  await fails(()=>create(db,{...booking,items:[{tariff:'carpet',length_m:3,width_m:2}]}),'42501');
  await fails(()=>create(db,{...booking,region_code:'andijan'}),'23514');
  await fails(()=>create(db,{...booking,street:''}),'23514');await fails(()=>create(db,{...booking,apartment:''}),'23514');
  assert.ok(await create(db,{...booking,region_code:'andijan',district_code:undefined,private_house:true,apartment:undefined,landmark:undefined}));
  const publicStatus=await call(db,'public_order_status',[o.track_token]);assert.equal(publicStatus.pricing_state,'awaiting_measurements');assert.equal(publicStatus.address,undefined);
  const b=await command(db,'branch.save',{code:'test_new',name:'Новый филиал'});const m=await call(db,'crm_workspace',['bootstrap',JSON.stringify({branch_id:b.id}),ids.admin]);assert.equal(m.tariffs.find(t=>t.code==='blanket').unit,'piece');assert.equal(m.tariffs.find(t=>t.code==='carpet').active,true);
 }finally{await db.close();}
});

test('приёмка: независимые замеры, причина расхождения, история и сохранение цены водителя',async()=>{
 const db=await database();try{
  const id=await create(db,{...booking,items:[{tariff:'carpet',quantity:2},{tariff:'blanket',quantity:2},{tariff:'tushak',quantity:1}]});await assign(db,id);
  let items=await call(db,'crm_measurements',[id,ids.driver]);const [a,b,c,d,e]=items;assert.equal(items.length,5);
  await fails(()=>command(db,'item.measure',{item_id:a.id,length_m:3,width_m:2},'operator'),'42501');
  await fails(()=>command(db,'item.measure',{item_id:a.id,length_m:3.333,width_m:2},'driver'),'23514');
  const key=randomUUID(),data={item_id:a.id,length_m:3,width_m:2,expected_id:null};const sample=await command(db,'item.measure',data,'driver',key);assert.equal((await command(db,'item.measure',data,'driver',key)).id,sample.id);
  assert.equal(Number((await db.query('select length_m from order_items where id=$1',[a.id])).rows[0].length_m),3);
  await fails(()=>command(db,'payment.record',{order_id:id,amount:1000,method:'cash'}),'23514');await fails(()=>command(db,'intake.create',{order_id:id,note:'Тест'}),'55000');
  await command(db,'tariff.schedule',{branch_id:branch,code:'carpet',name:'Ковры',price_per_m2:15000,unit:'m2',effective_at:new Date().toISOString()});
  await fails(()=>command(db,'tariff.schedule',{branch_id:branch,code:'blanket',name:'Одеяло',price_per_m2:30000,unit:'m2',effective_at:new Date().toISOString()}),'23514');
  await command(db,'item.measure',{item_id:b.id,length_m:3,width_m:2},'driver');for(const i of [c,d,e])await command(db,'item.measure',{item_id:i.id},'driver');
  for(const i of items)await call(db,'register_order_photo',[i.id,`${id}/${i.id}/${randomUUID()}.jpg`,'intake',ids.driver,null]);
  await command(db,'pickup.collect',{order_id:id,expected_state:'pending'},'driver');await command(db,'pickup.handover',{order_id:id,expected_state:'picked_up'},'driver');await command(db,'workshop.accept',{order_id:id,expected_state:'handed_over'},'workshop');
  await fails(()=>command(db,'item.measure',{item_id:a.id,length_m:3.5,width_m:2},'workshop'),'23514');
  await command(db,'item.measure',{item_id:a.id,length_m:3.5,width_m:2,reason:'Повторный замер рулеткой',expected_id:null},'workshop');
  await fails(()=>command(db,'item.measure',{item_id:a.id,length_m:4,width_m:2,reason:'Исправление',expected_id:null},'workshop'),'55000');
  await fails(()=>command(db,'item.measure',{item_id:b.id,length_m:3,width_m:2},'driver'),'55000');
  let o=(await db.query('select * from orders where id=$1',[id])).rows[0];assert.equal(Number(o.total),234000);assert.equal(o.pricing_state,'priced');
  await fails(()=>command(db,'workshop.advance',{order_id:id,expected_stage:'received'},'workshop'),'55000');await command(db,'payment.record',{order_id:id,amount:1000,method:'cash'});
  await command(db,'item.measure',{item_id:b.id,length_m:4,width_m:2,reason:'Контрольный замер'},'workshop');for(const i of [c,d,e])await command(db,'item.measure',{item_id:i.id},'workshop');
  assert.equal(Number((await db.query('select total from orders where id=$1',[id])).rows[0].total),234000);await command(db,'workshop.advance',{order_id:id,expected_stage:'received'},'workshop');
  items=await call(db,'crm_measurements',[id,ids.workshop]);assert.deepEqual(items[0].measurements.map(m=>m.source_role),['workshop','driver']);assert.equal(items[0].unit_rate,12000);assert.equal(items[0].area_m2,7);
  await fails(()=>db.query('update item_measurements set length_m=10 where id=$1',[sample.id]),'42501');await fails(()=>db.query('delete from item_measurements where id=$1',[sample.id]),'42501');
  await db.exec('reset role');await fails(()=>db.query('update item_measurements set length_m=10 where id=$1',[sample.id]),'55000');await db.exec('set role service_role');
 }finally{await db.close();}
});

test('поштучная цена зависит от количества, оператор HTTP не может передать замеры, чужой водитель не видит историю',async()=>{
 const f=await workflowServer();try{
  const request=(path,body,role='operator')=>fetch(f.url+'/api'+path,{method:'POST',headers:{Authorization:'Bearer '+role,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
  const quote=await (await request('/quote',{items:[{tariff:'blanket',quantity:3},{tariff:'tushak',quantity:2}]})).json();assert.equal(quote.total,150000);assert.equal(quote.pending_measurements,false);
  let r=await request('/orders',{...booking,items:[{tariff:'carpet',length_m:3,width_m:2}]});assert.equal(r.status,403);
  r=await request('/orders',{...booking,landmark:undefined});assert.equal(r.status,201);const o=await r.json();assert.equal(o.pricing_state,'awaiting_measurements');
  r=await fetch(f.url+`/api/orders/${o.id}/measurements`,{headers:{Authorization:'Bearer driver'}});assert.equal(r.status,403);
  r=await request('/actions/item.measure',{item_id:o.items[0].id,length_m:3,width_m:2});assert.equal(r.status,403);
 }finally{await f.close();}
});

test('DOM + HTTP + SQL: зависимые районы, адрес без координат, запись без размеров и отключаемый маршрут только водителю',async()=>{
 const f=await workflowServer();let dom;try{
  const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'});const w=dom.window,d=w.document;Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>fetch(new URL(path,f.url),args);
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);};
  const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const change=el=>el.dispatchEvent(new w.Event('change',{bubbles:true}));
  const login=async role=>{await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value=role+'@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('nav'));};
  await login('operator');await wait(()=>d.querySelector('[data-action=new-order]'));d.querySelector('[data-action=new-order]').click();
  const form=d.querySelector('[data-form=create]');assert.equal(form.querySelector('[name=length_m]'),null);assert.equal(form.querySelector('[name=latitude]'),null);assert.equal(form.elements.region_code.options.length,15);assert.equal(form.elements.district_code.options.length,20);
  form.elements.region_code.value='andijan';change(form.elements.region_code);assert.equal(form.elements.district_code.disabled,true);assert.match(form.elements.district_code.textContent,/добавлены позже/);form.elements.region_code.value='fergana';change(form.elements.region_code);assert.equal(form.elements.district_code.required,true);
  for(const key of ['name','phone','pickup_date','district_code','street','house','apartment'])form.elements[key].value=booking[key];assert.equal(form.elements.landmark.required,false);
  d.querySelector('[data-action=quote]').click();await wait(()=>d.querySelector('#quote-result').textContent.includes('Стоимость после замера'));
  submit('[data-form=create]');await wait(()=>!d.querySelector('#action[open]'));const order=(await f.sql.query("select * from orders where measurement_mode='verified' order by created_at desc limit 1")).rows[0];assert.ok(order);assert.equal(order.pricing_state,'awaiting_measurements');
  await command(f.sql,'visit.schedule',{order_id:order.id,kind:'pickup',scheduled_date:'2026-10-30',slot_code:'morning',driver_id:ids.driver,zone_code:'fergana_city'},'dispatcher');
  d.querySelector('[data-action=logout]').click();await login('driver');await wait(()=>d.querySelector('[data-desk-filter]'));d.querySelector('[data-desk-filter] [name=date]').value='2026-10-30';submit('[data-desk-filter]');await wait(()=>d.querySelector('[data-driver-map]'));
  d.querySelector(`[data-desk=order][data-order="${order.id}"]`).click();await wait(()=>d.querySelector('#detail[open] [data-desk=measure]'));d.querySelector('#detail[open] [data-desk=measure]').click();
  let measure=d.querySelector('[data-desk-form="item.measure"]');measure.elements.length_m.value='3';measure.elements.width_m.value='2';submit('[data-desk-form="item.measure"]');await wait(()=>!d.querySelector('#action[open]'));assert.match(d.querySelector('[data-measurements]').textContent,/driver/);d.querySelector('[data-action=close-detail]').click();
  assert.equal(d.querySelector('iframe'),null);let toggle=d.querySelector('[data-driver-map]');toggle.checked=true;change(toggle);assert.ok(d.querySelector('iframe'));assert.equal(new URL(d.querySelector('iframe').src).searchParams.get('rtt'),'auto');assert.match(new URL(d.querySelector('iframe').src).searchParams.get('rtext'),/Тестовая/);assert.doesNotMatch(d.querySelector('iframe').src,/кв\./);assert.ok(d.querySelector('.card').textContent.includes('кв. 5'));
  toggle=d.querySelector('[data-driver-map]');toggle.checked=false;change(toggle);assert.equal(d.querySelector('iframe'),null);assert.equal(w.localStorage.getItem('crm:driver-map:'+ids.driver),'off');
  d.querySelector('[data-action=logout]').click();await login('dispatcher');await wait(()=>d.querySelector('[data-desk-filter]'));d.querySelector('[data-desk-filter] [name=date]').value='2026-10-30';submit('[data-desk-filter]');await wait(()=>d.querySelector('[data-desk=order]'));assert.equal(d.querySelector('[data-driver-map]'),null);assert.equal(d.querySelector('iframe'),null);
  const physical=(await call(f.sql,'crm_measurements',[order.id,ids.driver]))[0];await call(f.sql,'register_order_photo',[physical.id,`${order.id}/${physical.id}/${randomUUID()}.jpg`,'intake',ids.driver,null]);await command(f.sql,'pickup.collect',{order_id:order.id,expected_state:'pending'},'driver');await command(f.sql,'pickup.handover',{order_id:order.id,expected_state:'picked_up'},'driver');await command(f.sql,'workshop.accept',{order_id:order.id,expected_state:'handed_over'},'workshop');d.querySelector('[data-action=logout]').click();await login('workshop');await wait(()=>d.querySelector(`[data-desk=order][data-order="${order.id}"]`));d.querySelector(`[data-desk=order][data-order="${order.id}"]`).click();await wait(()=>d.querySelector('#detail[open] [data-desk=measure]'));d.querySelector('#detail[open] [data-desk=measure]').click();
  measure=d.querySelector('[data-desk-form="item.measure"]');measure.elements.length_m.value='3.5';measure.elements.width_m.value='2';submit('[data-desk-form="item.measure"]');await wait(()=>measure.querySelector('[data-desk-error]').textContent.includes('причину'));measure.elements.reason.value='Проверено рулеткой в цехе';submit('[data-desk-form="item.measure"]');await wait(()=>!d.querySelector('#action[open]'));await wait(()=>d.querySelector('[data-measurements]')?.textContent.includes('Расхождение площади'));assert.match(d.querySelector('[data-measurements]').textContent,/Расхождение площади/);assert.match(d.querySelector('[data-measurements]').textContent,/Проверено рулеткой/);assert.equal(Number((await f.sql.query('select total from orders where id=$1',[order.id])).rows[0].total),92000);
 }finally{await new Promise(r=>setTimeout(r,100));dom?.window.close();await f.close();}
});
