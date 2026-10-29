import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,call,create,ids} from './helpers/database.js';
import {bootstrapAdmin} from '../src/bootstrap.js';
import {randomUUID} from 'node:crypto';
test('новый Supabase без default grants: сервер читает профиль/тарифы и создаёт заказ; клиентские роли закрыты',async()=>{
 const db=await database({legacyGrants:false});try{
  assert.equal((await call(db,'crm_ready',[])).ok,true);
  assert.equal((await call(db,'crm_ready',[])).schema,9);
  assert.equal((await db.query('select role from profiles where id=$1',[ids.admin])).rows[0].role,'admin');
  assert.equal((await db.query('select count(*) from tariffs')).rows[0].count,3);
  assert.equal((await db.query('select count(*) from settings')).rows[0].count,5);
  const id=await create(db);assert.ok(id);
  const bad=(await db.query("select table_name,grantee from information_schema.role_table_grants where table_schema='public' and table_name in ('profiles','tariffs','settings') and grantee in ('anon','authenticated','PUBLIC')")).rows;assert.deepEqual(bad,[]);
  await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/migrations/0008_service_privileges.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/0009_admin_bootstrap.sql',import.meta.url),'utf8'));await db.exec('set role service_role');assert.equal((await call(db,'crm_ready',[])).ok,true);
 }finally{await db.close();}
});

test('первый admin: app_metadata обязателен, повтор не повышает других пользователей',async()=>{
 const db=await database({legacyGrants:false});try{
  await db.exec('reset role');await db.exec("update profiles set active=false where role='admin'");const id=randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'owner@example.test')",[id]);await db.exec('set role service_role');
  assert.equal((await call(db,'crm_bootstrap_admin',['owner@example.test'])).initialized,false);
  await assert.rejects(call(db,'crm_bootstrap_admin',['owner@example.test',id]),e=>e.code==='42501');
  await db.exec('reset role');await db.query("update auth.users set raw_app_meta_data='{\"crm_bootstrap\":true}' where id=$1",[id]);await db.exec('set role service_role');
  assert.equal((await call(db,'crm_bootstrap_admin',['owner@example.test'])).pending_user_id,id);
  assert.equal((await call(db,'crm_bootstrap_admin',['owner@example.test',id])).initialized,true);
  const p=(await db.query('select role,active from profiles where id=$1',[id])).rows[0];assert.deepEqual(p,{role:'admin',active:true});
  await call(db,'crm_bootstrap_admin',['owner@example.test',ids.operator]);assert.equal((await db.query('select role from profiles where id=$1',[ids.operator])).rows[0].role,'operator');
  assert.equal((await db.query("select has_function_privilege('anon','public.crm_bootstrap_admin(text,uuid)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('server bootstrap: Admin Auth API вызывается только до первого admin, пароль не возвращается',async()=>{
 let created=0,initialized=false;const id=randomUUID(),db={rpc:async(_name,p)=>({data:p.p_user?(initialized=true,{initialized:true}):{initialized,pending_user_id:null},error:null}),auth:{admin:{createUser:async attrs=>{created++;assert.equal(attrs.email_confirm,true);assert.equal(attrs.app_metadata.crm_bootstrap,true);return {data:{user:{id}}};}}}};
 const config={bootstrapEmail:'owner@example.test',bootstrapPassword:'ExamplePassword16chars!'};
 assert.deepEqual(await bootstrapAdmin(db,config),{initialized:true});assert.deepEqual(await bootstrapAdmin(db,config),{initialized:true});assert.equal(created,1);
 assert.deepEqual(await bootstrapAdmin(db,{bootstrapEmail:'owner@example.test'}),{initialized:true});assert.deepEqual(await bootstrapAdmin(db,{}),{skipped:true});initialized=false;await assert.rejects(bootstrapAdmin(db,{bootstrapEmail:'owner@example.test',bootstrapPassword:'short'}),/BOOTSTRAP_CONFIGURATION_INVALID/);
});
