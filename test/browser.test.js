import {listen} from './helpers/listen.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../src/app.js';
import {fakeDb} from './helpers/fake-db.js';
import {database,create,ids} from './helpers/database.js';

// Реальные SQL RPC + локальный адаптер чтения вместо сетевого PostgREST/Supabase Auth.
test('браузер: оператор → заявка и отказ → администратор → корзина → восстановление → аудит',async()=>{
 const sql=await database(),db=fakeDb();
 const orderId=await create(sql);
 const sync=async()=>{
  db.rows.orders=(await sql.query(`select to_jsonb(o)||jsonb_build_object(
   'client',(select to_jsonb(c) from clients c where c.id=o.client_id),
   'items',(select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('photos','[]'::jsonb) order by i.seq),'[]'::jsonb) from order_items i where i.order_id=o.id),
   'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from status_history h where h.order_id=o.id)) as data from orders o`)).rows.map(r=>r.data);
  for(const table of ['profiles','clients','cancel_reasons','tariffs','settings','audit_log']) db.rows[table]=(await sql.query(`select * from ${table}`)).rows;
 };
 await sync();
 db.auth.getUser=async token=>({data:{user:{id:ids[token]}}});
 db.rpc=async(name,params)=>{
  try {
   const entries=Object.entries(params),args=entries.map(([k],i)=>`${k}=>$${i+1}`).join(',');
   const result=(await sql.query(`select to_jsonb(public.${name}(${args})) as data`,entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].data;
   await sync();return {data:result,error:null};
  }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
 };
 const authClient={auth:{signInWithPassword:async({email})=>({data:{session:{access_token:email.split('@')[0],expires_at:9999999999}}})}};
 const server=await listen(createApp({db,authClient,config:{trustProxy:false}}));
 const url=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try {
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'ru-RU'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  const login=async role=>{
   await page.getByLabel('Почта').fill(`${role}@example.test`);await page.getByLabel('Пароль').fill('test-password');
   await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Подробнее',exact:true}).first().waitFor();
  };
  await login('operator');
  assert.equal(await page.getByRole('button',{name:'Корзина',exact:true}).count(),0);
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().click();
  await page.getByRole('button',{name:'Запросить удаление',exact:true}).click();
  await page.getByLabel('Причина удаления',{exact:true}).fill('Дубликат звонка');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByText('Ожидает решения',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().click();
  await page.getByRole('button',{name:'Отказ клиента',exact:true}).click();
  await page.getByLabel('Причина отказа').selectOption('other');
  await page.getByLabel('Комментарий',{exact:true}).fill('Клиент подтвердил дубликат');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.locator('.card .pill.cancelled').waitFor();
  await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('admin');
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().click();
  await page.getByRole('button',{name:'В корзину',exact:true}).click();
  await page.getByLabel('Причина удаления',{exact:true}).fill('Дубликат, проверен администратором');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.getByText('Здесь пока нет заказов',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Корзина',exact:true}).click();
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().waitFor();
  await page.getByLabel('Кто удалил').selectOption(ids.admin);
  await page.getByLabel('Причина удаления',{exact:true}).fill('Дубликат');
  await page.getByRole('button',{name:'Показать',exact:true}).click();
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().waitFor();
  assert.ok(await page.locator('.card').textContent().then(s=>s.includes('+998901234567')));
  await mkdir(new URL('../test-artifacts/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL('../test-artifacts/trash-mobile.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.getByRole('button',{name:'Подробнее',exact:true}).first().click();
  await page.getByRole('button',{name:'Восстановить',exact:true}).click();
  await page.getByText('Здесь пока нет заказов',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Заказы',exact:true}).click();await page.locator('.card .pill.cancelled').waitFor();
  await page.getByRole('button',{name:'Журнал аудита',exact:true}).click();
  await page.locator('.event').first().waitFor();
  for(const text of ['Заявка на удаление','Отказ клиента','Удаление в корзину','Восстановление']) assert.ok((await page.locator('.events').innerText()).includes(text));
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:new URL('../test-artifacts/audit-desktop.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  assert.deepEqual(errors,[]);
  const o=(await sql.query('select status,restored_by from orders where id=$1',[orderId])).rows[0];
  assert.equal(o.status,'cancelled');assert.equal(o.restored_by,ids.admin);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await context.close();
 }finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await sql.close();
 }
});
