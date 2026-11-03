import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowServer} from './helpers/workflow-server.js';
import {advance,call,command,create,ids,input} from './helpers/database.js';

test('обращения и претензии: оператор принимает, оператор и admin видят; повтор, филиал и решение защищены SQL/API',async()=>{
 const f=await workflowServer();try{
  await advance(f.sql,f.orderId);
  for(let n=0;n<101;n++)await create(f.sql,{phone:'+998909998877'});
  const request=(path,role='operator',body,key=crypto.randomUUID())=>fetch(f.url+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+role,...(body?{'Content-Type':'application/json','Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const lookup=await request('/order-table?q=901234567&limit=20&offset=0');assert.equal(lookup.status,200);const found=await lookup.json();assert.ok(found.data.some(o=>o.id===f.orderId&&o.status==='delivered'));
  const lead={phone:'+998901234567',name:'Дилноза',source:'call_in',outcome:'new',comment:'Уточнить условия забора'},claim={order_id:f.orderId,reason:'Пятна после стирки',note:'Описание клиента\nПроверить приёмку',due_at:new Date(Date.now()+86400000).toISOString()},key=crypto.randomUUID();
  const leadResponse=await request('/actions/lead.save','operator',lead);assert.equal(leadResponse.status,200);const savedLead=await leadResponse.json();
  const claimResponse=await request('/actions/complaint.create','operator',claim,key);assert.equal(claimResponse.status,200);const savedClaim=await claimResponse.json();
  assert.equal(savedClaim.created_by,ids.operator);assert.equal(savedClaim.order_id,f.orderId);
  assert.equal((await request('/actions/complaint.create','operator',claim,key)).status,200);
  assert.equal((await f.sql.query('select count(*) n from complaints')).rows[0].n,1);
  for(const role of ['operator','admin']){
   const leads=await request('/workspaces/leads',role);assert.equal(leads.status,200);assert.ok((await leads.json()).data.some(l=>l.id===savedLead.id&&l.comment===lead.comment));
   const claims=await request('/ops/quality',role);assert.equal(claims.status,200);assert.ok((await claims.json()).complaints.some(c=>c.id===savedClaim.id&&c.note===claim.note));
  }
  assert.equal((await request('/actions/complaint.resolve','operator',{complaint_id:savedClaim.id,resolution:'no_issue',note:'Проверено'})).status,403);
  for(const role of ['driver','warehouse','washer','packer','inactive']){
   for(const path of ['/ops/quality','/workspaces/leads'])assert.equal((await request(path,role)).status,403);
   assert.equal((await request('/actions/complaint.create',role,claim)).status,403);assert.equal((await request('/actions/lead.save',role,lead)).status,403);
  }
  const branch=await command(f.sql,'branch.save',{code:'other_intake',name:'Другой филиал'}),other=await call(f.sql,'create_order_audited',[JSON.stringify({...input,branch_id:branch.id}),ids.admin,null,crypto.randomUUID()]);
  assert.equal((await request('/actions/complaint.create','operator',{...claim,order_id:other})).status,403);
  assert.equal((await request('/actions/lead.save','operator',{...lead,branch_id:branch.id})).status,403);
  for(const path of ['/ops/quality','/workspaces/leads'])assert.equal((await request(path+'?branch_id='+branch.id)).status,403);
  const adminResolution=await request('/actions/complaint.resolve','admin',{complaint_id:savedClaim.id,resolution:'no_issue',note:'Рассмотрено администратором'});assert.equal(adminResolution.status,200);
  assert.ok((await (await request('/ops/quality')).json()).complaints.some(c=>c.id===savedClaim.id&&c.resolution_note==='Рассмотрено администратором'));
 }finally{await f.close();}
});
