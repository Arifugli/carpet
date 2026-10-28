import {checked} from './http.js';
export function createOutboxWorker({db,send,channels=[],log=console.log}){
 let stopping=false,running=false;
 return {stop:()=>{stopping=true;},get running(){return running;},async once(){
  if(stopping||running)return;running=true;
  try{
   checked(await db.rpc('crm_tick',{}));if(!channels.length)return;
   const rows=checked(await db.rpc('crm_outbox_claim',{channels,maximum:20}));
   for(const row of rows){if(stopping)break;
    try{const result=await send(row);checked(await db.rpc('crm_outbox_finish',{oid:row.id,lease:row.lease_token,success:true,provider:result?.id||null}));log(JSON.stringify({event:'outbox_completed',id:row.id,channel:row.channel}));}
    catch(error){const code=/^[A-Z_0-9]{1,120}$/.test(error.message)?error.message:'PROVIDER_FAILED';checked(await db.rpc('crm_outbox_finish',{oid:row.id,lease:row.lease_token,success:false,error_code:code}));log(JSON.stringify({event:'outbox_retry',id:row.id,channel:row.channel,code}));}
   }
  }finally{running=false;}
 }};
}
