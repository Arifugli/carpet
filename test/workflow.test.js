import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,create,call,command,ids,advance,measurements,input} from './helpers/database.js';
import {PERMISSIONS,canReadOrder} from '../src/permissions.js';
let db;before(async()=>db=await database());after(async()=>db?.close());
const order=async id=>(await db.query('select * from orders where id=$1',[id])).rows[0];
const act=(id,c,r,d={},k)=>command(db,c,{order_id:id,...d},r,k);
const denied=p=>assert.rejects(p,e=>['42501','55000','23514'].includes(e.code));
const board=(role='admin',filters={})=>call(db,'crm_board',[JSON.stringify(filters),ids[role]]);
const column=async(id,s,role='admin')=>(await board(role,{q:'K-'+(await order(id)).number})).columns.find(c=>c.status===s);
test('матрица шести ролей совпадает с SQL; активные старые роли не допускаются',async()=>{
 assert.deepEqual(Object.keys(PERMISSIONS).sort(),['admin','driver','operator','packer','warehouse','washer']);
 const rows=(await db.query('select * from role_permissions order by role')).rows;assert.deepEqual(Object.fromEntries(rows.map(x=>[x.role,x.permissions])),PERMISSIONS);
 assert.equal((await db.query("select count(*) from profiles where active and role::text not in ('operator','driver','warehouse','washer','packer','admin')")).rows[0].count,0);
 assert.equal((await call(db,'crm_ready',[])).schema,24);
});
test('оператор: обязательны ФИО/область/район/адрес; нет размеров, фото и цены до забора',async()=>{
 for(const bad of [{name:''},{district_code:null},{region_code:'tashkent'},{street:''},{items:[{tariff:'carpet',length_m:3,width_m:2}]}])await denied(create(db,bad));
 const id=await create(db);const o=await order(id);assert.equal(o.status,'new');assert.equal(o.total,'0');assert.equal(o.pricing_state,'awaiting_measurements');
 assert.equal((await db.query('select count(*) from order_photos p join order_items i on i.id=p.item_id where i.order_id=$1',[id])).rows[0].count,0);
 await denied(act(id,'pickup.claim','operator',{pickup_at:new Date().toISOString()}));
});
test('атомарное взятие: два водителя, один победитель; повтор с тем же ключом не дублируется',async()=>{
 const id=await create(db),k=crypto.randomUUID(),d={pickup_at:new Date().toISOString()};
 const results=await Promise.allSettled([act(id,'pickup.claim','driver',d,k),act(id,'pickup.claim','driver2',d)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const again=await act(id,'pickup.claim','driver',d,k);assert.equal(again.pickup_driver_id,ids.driver);
 assert.equal((await db.query("select count(*) from status_history where order_id=$1 and status='pickup_planned'",[id])).rows[0].count,1);
 await denied(act(id,'pickup.claim','driver',{pickup_at:'2030-01-01T10:00:00Z'},k));
});
test('цена и фото: нельзя забрать без фото каждой строки; ошибка откатывает все замеры',async()=>{
 const id=await create(db);await advance(db,id,'pickup_planned');const items=await measurements(db,id);
 await denied(act(id,'pickup.collect','driver',{items}));assert.equal((await order(id)).pickup_state,'pending');assert.equal((await db.query('select count(*) from item_measurements m join order_items i on i.id=m.item_id where i.order_id=$1',[id])).rows[0].count,0);
 await advance(db,id,'collected');const o=await order(id);assert.equal(o.total,'162000');assert.equal(o.status,'pickup_planned');assert.equal(o.pickup_state,'picked_up');
 await denied(act(id,'pickup.collect','driver',{items}));await denied(act(id,'pickup.handover','driver2'));
});
test('склад: приёмка, расхождение в размерах и штуках требует комментарий; цена фиксирована',async()=>{
 const id=await create(db);await advance(db,id,'warehouse');const amount=(await order(id)).total,items=await measurements(db,id);
 await denied(act(id,'warehouse.measure','warehouse',{items}));await act(id,'warehouse.receive','warehouse');
 const changed=structuredClone(items);changed[0].length_m=4;changed[1].quantity=3;
 await denied(act(id,'warehouse.measure','warehouse',{items:changed}));assert.equal((await order(id)).warehouse_verified_at,null);
 changed[0].reason='Проверили на складе';changed[1].reason='Другая комплектация';await act(id,'warehouse.measure','warehouse',{items:changed});assert.equal((await order(id)).total,amount);
 const c=await column(id,'warehouse');assert.equal(c.totals.carpet_m2,8);assert.equal(c.totals.blankets,3);assert.equal(c.totals.tushaks,1);assert.equal(c.totals.amount,162000);
 const ledger=await call(db,'crm_measurements',[id,ids.warehouse]);assert.equal(ledger[0].measurements.length,2);
 await act(id,'warehouse.to_wash','warehouse');assert.equal((await column(id,'warehouse')).totals.orders,0);assert.equal((await column(id,'washing')).totals.orders,1);
});
test('мойка: обязательная приёмка, мойка, сушка, передача; чужие роли не могут выполнить шаг',async()=>{
 const id=await create(db);await advance(db,id,'washing');await denied(act(id,'wash.to_pack','washer'));await denied(act(id,'wash.accept','warehouse'));
 const k=crypto.randomUUID();await act(id,'wash.accept','washer',{},k);await act(id,'wash.accept','washer',{},k);assert.equal((await order(id)).wash_phase,'washing');
 await denied(act(id,'wash.to_pack','washer'));await act(id,'wash.dry','washer');assert.equal((await order(id)).status,'washing');await act(id,'wash.to_pack','washer');assert.equal((await order(id)).status,'packing');
});
test('упаковка: нельзя передать без свежего фото-чека; возврат по качеству снова идёт через склад',async()=>{
 const id=await create(db);await advance(db,id,'packing');await denied(act(id,'packing.complete','packer'));await act(id,'packing.accept','packer');await denied(act(id,'packing.complete','packer'));
 await denied(act(id,'packing.return','packer',{reason:''}));await act(id,'packing.return','packer',{reason:'Пятна после мойки'});assert.equal((await order(id)).status,'warehouse');assert.equal((await order(id)).production_cycle,1);
 await denied(act(id,'wash.accept','washer'));await advance(db,id,'pack_accepted');await denied(act(id,'packing.complete','packer'));await advance(db,id,'ready_for_delivery');
 assert.equal((await column(id,'ready_for_delivery')).totals.orders,1);
});
test('доставка: многократный отложен/повторно в путь, без новой даты и причины; история и аудит',async()=>{
 const id=await create(db);await advance(db,id,'in_transit');const k=crypto.randomUUID();await denied(act(id,'delivery.postpone','driver',{reason:''}));
 for(let j=0;j<3;j++){await act(id,'delivery.postpone','driver',{reason:'Клиент отсутствует'});assert.equal((await order(id)).status,'postponed');await act(id,'delivery.resume','driver',j?{comment:'Клиент дома'}:{});}
 await act(id,'delivery.complete','driver',{},k);await act(id,'delivery.complete','driver',{},k);await denied(act(id,'delivery.resume','driver'));await denied(call(db,'cancel_order',[id,ids.operator,'other','Клиент отменил',0,0,null]));
 const h=(await db.query("select count(*) from status_history where order_id=$1 and status='postponed'",[id])).rows[0].count;assert.equal(h,3);
 assert.ok((await db.query("select count(*) from audit_log where entity_id=$1 and action='status_changed'",[id])).rows[0].count>=10);
});
test('видимость: 10/6/1 колонок, общие новые/готовые, только свои заборы/доставки; отмены скрыты от водителя',async()=>{
 assert.equal((await board('admin')).columns.length,10);assert.equal((await board('operator')).columns.length,10);assert.equal((await board('driver')).columns.length,6);
 for(const r of ['warehouse','washer','packer'])assert.equal((await board(r)).columns.length,1);
 const id=await create(db);assert.equal((await column(id,'new','driver2')).totals.orders,1);await advance(db,id,'pickup_planned');assert.equal((await column(id,'pickup_planned','driver2')).totals.orders,0);
 await denied(call(db,'crm_order',[id,ids.warehouse,'read']));await call(db,'cancel_order',[id,ids.operator,'other','Клиент отменил',0,0,null]);
 assert.equal((await board('driver',{q:'K-'+(await order(id)).number})).columns.reduce((n,c)=>n+c.totals.orders,0),0);
});
test('отмена оператором допустима на каждом незавершённом этапе, с обязательной причиной',async()=>{
 for(const stage of ['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','postponed']){
  const id=await create(db);if(stage!=='new')await advance(db,id,stage==='postponed'?'in_transit':stage);if(stage==='postponed')await act(id,'delivery.postpone','driver',{reason:'Нет клиента'});
  await denied(call(db,'cancel_order',[id,ids.operator,'other','',0,0,null]));await call(db,'cancel_order',[id,ids.operator,'other','Отмена клиентом',0,0,null]);assert.equal((await order(id)).status,'cancelled');
 }
});
test('прямые недопустимые переходы и общий endpoint статуса заблокированы в PostgreSQL',async()=>{
 const id=await create(db);for(const to of ['warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed']){
  await denied(call(db,'change_order_status',[id,to,ids.admin,null]));await denied(call(db,'crm_flow_move',[id,to,ids.operator,'Неверный переход']));
 }
 await assert.rejects(db.query("update orders set status='delivered' where id=$1",[id]),e=>e.code==='42501');assert.equal((await order(id)).status,'new');
});
test('районы и цвет редактирует admin; чужой филиал закрыт даже для driver общих колонок',async()=>{
 await denied(command(db,'staff.update',{user_id:ids.driver,role:'driver',full_name:'Водитель',active:true,branch_id:'01000000-0000-4000-8000-000000000001'},'operator'));
 const d={user_id:ids.driver,role:'driver',full_name:'Водитель',active:true,branch_id:'01000000-0000-4000-8000-000000000001',district_codes:['fergana_city'],driver_color:'#12abcd'};await command(db,'staff.update',d);
 const id=await create(db);const b=await board('driver',{q:'K-'+(await order(id)).number});assert.equal(b.driver_color,'#12abcd');assert.equal(b.columns[0].data[0].district_priority,true);
 await denied(command(db,'staff.update',{...d,district_codes:[]}));await denied(command(db,'staff.update',{...d,driver_color:'bad'}));
 const o=await order(id);assert.equal(canReadOrder({id:ids.driver,role:'driver',branch_id:'other'},o),false);
});
test('итоги фильтруются по периоду, району, водителю, оператору, изделию, цене и поиску',async()=>{
 const id=await create(db);await advance(db,id,'collected');const o=await order(id),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
 const b=await board('admin',{q:'K-'+o.number,from:today,to:today,district_code:input.district_code,driver_id:ids.driver,operator_id:ids.operator,product:'blanket',min_price:162000,max_price:162000});assert.equal(b.columns.find(x=>x.status==='pickup_planned').totals.orders,1);
 for(const f of [{product:'other'}, {min_price:162001},{district_code:'kokand_city'},{operator_id:ids.admin},{from:'2099-01-01'}])assert.equal((await board('admin',{q:'K-'+o.number,...f})).columns.reduce((n,c)=>n+c.totals.orders,0),0);
});
test('admin «Заказы»: показатели совпадают с независимым SQL и не удваиваются при перемывке',async()=>{
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date()),metrics=(await call(db,'crm_order_metrics',[JSON.stringify({from:today,to:today}),ids.admin])).metrics;
 for(const k of ['washed','delivered','washing','ready_for_delivery']){
  const condition=k==='washed'?"exists(select 1 from status_history h where h.order_id=o.id and h.status='packing')":`o.status='${k}'`;
  const q=await db.query(`select count(distinct o.id) orders,coalesce(sum(i.area_m2) filter(where i.tariff_code='carpet'),0) carpet_m2,coalesce(sum(i.quantity) filter(where i.tariff_code='blanket'),0) blankets,coalesce(sum(i.quantity) filter(where i.tariff_code='tushak'),0) tushaks from orders o left join order_items i on i.order_id=o.id where o.deleted_at is null and ${condition}`);for(const key of ['orders','carpet_m2','blankets','tushaks'])assert.equal(Number(q.rows[0][key]),metrics[k][key]);
  const amount=(await db.query(`select coalesce(sum(o.total),0) amount from orders o where o.deleted_at is null and ${condition}`)).rows[0].amount;assert.equal(Number(amount),metrics[k].amount);
 }
 await denied(call(db,'crm_order_metrics',[JSON.stringify({from:today,to:today}),ids.operator]));
});
