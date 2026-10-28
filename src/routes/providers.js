import {Router,urlencoded} from 'express';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {equal} from '../integration-security.js';
import {checked} from '../http.js';
const nonempty=z.string().min(1).max(128),integer=z.number().int().safe(),uuid=z.string().uuid();
const methods={CheckPerformTransaction:'check',CreateTransaction:'create',PerformTransaction:'perform',CancelTransaction:'cancel',CheckTransaction:'status',GetStatement:'statement'};
const schemas={
 check:z.object({amount:integer.positive(),account:z.object({intent_id:uuid}).strict()}).strict(),
 create:z.object({id:nonempty,time:integer.nonnegative(),amount:integer.positive(),account:z.object({intent_id:uuid}).strict()}).strict(),
 perform:z.object({id:nonempty}).strict(),cancel:z.object({id:nonempty,reason:z.number().int().min(1).max(10)}).strict(),status:z.object({id:nonempty}).strict(),
 statement:z.object({from:integer.nonnegative(),to:integer.nonnegative()}).strict().refine(d=>d.to>=d.from&&d.to-d.from<=31*86400000),
};
const message=code=>({'-31001':'Неверная сумма','-31003':'Транзакция не найдена','-31007':'Заказ выдан, автоматическая отмена недоступна','-31008':'Невозможно выполнить операцию','-31050':'Счёт не найден','-32504':'Неверная авторизация','-32600':'Неверный запрос','-32601':'Метод не найден'})[code]||'Ошибка платежа';
export function createProviders(db,config={}){
 const r=Router();r.use(rateLimit({windowMs:60000,limit:180,message:{error:'Лимит запросов',code:'RATE_LIMIT'}}));
 r.post('/payme',async(req,res)=>{
  const id=['number','string'].includes(typeof req.body?.id)?req.body.id:null;
  const fail=(code,data)=>res.json({id,error:{code,message:{ru:message(code),uz:message(code),en:message(code)},...(data?{data}:{})}});
  if(!config.paymeKey)return res.status(503).json({error:'Платёжный модуль не подключён',code:'PROVIDER_DISABLED'});
  const expected=`Basic ${Buffer.from('Paycom:'+config.paymeKey).toString('base64')}`;
  if(!equal(req.get('Authorization'),expected))return fail(-32504);
  const b=z.object({id:z.union([integer,z.string().max(128)]).optional(),method:nonempty,params:z.unknown(),jsonrpc:z.literal('2.0').optional()}).strict().safeParse(req.body);if(!b.success)return fail(-32600);
  const op=methods[b.data.method];if(!op)return fail(-32601);
  const parsed=schemas[op].safeParse(b.data.params);if(!parsed.success)return fail(-32600);const p=parsed.data;
  const data={...p,provider_id:p.id,intent_id:p.account?.intent_id,amount:p.amount==null?undefined:p.amount/100,amount_tiyin:p.amount};
  const result=checked(await db.rpc('crm_provider',{p_provider:'payme',p_operation:op,d:data}));if(result.error_code)return fail(result.error_code,result.error_code===-31050?'intent_id':undefined);
  if(op==='statement')return res.json({id,result:{transactions:result}});
  const keys=op==='check'?['allow']:op==='create'?['create_time','transaction','state']:op==='perform'?['perform_time','transaction','state']:op==='cancel'?['cancel_time','transaction','state']:['create_time','perform_time','cancel_time','transaction','state','reason'];
  res.json({id,result:Object.fromEntries(keys.map(k=>[k,result[k]]))});
 });
 r.post('/click',urlencoded({extended:false,limit:'20kb'}),async(req,res)=>{
  if(!config.clickSecret||!config.clickServiceId)return res.status(503).json({error:'Платёжный модуль не подключён',code:'PROVIDER_DISABLED'});
  const parsed=z.object({click_trans_id:nonempty,service_id:nonempty,click_paydoc_id:nonempty,merchant_trans_id:uuid,amount:z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),action:z.enum(['0','1']),error:z.string().regex(/^-?\d+$/),error_note:z.string().max(500).optional(),sign_time:z.string().min(1).max(32),sign_string:z.string().regex(/^[a-f0-9]{32}$/i),merchant_prepare_id:z.string().regex(/^\d+$/).max(16).optional()}).strict().safeParse(req.body);
  if(!parsed.success)return res.json({error:-8,error_note:'Неверный запрос'});const p=parsed.data;
  const answer=(error,note,extra={})=>res.json({click_trans_id:p.click_trans_id,merchant_trans_id:p.merchant_trans_id,error,error_note:note,...extra});
  const value=p.click_trans_id+p.service_id+config.clickSecret+p.merchant_trans_id+(p.action==='1'?p.merchant_prepare_id||'':'')+p.amount+p.action+p.sign_time;
  if(p.service_id!==config.clickServiceId||!equal(createHash('md5').update(value).digest('hex'),p.sign_string.toLowerCase()))return answer(-1,'Неверная подпись');
  if(p.action==='1'&&!p.merchant_prepare_id)return answer(-8,'Не указан merchant_prepare_id');
  const data={intent_id:p.merchant_trans_id,provider_id:p.click_trans_id,amount:Number(p.amount),prepare_id:p.merchant_prepare_id==null?undefined:Number(p.merchant_prepare_id),reason:1};
  const result=checked(await db.rpc('crm_provider',{p_provider:'click',p_operation:Number(p.error)<0?'cancel':p.action==='0'?'create':'perform',d:data}));
  if(result.error_code)return answer(({'-31001':-2,'-31003':-6,'-31050':-5,'-31008':-9,'-31007':-7})[result.error_code]||-7,message(result.error_code));
  if(result.intent_id!==p.merchant_trans_id)return answer(-6,'Транзакция относится к другому счёту');
  if(result.state<0)return answer(-9,'Транзакция отменена');
  answer(0,'Success',p.action==='0'?{merchant_prepare_id:result.prepare_id}:{merchant_confirm_id:result.prepare_id});
 });return r;
}
