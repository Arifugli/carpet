import {z} from 'zod';
import {ADMIN_COMMANDS} from './admin-management.js';
const uuid=z.string().uuid(),text=(max=500)=>z.string().trim().min(1).max(max),note=z.string().trim().max(1000).optional();
const phone=z.string().regex(/^\+998\d{9}$/,'Телефон должен быть в формате +998XXXXXXXXX');
const branch={branch_id:uuid.optional()},geo={latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional()};
const datetime=z.string().datetime({offset:true}),code=z.string().regex(/^[a-z0-9_]{1,40}$/);
const object=fields=>z.object(fields).strict();
export const COMMANDS={
 ...ADMIN_COMMANDS,
 'photo.register':{permission:'photos',schema:object({item_id:uuid,path:text(300),kind:z.enum(['intake','ready'])})},
 'lead.save':{permission:'leads',schema:object({...branch,phone,name:z.string().max(120).optional(),source:code.optional(),outcome:z.enum(['new','callback','no_result','refused']),reason_code:code.optional(),comment:note,callback_at:datetime.optional()})},
 'lead.convert':{permission:'leads',schema:object({lead_id:uuid,order_id:uuid})},
 'client.address':{permission:'clients',schema:object({...branch,client_id:uuid,label:z.string().max(80).optional(),address:text(300),zone_code:code.optional(),...geo})},
 'call.log':{permission:'calls',schema:object({...branch,phone,direction:z.enum(['in','out']),outcome:z.enum(['ringing','answered','missed','no_result']),source:code.optional(),recording_url:z.string().url().startsWith('https://').max(1000).optional(),order_id:uuid.optional()})},
 'task.save':{permission:'tasks',schema:object({...branch,title:text(200),due_at:datetime,assigned_to:uuid.optional(),order_id:uuid.optional(),client_id:uuid.optional(),note})},
 'task.complete':{permission:'tasks',schema:object({task_id:uuid})},
 'visit.schedule':{permission:'dispatch',schema:object({order_id:uuid,kind:z.enum(['pickup','delivery']),scheduled_date:z.string().date(),slot_code:code,zone_code:code.optional(),driver_id:uuid.optional(),position:z.number().int().min(0).max(999).optional(),note})},
 'visit.event':{permission:'status',schema:object({visit_id:uuid,event:z.enum(['departed','completed','failed']),expected_state:z.enum(['planned','en_route']),failure_reason:code.optional(),note,...geo})},
 'visit.arrived':{permission:'status',schema:object({visit_id:uuid})},
 'workshop.advance':{permission:'workshop',schema:object({order_id:uuid,expected_stage:z.enum(['received','washing','drying','quality_check','packing']),note})},
 'workshop.defect':{permission:'workshop',schema:object({order_id:uuid,item_id:uuid.optional(),defect_code:code,note:text(1000),photo_id:uuid.optional()})},
 'payment.record':{permission:'payments',schema:object({order_id:uuid,amount:z.number().int().min(1).max(999999999999),method:z.enum(['cash','terminal','bank']),note})},
 'payment.confirm':{permission:'payments',schema:object({payment_id:uuid,confirm:z.boolean()})},
 'tariff.schedule':{permission:'tariffs',schema:object({...branch,code:code,name:text(60),price_per_m2:z.number().int().min(0).max(999999999999),active:z.boolean().optional(),effective_at:datetime})},
 'setting.schedule':{permission:'tariffs',schema:object({...branch,key:z.enum(['urgent_pct','stains_pct','pensioner_pct','delivery_fee','free_delivery_from']),value:z.number().finite(),effective_at:datetime})},
 'catalog.save':{permission:'catalogs',schema:object({...branch,kind:z.enum(['source','zone','slot','defect','failure','tag','cancel_reason']),code,name_ru:text(120),name_uz:z.string().max(120).optional(),active:z.boolean().optional(),position:z.number().int().min(0).max(999).optional(),config:object({start:z.string().regex(/^\d{2}:\d{2}$/).optional(),end:z.string().regex(/^\d{2}:\d{2}$/).optional(),capacity:z.number().int().min(1).max(5000).optional()}).optional()})},
 'template.save':{permission:'catalogs',schema:object({...branch,code,channel:z.enum(['sms','telegram']),locale:z.enum(['ru','uz']).optional(),body:text(1500),active:z.boolean().optional()})},
 'branch.save':{permission:'branches',schema:object({code,name:text(120),address:z.string().max(300).optional(),phone:phone.optional(),active:z.boolean().optional(),workshop_capacity_m2:z.number().min(1).max(100000).optional(),sla_hours:z.number().int().min(1).max(720).optional()})},
 'staff.update':{permission:'staff',schema:object({user_id:uuid,role:z.enum(['admin','manager','operator','dispatcher','driver','workshop']),full_name:text(120),active:z.boolean(),branch_id:uuid.nullable().optional(),phone:phone.optional()})},
};
export const commandNames=()=>Object.keys(COMMANDS);
