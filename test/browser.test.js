import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {workflowServer} from './helpers/workflow-server.js';
test('Chromium mobile: шесть колонок driver, десять operator, обязательный район и отсутствие размеров',async()=>{
 const f=await workflowServer();let browser;try{
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const login=async role=>{await page.goto(f.url);await page.locator('[name=email]').fill(role+'@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-order-table]').waitFor();await page.locator('[data-view=kanban]').click();await page.locator('[data-column]').first().waitFor();};
  await page.goto(f.url);await page.locator('[data-language]').selectOption('uz');await page.getByRole('heading',{name:'Xodimlar uchun kirish'}).waitFor();await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'uz');
  await login('driver');assert.equal(await page.locator('[data-column]').count(),6);assert.equal(await page.locator('[data-column=new] h2').textContent(),'Yangi buyurtmalar');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/driver-mobile.png',fullPage:true});
  await page.locator('[data-flow=open]').first().click();await page.locator('#detail[open]').waitFor();assert.equal(await page.locator('#detail [data-photo-gallery]').count(),1);assert.equal(await page.locator('#detail [data-photo-gallery]').getAttribute('open'),null);await page.locator('[data-action=close-detail]').click();
  await page.locator('[data-action=logout]').click();await login('operator');assert.equal(await page.locator('[data-column]').count(),10);await page.locator('[data-flow=create]').click();assert.equal(await page.locator('[data-form=create] [name=district_code]').getAttribute('required'),'');assert.equal(await page.locator('[data-form=create] [name=length_m]').count(),0);await page.screenshot({path:dir+'/operator-mobile.png',fullPage:true});await page.locator('[data-action=close-action]').click();await page.locator('[data-language]').selectOption('ru');await page.getByRole('heading',{name:/^Новые заказы/}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ru');await page.locator('[data-flow=create]').click();
  assert.equal(await page.locator('[data-form=create] input').first().getAttribute('name'),'phone');
  assert.equal(await page.locator('[data-form=create] [data-item]').count(),0);
  assert.equal(await page.locator('[data-form=create] [data-action=quote]').count(),0);
  await page.locator('[data-form=create] [name=phone]').fill('901234567');
  await page.waitForFunction(()=>document.querySelector('[data-form=create] [name=name]').value==='Дилноза');
  assert.equal(await page.locator('[data-form=create] [name=street]').inputValue(),'Навои');
  await page.screenshot({path:dir+'/operator-intake-mobile.png',fullPage:true});
  await page.locator('[data-form=create] button.primary').click();
  await page.waitForFunction(()=>!document.querySelector('#action').open);
  const created=(await f.sql.query('select id from orders where id<>$1 order by number desc limit 1',[f.orderId])).rows[0];
  assert.ok(created);assert.equal((await f.sql.query('select count(*) from order_items where order_id=$1',[created.id])).rows[0].count,0);
  await page.locator('[data-action=logout]').click();await login('driver');
  const card=page.locator('[data-card="'+created.id+'"]');
  await card.locator('[data-flow=open]').click();await page.locator('#detail [data-command="pickup.claim"]').click();
  await page.locator('[name=pickup_at]').fill('2026-11-02T14:00');
  await page.locator('[data-flow-command] button.primary').click();
  await card.locator('[data-flow=open]').click();await page.locator('#detail [data-command="pickup.collect"]').click();
  await page.locator('[data-intake-item] [name=tariff]').selectOption('blanket');
  await page.locator('[data-intake-composition] button.primary').click();
  await page.locator('[data-flow-measure]').waitFor();
  assert.equal(await page.locator('[data-flow-measure] [name=length_m]').count(),0);
  await page.locator('[data-flow-measure] [name=photo]').setInputFiles({name:'intake.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1EAAAAASUVORK5CYII=','base64')});
  await page.locator('[data-flow=preview]').click();
  await page.waitForFunction(()=>document.querySelector('[data-flow-price]').textContent.includes('30'));
  assert.equal(await page.locator('[data-flow-measure] button.primary').isEnabled(),true);
  await page.screenshot({path:dir+'/driver-intake-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await f.close();}
});
import {create} from './helpers/database.js';

test('Chromium Dashboard: 55 заказов, страницы, боковая карточка, клиент и мобильный возврат',async()=>{
 const f=await workflowServer();let browser;try{
  for(let n=0;n<54;n++)await create(f.sql,{items:[]});await f.db.rpc('crm_ready',{});
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1500,height:950}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.url);await page.locator('[name=email]').fill('operator@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-order-table] tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-order-table] tbody tr').count(),50);assert.match(await page.locator('#work-page').textContent(),/55/);
  await page.locator('[data-dashboard=page]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-order-table] tbody tr').length===5);
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/dashboard-desktop.png',fullPage:true});
  await page.locator('[data-dashboard=open]').first().click();await page.locator('#detail[open]').waitFor();
  assert.equal(await page.locator('#detail [data-photo-gallery]').getAttribute('open'),null);assert.equal(await page.locator('#detail [data-flow-detail]').getAttribute('open'),null);
  assert.equal(await page.locator('#detail').evaluate(el=>Math.round(el.getBoundingClientRect().right)),1500);
  await page.locator('[data-detail-tab=client]').click();await page.locator('.client-overview').waitFor();assert.match(await page.locator('.client-overview').textContent(),/55/);assert.equal(await page.locator('.client-order-row').count(),10);
  await page.screenshot({path:dir+'/client-side-desktop.png',fullPage:true});await page.locator('[data-action=close-detail]').click();assert.equal(await page.locator('[data-order-table] tbody tr').count(),5);
  await page.locator('[data-view=kanban]').click();await page.locator('[data-card]').first().waitFor();assert.equal(await page.locator('[data-column=new] [data-card]').count(),15);await page.screenshot({path:dir+'/kanban-desktop.png',fullPage:true});
  await page.locator('[data-column=new] [data-flow=open]').first().click();await page.locator('#detail[open]').waitFor();await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('#detail').evaluate(el=>Math.round(el.getBoundingClientRect().width)),390);assert.equal(await page.locator('#main').evaluate(el=>el.inert),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:dir+'/order-panel-mobile.png',fullPage:true});await page.locator('[data-action=close-detail]').click();assert.equal(await page.locator('#main').evaluate(el=>el.inert),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await f.close();}
});

