import {createHmac,createHash,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {HttpError} from './http.js';
export const equal=(a,b)=>{const x=Buffer.from(String(a??'')),y=Buffer.from(String(b??''));return x.length===y.length&&timingSafeEqual(x,y);};
export const sign=(secret,body)=>createHmac('sha256',secret).update(body).digest('hex');
export const otpHash=(token,code,secret)=>createHmac('sha256',secret).update(`${token}:${code}`).digest('hex');
const encryptionKey=secret=>{if(!/^[a-f0-9]{64}$/i.test(secret||''))throw new HttpError(503,'Не настроен ключ шифрования уведомлений','NOTIFICATIONS_DISABLED');return Buffer.from(secret,'hex');};
export function encrypt(text,secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(secret),iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
export function decrypt(value,secret){const raw=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey(secret),raw.subarray(0,12));cipher.setAuthTag(raw.subarray(12,28));return Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8');}
export function verifySignedRequest(req,secret,{bindKey=false}={}){
 const ts=req.get('X-CRM-Timestamp'),signature=req.get('X-CRM-Signature');
 const message=`${ts}.${bindKey?(req.get('Idempotency-Key')||'')+'.':''}${req.rawBody?.toString('utf8')||''}`;
 if(!secret||!/^\d{10}$/.test(ts||'')||Math.abs(Date.now()/1000-Number(ts))>300||!equal(signature,sign(secret,message)))throw new HttpError(401,'Неверная подпись интеграции','INVALID_SIGNATURE');
}
export function webhookURL(value,allowed=''){
 let u;try{u=new URL(value);}catch{throw new HttpError(400,'Неверный адрес webhook');}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!allowed.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(u.hostname.toLowerCase())||u.hash)throw new HttpError(400,'Адрес webhook отсутствует в WEBHOOK_ALLOWED_HOSTS','WEBHOOK_HOST_DENIED');
 return u;
}
export const contentHash=value=>createHash('sha256').update(value).digest('hex');
