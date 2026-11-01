import {z} from 'zod';
import {phone} from './validation.js';
const text=(max)=>z.string().trim().min(1).max(max),optional=(max)=>z.string().trim().max(max).optional();
const dimension=z.number().min(.3).max(20).multipleOf(.01,'Укажите не более двух знаков после запятой');
export const productItem=z.object({tariff:z.enum(['carpet','blanket','tushak']),quantity:z.number().int().min(1).max(30).default(1),note:optional(300)}).strict();
export const bookingFields={
 name:text(120),phone,address:optional(1000),pickup_date:z.string().date().optional(),pickup_slot:z.string().max(40).default(''),
 source:z.string().regex(/^[a-z0-9_]{1,40}$/).default('call_in'),comment:optional(500),branch_id:z.string().uuid().optional(),zone_code:optional(40),
 region_code:text(40),district_code:text(40),street:text(150),house:text(30),apartment:optional(30),landmark:optional(250),private_house:z.boolean().default(false),promised_at:z.string().datetime({offset:true}).optional(),
 urgent:z.boolean().default(false),stains:z.boolean().default(false),pensioner:z.boolean().default(false),items:z.array(productItem).min(1).max(30),
};
export const bookingInput=z.object(bookingFields).strict().superRefine((data,ctx)=>{
 if(data.region_code){
  for(const key of ['street','house'])if(!data[key])ctx.addIssue({code:'custom',path:[key],message:'Заполните поле адреса'});
  if(!data.district_code)ctx.addIssue({code:'custom',path:['district_code'],message:'Выберите район или город'});
  if(!data.private_house&&!data.apartment)ctx.addIssue({code:'custom',path:['apartment'],message:'Укажите квартиру или выберите «Частный дом»'});
 }else if(!data.address||data.address.length<3)ctx.addIssue({code:'custom',path:['region_code'],message:'Выберите область и заполните адрес'});
 if(data.items.reduce((n,i)=>n+i.quantity,0)>30)ctx.addIssue({code:'custom',path:['items'],message:'В одном заказе допускается до 30 изделий'});
});
export const quoteInput=z.object(bookingFields).partial({phone:true,address:true,pickup_date:true}).strict();
export const measurementInput=z.object({item_id:z.string().uuid(),length_m:dimension.optional(),width_m:dimension.optional(),quantity:z.number().int().min(1).max(1000).default(1),reason:optional(500)}).strict()
 .refine(i=>(i.length_m==null)===(i.width_m==null),{message:'Укажите длину и ширину вместе',path:['width_m']});
