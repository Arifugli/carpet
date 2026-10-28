import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,call,create,ids,input} from './helpers/database.js';

let db;
before(async()=>{db=await database();});
after(async()=>{await db?.close();});
const expectError=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
const change=(id,status,actor=ids.admin)=>call(db,'change_order_status_audited',[id,status,actor,null,'127.0.0.1']);
async function receive(id) {
 await call(db,'assign_order_driver',[id,ids.operator,ids.driver,'127.0.0.1']);
 await change(id,'pickup_assigned'); await change(id,'received');
}

test('цена из SQL: площадь, надбавки, округление, доставка и скидка',async()=>{
 assert.equal((await call(db,'quote_order',[JSON.stringify(input)])).total,180000);
 const p={...input,items:[{length_m:1,width_m:1,tariff:'syn'}],urgent:true,stains:true,pensioner:true};
 assert.deepEqual(await call(db,'quote_order',[JSON.stringify(p)]),{area_m2:1,subtotal:20000,adjustment:7000,delivery_fee:20000,total:47000});
 await assert.rejects(()=>call(db,'quote_order',[JSON.stringify({...input,items:[{length_m:1,width_m:1,tariff:'missing'}]})]));
});
test('миграции повторяемы и не меняют существующие данные',async()=>{
 const id=await create(db);
 const original=(await db.query('select updated_at from orders where id=$1',[id])).rows[0];
 const count=(await db.query('select count(*)::int n from audit_log where entity_id=$1',[id])).rows[0].n;
 await db.exec('reset role');
 for(const name of ['0002_manager_role.sql','0003_order_lifecycle.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 assert.equal((await db.query('select status from orders where id=$1',[id])).rows[0].status,'new');
 assert.equal((await db.query('select updated_at from orders where id=$1',[id])).rows[0].updated_at.toISOString(),original.updated_at.toISOString());
 assert.equal((await db.query('select count(*)::int n from audit_log where entity_id=$1',[id])).rows[0].n,count);
});
test('отказ: причина и комментарий обязательны; обход через старый RPC запрещён',async()=>{
 const id=await create(db);
 await expectError(()=>call(db,'cancel_order',[id,ids.operator,'other',' ',null,null,null]),'23514');
 await expectError(()=>call(db,'cancel_order',[id,ids.operator,'unknown','Ошибка',null,null,null]),'23514');
 await expectError(()=>call(db,'change_order_status',[id,'cancelled',ids.operator,null]),'23514');
 const o=await call(db,'cancel_order',[id,ids.operator,'expensive','Не устроила цена',null,null,'127.0.0.1']);
 assert.equal(o.status,'cancelled'); assert.equal(o.cancelled_from_status,'new'); assert.equal(o.cancelled_by,ids.operator);
 assert.equal((await db.query('select count(*)::int as n from cancelled_orders where id=$1',[id])).rows[0].n,1);
});
test('создание идемпотентно; изменённый запрос и повтор после удаления отклоняются',async()=>{
 const key='40000000-0000-4000-8000-000000000001';
 const args=[JSON.stringify(input),ids.operator,'127.0.0.1',key];
 const id=await call(db,'create_order_audited',args);
 assert.equal(await call(db,'create_order_audited',args),id);
 await expectError(()=>call(db,'create_order_audited',[JSON.stringify({...input,urgent:true}),...args.slice(1)]),'55000');
 assert.equal((await db.query("select count(*)::int n from audit_log where entity_id=$1 and action='created'",[id])).rows[0].n,1);
 await call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]);
 await expectError(()=>call(db,'create_order_audited',args),'55000');
});
test('все четыре действия имеют автора, время, IP и снимки; восстановление сохраняет статус и связи',async()=>{
 const id=await create(db);
 await call(db,'request_order_deletion',[id,ids.operator,'Дубликат','127.0.0.1']);
 await call(db,'cancel_order',[id,ids.operator,'other','Дубликат заявки',0,0,'127.0.0.1']);
 const original=(await db.query('select * from orders where id=$1',[id])).rows[0];
 const deleted=await call(db,'soft_delete_order',[id,ids.admin,'Дубликат','127.0.0.1']);
 assert.equal(deleted.delete_snapshot.client.phone,input.phone); assert.equal(deleted.delete_snapshot.items.length,1);
 assert.equal(deleted.deleted_status,'cancelled');
 assert.equal(await call(db,'public_order_status',[original.track_token]),null);
 assert.equal((await db.query('select count(*)::int n from active_orders where id=$1',[id])).rows[0].n,0);
 const restored=await call(db,'restore_order',[id,ids.manager,'127.0.0.1']);
 assert.equal(restored.status,'cancelled'); assert.equal(restored.deleted_at,null); assert.equal(restored.restored_by,ids.manager);
 assert.equal(restored.number,original.number); assert.equal(restored.track_token,original.track_token);
 assert.equal((await db.query('select count(*)::int n from order_items where order_id=$1',[id])).rows[0].n,1);
 assert.equal((await call(db,'public_order_status',[original.track_token])).status,'cancelled');
 const audit=(await db.query('select * from audit_log where entity_id=$1 order by id',[id])).rows;
 for (const action of ['cancelled','deletion_requested','deleted','restored']) {
  const row=audit.find(a=>a.action===action); assert.ok(row); assert.ok(row.user_id); assert.ok(row.at); assert.ok(row.before); assert.ok(row.after); assert.equal(row.ip,'127.0.0.1');
 }
});
test('матрица прав SQL: оператор, водитель, цех и неактивный сотрудник не удаляют и не восстанавливают',async()=>{
 const id=await create(db);
 for (const actor of [ids.operator,ids.driver,ids.workshop,ids.inactive]) await expectError(()=>call(db,'soft_delete_order',[id,actor,'Причина',null]),'42501');
 await call(db,'soft_delete_order',[id,ids.manager,'Причина',null]);
 for (const actor of [ids.operator,ids.driver,ids.workshop]) await expectError(()=>call(db,'restore_order',[id,actor,null]),'42501');
 await call(db,'restore_order',[id,ids.admin,null]);
});
test('заявка оператора только new; повторная заявка не дублирует аудит',async()=>{
 const id=await create(db);
 await call(db,'request_order_deletion',[id,ids.operator,'Ошибка',null]);
 await expectError(()=>call(db,'request_order_deletion',[id,ids.operator,'Ошибка',null]),'55000');
 await receive(id);
 await expectError(()=>call(db,'request_order_deletion',[id,ids.operator,'Ошибка',null]),'42501');
 await expectError(()=>call(db,'cancel_order',[id,ids.operator,'other','Ошибка',0,0,null]),'42501');
 assert.equal((await db.query('select delete_requested_at from orders where id=$1',[id])).rows[0].delete_requested_at,null);
});
test('после стирки нельзя удалить даже после возврата к received и отмены',async()=>{
 const id=await create(db); await receive(id); await change(id,'washing',ids.workshop); await change(id,'received');
 await expectError(()=>call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),'55000');
 await expectError(()=>call(db,'cancel_order',[id,ids.manager,'condition','Не принимаем',null,null,null]),'23514');
 const o=await call(db,'cancel_order',[id,ids.manager,'condition','Не принимаем',20000,5000,null]);
 assert.equal(o.completed_work_amount,20000); assert.equal(o.paid_amount,5000); assert.ok(o.payment_recorded_at);
 await expectError(()=>call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),'55000');
});
test('оплаченный заказ не удаляется; нулевая сумма после возврата оплаты не стирает след',async()=>{
 const id=await create(db);
 await db.query('update orders set paid_amount=1000 where id=$1',[id]);
 await expectError(()=>call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),'55000');
 await db.query('update orders set paid_amount=0,payment_recorded_at=null where id=$1',[id]);
 await expectError(()=>call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),'55000');
});
test('удалённый заказ неизменяем, повторные delete/restore отклоняются, циклы сохраняют аудит',async()=>{
 const id=await create(db); await call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]);
 await expectError(()=>call(db,'soft_delete_order',[id,ids.admin,'Ошибка',null]),'55000');
 await expectError(()=>change(id,'pickup_assigned'),'P0002');
 await expectError(()=>db.query('update order_items set note=$1 where order_id=$2',['Правка',id]),'55000');
 await expectError(()=>db.query('update orders set comment=$1 where id=$2',['Правка',id]),'55000');
 await call(db,'restore_order',[id,ids.admin,null]);
 await expectError(()=>call(db,'restore_order',[id,ids.admin,null]),'55000');
 await receive(id); await call(db,'soft_delete_order',[id,ids.manager,'Ошибка 2',null]);
 const o=await call(db,'restore_order',[id,ids.admin,null]); assert.equal(o.status,'received');
 assert.equal((await db.query("select count(*)::int n from audit_log where entity_id=$1 and action='deleted'",[id])).rows[0].n,2);
});
test('недопустимые переходы, чужой водитель, закрытый заказ и финансовая валидация',async()=>{
 const id=await create(db);
 await expectError(()=>change(id,'washing'),'23514');
 await expectError(()=>change(id,'received',ids.driver),'42501');
 await expectError(()=>change(id,'pickup_assigned'),'23514');
 await receive(id);
 for (const status of ['washing','drying','ready','delivering','delivered']) await change(id,status);
 await expectError(()=>call(db,'cancel_order',[id,ids.admin,'other','Ошибка',0,0,null]),'55000');
 const fresh=await create(db);
 await expectError(()=>call(db,'cancel_order',[fresh,ids.admin,'other','Ошибка',-1,0,null]),'23514');
 await expectError(()=>call(db,'cancel_order',[fresh,ids.admin,'other','Ошибка',1.2,0,null]),'23514');
});
test('журнал append only и физическое удаление запрещены даже администратору приложения',async()=>{
 await expectError(()=>db.exec('delete from audit_log'),'42501');
 await expectError(()=>db.exec("update audit_log set action='forged'"),'42501');
 await expectError(()=>db.exec('truncate audit_log'),'42501');
 await expectError(()=>db.exec('delete from orders'),'42501');
 await db.exec('reset role');
 await expectError(()=>db.exec('truncate audit_log'),'42501');
 await expectError(()=>db.exec('delete from audit_log'),'42501');
 await db.exec('set role authenticated');
 await expectError(()=>db.exec('select * from orders'),'42501');
 await expectError(()=>call(db,'restore_order',['10000000-0000-4000-8000-000000000099',ids.admin,null]),'42501');
 await db.exec('set role service_role');
});
test('фото и тарифы пишут автора/IP в аудит; SQL запрещает чужие и удалённые фото',async()=>{
 const id=await create(db),item=(await db.query('select id from order_items where order_id=$1',[id])).rows[0].id;
 const path=`${id}/${item}/50000000-0000-4000-8000-000000000001.jpg`;
 await expectError(()=>call(db,'register_order_photo',[item,path,'intake',ids.driver,'127.0.0.1']),'42501');
 const photo=await call(db,'register_order_photo',[item,path,'intake',ids.operator,'127.0.0.1']);
 const audit=(await db.query('select * from audit_log where entity_id=$1',[photo.id])).rows[0];
 assert.equal(audit.entity,'order_photo');assert.equal(audit.user_id,ids.operator);assert.equal(audit.ip,'127.0.0.1');
 await call(db,'soft_delete_order',[id,ids.admin,'Дубликат',null]);
 await expectError(()=>call(db,'register_order_photo',[item,path,'ready',ids.admin,null]),'P0002');
 await expectError(()=>call(db,'save_tariff_audited',['wool',JSON.stringify({name:'Шерсть',price_per_m2:30000,active:true}),ids.manager,null]),'42501');
 await call(db,'save_tariff_audited',['wool',JSON.stringify({name:'Шерсть',price_per_m2:30000,active:true}),ids.admin,'127.0.0.1']);
 const tariffAudit=(await db.query("select * from audit_log where entity='tariff' order by id desc limit 1")).rows[0];
 assert.equal(tariffAudit.user_id,ids.admin);assert.equal(tariffAudit.before.code,'wool');assert.equal(tariffAudit.after.price_per_m2,30000);
});
test('обновление существующей базы сохраняет старые отказы и обнаруживает стирку по истории',async()=>{
 let washed,cancelled;
 const legacy=await database({beforeLifecycle:async connection=>{
  washed=await call(connection,'create_order',[JSON.stringify(input),ids.operator]);
  cancelled=await call(connection,'create_order',[JSON.stringify(input),ids.operator]);
  await connection.query("update orders set status='received' where id=$1",[washed]);
  await connection.query("insert into status_history(order_id,status) values($1,'washing'),($1,'received')",[washed]);
  await connection.query("update orders set status='cancelled' where id=$1",[cancelled]);
 }});
 try {
  await expectError(()=>call(legacy,'soft_delete_order',[washed,ids.admin,'Ошибка',null]),'55000');
  const o=(await legacy.query('select * from orders where id=$1',[cancelled])).rows[0];
  assert.equal(o.status,'cancelled');assert.equal(o.cancel_reason_code,null);
  assert.equal((await legacy.query('select count(*)::int n from order_items where order_id=$1',[cancelled])).rows[0].n,1);
 } finally{await legacy.close();}
});
