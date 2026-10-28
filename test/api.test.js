import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {fakeDb,exampleOrder} from './helpers/fake-db.js';
import {ids} from './helpers/database.js';
import {PERMISSIONS} from '../src/permissions.js';

async function server(role,fn,{auth=true}={}) {
 const db=fakeDb(role),app=createApp({db,config:{trustProxy:false},...(!auth?{authenticate:(req,res,next)=>{req.user={id:ids[role],role,permissions:PERMISSIONS[role]};next();}}:{})});
 const srv=app.listen(0,'127.0.0.1');await new Promise(resolve=>srv.once('listening',resolve));
 const request=async(path,method='GET',body,token='valid')=>{
  const r=await fetch(`http://127.0.0.1:${srv.address().port}/api${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json(),headers:r.headers};
 };
 try{await fn({db,request});}finally{srv.closeAllConnections();await new Promise(resolve=>srv.close(resolve));}
}

test('HTTP: требуется действующий токен и активный профиль',async()=>{
 await server('admin',async({request})=>{
  assert.equal((await request('/orders','GET',null,null)).status,401);
  assert.equal((await request('/orders','GET',null,'invalid')).status,401);
  assert.equal((await request('/me')).body.role,'admin');
 });
 await server('inactive',async({request})=>assert.equal((await request('/orders')).status,403));
});
test('HTTP: корзина, аудит, удаление, восстановление запрещены оператору, водителю, цеху',async()=>{
 for(const role of ['operator','driver','workshop']) await server(role,async({request,db})=>{
  for(const [path,method,body] of [['/trash','GET'],['/audit-log','GET'],[`/orders/${exampleOrder.id}`,'DELETE',{reason:'Ошибка'}],[`/orders/${exampleOrder.id}/restore`,'POST',{}]]) assert.equal((await request(path,method,body)).status,403);
  assert.equal(db.calls.filter(c=>c.rpc).length,0);
 });
});
test('HTTP: валидация причины, суммы, id, курсора и запрет обхода отказа через status',async()=>{
 await server('admin',async({request,db})=>{
  for(const [path,method,body] of [[`/orders/${exampleOrder.id}`,'DELETE',{reason:' '}],[`/orders/${exampleOrder.id}/cancel`,'POST',{reason_code:'other',comment:'Ошибка',payment_amount:-1}],[`/orders/${exampleOrder.id}/status`,'POST',{status:'cancelled'}],['/orders/nope','GET'],['/orders?cursor=bad','GET'],['/trash?deleted_by=bad','GET'],['/trash?from=2026-10-29T00:00:00Z&to=2026-10-28T00:00:00Z','GET']]) assert.equal((await request(path,method,body)).status,400);
  assert.equal(db.calls.filter(c=>c.rpc).length,0);
 });
});
test('HTTP: API передаёт проверенного автора и IP в атомарный SQL RPC',async()=>{
 await server('operator',async({request,db})=>{
  const r=await request(`/orders/${exampleOrder.id}/cancel`,'POST',{reason_code:'expensive',comment:'Дорого'});
  assert.equal(r.status,200);const c=db.calls.find(c=>c.rpc==='cancel_order');
  assert.equal(c.args.p_user,ids.operator);assert.equal(c.args.p_ip,'127.0.0.1');assert.equal(c.args.p_reason,'expensive');
  assert.equal((await request(`/orders/${exampleOrder.id}/cancel`,'POST',{reason_code:'other',comment:'Ошибка',p_user:ids.admin})).status,400);
 });
});
test('HTTP: SQL-ошибки прав, конфликта и отсутствия заказа имеют ожидаемый статус',async()=>{
 await server('admin',async({request,db})=>{
  for(const [code,status] of [['42501',403],['55000',409],['P0002',404],['23514',400]]) {
   db.rpcResult={data:null,error:{code,message:'Понятная ошибка'}};
   assert.equal((await request(`/orders/${exampleOrder.id}`,'DELETE',{reason:'Ошибка'})).status,status);
  }
 });
});
test('HTTP: скрывает корзину из списка, карточки и истории клиента',async()=>{
 await server('admin',async({request,db})=>{
  db.rows.orders[0].deleted_at='2026-10-28T09:00:00Z';
  assert.equal((await request('/orders')).body.data.length,0);
  assert.equal((await request(`/orders/${exampleOrder.id}`)).status,404);
  assert.equal((await request('/trash')).body.data.length,1);
  db.rows.clients=[{id:'client',phone_key:'901234567'}];db.rows.orders[0].client_id='client';
  assert.equal((await request('/clients/lookup?phone=%2B998901234567')).body.orders.length,0);
 });
});
test('HTTP: водитель видит только свои заказы; цех — свои этапы и замаскированный телефон',async()=>{
 await server('driver',async({request})=>{
  assert.equal((await request('/orders')).body.data.length,0);
  assert.equal((await request(`/orders/${exampleOrder.id}`)).status,403);
 });
 await server('workshop',async({request,db})=>{
  assert.equal((await request(`/orders/${exampleOrder.id}`)).status,403);
  db.rows.orders[0].status='received';db.rows.orders[0].track_token='secret-token';
  const r=await request(`/orders/${exampleOrder.id}`);assert.equal(r.status,200);
  assert.notEqual(r.body.client.phone,exampleOrder.client.phone);assert.equal(r.body.track_token,undefined);
 });
});
test('HTTP: фото запрещены для чужого и удалённого заказа',async()=>{
 await server('driver',async({request,db})=>{
  const item=exampleOrder.items[0];db.rows.order_items=[{id:item.id,order_id:exampleOrder.id,order:{...exampleOrder}}];
  assert.equal((await request(`/items/${item.id}/photo-upload`,'POST',{})).status,403);
  db.rows.order_items[0].order.deleted_at='2026-10-28T09:00:00Z';
  assert.equal((await request(`/items/${item.id}/photo-upload`,'POST',{})).status,404);
 });
});
test('HTTP: публичный ответ одинаков для неверного, неизвестного и удалённого токена',async()=>{
 await server('admin',async({request,db})=>{
  db.rpcResult={data:null,error:null};
  const invalid=await request('/public/track/bad','GET',null,null),unknown=await request(`/public/track/${'a'.repeat(24)}`,'GET',null,null);
  assert.equal(invalid.status,404);assert.equal(unknown.status,404);assert.deepEqual(unknown.body,invalid.body);
  assert.match(unknown.headers.get('cache-control'),/no-store/);
 });
});
test('HTTP: фильтры корзины и курсор используют устойчивый порядок',async()=>{
 await server('manager',async({request,db})=>{
  db.rows.orders=[{...exampleOrder,deleted_at:'2026-10-28T09:00:00.000Z',deleted_by:ids.admin},{...exampleOrder,id:'20000000-0000-4000-8000-000000000002',deleted_at:'2026-10-28T08:00:00.000Z',deleted_by:ids.admin}];
  const first=await request(`/trash?limit=1&deleted_by=${ids.admin}&reason=Ошибка`);
  assert.equal(first.status,200);assert.ok(first.body.next_cursor);assert.equal(first.body.data.length,1);
  assert.equal((await request(`/trash?cursor=${first.body.next_cursor}`)).status,200);
  assert.ok(db.calls.some(c=>c.operations?.some(o=>o[0]==='order'&&o[1]==='id')));
 });
});
test('HTTP: руководитель не получает права редактирования тарифов и обычных статусов',async()=>{
 await server('manager',async({request})=>{
  assert.equal((await request('/tariffs/wool','PUT',{name:'Шерсть',price_per_m2:30000})).status,403);
  assert.equal((await request(`/orders/${exampleOrder.id}/status`,'POST',{status:'pickup_assigned'})).status,403);
 });
});
