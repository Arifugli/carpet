import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,create,call,command,advance,measurements,ids} from './helpers/database.js';

test('цена 50 000 без скрытых 20 000: миграция исправляет ожидающие заявки, сохраняет согласованную цену и историю',async()=>{
 const db=await database({deliveryPricingFix:false});
 try{
  const bid='01000000-0000-4000-8000-000000000001';
  await command(db,'tariff.schedule',{branch_id:bid,code:'blanket',name:'Одеяло',price_per_m2:50000,unit:'piece',active:true,effective_at:new Date().toISOString()});
  const sample={items:[{tariff:'blanket',quantity:1}]};
  const priced=await create(db,sample);await advance(db,priced,'collected');
  await command(db,'payment.record',{order_id:priced,amount:10000,method:'cash'},'driver');
  const get=async id=>(await db.query('select * from orders where id=$1',[id])).rows[0];
  const agreed=await get(priced);assert.equal(agreed.total,'70000');
  const tariffHistory=(await db.query('select * from tariff_versions order by id')).rows;
  const settingHistory=(await db.query('select * from setting_versions order by id')).rows;
  const planned=await create(db,sample),fresh=await create(db,sample);await advance(db,planned,'pickup_planned');
  const items=await measurements(db,planned);
  const quote=()=>call(db,'crm_pickup_preview',[planned,JSON.stringify(items),ids.driver]);
  assert.equal((await quote()).total,70000);
  const sql=await readFile(new URL('../supabase/migrations/0017_delivery_fee_default.sql',import.meta.url),'utf8');
  await db.exec('reset role');await db.exec(sql);await db.exec('set role service_role');
  const q=await quote();assert.equal(q.subtotal,50000);assert.equal(q.delivery_fee,0);assert.equal(q.total,50000);
  for(const id of [planned,fresh])assert.equal((await get(id)).pricing_snapshot.settings.delivery_fee,0);
  const after=await create(db,sample);
  assert.equal((await get(after)).pricing_snapshot.settings.delivery_fee,0);
  const double=await call(db,'crm_pickup_calculation',[after,JSON.stringify((await measurements(db,after)).map(i=>({...i,quantity:2})))]);
  assert.equal(double.total,100000);
  const actual=await call(db,'quote_order',[JSON.stringify({...sample,branch_id:bid})]);assert.equal(actual.total,50000);
  await advance(db,planned,'collected');assert.equal((await get(planned)).total,'50000');
  assert.deepEqual(await get(priced),agreed);
  assert.deepEqual((await db.query('select * from tariff_versions order by id')).rows,tariffHistory);
  for(const old of settingHistory)assert.deepEqual((await db.query('select * from setting_versions where id=$1',[old.id])).rows[0],old);
  assert.equal((await db.query("select count(*) from audit_log where action='default_delivery_fee_disabled'")).rows[0].count,1);
  // A later deliberate admin setting is allowed and must survive a repeated migration.
  await command(db,'setting.schedule',{branch_id:bid,key:'delivery_fee',value:10000,effective_at:new Date().toISOString()});
  assert.equal(await call(db,'crm_setting',['delivery_fee',bid]),10000);
  await db.exec('reset role');await db.exec(sql);await db.exec('set role service_role');
  assert.equal(await call(db,'crm_setting',['delivery_fee',bid]),10000);
  assert.equal((await db.query("select count(*) from audit_log where action='default_delivery_fee_disabled'")).rows[0].count,1);
 }finally{await db.close();}
});
