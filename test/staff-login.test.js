import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,command,call,ids} from './helpers/database.js';
import {workflowServer} from './helpers/workflow-server.js';
import {bootstrapAdmin} from '../src/bootstrap.js';
const bid='01000000-0000-4000-8000-000000000001',staff={user_id:ids.operator,full_name:'Оператор',role:'operator',active:true,branch_id:bid};

test('логины SQL: нормализация, уникальность, активность, admin-only, атомарность и повтор после переименования',async()=>{
 const db=await database({legacyGrants:false});try{
  const key=crypto.randomUUID(),body={...staff,login:'  Operator.1  '};
  assert.equal((await command(db,'staff.update',body,'admin',key)).login,'operator.1');assert.equal(await call(db,'crm_login_identity',[' OPERATOR.1 ']),ids.operator);
  for(const role of ['operator','driver','warehouse','washer','packer','inactive'])await assert.rejects(call(db,'crm_staff_login_set',[ids.operator,'hacked',ids[role],null]),e=>e.code==='42501');
  await assert.rejects(db.query("update profiles set login='hacked' where id=$1",[ids.operator]),e=>e.code==='42501');
  for(const role of ['anon','authenticated'])for(const f of ['crm_login_identity(text)','crm_staff_login_set(uuid,text,uuid,inet)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,'public.'+f])).rows[0].ok,false);
  await command(db,'staff.update',{...staff,login:'renamed'});assert.equal(await call(db,'crm_login_identity',['operator.1']),null);
  assert.equal((await command(db,'staff.update',body,'admin',key)).login,'operator.1');assert.equal(await call(db,'crm_login_identity',['renamed']),ids.operator);
  await assert.rejects(command(db,'staff.update',{...body,login:'different'},'admin',key),e=>e.code==='55000');
  await assert.rejects(command(db,'staff.update',{user_id:ids.inactive,full_name:'Should rollback',role:'operator',active:false,branch_id:bid,login:'RENAMED'}),e=>e.code==='23505');
  assert.notEqual((await db.query('select full_name from profiles where id=$1',[ids.inactive])).rows[0].full_name,'Should rollback');
  await assert.rejects(command(db,'staff.update',{user_id:ids.admin,full_name:'Владелец',role:'admin',active:false,branch_id:null,login:'last_admin'}),e=>e.code==='55000');
  assert.equal((await db.query('select login from profiles where id=$1',[ids.admin])).rows[0].login,null);
  await command(db,'staff.update',{...staff,active:false,login:'renamed'});assert.equal(await call(db,'crm_login_identity',['renamed']),null);
  await command(db,'staff.update',{...staff,login:null});assert.equal((await db.query('select login from profiles where id=$1',[ids.operator])).rows[0].login,null);
  assert.ok((await db.query("select count(*) n from audit_log where entity='profiles' and \"after\"->>'login'='renamed' and user_id=$1",[ids.admin])).rows[0].n>0);
 }finally{await db.close();}
});

test('вход HTTP: логин без регистра и почта, одинаковая ошибка неизвестного/неактивного логина и неверного пароля',async()=>{
 const f=await workflowServer();try{
  await command(f.sql,'staff.update',{...staff,login:'operator1'});
  await command(f.sql,'staff.update',{...staff,user_id:ids.inactive,active:false,login:'inactive1'});
  f.authClient.auth.signInWithPassword=async({email,password})=>email==='operator@example.test'&&password==='abc123'?{data:{session:{access_token:'operator',expires_at:9999999999}},error:null}:{data:{session:null},error:{message:'invalid'}};
  const login=body=>fetch(f.url+'/api/public/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  for(const body of [{identifier:' OPERATOR1 ',password:'abc123'},{identifier:'operator@example.test',password:'abc123'},{email:'operator@example.test',password:'abc123'}]){const r=await login(body);assert.equal(r.status,200);assert.deepEqual(await r.json(),{access_token:'operator',expires_at:9999999999});}
  let previous;for(const identifier of ['unknown1','inactive1','operator1']){const r=await login({identifier,password:'wrong1'});assert.equal(r.status,401);const data=await r.json();assert.equal(data.code,'LOGIN_FAILED');if(previous)assert.deepEqual(data,previous);previous=data;}
  assert.equal((await login({identifier:'operator1',password:'12345'})).status,400);
  assert.equal((await login({identifier:'operator1',email:'operator@example.test',password:'abc123'})).status,400);
  assert.equal((await fetch(f.url+'/api/role',{method:'POST'})).status,401);
 }finally{await f.close();}
});

test('сотрудник HTTP: 6 символов, создание без почты, пароль не идёт в SQL/ответ; дубли и 5 символов отклоняются',async()=>{
 const f=await workflowServer();try{
  let calls=0,lastAuth;f.db.auth.admin.createUser=async attrs=>{calls++;lastAuth=attrs;const id=crypto.randomUUID();await f.sql.exec('reset role');try{await f.sql.query('insert into auth.users(id,email) values($1,$2)',[id,attrs.email]);}finally{await f.sql.exec('set role service_role');}return {data:{user:{id}},error:null};};
  const post=(body,role='admin')=>fetch(f.url+'/api/staff/create',{method:'POST',headers:{Authorization:'Bearer '+role,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(body)}),body={login:'worker1',password:'abc123',full_name:'Сотрудник',role:'operator',active:true,branch_id:bid};
  assert.equal((await post({...body,password:'12345'})).status,400);assert.equal(calls,0);assert.equal((await post(body,'operator')).status,403);
  const response=await post(body);assert.equal(response.status,201);const saved=await response.json();assert.equal(saved.login,'worker1');assert.equal(saved.active,true);assert.equal(lastAuth.password,'abc123');assert.match(lastAuth.email,/@staff\.invalid$/);assert.equal(lastAuth.email_confirm,true);assert.ok(!JSON.stringify(saved).includes('abc123'));assert.ok(!JSON.stringify(saved).includes('@staff.invalid'));
  assert.equal((await post({...body,login:'WORKER1'})).status,409);assert.equal(calls,1);
  const receipt=(await f.sql.query('select payload from command_receipts where result->>\'id\'=$1',[saved.id])).rows;assert.ok(receipt.length);assert.ok(!JSON.stringify(receipt).includes('abc123'));
  const emailOnly=await post({...body,login:undefined,email:'staff@example.test'});assert.equal(emailOnly.status,201);
 }finally{await f.close();}
});

test('первый администратор: пароль из 6 символов принимается через Auth API',async()=>{
 let created=false;const db={rpc:async(_n,p)=>({data:p.p_user?{initialized:true}:{initialized:false},error:null}),auth:{admin:{createUser:async p=>{assert.equal(p.password,'abc123');created=true;return {data:{user:{id:crypto.randomUUID()}}};}}}};
 await bootstrapAdmin(db,{bootstrapEmail:'admin@example.test',bootstrapPassword:'abc123'});assert.equal(created,true);
});
