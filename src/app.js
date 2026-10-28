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

export function createApp({db,authClient,config={},authenticate}={}) {
 const app=express();
 app.set('trust proxy',config.trustProxy??1);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:','https:'],connectSrc:["'self'"],upgradeInsecureRequests:null}}}));
 app.use(cors({origin:config.corsOrigins?.length?config.corsOrigins:false}));
 app.use(express.json({limit:'100kb'}));
 app.get('/health',(_req,res)=>res.json({ok:true}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use('/api/public',createPublicApi(db,authClient));
 app.use('/api',rateLimit({windowMs:60000,limit:240,message:{error:'Слишком много запросов. Повторите позже.',code:'RATE_LIMIT'}}),authenticate||createAuth(db),createStaffApi(db,config),createOrders(db,config));
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
 app.get('/track/:token',(_req,res)=>res.sendFile(fileURLToPath(new URL('../public/index.html',import.meta.url))));
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
