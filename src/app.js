import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { fileURLToPath } from 'node:url';
import { createAuth } from './middleware/auth.js';
import { createOrders } from './routes/orders.js';
import { createPublicApi,createStaffApi } from './routes/misc.js';
import { HttpError } from './http.js';
import {createWorkspaces} from './routes/workspaces.js';
import {createReports} from './routes/reports.js';
import {createOperations} from './routes/operations.js';
import {createProviders} from './routes/providers.js';
import {createInbound,createClientPortal} from './routes/integrations.js';
import {randomUUID} from 'node:crypto';

export function createApp({db,authClient,config={},authenticate}={}) {
 const app=express();
 app.set('trust proxy',config.trustProxy??1);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'",...(config.supabaseUrl?[new URL(config.supabaseUrl).origin]:[])],upgradeInsecureRequests:null}}}));
 app.use(cors({origin:config.corsOrigins?.length?config.corsOrigins:false}));
 app.use((req,res,next)=>{const started=performance.now(),id=randomUUID();res.set('X-Request-Id',id);res.on('finish',()=>{if(config.requestLogging)console.log(JSON.stringify({event:'http',request_id:id,method:req.method,route:req.route?.path||'static',status:res.statusCode,duration_ms:Math.round(performance.now()-started)}));});next();});
 app.use(express.json({limit:'3mb',verify:(req,_res,buffer)=>{req.rawBody=buffer;}}));
 app.get('/health',(_req,res)=>res.json({ok:true}));
 app.get('/ready',async(_req,res)=>{let timer;try{const result=await Promise.race([db.rpc('crm_ready',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),2000);})]);res.status(!result.error&&result.data?.ok?200:503).json({ok:!result.error&&!!result.data?.ok});}catch{res.status(503).json({ok:false});}finally{clearTimeout(timer);}});
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use('/api/public',createPublicApi(db,authClient));
 app.use('/api/public',createClientPortal(db,config));
 app.use('/api/providers',createProviders(db,config));
 app.use('/api/integrations',createInbound(db,config));
 app.use('/api',rateLimit({windowMs:60000,limit:240,message:{error:'Слишком много запросов. Повторите позже.',code:'RATE_LIMIT'}}),authenticate||createAuth(db),createOperations(db,config),createReports(db),createWorkspaces(db,config),createStaffApi(db,config),createOrders(db,config));
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
 app.get('/track/:token',(_req,res)=>res.sendFile(fileURLToPath(new URL('../public/index.html',import.meta.url))));
 app.get(['/intake/:token','/feedback/:token'],(_req,res)=>{res.set('Cache-Control','no-store');res.sendFile(fileURLToPath(new URL('../public/confirm.html',import.meta.url)));});
 app.use('/api',(_req,res)=>res.status(404).json({error:'Маршрут не найден',code:'NOT_FOUND'}));
 app.use((err,_req,res,_next)=>{
  if (err instanceof ZodError) return res.status(400).json({error:'Неверные данные. Проверьте обязательные поля.',code:'VALIDATION_ERROR',fields:err.issues.map(i=>i.path.join('.'))});
  if (err instanceof HttpError) return res.status(err.status).json({error:err.message,code:err.code});
  if (err.type==='entity.parse.failed') return res.status(400).json({error:'Неверный формат JSON',code:'INVALID_JSON'});
  if (err.type==='entity.too.large') return res.status(413).json({error:'Слишком большой запрос',code:'PAYLOAD_TOO_LARGE'});
  console.error(JSON.stringify({event:'unhandled_error',name:err.name}));
  res.status(500).json({error:'Ошибка сервера',code:'INTERNAL_ERROR'});
 });
 return app;
}
