import {z} from 'zod';
import {COMMANDS} from './commands.js';
const uuid=z.string().uuid(),text=(n=500)=>z.string().trim().min(1).max(n),note=text(1000),money=z.number().int().min(0).max(999999999999),branch={branch_id:uuid.optional()},date=z.string().date(),time=z.string().datetime({offset:true}),code=z.string().regex(/^[a-z0-9_]{1,40}$/),object=f=>z.object(f).strict();
export const OP_COMMANDS={
 'call.link':{permission:'calls',schema:object({call_id:uuid,order_id:uuid})},
 'discount.rule':{permission:'discounts',schema:object({...branch,code:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),kind:z.enum(['promo','loyalty']),percent:z.number().positive().max(50),min_orders:z.number().int().min(0).max(10000).default(0),min_total:money.default(0),max_uses:z.number().int().positive().max(10000000).optional(),valid_from:time,valid_to:time,active:z.boolean().default(true)}).refine(v=>v.valid_to>v.valid_from)},
 'discount.apply':{permission:'create',schema:object({order_id:uuid,code:z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional()})},
 'payment.refund':{permission:'discounts',schema:object({order_id:uuid,amount:money.positive(),method:z.enum(['cash','terminal','bank']),note})},
 'payment.intent':{permission:'payments',schema:object({order_id:uuid,amount:money.positive(),provider:z.enum(['payme','click'])})},
 'cash.close':{permission:'payments',schema:object({...branch,driver_id:uuid,day:date,counted:money,note})},
 'client.preferences':{permission:'clients',schema:object({...branch,client_id:uuid,tags:z.array(text(40)).max(20).optional(),blacklisted:z.boolean().optional(),blacklist_reason:text(500).optional(),sms_consent:z.boolean().optional(),telegram_consent:z.boolean().optional(),telegram_chat_id:z.string().regex(/^-?\d{1,20}$/).optional()})},
 'intake.create':{permission:'photos',schema:object({order_id:uuid,note})},
 'complaint.create':{permission:'complaints',schema:object({order_id:uuid,reason:text(200),note:z.string().max(1000).optional(),photo_ids:z.array(uuid).max(30).optional(),responsible_id:uuid.optional(),due_at:time})},
 'complaint.resolve':{permission:'discounts',schema:object({complaint_id:uuid,resolution:z.enum(['rewash','discount','compensation','no_issue']),amount:money.default(0),note})},
 'compensation.paid':{permission:'discounts',schema:object({compensation_id:uuid})},
 'rewash.advance':{permission:'workshop',schema:object({job_id:uuid,expected_stage:z.enum(['received','washing','drying','quality_check','packing'])})},
 'material.save':{permission:'staff',schema:object({...branch,code,name:text(120),unit:text(30),norm_per_m2:z.number().min(0).max(100),active:z.boolean().default(true)})},
 'stock.adjust':{permission:'staff',schema:object({material_id:uuid,quantity:z.number().min(-100000000).max(100000000).refine(v=>v!==0),note})},
 'piece_rate.save':{permission:'staff',schema:object({...branch,role:z.enum(['driver','workshop']),event:z.enum(['pickup','delivery','washing','packing']),unit:z.enum(['order','m2']),rate:money,effective_at:time})},
 'slot_limit.save':{permission:'dispatch',schema:object({...branch,day:date,zone_code:code,slot_code:code,capacity:z.number().int().min(1).max(5000)})},
 'webhook.save':{permission:'integrations',schema:object({...branch,name:text(120),url:z.string().url().startsWith('https://').max(1000),secret_env:z.string().regex(/^WEBHOOK_SECRET_[A-Z0-9_]+$/),active:z.boolean().default(false)})},
 'outbox.retry':{permission:'integrations',schema:object({outbox_id:uuid})},
};
Object.assign(COMMANDS,OP_COMMANDS);
export const operationPermissions={cash:'payments',stock:'inventory',quality:'complaints',rewash:'workshop',loyalty:'discounts',payroll:'payroll',integrations:'integrations',planning:'read',documents:'read',alerts:'reports'};
export const operationFilters=object({...branch,date,from:date.optional(),to:date.optional(),zone_code:code.optional(),order_id:uuid.optional(),cursor:z.string().max(600).optional()}).partial({date:true});
