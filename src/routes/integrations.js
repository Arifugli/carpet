import {Router} from 'express';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {verifySignedRequest,otpHash} from '../integration-security.js';
import {checked,HttpError} from '../http.js';
import {orderInput} from './orders.js';
export function createInbound(db,config={}){
 const r=Router();r.use(rateLimit({windowMs:60000,limit:90,message:{error:'Лимит запросов',code:'RATE_LIMIT'}}));
 r.post('/orders',async(req,res)=>{
  verifySignedRequest(req,config.externalSecret,{bindKey:true});const actor=z.string().uuid().safeParse(config.externalActor);if(!actor.success)throw new HttpError(503,'Интеграция не настроена','INTEGRATION_DISABLED');
  const p=orderInput.parse(req.body),key=z.string().uuid().parse(req.get('Idempotency-Key'));
  const id=checked(await db.rpc('create_order_audited',{p,p_user:actor.data,p_ip:req.ip,p_key:key}));res.status(201).json({id});
 });
 r.post('/telephony',async(req,res)=>{
  verifySignedRequest(req,config.telephonySecret);const actor=z.string().uuid().safeParse(config.telephonyActor);if(!actor.success)throw new HttpError(503,'Телефония не настроена','INTEGRATION_DISABLED');
  const d=z.object({external_id:z.string().min(1).max(120),branch_id:z.string().uuid(),phone:z.string().regex(/^\+998\d{9}$/),direction:z.enum(['in','out']),outcome:z.enum(['ringing','answered','missed','no_result']),recording_url:z.string().url().startsWith('https://').max(1000).optional(),order_id:z.string().uuid().optional()}).strict().parse(req.body);
  const data=checked(await db.rpc('crm_telephony',{d,u:actor.data,ip:req.ip}));res.json({id:data.id,outcome:data.outcome});
 });return r;
}
export function createClientPortal(db,config={}){
 const r=Router();r.use(rateLimit({windowMs:60000,limit:20,message:{error:'Слишком много попыток',code:'RATE_LIMIT'}}));
 const token=z.string().regex(/^[a-f0-9]{48}$/),notFound=()=>new HttpError(404,'Документ недоступен. Обратитесь к оператору.','DOCUMENT_UNAVAILABLE');
 r.get('/intake/:token',async(req,res)=>{
  if(!token.safeParse(req.params.token).success)throw notFound();z.object({}).strict().parse(req.query);const data=checked(await db.rpc('crm_intake_public',{token:req.params.token}));if(!data)throw notFound();
  for(const item of data.snapshot.items||[])for(const photo of item.photos||[]){const signed=await db.storage.from(config.bucket||'carpet-photos').createSignedUrl(photo.path,300);photo.url=signed.error?null:signed.data.signedUrl;delete photo.path;}
  res.json(data);
 });
 r.post('/intake/:token/confirm',async(req,res)=>{
  if(!token.safeParse(req.params.token).success)throw notFound();const b=z.object({code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
  if(!config.otpSecret)throw new HttpError(503,'Подтверждение пока недоступно','NOTIFICATIONS_DISABLED');
  const data=checked(await db.rpc('crm_intake_public',{token:req.params.token,hash:otpHash(req.params.token,b.code,config.otpSecret),p_ip:req.ip}));if(!data)throw notFound();
  if(!data.confirmed)throw new HttpError(400,data.code==='OTP_INVALID'?'Неверный код':'Код истёк или исчерпаны попытки. Попросите новый код у сотрудника.',data.code);res.json(data);
 });
 r.post('/feedback/:token',async(req,res)=>{
  const t=z.string().regex(/^[a-f0-9]{24}$/).safeParse(req.params.token);if(!t.success)throw notFound();
  const b=z.object({score:z.number().int().min(0).max(10),comment:z.string().max(1000).default('')}).strict().parse(req.body),data=checked(await db.rpc('crm_feedback',{token:t.data,score:b.score,note:b.comment}));if(!data)throw notFound();res.json(data);
 });return r;
}
