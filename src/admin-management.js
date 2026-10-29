import {z} from 'zod';
import {phone} from './validation.js';
const uuid=z.string().uuid(),code=z.string().regex(/^[a-z0-9_]{1,40}$/),name=z.string().trim().min(1).max(120);
const object=fields=>z.object(fields).strict();
const target=z.discriminatedUnion('entity',[
 ...['branch','staff','catalog','template'].map(entity=>object({entity:z.literal(entity),id:uuid})),
 object({entity:z.literal('reason'),code}),object({entity:z.literal('tariff'),code,branch_id:uuid}),
]);
export const ADMIN_COMMANDS={
 'admin.archive':{permission:'staff',schema:target},'admin.restore':{permission:'staff',schema:target},
 'admin.update':{permission:'staff',schema:z.discriminatedUnion('entity',[
  object({entity:z.literal('branch'),id:uuid,code,name,address:z.string().max(300).default(''),phone:z.union([phone,z.literal('')]).optional(),active:z.boolean(),workshop_capacity_m2:z.number().min(1).max(100000),sla_hours:z.number().int().min(1).max(720)}),
  object({entity:z.literal('catalog'),id:uuid,kind:z.enum(['source','zone','slot','defect','failure','tag']),code,branch_id:uuid,name_ru:name,name_uz:z.string().max(120).optional(),active:z.boolean(),position:z.number().int().min(0).max(999).optional(),config:object({start:z.string().regex(/^\d{2}:\d{2}$/).optional(),end:z.string().regex(/^\d{2}:\d{2}$/).optional(),capacity:z.number().int().min(1).max(5000).optional()}).optional()}),
  object({entity:z.literal('reason'),code,name_ru:name,name_uz:z.string().max(120).optional(),active:z.boolean(),position:z.number().int().min(0).max(999).optional()}),
  object({entity:z.literal('template'),id:uuid,code,branch_id:uuid,channel:z.enum(['sms','telegram']),locale:z.enum(['ru','uz']),body:z.string().trim().min(1).max(1500),active:z.boolean()}),
 ])},
};
