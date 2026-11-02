import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,call,create,advance,ids,command} from './helpers/database.js';
let db;before(async()=>db=await database());after(async()=>db?.close());
const queue=(role='admin',f={},home=false)=>call(db,'crm_queue',[JSON.stringify(f),ids[role],home]);
test('очередь: серверные страницы и итоги считают все строки, просроченные наверху, клиентские данные компактны',async()=>{
 for(let n=0;n<57;n++)await create(db,{items:[]});
 const first=await queue();assert.equal(first.count,57);assert.equal(first.data.length,50);assert.equal(first.next_offset,50);assert.equal(first.totals.orders,57);
 const rest=await queue('admin',{offset:50});assert.equal(rest.data.length,7);assert.equal(rest.previous_offset,0);assert.equal(new Set([...first.data,...rest.data].map(x=>x.id)).size,57);
 const late=rest.data[6].id;await db.query("update orders set promised_at=now()-interval '1 hour' where id=$1",[late]);
 const active=await queue('admin',{},true);assert.equal(active.data[0].id,late);assert.equal(active.tiles.attention,1);
 const attention=await queue('admin',{focus:'attention'},true);assert.equal(attention.count,1);assert.equal(attention.tiles.attention,1);
 assert.equal(first.data[0].track_token,undefined);assert.equal(first.data[0].pricing_snapshot,undefined);assert.equal(first.data[0].delete_snapshot,undefined);
 const board=await call(db,'crm_board',['{}',ids.admin]);assert.equal(board.columns[0].data.length,15);assert.equal(board.columns[0].totals.orders,57);
});
test('очередь: состояние роли, филиал, фильтры и доставка за бизнес-день проверяются в SQL',async()=>{
 const id=await create(db,{items:[{tariff:'blanket',quantity:1}]});await advance(db,id,'pickup_planned');
 assert.equal((await queue('driver',{status:'pickup_planned'})).count,1);assert.equal((await queue('driver2',{status:'pickup_planned'})).count,0);
 assert.equal((await queue('driver',{},true)).tiles.pickup_today,1);
 await advance(db,id,'warehouse');
 const shop=await queue('warehouse');assert.equal(shop.count,1);assert.match(shop.data[0].client.phone,/\*\*/);assert.equal(JSON.stringify(shop).includes('+998901234567'),false);
 assert.equal((await queue('driver',{status:'warehouse'})).count,0);
 const total=(await queue('admin',{status:'warehouse',product:'blanket',min_price:30000,max_price:30000})).totals;assert.equal(total.amount,30000);assert.equal(total.blankets,1);
 const branch=crypto.randomUUID();await db.exec('reset role');await db.query("insert into branches(id,code,name) values($1,'elsewhere','Другой филиал')",[branch]);await db.exec('set role service_role');
 const other=await create(db,{items:[]});await db.exec('reset role');await db.query('update orders set branch_id=$1 where id=$2',[branch,other]);await db.exec('set role service_role');
 assert.equal((await queue('operator',{branch_id:branch})).count,0);
 await assert.rejects(queue('inactive'),e=>e.code==='42501');
});
test('клиенты: пагинация и карточка ограничивают историю, сохраняют полный счётчик и закрыты производственным ролям',async()=>{
 const list=await call(db,'crm_clients',['{}',ids.operator]);assert.equal(list.data.length,1);const id=list.data[0].id;
 const card=await call(db,'crm_client_card',[id,null,ids.operator]);assert.equal(card.orders.length,10);assert.equal(card.orders_count,list.data[0].orders);
 const scoped=await queue('operator',{client_id:id});assert.equal(scoped.count,card.orders_count);
 for(const role of ['driver','warehouse','washer','packer'])await assert.rejects(call(db,'crm_clients',['{}',ids[role]]),e=>e.code==='42501');
 for(const role of ['anon','authenticated'])for(const fn of ['public.crm_queue(jsonb,uuid,boolean)','public.crm_clients(jsonb,uuid)','public.crm_client_card(uuid,uuid,uuid)'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') ok",[role,fn])).rows[0].ok,false);
});
