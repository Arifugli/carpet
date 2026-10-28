import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { allow,canReadOrder,PERMISSIONS } from '../permissions.js';
import { checked,HttpError,withCode } from '../http.js';

const unavailable={error:'Статус заказа недоступен. Уточните информацию у оператора.',code:'TRACK_UNAVAILABLE'};
export function createPublicApi(db,authClient) {
 const router=Router();
 router.get('/track/:token',rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Слишком много запросов. Повторите позже.',code:'RATE_LIMIT'}}),async(req,res)=>{
  res.set('Cache-Control','no-store');
  if (!z.string().regex(/^[0-9a-f]{24}$/).safeParse(req.params.token).success) return res.status(404).json(unavailable);
  const data=checked(await db.rpc('public_order_status',{p_token:req.params.token}));
  if (!data) return res.status(404).json(unavailable);
  res.json(data);
 });
 router.post('/login',rateLimit({windowMs:60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Слишком много попыток входа. Повторите позже.',code:'RATE_LIMIT'}}),async(req,res)=>{
  const b=z.object({email:z.string().email().max(254),password:z.string().min(1).max(256)}).strict().parse(req.body);
  if (!authClient) throw new HttpError(503,'Вход временно недоступен');
  // Отдельный клиент: сессия сотрудника никогда не подменяет service_role клиента БД.
  const {data,error}=await authClient.auth.signInWithPassword(b);
  if (error||!data.session) throw new HttpError(401,'Неверная почта или пароль','LOGIN_FAILED');
  res.set('Cache-Control','no-store').json({access_token:data.session.access_token,expires_at:data.session.expires_at});
 });
 return router;
}

export function createStaffApi(db,{bucket='carpet-photos'}={}) {
 const router=Router();
 router.use(allow('read'));
 router.get('/me',(req,res)=>res.json({...req.user,permissions:PERMISSIONS[req.user.role]}));
 router.get('/clients/lookup',allow('create'),async(req,res)=>{
  const {phone}=z.object({phone:z.string().max(32)}).strict().parse(req.query),k=phone.replace(/\D/g,'').slice(-9);
  if (k.length<9) return res.json({client:null,orders:[]});
  const client=checked(await db.from('clients').select('*').eq('phone_key',k).maybeSingle());
  if (!client) return res.json({client:null,orders:[]});
  const orders=checked(await db.from('orders').select('id,number,status,total,created_at').eq('client_id',client.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(5));
  res.json({client,orders:orders.map(withCode)});
 });
 router.get('/drivers',allow('assign'),async(req,res)=>{
  z.object({}).strict().parse(req.query);
  res.json(checked(await db.from('profiles').select('id,full_name,phone').eq('role','driver').eq('active',true).order('full_name')));
 });
 router.get('/staff',allow('trash'),async(req,res)=>{
  z.object({}).strict().parse(req.query);
  res.json(checked(await db.from('profiles').select('id,full_name,role').order('full_name')));
 });
 router.get('/tariffs',async(req,res)=>{
  z.object({}).strict().parse(req.query);
  const [t,s]=await Promise.all([db.from('tariffs').select('*').order('code'),db.from('settings').select('*')]);
  res.json({tariffs:checked(t),settings:Object.fromEntries(checked(s).map(r=>[r.key,Number(r.value)]))});
 });
 router.put('/tariffs/:code',allow('tariffs'),async(req,res)=>{
  const code=z.string().regex(/^[a-z0-9_]{1,20}$/).parse(req.params.code);
  const b=z.object({name:z.string().trim().min(1).max(60),price_per_m2:z.number().int().min(0).max(999999999999),active:z.boolean().default(true)}).strict().parse(req.body);
  res.json(checked(await db.rpc('save_tariff_audited',{p_code:code,p_data:b,p_user:req.user.id,p_ip:req.ip})));
 });
 const ownedItem=async req=>{
  const id=z.string().uuid().parse(req.params.itemId);
  const it=checked(await db.from('order_items').select('id,order_id,order:orders(id,driver_id,status,deleted_at)').eq('id',id).maybeSingle());
  if (!it||!it.order||it.order.deleted_at) throw new HttpError(404,'Ковёр не найден','ITEM_NOT_FOUND');
  if (!canReadOrder(req.user,it.order)) throw new HttpError(403,'Недостаточно прав для этого заказа','FORBIDDEN');
  return it;
 };
 router.post('/items/:itemId/photo-upload',allow('photos'),async(req,res)=>{
  z.object({}).strict().parse(req.body??{}); const it=await ownedItem(req);
  const path=`${it.order_id}/${it.id}/${crypto.randomUUID()}.jpg`;
  const data=checked(await db.storage.from(bucket).createSignedUploadUrl(path));
  res.json({path,signedUrl:data.signedUrl,token:data.token});
 });
 router.post('/items/:itemId/photos',allow('photos'),async(req,res)=>{
  const b=z.object({path:z.string().min(1).max(300),kind:z.enum(['intake','ready']).default('intake')}).strict().parse(req.body),it=await ownedItem(req);
  if (!new RegExp(`^${it.order_id}/${it.id}/[a-f0-9-]{36}\\.jpg$`).test(b.path)) throw new HttpError(400,'Неверный путь файла');
  res.status(201).json(checked(await db.rpc('register_order_photo',{p_item:it.id,p_path:b.path,p_kind:b.kind,p_user:req.user.id,p_ip:req.ip})));
 });
 return router;
}
