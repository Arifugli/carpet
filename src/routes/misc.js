import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { allow,canReadOrder,PERMISSIONS } from '../permissions.js';
import { checked,HttpError,withCode } from '../http.js';
import {loginName,PASSWORD_MIN_LENGTH} from '../staff-login.js';
import {randomUUID} from 'node:crypto';

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
  const b=z.object({identifier:z.string().trim().min(1).max(254).optional(),email:z.string().trim().min(1).max(254).optional(),password:z.string().min(PASSWORD_MIN_LENGTH).max(256)}).strict().refine(v=>!!v.identifier!==!!v.email,{message:'Укажите логин или почту',path:['identifier']}).parse(req.body);
  if (!authClient) throw new HttpError(503,'Вход временно недоступен');
  const identifier=b.identifier||b.email;let email=identifier,found=true;
  if(!identifier.includes('@')){
   const login=loginName.safeParse(identifier);if(!login.success)throw new HttpError(401,'Неверный логин, почта или пароль','LOGIN_FAILED');
   const id=checked(await db.rpc('crm_login_identity',{p_login:login.data}));
   const user=id?await db.auth.admin.getUserById(id):null;
   found=!!user?.data?.user?.email&&!user.error;
   email=found?user.data.user.email:`unknown-${randomUUID()}@staff.invalid`;
  }else if(!z.string().email().safeParse(email).success)throw new HttpError(401,'Неверный логин, почта или пароль','LOGIN_FAILED');
  // Отдельный клиент: сессия сотрудника никогда не подменяет service_role клиента БД.
  const {data,error}=await authClient.auth.signInWithPassword({email,password:b.password});
  if (!found||error||!data.session) throw new HttpError(401,'Неверный логин, почта или пароль','LOGIN_FAILED');
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
  let query=db.from('orders').select('id,number,status,total,created_at').eq('client_id',client.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(5);
  if(req.user.role!=='admin')query=query.eq('branch_id',req.user.branch_id);
  const orders=checked(await query);
  res.json({client,orders:orders.map(withCode)});
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
  const it=checked(await db.from('order_items').select('id,order_id,order:orders(id,driver_id,pickup_driver_id,delivery_driver_id,status,deleted_at,branch_id,pickup_state,packing_received_at)').eq('id',id).maybeSingle());
  if (!it||!it.order||it.order.deleted_at) throw new HttpError(404,'Ковёр не найден','ITEM_NOT_FOUND');
  if (!canReadOrder(req.user,it.order)) throw new HttpError(403,'Недостаточно прав для этого заказа','FORBIDDEN');
  return it;
 };
 router.post('/items/:itemId/photo-upload',allow('photos'),async(req,res)=>{
  const b=z.object({upload_id:z.string().uuid().optional()}).strict().parse(req.body??{}); const it=await ownedItem(req);
  if(!(req.user.role==='admin'||(req.user.role==='driver'&&it.order.status==='pickup_planned'&&it.order.pickup_driver_id===req.user.id&&it.order.pickup_state==='pending')||(req.user.role==='packer'&&it.order.status==='packing'&&it.order.packing_received_at)))throw new HttpError(403,'Фото загружаются при заборе или упаковке','FORBIDDEN');
  const path=`${it.order_id}/${it.id}/${b.upload_id||crypto.randomUUID()}.jpg`;
  const data=checked(await db.storage.from(bucket).createSignedUploadUrl(path));
  res.json({path,signedUrl:data.signedUrl,token:data.token});
 });
 router.post('/items/:itemId/photos',allow('photos'),async(req,res)=>{
  const b=z.object({path:z.string().min(1).max(300),kind:z.enum(['intake','ready']).default('intake')}).strict().parse(req.body),it=await ownedItem(req);
  if (!new RegExp(`^${it.order_id}/${it.id}/[a-f0-9-]{36}\\.jpg$`).test(b.path)) throw new HttpError(400,'Неверный путь файла');
  const exists=await db.storage.from(bucket).exists(b.path);
  if(!exists.data)throw new HttpError(409,'Фото ещё не загружено. Повторите отправку.','PHOTO_NOT_UPLOADED');
  const key=req.get('Idempotency-Key');
  if(key){z.string().uuid().parse(key);return res.status(201).json(checked(await db.rpc('crm_command',{p_command:'photo.register',p_data:{item_id:it.id,path:b.path,kind:b.kind},p_user:req.user.id,p_ip:req.ip,p_key:key})));}
  res.status(201).json(checked(await db.rpc('register_order_photo',{p_item:it.id,p_path:b.path,p_kind:b.kind,p_user:req.user.id,p_ip:req.ip})));
 });
 return router;
}
