import {createApp} from '../../src/app.js';
import {fakeDb} from './fake-db.js';
import {database,create,ids} from './database.js';
import {listen} from './listen.js';

export async function workflowServer(config={}) {
 const sql=await database(),db=fakeDb(),orderId=await create(sql);
 const sync=async()=>{
  db.rows.orders=(await sql.query(`select to_jsonb(o)||jsonb_build_object(
   'client',(select to_jsonb(c) from clients c where c.id=o.client_id),
   'items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('photos','[]'::jsonb) order by i.seq),'[]'::jsonb) from order_items i where i.order_id=o.id),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from status_history h where h.order_id=o.id)) as data from orders o`)).rows.map(r=>r.data);
  for(const table of ['profiles','clients','cancel_reasons','tariffs','settings','audit_log','intake_acts','order_items','payments','payment_intents','webhook_subscriptions']) db.rows[table]=(await sql.query(`select * from ${table}`)).rows;
 };
 await sync();
 db.auth.getUser=async token=>({data:{user:{id:ids[token]}}});
 db.rpc=async(name,params)=>{
  try {
   const entries=Object.entries(params),args=entries.map(([k],i)=>`${k}=>$${i+1}`).join(',');
   const result=(await sql.query(`select to_jsonb(public.${name}(${args})) as data`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].data;
   await sync();return {data:result,error:null};
  }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
 };
 const authClient={auth:{signInWithPassword:async({email})=>({data:{session:{access_token:email.split('@')[0],expires_at:9999999999}}})}};
 const server=await listen(createApp({db,authClient,config:{trustProxy:false,...config}}));
 return {sql,db,orderId,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sql.close();}};
}
