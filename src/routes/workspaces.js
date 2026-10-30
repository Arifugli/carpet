import {Router} from 'express';
import {z} from 'zod';
import {COMMANDS,commandNames} from '../commands.js';
import {allow,can,canReadOrder} from '../permissions.js';
import {checked,HttpError} from '../http.js';
import {webhookURL} from '../integration-security.js';

const filters=z.object({branch_id:z.string().uuid().optional(),date:z.string().date().optional(),limit:z.coerce.number().int().min(1).max(100).optional(),cursor:z.string().max(600).optional(),phone:z.string().max(32).optional(),client_id:z.string().uuid().optional(),order_id:z.string().uuid().optional(),driver_id:z.string().uuid().optional(),stage:z.enum(['awaiting_acceptance','received','washing','drying','quality_check','packing','ready']).optional(),status:z.enum(['open','done']).optional(),label:z.string().regex(/^K-[1-9]\d{0,14}(?:-[1-9]\d{0,2})?$/i).optional()}).strict();
const viewPermissions={bootstrap:'read',client:'clients',leads:'leads',calls:'calls',tasks:'tasks',dispatch:'dispatch',driver:'read',workshop:'workshop',scan:'read',payments:'read',admin:'staff'};
export function createWorkspaces(db,config={}){
 const router=Router();
 router.get('/workspaces/:view',async(req,res)=>{
  const view=z.enum(Object.keys(viewPermissions)).parse(req.params.view);
  if(!can(req.user,viewPermissions[view]))throw new HttpError(403,'Недостаточно прав','FORBIDDEN');
  const f=filters.parse(req.query);
  if(f.cursor){
   let c;try{c=z.object({at:z.string().datetime({offset:true}),id:z.string().uuid(),priority:z.boolean().nullable().optional()}).parse(JSON.parse(Buffer.from(f.cursor,'base64url').toString()));}
   catch{throw new HttpError(400,'Неверный курсор страницы','INVALID_CURSOR');}
   Object.assign(f,{cursor_at:c.at,cursor_id:c.id,cursor_priority:c.priority});delete f.cursor;
  }
  const result=checked(await db.rpc('crm_workspace',{p_view:view,p_filters:f,p_user:req.user.id}));
  if(result?.next_cursor)result.next_cursor=Buffer.from(JSON.stringify(result.next_cursor)).toString('base64url');
  res.json(result);
 });
 router.post('/actions/:command',async(req,res)=>{
  const name=z.enum(commandNames()).parse(req.params.command),definition=COMMANDS[name];
  if(!can(req.user,definition.permission))throw new HttpError(403,'Недостаточно прав','FORBIDDEN');
  const data=definition.schema.parse(req.body),key=z.string().uuid().parse(req.get('Idempotency-Key'));
  if(name==='photo.register'){
   const item=checked(await db.from('order_items').select('id,order_id,order:orders(id,status,driver_id,deleted_at,branch_id,pickup_state)').eq('id',data.item_id).maybeSingle());
   if(!item?.order||!canReadOrder(req.user,item.order))throw new HttpError(403,'Нет доступа к этому изделию','FORBIDDEN');
   if(!new RegExp(`^${item.order_id}/${item.id}/[a-f0-9-]{36}\\.jpg$`).test(data.path))throw new HttpError(400,'Неверный путь файла');
   const exists=await db.storage.from(config.bucket||'carpet-photos').exists(data.path);if(!exists.data)throw new HttpError(409,'Фото ещё не загружено. Повторите отправку.','PHOTO_NOT_UPLOADED');
  }
  if(name==='webhook.save')webhookURL(data.url,config.webhookHosts);
  res.json(checked(await db.rpc(name.startsWith('admin.')?'crm_admin_command':'crm_command',{p_command:name,p_data:data,p_user:req.user.id,p_ip:req.ip,p_key:key})));
 });
 router.post('/staff/create',allow('staff'),async(req,res)=>{
  const b=z.object({email:z.string().email().max(254),password:z.string().min(12).max(128),full_name:z.string().trim().min(1).max(120),role:z.enum(['admin','manager','operator','dispatcher','driver','workshop']),branch_id:z.string().uuid().nullable(),active:z.boolean().default(false)}).strict().parse(req.body);
  const key=z.string().uuid().parse(req.get('Idempotency-Key'));
  const {data,error}=await db.auth.admin.createUser({email:b.email,password:b.password,email_confirm:true,user_metadata:{full_name:b.full_name}});
  if(error)throw new HttpError(400,'Не удалось создать учётную запись. Проверьте почту и требования к паролю','AUTH_CREATE_FAILED');
  const result=await db.rpc('crm_command',{p_command:'staff.update',p_data:{user_id:data.user.id,full_name:b.full_name,role:b.role,branch_id:b.branch_id,active:b.active},p_user:req.user.id,p_ip:req.ip,p_key:key});
  if(result.error)return res.status(409).json({error:'Учётная запись создана неактивной. Откройте сотрудников и настройте её профиль.',code:'PROFILE_SETUP_REQUIRED',user_id:data.user.id});
  res.status(201).json(result.data);
 });
 router.post('/staff/:id/access-link',allow('staff'),async(req,res)=>{
  const id=z.string().uuid().parse(req.params.id);z.object({}).strict().parse(req.body??{});
  const found=await db.auth.admin.getUserById(id);
  if(found.error||!found.data.user)throw new HttpError(404,'Сотрудник не найден');
  const result=await db.auth.admin.generateLink({type:'recovery',email:found.data.user.email});
  if(result.error)throw new HttpError(400,'Не удалось сформировать ссылку восстановления');
  checked(await db.rpc('crm_staff_access_audit',{p_target:id,p_user:req.user.id,p_ip:req.ip}));
  res.json({action_link:result.data.properties.action_link});
 });
 return router;
}
