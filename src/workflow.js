import {z} from 'zod';
export const ROLES=['operator','driver','warehouse','washer','packer','admin'];
export const STATUSES=['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled'];
export const PRODUCTION={warehouse:'warehouse',washer:'washing',packer:'packing'};
export const boardFilter=z.object({from:z.string().date().optional(),to:z.string().date().optional(),product:z.enum(['carpet','blanket','tushak']).optional(),min_price:z.coerce.number().int().min(0).max(999999999999).optional(),max_price:z.coerce.number().int().min(0).max(999999999999).optional(),district_code:z.string().max(40).optional(),branch_id:z.string().uuid().optional(),driver_id:z.string().uuid().optional(),operator_id:z.string().uuid().optional(),q:z.string().trim().max(120).optional(),limit:z.coerce.number().int().min(1).max(100).optional(),offset:z.coerce.number().int().min(0).max(10000000).optional()}).strict();
export const driverFields={district_codes:z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(500).optional(),driver_color:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()};
export const requireDistricts=(data,ctx)=>{if(data.role==='driver'&&!data.district_codes?.length)ctx.addIssue({code:'custom',path:['district_codes'],message:'Назначьте водителю хотя бы один район'});};
