import https from 'node:https';
import dns from 'node:dns';
import {isIP} from 'node:net';
import {webhookURL,sign,decrypt} from './integration-security.js';
export function publicAddress(value){
 if(isIP(value)===4){const a=value.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0))||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&(a[1]===18||a[1]===19)));}
 if(isIP(value)===6){const v=value.toLowerCase();return /^2[0-9a-f]{3}:/.test(v)&&!v.startsWith('2001:db8:');}return false;
}
// Проверка адреса выполняется в lookup фактического TCP-соединения, без DNS rebinding.
export async function sendWebhook(url,body,headers,hosts){
 const target=webhookURL(url,hosts);if(isIP(target.hostname))throw Error('WEBHOOK_IP_DENIED');
 return new Promise((resolve,reject)=>{
  const request=https.request(target,{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},lookup:(hostname,options,callback)=>{
   dns.lookup(hostname,{all:true},(error,addresses)=>{if(error)return callback(error);if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))return callback(Error('WEBHOOK_IP_DENIED'));const first=addresses[0];callback(null,options?.all?addresses:first.address,options?.all?undefined:first.family);});
  }},response=>{let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>65536)request.destroy(Error('RESPONSE_TOO_LARGE'));});response.on('end',()=>response.statusCode>=200&&response.statusCode<300?resolve({id:null}):reject(Error(`WEBHOOK_HTTP_${response.statusCode}`)));response.on('error',reject);});
  request.setTimeout(10000,()=>request.destroy(Error('PROVIDER_TIMEOUT')));request.on('error',reject);request.end(body);
 });
}
export function createSender({config,db,fetcher=fetch,webhook=sendWebhook}){
 const json=async(url,body,headers={})=>{let response;try{response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});}catch{throw Error('PROVIDER_NETWORK');}if(!response.ok)throw Error(`PROVIDER_HTTP_${response.status}`);return response.json();};
 return async row=>{
  if(row.payload.encrypted&&row.payload.expires_at&&Date.parse(row.payload.expires_at)<=Date.now())return {id:'skip:otp-expired'};
  if(row.payload.visit_id){const {data:v,error}=await db.from('visits').select('state,scheduled_date').eq('id',row.payload.visit_id).single();if(error)throw Error('VISIT_READ_FAILED');const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());if(!v||v.state!=='planned'||v.scheduled_date<today)return {id:'skip:visit-changed'};}
  // Обычные уведомления проверяют текущее согласие и корзину непосредственно перед отправкой.
  if(row.order_id){const {data:o,error}=await db.from('orders').select('deleted_at,status,client:clients(sms_consent,telegram_consent)').eq('id',row.order_id).single();if(error)throw Error('ORDER_READ_FAILED');if(!o||o.deleted_at)return {id:'skip:order-unavailable'};if(row.channel!=='webhook'&&row.event_key?.startsWith('pickup:')&&!['new','pickup_assigned'].includes(o.status))return {id:'skip:pickup-closed'};if(row.channel!=='webhook'&&row.payload.expected_status&&row.payload.expected_status!==o.status)return {id:'skip:outdated-status'};if(row.channel!=='webhook'&&!row.payload.encrypted&&!o.client?.[row.channel==='sms'?'sms_consent':'telegram_consent'])return {id:'skip:consent-withdrawn'};}
  if(row.channel==='webhook'){
   const {data:w,error}=await db.from('webhook_subscriptions').select('url,secret_env,active').eq('id',row.destination).single();if(error||!w?.active)throw Error('WEBHOOK_DISABLED');const secret=config.webhookSecrets?.[w.secret_env];if(!secret)throw Error('WEBHOOK_SECRET_MISSING');
   const body=JSON.stringify({id:row.id,...row.payload}),timestamp=String(Math.floor(Date.now()/1000));return webhook(w.url,body,{'X-CRM-Event-Id':row.id,'X-CRM-Timestamp':timestamp,'X-CRM-Signature':sign(secret,`${timestamp}.${body}`),'Idempotency-Key':row.id},config.webhookHosts);
  }
  const text=(row.payload.encrypted?decrypt(row.payload.encrypted,config.notificationKey):row.payload.text||'').replaceAll('{base_url}',config.publicBaseUrl||'');if(!text||text.includes('{base_url}')||(!config.publicBaseUrl&&/\/track\/|\/feedback\//.test(text)))throw Error('PUBLIC_BASE_URL_MISSING');
  if(row.channel==='sms'){
   if(!config.smsToken||!config.smsFrom)throw Error('SMS_DISABLED');
   const result=await json('https://notify.eskiz.uz/api/message/sms/send',{mobile_phone:row.destination.replace(/^\+/,''),message:text,from:config.smsFrom,user_sms_id:row.id},{Authorization:`Bearer ${config.smsToken}`});if(!result.id)throw Error('SMS_RESPONSE_INVALID');return {id:String(result.id)};
  }
  if(row.channel==='telegram'){
   if(!config.telegramToken)throw Error('TELEGRAM_DISABLED');const result=await json(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`,{chat_id:row.destination,text,link_preview_options:{is_disabled:true}});if(!result.ok||!result.result?.message_id)throw Error('TELEGRAM_RESPONSE_INVALID');return {id:String(result.result.message_id)};
  }throw Error('CHANNEL_UNSUPPORTED');
 };
}
