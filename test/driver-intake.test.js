import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {database,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
const branch='01000000-0000-4000-8000-000000000001';
const booking={name:'Тестовый клиент',phone:'+998901234570',pickup_date:'2026-10-30',region_code:'fergana',district_code:'fergana_city',street:'Тестовая',house:'12',private_house:true,items:[{tariff:'carpet',quantity:1},{tariff:'blanket',quantity:1}]};
const cmd=(db,name,d,role='driver',key=randomUUID())=>call(db,'crm_command',[name,JSON.stringify(d),ids[role],'127.0.0.1',key]);
const view=(db,name,role,filters={})=>call(db,'crm_workspace',[name,JSON.stringify(filters),ids[role]]);
const create=async db=>{const id=await call(db,'create_order_audited',[JSON.stringify(booking),ids.operator,null,randomUUID()]);await call(db,'assign_order_driver',[id,ids.operator,ids.driver,null]);await call(db,'change_order_status',[id,'pickup_assigned',ids.operator,null]);return id;};
const items=(db,id)=>call(db,'crm_measurements',[id,ids.driver]);
const photo=(db,id,item)=>call(db,'register_order_photo',[item,`${id}/${item}/${randomUUID()}.jpg`,'intake',ids.driver,null]);
const measure=(db,id,list,role='driver',width=3)=>cmd(db,'order.measure',{order_id:id,items:list.map(i=>({item_id:i.id,...(i.unit==='m2'?{length_m:width,width_m:2}:{}),expected_id:i.measurements?.find(m=>m.source_role===role)?.id||null,...(role==='workshop'&&width!==3?{reason:'Контрольный замер в цехе'}:{})}))},role);
const fails=(fn,code)=>assert.rejects(fn,e=>e.code===code);

test('водитель рассчитывает цену у клиента; забор, передача и приём разделены, замер цеха не меняет оплаченную цену',async()=>{
 const db=await database();try{
  const id=await create(db),list=await items(db,id);await fails(()=>cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'}),'55000');
  const quote=await measure(db,id,list);assert.equal(quote.total,122000);assert.equal(quote.pricing_state,'priced');assert.equal((await db.query('select measurement_origin from order_items where id=$1',[list[0].id])).rows[0].measurement_origin,'driver');
  await fails(()=>cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'}),'55000');
  for(const i of list)await photo(db,id,i.id);
  await cmd(db,'payment.record',{order_id:id,amount:122000,method:'cash'});
  const key=randomUUID(),collected=await cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'},'driver',key);assert.equal((await cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'},'driver',key)).picked_up_at,collected.picked_up_at);
  assert.equal(collected.status,'pickup_assigned');assert.equal(collected.pickup_state,'picked_up');assert.equal((await view(db,'workshop','workshop')).data.length,0);
  assert.ok((await view(db,'driver','driver',{date:'2026-11-02'})).data.some(o=>o.order_id===id));
  await fails(async()=>measure(db,id,await items(db,id)),'55000');await fails(()=>cmd(db,'workshop.accept',{order_id:id,expected_state:'picked_up'},'workshop'),'42501');
  await cmd(db,'pickup.handover',{order_id:id,expected_state:'picked_up'});let workshop=await view(db,'workshop','workshop');assert.equal(workshop.data[0].stage,'awaiting_acceptance');
  await fails(async()=>measure(db,id,await items(db,id),'workshop',3.5),'55000');
  await cmd(db,'workshop.accept',{order_id:id,expected_state:'handed_over'},'workshop');
  await fails(()=>cmd(db,'workshop.advance',{order_id:id,expected_stage:'received'},'workshop'),'55000');
  const result=await measure(db,id,await items(db,id),'workshop',3.5);assert.equal(result.total,122000);
  const measured=await items(db,id);assert.equal(measured[0].area_m2,7);assert.equal(measured[0].price,72000);assert.deepEqual(measured[0].measurements.map(m=>m.source_role),['workshop','driver']);
  await cmd(db,'workshop.advance',{order_id:id,expected_stage:'received'},'workshop');
  const rows=(await db.query('select event,actor_id,snapshot from pickup_events where order_id=$1 order by created_at,id',[id])).rows;assert.deepEqual(rows.map(r=>r.event),['collected','handed_over','accepted']);assert.equal(rows[0].snapshot.total,122000);assert.equal(rows[2].actor_id,ids.workshop);
 }finally{await db.close();}
});

test('протокол нельзя обойти старым status/visit API; чужая роль и неполный пакет замеров отклоняются атомарно',async()=>{
 const db=await database();try{
  const id=await create(db),list=await items(db,id);
  await fails(()=>call(db,'change_order_status',[id,'received',ids.admin,null]),'55000');
  await fails(()=>cmd(db,'order.measure',{order_id:id,items:[{item_id:list[0].id,length_m:3,width_m:2}] }),'23514');assert.equal((await db.query('select count(*) n from item_measurements')).rows[0].n,0);
  await fails(()=>measure(db,id,list,'operator'),'42501');
  await measure(db,id,list);for(const i of list)await photo(db,id,i.id);
  await fails(()=>cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'},'operator'),'42501');
  const v=await cmd(db,'visit.schedule',{order_id:id,kind:'pickup',scheduled_date:'2026-10-30',slot_code:'morning',driver_id:ids.driver},'dispatcher');
  await fails(()=>cmd(db,'visit.event',{visit_id:v.id,event:'completed',expected_state:'planned'}),'55000');
  await cmd(db,'pickup.collect',{order_id:id,expected_state:'pending'});await fails(()=>cmd(db,'pickup.handover',{order_id:id,expected_state:'pending'}),'55000');
  await cmd(db,'pickup.handover',{order_id:id,expected_state:'picked_up'});await fails(()=>cmd(db,'workshop.accept',{order_id:id,expected_state:'handed_over'},'driver'),'42501');
 }finally{await db.close();}
});

test('обновление 0.6: водитель может завершить замер уже забранного заказа, фото и прежние суммы не пропадают',async()=>{
 const db=await database({through:'0011_booking_measurements.sql'});try{
  const id=await create(db),list=await items(db,id);for(const i of list)await photo(db,id,i.id);
  await call(db,'change_order_status',[id,'received',ids.driver,null]);const before=(await db.query('select total from orders where id=$1',[id])).rows[0].total;
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/0012_driver_intake.sql',import.meta.url),'utf8'));await db.exec('set role service_role');
  const o=(await db.query('select * from orders where id=$1',[id])).rows[0];assert.equal(o.pickup_state,'picked_up');assert.equal(o.total,before);assert.equal(o.driver_measurement_closed_at,null);
  const tasks=await view(db,'driver','driver',{date:'2026-11-03'});assert.ok(tasks.data.some(o=>o.order_id===id&&o.can_driver_measure));
  assert.equal((await call(db,'crm_photo_gallery',[JSON.stringify({order_id:id}),ids.operator])).data.length,2);
  assert.equal((await measure(db,id,list)).total,122000);await cmd(db,'pickup.handover',{order_id:id,expected_state:'picked_up'});
 }finally{await db.close();}
});

test('HTTP фото: любой участник филиала видит фото клиента, посторонний филиал закрыт, приватные ссылки выдаются по запросу',async()=>{
 const f=await workflowServer();try{
  const id=await create(f.sql),list=await items(f.sql,id);for(const i of list)await photo(f.sql,id,i.id);
  await f.db.rpc('crm_workspace',{p_view:'bootstrap',p_filters:{},p_user:ids.admin});
  const cid=(await f.sql.query('select client_id from orders where id=$1',[id])).rows[0].client_id;
  const get=(path,role='operator')=>fetch(f.url+'/api'+path,{headers:{Authorization:'Bearer '+role}});
  for(const role of ['admin','manager','operator','dispatcher','driver','workshop']){const r=await get(`/clients/${cid}/photos`,role);assert.equal(r.status,200,role);const data=await r.json();assert.equal(data.data.length,2);assert.ok(data.data.every(p=>p.url.startsWith('https://example.test/private/')&&!p.storage_path));}
  const r=await get(`/orders/${id}`,'driver'),detail=await r.json();assert.equal(detail.items[0].photos[0].url,undefined);
  const first=await(await get(`/orders/${id}/photos?limit=1`)).json();assert.ok(first.next_cursor);const second=await(await get(`/orders/${id}/photos?limit=1&cursor=${first.next_cursor}`)).json();assert.notEqual(first.data[0].id,second.data[0].id);
  const storage=f.db.storage.from;f.db.storage.from=()=>({...storage(),exists:async()=>({data:false,error:{status:404}})});
  const missing=await fetch(f.url+`/api/items/${list[0].id}/photos`,{method:'POST',headers:{Authorization:'Bearer driver','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({path:`${id}/${list[0].id}/${randomUUID()}.jpg`,kind:'intake'})});assert.equal(missing.status,409);assert.equal((await missing.json()).code,'PHOTO_NOT_UPLOADED');f.db.storage.from=storage;
  const b=await cmd(f.sql,'branch.save',{code:'gallery_other',name:'Другой филиал'},'admin');await f.sql.query('update profiles set active=true,branch_id=$1 where id=$2',[b.id,ids.inactive]);await f.db.rpc('crm_workspace',{p_view:'bootstrap',p_filters:{},p_user:ids.admin});
  assert.equal((await get(`/clients/${cid}/photos`,'inactive')).status,404);assert.equal((await get(`/orders/${id}/photos`,'inactive')).status,403);
 }finally{await f.close();}
});

test('DOM → HTTP → SQL: замер и цена, загрузка фото, скрытая галерея, «Забрал → Передал цеху → Принял»',async()=>{
 const f=await workflowServer();let dom;try{
  const id=await create(f.sql);const files=await Promise.all(['index.html','i18n.js','offline.js','workspaces.js','app.js'].map(n=>readFile(new URL('../public/'+n,import.meta.url),'utf8')));
  dom=new JSDOM(files[0],{url:f.url,runScripts:'outside-only'});const w=dom.window,d=w.document,requests=[];
  Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});w.crypto.randomUUID=randomUUID;w.fetch=(path,args)=>{requests.push({path:String(path),method:args?.method||'GET'});if(String(path)==='https://example.test/upload')return Promise.resolve({ok:true,status:200});return fetch(new URL(path,f.url),args);};
  w.createImageBitmap=async()=>({width:100,height:100,close(){}});w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob(['fixture'],{type:'image/jpeg'}));};
  const NativeFormData=w.FormData;w.FormData=class extends NativeFormData{constructor(form){super(form);this.form=form;}get(key){return key==='photo'&&this.form?.elements.photo?.files?.length?this.form.elements.photo.files[0]:super.get(key);}};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};w.eval(files.slice(1).map(s=>s.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')).join('\n'));
  const wait=async fn=>{for(let n=0;n<260;n++){if(fn())return;await new Promise(r=>setTimeout(r,15));}throw Error('UI timeout: '+d.body.textContent);};const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const login=async role=>{await wait(()=>d.querySelector('[data-form=login]'));d.querySelector('[name=email]').value=role+'@example.test';d.querySelector('[name=password]').value='test';submit('[data-form=login]');await wait(()=>d.querySelector('nav'));};
  await login('driver');await wait(()=>d.querySelector(`[data-desk=measure-order][data-order="${id}"]`));d.querySelector(`[data-desk=measure-order][data-order="${id}"]`).click();await wait(()=>d.querySelector('[data-desk-form="order.measure"]'));
  let form=d.querySelector('[data-desk-form="order.measure"]');form.querySelector('[name=length_m]').value='3';form.querySelector('[name=width_m]').value='2';form.querySelector('[name=confirm_piece]').checked=true;submit('[data-desk-form="order.measure"]');await wait(()=>!d.querySelector('#action[open]'));await wait(()=>d.querySelector('#desk-list')?.textContent.includes('122'));assert.match(d.querySelector('#desk-list').textContent,/122/);assert.equal(d.querySelector('[data-desk=pickup-collect]').disabled,true);
  const list=await items(f.sql,id);
  for(const i of list){d.querySelector(`[data-desk=photo][data-order="${id}"]`).click();await wait(()=>d.querySelector('#action[open] [data-desk-form=photo]'));form=d.querySelector('[data-desk-form=photo]');form.elements.item_id.value=i.id;Object.defineProperty(form.elements.photo,'files',{value:[new w.File(['fixture'],'product.jpg',{type:'image/jpeg'})],configurable:true});submit('[data-desk-form=photo]');await wait(()=>!d.querySelector('#action[open]'));await wait(()=>d.querySelector('#detail[open]'));assert.equal(d.querySelector('[data-photo-gallery] img'),null);d.querySelector('[data-action=close-detail]').click();}
  await wait(()=>!d.querySelector('[data-desk=pickup-collect]').disabled);d.querySelector(`[data-desk=order][data-order="${id}"]`).click();await wait(()=>d.querySelector('#detail[open] [data-photo-gallery]'));
  const gallery=d.querySelector('#detail[open] [data-photo-gallery]');assert.equal(gallery.open,false);assert.equal(gallery.querySelector('img'),null);gallery.open=true;gallery.dispatchEvent(new w.Event('toggle'));await wait(()=>gallery.querySelectorAll('img').length===2);d.querySelector('[data-action=close-detail]').click();
  d.querySelector('[data-desk=pickup-collect]').click();await wait(()=>d.querySelector('[data-desk=pickup-handover]'));assert.equal((await f.sql.query('select status from orders where id=$1',[id])).rows[0].status,'pickup_assigned');d.querySelector('[data-desk=pickup-handover]').click();await wait(()=>d.querySelector('#desk-list').textContent.includes('ожидается приём'));
  d.querySelector('[data-action=logout]').click();await login('workshop');await wait(()=>d.querySelector('[data-desk=workshop-accept]'));d.querySelector('[data-desk=workshop-accept]').click();await wait(()=>d.querySelector('[data-desk=measure-order]'));d.querySelector('[data-desk=measure-order]').click();await wait(()=>d.querySelector('#action[open] [data-desk-form="order.measure"]'));
  form=d.querySelector('[data-desk-form="order.measure"]');assert.equal(form.querySelector('[name=length_m]').value,'');form.querySelector('[name=length_m]').value='3.5';form.querySelector('[name=width_m]').value='2';form.querySelector('[name=reason]').value='Контрольный замер рулеткой';form.querySelector('[name=confirm_piece]').checked=true;submit('[data-desk-form="order.measure"]');await wait(()=>!d.querySelector('#action[open]'));await wait(()=>!d.querySelector('[data-desk=advance]').disabled);assert.equal(Number((await f.sql.query('select total from orders where id=$1',[id])).rows[0].total),122000);
  d.querySelector('[data-desk=advance]').click();await wait(()=>d.querySelector('#desk-list').textContent.includes('Стирка'));assert.ok(requests.some(r=>r.path.includes('/photos')&&r.method==='GET'));
 }finally{await new Promise(r=>setTimeout(r,100));dom?.window.close();await f.close();}
});
