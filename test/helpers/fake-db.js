import {ids} from './database.js';
export const exampleOrder={id:'20000000-0000-4000-8000-000000000001',branch_id:'01000000-0000-4000-8000-000000000001',number:1041,status:'new',driver_id:null,deleted_at:null,total:180000,paid_amount:0,
 created_at:'2026-10-28T08:00:00.000Z',client:{name:'Дилноза',phone:'+998901234567'},items:[{id:'30000000-0000-4000-8000-000000000001',seq:1,length_m:3,width_m:2,tariff_code:'wool',price:180000,photos:[]}],history:[]};
export function fakeDb(role='admin') {
 const db={calls:[],rows:{orders:[structuredClone(exampleOrder)],profiles:Object.entries(ids).map(([r,id])=>({id,role:r,active:r!=='inactive',full_name:r,branch_id:exampleOrder.branch_id})),cancel_reasons:[],clients:[]},rpcResult:null};
 db.auth={getUser:async token=>token==='invalid'?{data:{user:null},error:{}}:{data:{user:{id:ids[role]}}}};
 db.rpc=async(name,args)=>{db.calls.push({rpc:name,args});return db.rpcResult??{data:{...exampleOrder,status:name==='cancel_order'?'cancelled':'new'},error:null};};
 db.from=table=>{
  const call={table,filters:[],operations:[]};db.calls.push(call);let max=Infinity,single=false;
  const q={
   select(value){call.select=value;return q;},eq(k,v){call.filters.push(['eq',k,v]);return q;},
   is(k,v){call.filters.push(['is',k,v]);return q;},not(k,op,v){call.filters.push(['not',k,v]);return q;},
   in(k,v){call.filters.push(['in',k,v]);return q;},order(...args){call.operations.push(['order',...args]);return q;},
   limit(n){max=n;return q;},or(v){call.operations.push(['or',v]);return q;},gte(...args){call.operations.push(['gte',...args]);return q;},lte(...args){call.operations.push(['lte',...args]);return q;},ilike(...args){call.operations.push(['ilike',...args]);return q;},
   insert(v){call.operations.push(['insert',v]);return q;},upsert(v){call.operations.push(['upsert',v]);return q;},
   maybeSingle(){single=true;return q;},single(){single=true;return q;},
   then(resolve,reject){
    const rows=structuredClone(db.rows[table]||[]).filter(row=>call.filters.every(([op,k,v])=>op==='eq'||op==='is'?row[k]===v:op==='not'?row[k]!==v:op==='in'?v.includes(row[k]):true)).slice(0,max);
    return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve,reject);
   },
  };return q;
 };
 db.storage={from:()=>({createSignedUrls:async()=>({data:[],error:null}),createSignedUploadUrl:async()=>({data:{signedUrl:'https://example.test/upload',token:'signed'},error:null})})};
 return db;
}
