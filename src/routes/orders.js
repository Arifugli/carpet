import { Router } from 'express';
import { z } from 'zod';
import { allow,canReadOrder,maskPhone,WORKSHOP_STATUSES } from '../permissions.js';
import { checked,HttpError,orderRef,byRef,withCode,parseCursor,applyCursor,page } from '../http.js';

const STATUSES=['new','pickup_assigned','received','washing','drying','ready','delivering','delivered','cancelled'];
const money=z.number().int().min(0).max(999999999999);
const reason=z.string().trim().min(1,'Укажите причину').max(500);
const item=z.object({length_m:z.number().min(0.3).max(20),width_m:z.number().min(0.3).max(20),tariff:z.string().min(1).max(20),note:z.string().max(300).optional()}).strict();
const orderInput=z.object({
 name:z.string().max(120).default(''),phone:z.string().max(32).transform(v=>v.replace(/[\s()-]/g,''))
  .refine(v=>/^\+998\d{9}$/.test(v),'Телефон должен быть в формате +998XXXXXXXXX'),
 address:z.string().trim().min(3).max(300),pickup_date:z.string().date(),pickup_slot:z.string().max(40).default(''),
 source:z.string().regex(/^[a-z0-9_]{1,40}$/).default('call_in'),comment:z.string().max(500).optional(),
 branch_id:z.string().uuid().optional(),zone_code:z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),promised_at:z.string().datetime({offset:true}).optional(),
 urgent:z.boolean().default(false),stains:z.boolean().default(false),pensioner:z.boolean().default(false),items:z.array(item).min(1).max(30),
}).strict();
const LIST='id,number,status,branch_id,production_stage,pickup_date,pickup_slot,address,total,urgent,driver_id,created_at,delete_requested_at,delete_requested_by,delete_request_reason,cancel_reason_code,paid_amount,washing_started_at,client:clients(name,phone),items:order_items(id)';
const DETAIL='*,client:clients(*),driver:profiles!driver_id(id,full_name),items:order_items(*,photos:order_photos(*)),history:status_history(status,note,created_at,changed_by)';
const filters=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().max(500).optional()});
const trashFilters=filters.extend({deleted_by:z.string().uuid().optional(),from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),reason:z.string().trim().max(500).optional()}).strict()
 .refine(v=>!v.from||!v.to||Date.parse(v.from)<=Date.parse(v.to),'Начало периода должно быть раньше окончания');
const redact=(o,user)=>{
 if (user.role==='workshop') {
  o={...o,client:o.client?{name:o.client.name,phone:maskPhone(o.client.phone)}:null};
  delete o.track_token; delete o.delete_snapshot;
 }
 return withCode(o);
};

export function createOrders(db,{bucket='carpet-photos'}={}) {
 const router=Router();
 router.use(allow('read'));
 const resolve=async(req,{trash=false}={})=>{
  const ref=orderRef.parse(req.params.id);
  let q=byRef(db.from('orders').select('id,status,driver_id,deleted_at,branch_id'),ref);
  q=trash?q.not('deleted_at','is',null):q.is('deleted_at',null);
  const o=checked(await q.maybeSingle());
  if (!o) throw new HttpError(404,'Заказ не найден','ORDER_NOT_FOUND');
  if (!trash&&!canReadOrder(req.user,o)) throw new HttpError(403,'Недостаточно прав для этого заказа','FORBIDDEN');
  return o;
 };
 const rpc=async(req,name,params)=>withCode(checked(await db.rpc(name,{p_user:req.user.id,p_ip:req.ip,...params})));

 router.post('/quote',allow('quote'),async(req,res)=>{
  const body=orderInput.partial({phone:true,address:true,pickup_date:true}).parse(req.body);
  res.json(checked(await db.rpc('crm_quote',{p:body,p_user:req.user.id,p_ip:req.ip})));
 });
 router.get('/cancel-reasons',async(req,res)=>{
  z.object({}).strict().parse(req.query);
  res.json(checked(await db.from('cancel_reasons').select('code,name_ru,name_uz').eq('active',true).order('position')));
 });
 router.get('/orders',async(req,res)=>{
  const b=filters.extend({status:z.enum(STATUSES).optional(),q:z.string().trim().max(120).optional(),date:z.string().date().optional(),branch_id:z.string().uuid().optional(),deletion_requested:z.enum(['true']).optional()}).strict().parse(req.query);
  if (b.deletion_requested&&!['admin','manager'].includes(req.user.role)) throw new HttpError(403,'Недостаточно прав','FORBIDDEN');
  let q=db.from('orders').select(LIST).is('deleted_at',null).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(b.limit+1);
  if(!['admin','manager'].includes(req.user.role))q=q.eq('branch_id',req.user.branch_id);
  else if(b.branch_id)q=q.eq('branch_id',b.branch_id);
  if (b.status) q=q.eq('status',b.status);
  if (b.date) q=q.eq('pickup_date',b.date);
  if (b.deletion_requested) q=q.not('delete_requested_at','is',null);
  if (req.user.role==='driver') q=q.eq('driver_id',req.user.id);
  if (req.user.role==='workshop') q=q.in('status',WORKSHOP_STATUSES);
  if (b.q) {
   const n=b.q.replace(/^k-/i,'');
   if (/^\d{1,15}$/.test(n)) q=q.eq('number',n);
   else {
    const s=b.q.replace(/[^\p{L}\p{N}\s+@.-]/gu,' ').trim();
    const clients=checked(await db.from('clients').select('id').or(`name.ilike.%${s}%,phone.ilike.%${s}%`).limit(100));
    if (!clients.length) return res.json({data:[],next_cursor:null});
    q=q.in('client_id',clients.map(c=>c.id));
   }
  }
  const p=page(checked(await applyCursor(q,parseCursor(b.cursor),'created_at')),b.limit,'created_at');
  res.json({...p,data:p.data.map(o=>redact(o,req.user))});
 });
 router.post('/orders',allow('create'),async(req,res)=>{
  const body=orderInput.parse(req.body);
  const key=z.string().uuid('Требуется UUID в заголовке Idempotency-Key').parse(req.get('Idempotency-Key'));
  const id=checked(await db.rpc('create_order_audited',{p:body,p_user:req.user.id,p_ip:req.ip,p_key:key}));
  const o=checked(await db.from('orders').select(DETAIL).eq('id',id).is('deleted_at',null).maybeSingle());
  if(!o) throw new HttpError(404,'Заказ не найден','ORDER_NOT_FOUND');
  res.status(201).json(withCode(o));
 });
 router.get('/trash',allow('trash'),async(req,res)=>{
  const b=trashFilters.parse(req.query);
  let q=db.from('orders').select('id,number,total,deleted_at,deleted_by,delete_reason,deleted_status,delete_snapshot,restored_at,restored_by')
   .not('deleted_at','is',null).order('deleted_at',{ascending:false}).order('id',{ascending:false}).limit(b.limit+1);
  if (b.deleted_by) q=q.eq('deleted_by',b.deleted_by);
  if (b.from) q=q.gte('deleted_at',b.from);
  if (b.to) q=q.lte('deleted_at',b.to);
  if (b.reason) q=q.ilike('delete_reason',`%${b.reason.replace(/[%_\\]/g,'\\$&')}%`);
  const p=page(checked(await applyCursor(q,parseCursor(b.cursor),'deleted_at')),b.limit,'deleted_at');
  res.json({...p,data:p.data.map(withCode)});
 });
 router.get('/trash/:id',allow('trash'),async(req,res)=>{
  const o=await resolve(req,{trash:true});
  const detail=checked(await db.from('orders').select(DETAIL).eq('id',o.id).not('deleted_at','is',null).maybeSingle());
  if(!detail) throw new HttpError(404,'Заказ не найден','ORDER_NOT_FOUND');
  res.json(withCode(detail));
 });
 router.get('/audit-log',allow('audit'),async(req,res)=>{
  const b=filters.extend({entity_id:z.string().uuid().optional(),action:z.enum(['created','cancelled','deletion_requested','deleted','restored','status_changed','driver_assigned','updated']).optional()}).strict().parse(req.query);
  let q=db.from('audit_log').select('*').order('at',{ascending:false}).order('id',{ascending:false}).limit(b.limit+1);
  if (b.cursor) {
   let c; try { c=z.object({at:z.string().datetime({offset:true}),id:z.string().regex(/^\d+$/)}).parse(JSON.parse(Buffer.from(b.cursor,'base64url').toString())); }
   catch { throw new HttpError(400,'Неверный курсор страницы','INVALID_CURSOR'); }
   q=q.or(`at.lt.${c.at},and(at.eq.${c.at},id.lt.${c.id})`);
  }
  if (b.entity_id) q=q.eq('entity_id',b.entity_id);
  if (b.action) q=q.eq('action',b.action);
  res.json(page(checked(await q).map(x=>({...x,id:String(x.id)})),b.limit,'at'));
 });
 router.get('/orders/:id',async(req,res)=>{
  const o=checked(await byRef(db.from('orders').select(DETAIL).is('deleted_at',null),orderRef.parse(req.params.id)).maybeSingle());
  if (!o) throw new HttpError(404,'Заказ не найден','ORDER_NOT_FOUND');
  if (!canReadOrder(req.user,o)) throw new HttpError(403,'Недостаточно прав для этого заказа','FORBIDDEN');
  const paths=o.items.flatMap(i=>i.photos.map(p=>p.storage_path));
  if (paths.length) {
   const urls=checked(await db.storage.from(bucket).createSignedUrls(paths,3600));
   const map=Object.fromEntries(urls.map(u=>[u.path,u.signedUrl]));
   o.items.forEach(i=>i.photos.forEach(p=>p.url=map[p.storage_path]||null));
  }
  o.history.sort((a,b)=>a.created_at.localeCompare(b.created_at));
  res.json(redact(o,req.user));
 });
 router.post('/orders/:id/cancel',allow('cancel'),async(req,res)=>{
  const b=z.object({reason_code:z.string().min(1).max(40),comment:z.string().trim().min(1).max(1000),completed_work_amount:money.optional(),payment_amount:money.optional()}).strict().parse(req.body);
  const o=await resolve(req);
  res.json(await rpc(req,'cancel_order',{p_order:o.id,p_reason:b.reason_code,p_comment:b.comment,p_work_amount:b.completed_work_amount??null,p_payment_amount:b.payment_amount??null}));
 });
 router.post('/orders/:id/deletion-request',allow('requestDeletion'),async(req,res)=>{
  const b=z.object({reason}).strict().parse(req.body),o=await resolve(req);
  res.status(201).json(await rpc(req,'request_order_deletion',{p_order:o.id,p_reason:b.reason}));
 });
 // DELETE означает только мягкое удаление.
 router.delete('/orders/:id',allow('delete'),async(req,res)=>{
  const b=z.object({reason}).strict().parse(req.body),o=await resolve(req);
  res.json(await rpc(req,'soft_delete_order',{p_order:o.id,p_reason:b.reason}));
 });
 router.post('/orders/:id/restore',allow('restore'),async(req,res)=>{
  z.object({}).strict().parse(req.body??{}); const o=await resolve(req,{trash:true});
  res.json(await rpc(req,'restore_order',{p_order:o.id}));
 });
 router.patch('/orders/:id/driver',allow('assign'),async(req,res)=>{
  const b=z.object({driver_id:z.string().uuid().nullable()}).strict().parse(req.body),o=await resolve(req);
  res.json(await rpc(req,'assign_order_driver',{p_order:o.id,p_driver:b.driver_id}));
 });
 router.post('/orders/:id/status',allow('status'),async(req,res)=>{
  const b=z.object({status:z.enum(STATUSES.filter(s=>s!=='cancelled')),note:z.string().max(300).optional()}).strict().parse(req.body),o=await resolve(req);
  const status=checked(await db.rpc('change_order_status_audited',{p_order:o.id,p_status:b.status,p_note:b.note??null,p_user:req.user.id,p_ip:req.ip}));
  res.json({ok:true,status});
 });
 return router;
}
