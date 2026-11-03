import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
import {BRAND_DEFAULTS,BRAND_PRESETS,brandPalette,brandColorErrors,brandContrast,brandPageColors} from '../public/theme.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFSkAAAAASUVORK5CYII=','base64');
const payload={...BRAND_DEFAULTS,organization_name:'Gilamjon',subtitle:'',expected_revision:0};
test('оформление: темы читаемы, первичные кнопки и фон имеют контраст; опасные цвета отвергаются',()=>{
 for(const preset of Object.values(BRAND_PRESETS)){const c={...BRAND_DEFAULTS,...preset},p=brandPalette(c);assert.deepEqual(brandColorErrors(c),[]);assert.ok(brandContrast(c.accent_color,p['--accent-ink'])>=4.5);assert.ok(brandContrast(c.sidebar_color,p['--sidebar-ink'])>=4.5);}
 for(const preset of Object.values(BRAND_PRESETS)){const c={...BRAND_DEFAULTS,...preset,background_id:'photo',background_opacity:0.2},p=brandPalette(c);assert.deepEqual(brandColorErrors(c),[]);for(const bg of brandPageColors(c))assert.ok(brandContrast(bg,p['--muted'])>=4.5);}
 assert.ok(brandColorErrors({...BRAND_DEFAULTS,accent_color:'#ffff00'}).includes('accent_color'));
 assert.ok(brandColorErrors({...BRAND_DEFAULTS,background_color:'#000000'}).includes('background_color'));
 assert.deepEqual(brandColorErrors({...BRAND_DEFAULTS,accent_color:'url(https://bad.test)'}),['colors']);
});
test('оформление SQL: только активный admin, RLS/GRANT, блокировка, повтор и аудит; изображения только своего назначения',async()=>{
 const db=await database({legacyGrants:false});try{
  for(const role of ['operator','driver','warehouse','washer','packer','inactive'])await assert.rejects(call(db,'crm_branding_save',[JSON.stringify(payload),ids[role],null]),e=>e.code==='42501');
  const first=await call(db,'crm_branding_save',[JSON.stringify(payload),ids.admin,null]);assert.equal(first.organization_name,'Gilamjon');assert.equal(first.revision,1);assert.equal(first.updated_by,undefined);
  assert.equal((await call(db,'crm_branding_save',[JSON.stringify(payload),ids.admin,null])).revision,1);
  await assert.rejects(call(db,'crm_branding_save',[JSON.stringify({...payload,organization_name:'Other'}),ids.admin,null]),e=>e.code==='55000');
  await assert.rejects(db.query("update organization_branding set organization_name='Bypass'"),e=>e.code==='42501');
  assert.equal((await db.query("select count(*) n from audit_log where entity='organization_branding'")).rows[0].n,1);
  for(const role of ['anon','authenticated']){for(const table of ['organization_branding','branding_assets'])assert.equal((await db.query("select has_table_privilege($1,$2,'select') ok",[role,table])).rows[0].ok,false);assert.equal((await db.query("select has_function_privilege($1,'public.crm_branding_public()','execute') ok",[role])).rows[0].ok,false);}
  const id=crypto.randomUUID();await call(db,'crm_branding_asset_register',[id,'background','background/'+id+'.png','image/png',png.length,ids.admin,null]);
  await assert.rejects(call(db,'crm_branding_save',[JSON.stringify({...payload,expected_revision:1,logo_id:id}),ids.admin,null]),e=>e.code==='23514');
  assert.equal((await call(db,'crm_branding_public',[])).logo_id,null);
  const logo=crypto.randomUUID();await call(db,'crm_branding_asset_register',[logo,'logo','logo/'+logo+'.png','image/png',png.length,ids.admin,null]);
  const branded={...payload,...BRAND_PRESETS.warm,subtitle:'Gilam yuvish',logo_id:logo,background_id:id,background_opacity:0.12,expected_revision:1};
  const saved=await call(db,'crm_branding_save',[JSON.stringify(branded),ids.admin,null]);
  assert.equal(saved.revision,2);assert.equal(saved.organization_name,'Gilamjon');assert.equal(saved.subtitle,'Gilam yuvish');assert.equal(saved.logo_id,logo);assert.equal(saved.background_id,id);
  assert.equal((await call(db,'crm_branding_save',[JSON.stringify(branded),ids.admin,null])).revision,2);
  await assert.rejects(call(db,'crm_branding_save',[JSON.stringify({...branded,expected_revision:2,logo_id:id,organization_name:'Rejected'}),ids.admin,null]),e=>e.code==='23514');
  assert.deepEqual(await call(db,'crm_branding_public',[]),saved);
  assert.equal((await db.query("select count(*) n from audit_log where entity='organization_branding'")).rows[0].n,2);
 }finally{await db.close();}
});
test('оформление HTTP: общая публичная тема, защищённая запись/загрузка, приватные файлы через ограниченный маршрут',async()=>{
 const f=await workflowServer();try{
  const req=(path,role,body,contentType='application/json')=>fetch(f.url+'/api'+path,{method:body!==undefined?'POST':'GET',headers:{...(role?{Authorization:'Bearer '+role}:{}),...(body!==undefined?{'Content-Type':contentType}:{})},...(body!==undefined?{body:contentType==='application/json'?JSON.stringify(body):body}:{})});
  assert.equal((await req('/branding')).status,200);assert.equal((await req('/branding',null,payload)).status,401);
  for(const role of ['operator','driver','warehouse','washer','packer','inactive'])assert.equal((await req('/branding',role,payload)).status,403);
  assert.equal((await req('/branding','admin',{...payload,logo_url:'https://bad.test'})).status,400);
  assert.equal((await req('/branding','admin',{...payload,accent_color:'#ffff00'})).status,400);
  assert.equal((await req('/branding/assets?kind=logo','operator',png,'image/png')).status,403);
  assert.equal((await req('/branding/assets?kind=logo','admin',Buffer.from('<svg onload="alert(1)"></svg>'),'image/png')).status,400);
  assert.equal(f.db.storageObjects.size,0);
  const uploaded=await req('/branding/assets?kind=logo','admin',png,'image/png');assert.equal(uploaded.status,201);const image=await uploaded.json();
  const backgroundUpload=await req('/branding/assets?kind=background','admin',png,'image/png');assert.equal(backgroundUpload.status,201);const background=await backgroundUpload.json();
  assert.equal((await req('/branding','admin',{...payload,...BRAND_PRESETS.warm,subtitle:'Gilam yuvish',logo_id:image.id,background_id:background.id})).status,200);
  const publicData=await (await req('/branding')).json();assert.equal(publicData.logo_id,image.id);assert.equal(publicData.background_id,background.id);assert.equal(publicData.organization_name,'Gilamjon');assert.equal(publicData.subtitle,'Gilam yuvish');assert.equal(publicData.updated_by,undefined);
  const actual=await req('/branding/assets/'+image.id);assert.equal(actual.status,200);assert.match(actual.headers.get('Content-Type'),/image\/png/);assert.match(actual.headers.get('Cache-Control'),/immutable/);assert.deepEqual(Buffer.from(await actual.arrayBuffer()),png);
  assert.equal((await req('/branding/assets/'+crypto.randomUUID())).status,404);assert.equal((await req('/orders')).status,401);assert.equal((await req('/orders/'+f.orderId+'/photos')).status,401);
  await f.sql.exec('reset role');assert.equal((await f.sql.query("select public from storage.buckets where id='carpet-photos'")).rows[0].public,false);
 }finally{await f.close();}
});
