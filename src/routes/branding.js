import {Router,raw} from 'express';
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {allow} from '../permissions.js';
import {checked,HttpError} from '../http.js';
import {BRAND_DEFAULTS,brandColorErrors} from '../../public/theme.js';
import {t} from '../../public/i18n.js';
const bucket='organization-branding',uuid=z.string().uuid();
const color=z.string().regex(/^#[0-9a-f]{6}$/i);
const schema=z.object({organization_name:z.string().trim().min(1).max(80).nullable(),subtitle:z.string().trim().max(120).nullable(),mode:z.enum(['light','dark']),accent_color:color,background_color:color,sidebar_color:color,logo_id:uuid.nullable(),background_id:uuid.nullable(),background_opacity:z.number().finite().min(0).max(0.2),expected_revision:z.number().int().min(0)}).strict();
export function brandingImageType(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<12)return null;
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'png'};
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {mime:'image/jpeg',ext:'jpg'};
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'webp'};
 return null;
}
export function createBrandingPublic(db){
 const r=Router();
 r.get('/',async(_req,res)=>res.json(checked(await db.rpc('crm_branding_public',{}))||{...BRAND_DEFAULTS,revision:0}));
 r.get('/assets/:id',async(req,res)=>{
  const id=uuid.parse(req.params.id),asset=checked(await db.rpc('crm_branding_asset',{p_id:id}));
  if(!asset)throw new HttpError(404,t('themeImageMissing'));
  const result=await db.storage.from(bucket).download(asset.path);if(result.error||!result.data)throw new HttpError(404,t('themeImageMissing'));
  const bytes=Buffer.from(await result.data.arrayBuffer()),type=brandingImageType(bytes);
  if(!type||type.mime!==asset.content_type||bytes.length>2097152)throw new HttpError(404,t('themeImageMissing'));
  res.set({'Cache-Control':'public, max-age=31536000, immutable','ETag':'"'+createHash('sha256').update(bytes).digest('hex')+'"','X-Content-Type-Options':'nosniff'}).type(type.mime).send(bytes);
 });
 return r;
}
export function createBrandingAdmin(db){
 const r=Router();
 r.post('/branding',allow('staff'),async(req,res)=>{
  const data=schema.parse(req.body);if(brandColorErrors(data).length)throw new HttpError(400,t('themeLowContrast'),'THEME_CONTRAST');
  res.json(checked(await db.rpc('crm_branding_save',{p_data:data,p_user:req.user.id,p_ip:req.ip})));
 });
 r.post('/branding/assets',allow('staff'),raw({type:['image/png','image/jpeg','image/webp'],limit:'2mb'}),async(req,res)=>{
  const kind=z.object({kind:z.enum(['logo','background'])}).strict().parse(req.query).kind,type=brandingImageType(req.body);
  if(!type||!req.is(type.mime))throw new HttpError(400,t('themeImageFormat'),'THEME_IMAGE');
  // Re-check the active profile in SQL before creating an object in Storage.
  checked(await db.rpc('crm_branding_require_admin',{p_user:req.user.id}));
  const id=randomUUID(),path=kind+'/'+id+'.'+type.ext;
  const upload=await db.storage.from(bucket).upload(path,req.body,{contentType:type.mime,upsert:false,cacheControl:'31536000'});
  if(upload.error)throw new HttpError(502,t('themeUploadFailed'),'THEME_UPLOAD');
  const asset=checked(await db.rpc('crm_branding_asset_register',{p_id:id,p_kind:kind,p_path:path,p_type:type.mime,p_size:req.body.length,p_user:req.user.id,p_ip:req.ip}));
  res.status(201).json({id:asset.id,url:'/api/branding/assets/'+asset.id});
 });
 return r;
}
