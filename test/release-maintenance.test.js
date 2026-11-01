import {test} from 'node:test';import assert from 'node:assert/strict';
import {database,create,call,ids} from './helpers/database.js';
import {finalizeLegacyStorage} from '../scripts/finalize-legacy-storage.mjs';
test('окно обновления: DML и RPC блокируются, readiness остаётся доступной, после снятия блокировки заказы создаются',async()=>{
 const db=await database();try{
  const id=await create(db);await db.exec("reset role;update settings set value=1 where key='workflow_maintenance';set role service_role");
  await assert.rejects(create(db),e=>e.code==='57P03');await assert.rejects(db.query('update orders set comment=$1 where id=$2',['Заблокировано',id]),e=>e.code==='57P03');await assert.rejects(call(db,'crm_board',['{}',ids.admin]),e=>e.code==='57P03');
  assert.equal((await call(db,'crm_ready',[])).ok,true);await db.exec("reset role;update settings set value=0 where key='workflow_maintenance';set role service_role");assert.ok(await create(db));
 }finally{await db.close();}
});
test('разовая очистка Storage: только точное подтверждение, манифест и отсутствие живых ссылок; повтор не удаляет снова',async()=>{
 let completed=false,removes=0,audits=0;const path=Array.from({length:3},()=>crypto.randomUUID()).join('/')+'.jpg';
 const db={storage:{from:()=>({remove:async p=>{removes++;assert.deepEqual(p,[path]);return {data:[],error:null};}})},from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:completed?{id:'done'}:null,error:null}),single:async()=>({data:{storage_manifest:[{path}]},error:null}),insert:async()=>{audits++;return {data:null,error:null};},upsert:async()=>{completed=true;return {data:null,error:null};},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}})};
 assert.deepEqual(await finalizeLegacyStorage(db),{skipped:true});await assert.rejects(finalizeLegacyStorage(db,{legacyStorageCleanupConfirm:'yes'}));assert.equal(removes,0);
 const c={legacyStorageCleanupConfirm:'delete-legacy-order-photos-0016'};assert.equal((await finalizeLegacyStorage(db,c)).files,1);assert.equal((await finalizeLegacyStorage(db,c)).already_completed,true);assert.equal(removes,1);assert.equal(audits,1);
});
