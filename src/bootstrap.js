import {z} from 'zod';
import {checked} from './http.js';
export async function bootstrapAdmin(db,{bootstrapEmail,bootstrapPassword}={}){
 if(!bootstrapEmail&&!bootstrapPassword)return {skipped:true};
 const parsed=z.string().email().max(254).safeParse(bootstrapEmail);
 if(!parsed.success)throw Error('BOOTSTRAP_CONFIGURATION_INVALID');
 const email=parsed.data,status=checked(await db.rpc('crm_bootstrap_admin',{p_email:email}));
 if(status.initialized)return {initialized:true};
 const password=z.string().min(16).max(128).safeParse(bootstrapPassword);if(!password.success)throw Error('BOOTSTRAP_CONFIGURATION_INVALID');
 let id=status.pending_user_id;
 if(!id){
  const {data,error}=await db.auth.admin.createUser({email,password:password.data,email_confirm:true,app_metadata:{crm_bootstrap:true},user_metadata:{full_name:'Администратор'}});
  if(error||!data?.user?.id)throw Error('BOOTSTRAP_AUTH_CREATE_FAILED');
  id=data.user.id;
 }
 return checked(await db.rpc('crm_bootstrap_admin',{p_email:email,p_user:id}));
}
