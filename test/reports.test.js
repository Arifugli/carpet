import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import {database,call,create,ids,input} from './helpers/database.js';
import {REPORTS,decorateReport} from '../src/reports.js';
import {exportReport} from '../src/export-report.js';
import {workflowServer} from './helpers/workflow-server.js';
let db,serial=0;
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
const from=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date(Date.now()-86400000*2));
const filters=source=>({from,to:today,source});
before(async()=>{db=await database();});after(async()=>{await db?.close();});
const cmd=(name,data,role='admin')=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],'127.0.0.1',randomUUID()]);
const report=(name,source,extra={},role='manager')=>call(db,'crm_report',[name,JSON.stringify({...filters(source),...extra}),ids[role]]);
async function scope(){const code=`report_${++serial}`;await cmd('catalog.save',{kind:'source',code,name_ru:code});return code;}
async function deliver(id){await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);for(const status of ['pickup_assigned','received','washing','drying','ready','delivering','delivered'])await call(db,'change_order_status',[id,status,ids.admin,null]);}
const examples=new Map();

test('отчёты: доступ только руководителю/admin и проверка периода',async()=>{
 await assert.rejects(()=>report('sales',null,{},'operator'),e=>e.code==='42501');
 await assert.rejects(()=>report('sales',null,{from:'2026-10-30',to:'2026-10-01'}),e=>e.code==='23514');
});
test('фильтры отчётов: филиал, оператор, водитель, источник и граница суток Ташкента',async()=>{
 const source=await scope(),a=await create(db,{source}),b=await create(db,{source});
 await db.query('update orders set created_at=$1,created_by=$2 where id=$3',[`${today}T00:00:00+05:00`,ids.admin,a]);
 await db.query("update orders set created_at=$1::timestamptz-interval '1 millisecond' where id=$2",[`${today}T00:00:00+05:00`,b]);
 await call(db,'assign_order_driver',[a,ids.admin,ids.driver,null]);
 const f={from:today,to:today,operator_id:ids.admin,driver_id:ids.driver,branch_id:'01000000-0000-4000-8000-000000000001'};
 assert.equal((await report('funnel',source,f)).summary.orders,1);
 assert.equal((await report('funnel',source,{...f,operator_id:ids.operator})).summary.orders,0);
 assert.equal((await report('funnel',source,{...f,branch_id:randomUUID()})).summary.orders,0);
});
test('воронка: реальные этапы, оплата, атрибуция звонка и неизвестная конверсия',async()=>{
 const source=await scope(),id=await create(db,{source});await deliver(id);await cmd('payment.record',{order_id:id,amount:180000,method:'cash'});
 await cmd('call.log',{phone:input.phone,direction:'in',outcome:'answered',source,order_id:id},'operator');
 const r=await report('funnel',source);assert.deepEqual(r.rows.map(x=>x.count),[1,1,1,1,1]);assert.equal(r.rows[1].conversion,1);
 await cmd('call.log',{phone:input.phone,direction:'in',outcome:'answered',source},'operator');
 const unknown=await report('funnel',source);assert.equal(unknown.rows[1].conversion,null);assert.equal(unknown.coverage.calls_with_unknown_result,1);examples.set('funnel',r);
});
test('отказы: причины, этап, оператор, потерянная выручка; корзина исключена',async()=>{
 const source=await scope(),id=await create(db,{source});await call(db,'cancel_order',[id,ids.operator,'expensive','Цена',0,0,null]);
 const r=await report('cancellations',source);assert.equal(r.rows[0].count,1);assert.equal(r.rows[0].share,1);assert.equal(r.rows[0].lost_revenue,180000);assert.equal(r.rows[0].stage,'new');examples.set('cancellations',r);
 await call(db,'soft_delete_order',[id,ids.admin,'Ошибка ввода',null]);assert.equal((await report('cancellations',source)).rows.length,0);
});
test('выручка/структура: выдача, средний чек, площадь и срочность считаются SQL',async()=>{
 const source=await scope(),a=await create(db,{source}),b=await create(db,{source,urgent:true});await deliver(a);await deliver(b);
 const r=await report('sales',source);assert.equal(r.summary.orders,2);assert.equal(r.summary.revenue,414000);assert.equal(r.summary.average_check,207000);assert.equal(r.summary.area_m2,12);assert.equal(r.summary.urgent_share,.5);examples.set('sales',r);
 const mix=await report('mix',source);assert.equal(mix.rows[0].items,2);assert.equal(mix.summary.base_revenue,360000);examples.set('mix',mix);
 const times=await report('turnaround',source);assert.equal(times.summary.completed,2);assert.ok(times.rows.every(row=>row.average_hours==null||row.average_hours>=0));examples.set('turnaround',times);
});

test('выручка выполненных работ при отказе учитывается отдельно от выдачи и оплаты',async()=>{
 const source=await scope(),id=await create(db,{source});await call(db,'assign_order_driver',[id,ids.admin,ids.driver,null]);await call(db,'change_order_status',[id,'pickup_assigned',ids.admin,null]);await call(db,'change_order_status',[id,'received',ids.admin,null]);
 await call(db,'cancel_order',[id,ids.admin,'condition','Согласован отказ',20000,10000,null]);const r=await report('sales',source);assert.equal(r.summary.revenue,20000);assert.equal(r.summary.orders,0);assert.equal(r.summary.average_check,null);assert.equal(r.summary.area_m2,0);assert.equal(r.rows[0].cancelled_work_revenue,20000);
});
test('логистика: успешность, повторные выезды и измеренное время в пути',async()=>{
 const source=await scope(),id=await create(db,{source});
 const first=await cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:today,slot_code:'morning',driver_id:ids.driver},'dispatcher');
 await cmd('visit.event',{visit_id:first.id,event:'failed',expected_state:'planned',failure_reason:'absent'},'driver');
 const second=await cmd('visit.schedule',{order_id:id,kind:'pickup',scheduled_date:today,slot_code:'morning',driver_id:ids.driver,note:'Повторный забор'},'dispatcher');
 await cmd('visit.event',{visit_id:second.id,event:'departed',expected_state:'planned'},'driver');await cmd('visit.arrived',{visit_id:second.id},'driver');
 await db.query("update visits set departed_at=now()-interval '20 minutes',arrived_at=now()-interval '5 minutes' where id=$1",[second.id]);
 await cmd('visit.event',{visit_id:second.id,event:'completed',expected_state:'en_route'},'driver');
 const r=await report('logistics',source);assert.equal(r.rows[0].visits,2);assert.equal(r.rows[0].success_rate,.5);assert.equal(r.rows[0].repeat_visits,1);assert.equal(r.rows[0].average_travel_minutes,15);examples.set('logistics',r);
});
test('качество: NPS с ответами отличается от отсутствующего NPS',async()=>{
 const source=await scope(),a=await create(db,{source}),b=await create(db,{source});
 await db.query('insert into feedback(order_id,score) values($1,9),($2,5)',[a,b]);
 await db.query("insert into complaints(order_id,branch_id,reason,note,resolution,state,due_at) select id,branch_id,'Пятна','Остались пятна','rewash','resolved',now() from orders where id=$1",[a]);
 const r=await report('quality',source);assert.equal(r.summary.responses,2);assert.equal(r.summary.nps,0);assert.equal(r.summary.rewashes,1);examples.set('quality',r);
 const empty=await report('quality',await scope());assert.equal(empty.summary.responses,0);assert.equal(empty.summary.nps,null);
});
test('дебиторка: частичная оплата и начисление при отказе, без корзины',async()=>{
 const source=await scope(),a=await create(db,{source}),b=await create(db,{source});await cmd('payment.record',{order_id:a,amount:50000,method:'cash'});
 await call(db,'assign_order_driver',[b,ids.admin,ids.driver,null]);await call(db,'change_order_status',[b,'pickup_assigned',ids.admin,null]);await call(db,'change_order_status',[b,'received',ids.admin,null]);
 await call(db,'cancel_order',[b,ids.admin,'condition','Нельзя стирать',20000,0,null]);
 const r=await report('debt',source);assert.equal(r.summary.debt,150000);assert.equal(r.rows.length,2);assert.ok(r.rows.some(row=>row.liability===20000));examples.set('debt',r);
});
test('повторные/спящие: история до периода, доли клиентов и повторных заказов',async()=>{
 const source=await scope();await create(db,{source,phone:'+998901000001',name:'Повторный'});await create(db,{source,phone:'+998901000001',name:'Повторный'});
 const sleeping=await create(db,{source,phone:'+998901000002',name:'Спящий'});await db.query("update orders set created_at=now()-interval '100 days' where id=$1",[sleeping]);
 const r=await report('retention',source);assert.equal(r.summary.clients,2);assert.equal(r.summary.repeat_clients,1);assert.equal(r.summary.sleeping,1);assert.equal(r.summary.repeat_share,.5);assert.equal(r.summary.repeat_order_share,.5);examples.set('retention',r);
});
test('Excel каждого отчёта: настоящие формулы, CF, диаграмма, полные строки, типы и кеш значений',async()=>{
 await mkdir(new URL('../../sheets/report-samples/',import.meta.url),{recursive:true});
 for(const name of Object.keys(REPORTS)){
  const data=decorateReport(examples.get(name)),file=await exportReport(data),zip=unzipSync(file),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']),chart=strFromU8(zip[Object.keys(zip).find(k=>/\/charts\/chart.*\.xml$/.test(k))]);
  assert.match(sheet,/<x:conditionalFormatting/);assert.match(chart,/<c:barChart>/);assert.match(chart,/<c:ptCount val="[1-9]/);assert.match(sheet,/<x:f>/);
  assert.ok(!sheet.includes('Группа 1'));assert.ok(!sheet.includes('#REF!'));assert.ok(!sheet.includes('#DIV/0!'));
  assert.ok(sheet.includes(data.title));assert.match(sheet,/<x:autoFilter/);
  await writeFile(new URL(`../../sheets/report-samples/${name}.xlsx`,import.meta.url),file);
 }
 await writeFile(new URL('../../sheets/report-samples/expected.json',import.meta.url),JSON.stringify(Object.fromEntries(examples),null,2));
});
test('HTTP отчётов: доступ, снимок для курсора, экспорт и изоляция владельца',async()=>{
 const fixture=await workflowServer();try{
  await create(fixture.sql);
  const get=(path,role='manager')=>fetch(fixture.url+'/api'+path,{headers:{Authorization:`Bearer ${role}`}});
  assert.equal((await get('/reports','operator')).status,403);
  const firstResponse=await get(`/reports/debt?from=${from}&to=${today}&limit=1`);assert.equal(firstResponse.status,200);const first=await firstResponse.json();assert.ok(first.next_cursor);
  await create(fixture.sql);
  const next=await(await get('/reports/debt?cursor='+first.next_cursor)).json();assert.equal(next.rows.length,1);assert.equal(next.total_rows,2);
  assert.equal((await get(`/reports/debt?snapshot_id=${first.snapshot_id}`,'admin')).status,409);
  const exported=await get(`/reports/debt/export?snapshot_id=${first.snapshot_id}`);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/spreadsheetml/);assert.ok((await exported.arrayBuffer()).byteLength>5000);
 }finally{await fixture.close();}
});
