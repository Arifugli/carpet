import {database as legacyDatabase} from './legacy-database.js';
import {readFile} from 'node:fs/promises';
export const ids={admin:'10000000-0000-4000-8000-000000000001',operator:'10000000-0000-4000-8000-000000000003',driver:'10000000-0000-4000-8000-000000000004',inactive:'10000000-0000-4000-8000-000000000006',warehouse:'10000000-0000-4000-8000-000000000008',washer:'10000000-0000-4000-8000-000000000009',packer:'10000000-0000-4000-8000-000000000010',driver2:'10000000-0000-4000-8000-000000000011'};
export const input={name:'Дилноза',phone:'+998901234567',source:'call_in',region_code:'fergana',district_code:'fergana_city',street:'Навои',house:'14',private_house:true,items:[{tariff:'carpet',quantity:1},{tariff:'blanket',quantity:2},{tariff:'tushak',quantity:1}]};
export async function database({cleanup=true,legacyGrants=false,deliveryPricingFix=true,cashbook=true}={}){
 const db=await legacyDatabase({through:'0014_workflow_enums.sql',legacyGrants});try{
  await db.exec('reset role');for(const name of ['0015_order_workflow.sql',...(cleanup?['0016_clear_legacy_orders.sql',...(deliveryPricingFix?['0017_delivery_fee_default.sql']:[])]:[])])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
  if(cleanup)for(const name of ['0018_driver_intake_items.sql','0019_work_dashboard.sql',...(cashbook?['0020_unified_cash.sql','0022_organization_branding.sql','0023_branding_save_where.sql']:[])])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
  await db.exec('drop function if exists public.test_legacy_order(jsonb,uuid,inet)');
  for(const role of ['warehouse','washer','packer','driver2']){await db.query('insert into auth.users(id) values($1)',[ids[role]]);await db.query("update profiles set role=$1,active=true,full_name=$2,branch_id='01000000-0000-4000-8000-000000000001' where id=$3",[role==='driver2'?'driver':role,role,ids[role]]);}
  await db.exec('set role service_role');return db;
 }catch(e){await db.close();throw e;}
}
export async function call(db,name,args){return(await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})) result`,args)).rows[0].result;}
export const create=(db,overrides={})=>call(db,'create_order_audited',[JSON.stringify({...input,...overrides}),ids.operator,'127.0.0.1',crypto.randomUUID()]);
export const command=(db,name,data,role='admin',key=crypto.randomUUID())=>call(db,'crm_command',[name,JSON.stringify(data),ids[role],'127.0.0.1',key]);
export async function measurements(db,id){return(await db.query('select * from order_items where order_id=$1 order by seq',[id])).rows.map(i=>({item_id:i.id,...(i.unit==='m2'?{length_m:3,width_m:2}:{quantity:i.quantity})}));}
export async function advance(db,id,target='delivered',{dimensions=[3,2],driver='driver'}={}){
 const current=async()=>(await db.query('select * from orders where id=$1',[id])).rows[0],act=(c,d={},r=driver)=>command(db,c,{order_id:id,...d},r);
 let o=await current();if(o.status===target)return o;
 if(o.status==='new'){await act('pickup.claim',{pickup_at:new Date().toISOString()});if(target==='pickup_planned')return current();}
 o=await current();if(o.status==='pickup_planned'){
  const rows=(await db.query('select * from order_items where order_id=$1 order by seq',[id])).rows;
  if(o.pickup_state==='pending'){for(const i of rows)await call(db,'register_order_photo',[i.id,`${id}/${i.id}/${crypto.randomUUID()}.jpg`,'intake',ids[driver],'127.0.0.1']);await act('pickup.collect',{items:rows.map(i=>({item_id:i.id,...(i.unit==='m2'?{length_m:dimensions[0],width_m:dimensions[1]}:{quantity:i.quantity})}))});}
  if(target==='collected')return current();await act('pickup.handover');if(target==='warehouse')return current();
 }
 o=await current();if(o.status==='warehouse'){
  if(!o.warehouse_received_at)await act('warehouse.receive',{},'warehouse');
  const samples=(await db.query("select m.* from item_measurements m join order_items i on i.id=m.item_id where i.order_id=$1 and m.source_role='driver'",[id])).rows;
  if(!o.warehouse_verified_at)await act('warehouse.measure',{items:samples.map(m=>({item_id:m.item_id,...(m.length_m?{length_m:Number(m.length_m),width_m:Number(m.width_m)}:{quantity:m.quantity})}))},'warehouse');
  if(target==='verified')return current();await act('warehouse.to_wash',{},'warehouse');if(target==='washing')return current();
 }
 o=await current();if(o.status==='washing'){
  if(o.wash_phase==='acceptance')await act('wash.accept',{},'washer');if(target==='wash_accepted')return current();
  if((await current()).wash_phase==='washing')await act('wash.dry',{},'washer');if(target==='drying')return current();await act('wash.to_pack',{},'washer');if(target==='packing')return current();
 }
 o=await current();if(o.status==='packing'){
  if(!o.packing_received_at)await act('packing.accept',{},'packer');if(target==='pack_accepted')return current();
  const item=(await db.query('select id from order_items where order_id=$1 limit 1',[id])).rows[0];await call(db,'register_order_photo',[item.id,`${id}/${item.id}/${crypto.randomUUID()}.jpg`,'ready',ids.packer,'127.0.0.1']);await act('packing.complete',{},'packer');if(target==='ready_for_delivery')return current();
 }
 if((await current()).status==='ready_for_delivery'){await act('delivery.claim');if(target==='in_transit')return current();}
 if((await current()).status==='in_transit')await act('delivery.complete');return current();
}
export async function createPriced(db,overrides={}){const id=await create(db,{items:[{tariff:'carpet',quantity:1}],...overrides});await advance(db,id,'collected',{dimensions:[5,3]});return id;}
