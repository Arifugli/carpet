import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {bootstrapAdmin} from '../src/bootstrap.js';
test('server bootstrap: Admin Auth API вызывается только до первого admin, пароль не возвращается',async()=>{
 let created=0,initialized=false;const id=randomUUID(),db={rpc:async(_name,p)=>({data:p.p_user?(initialized=true,{initialized:true}):{initialized,pending_user_id:null},error:null}),auth:{admin:{createUser:async attrs=>{created++;assert.equal(attrs.email_confirm,true);assert.equal(attrs.app_metadata.crm_bootstrap,true);return {data:{user:{id}}};}}}};
 const config={bootstrapEmail:'owner@example.test',bootstrapPassword:'ExamplePassword16chars!'};
 assert.deepEqual(await bootstrapAdmin(db,config),{initialized:true});assert.deepEqual(await bootstrapAdmin(db,config),{initialized:true});assert.equal(created,1);
 assert.deepEqual(await bootstrapAdmin(db,{bootstrapEmail:'owner@example.test'}),{initialized:true});assert.deepEqual(await bootstrapAdmin(db,{}),{skipped:true});initialized=false;await assert.rejects(bootstrapAdmin(db,{bootstrapEmail:'owner@example.test',bootstrapPassword:'short'}),/BOOTSTRAP_CONFIGURATION_INVALID/);
});
