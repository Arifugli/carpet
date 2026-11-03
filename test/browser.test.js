import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {workflowServer} from './helpers/workflow-server.js';
test('Chromium mobile: шесть колонок driver, десять operator, обязательный район и отсутствие размеров',async()=>{
 const f=await workflowServer();let browser;try{
  const far=await create(f.sql,{items:[{tariff:'blanket',quantity:1}]});await advance(f.sql,far,'ready_for_delivery');
  const near=await create(f.sql,{district_code:'kokand_city',items:[{tariff:'blanket',quantity:1}]});await advance(f.sql,near,'ready_for_delivery');
  const today=await create(f.sql,{items:[]});await command(f.sql,'pickup.claim',{order_id:today,pickup_at:new Date().toISOString()},'driver');
  const tomorrow=await create(f.sql,{items:[]});await command(f.sql,'pickup.claim',{order_id:tomorrow,pickup_at:new Date(Date.now()+86400000).toISOString()},'driver');
  const delayed=await create(f.sql,{items:[{tariff:'blanket',quantity:1}]});await advance(f.sql,delayed,'in_transit');await command(f.sql,'delivery.postpone',{order_id:delayed,reason:'Клиент попросил перенести'},'driver');
  await f.sql.query("update orders set promised_at=now()-interval '1 hour' where id=$1",[f.orderId]);
  await command(f.sql,'staff.update',{user_id:ids.driver,full_name:'driver',role:'driver',active:true,branch_id:'01000000-0000-4000-8000-000000000001',district_codes:['kokand_city'],driver_color:'#123abc'});await f.db.rpc('crm_ready',{});
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const login=async role=>{await page.goto(f.url);await page.locator('[name=email]').fill(role+'@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-order-table]').waitFor();await page.locator('[data-view=kanban]').click();await page.locator('[data-column]').first().waitFor();};
  await page.goto(f.url);await page.locator('[data-language]').selectOption('uz');await page.getByRole('heading',{name:'Xodimlar uchun kirish'}).waitFor();await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'uz');
  await login('driver');assert.equal(await page.locator('[data-column]').count(),6);assert.equal(await page.locator('[data-column=new] h2').textContent(),'Yangi buyurtmalar');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/driver-mobile.png',fullPage:true});
  await page.locator('[data-column=ready_for_delivery] .column-filter summary').click();
  await page.locator('[data-column=ready_for_delivery] [name=q]').fill('does-not-match');await page.locator('[data-column=ready_for_delivery] form button').first().click();await page.waitForFunction(()=>!document.querySelector('[data-column=ready_for_delivery] [data-card]'));
  await page.locator('#kanban').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await page.locator('[data-view=home]').click();await page.locator('[data-dashboard=ready-warehouse]').waitFor();await page.locator('[data-dashboard=ready-warehouse]').click();
  await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-column=ready_for_delivery] h2'));
  const ready=page.locator('[data-column=ready_for_delivery]');assert.equal(await ready.locator('[data-card]').count(),2);assert.equal(await ready.locator('[data-card]').first().getAttribute('data-card'),near);assert.equal(await ready.locator('[data-card]').first().evaluate(el=>el.style.borderColor),'rgb(18, 58, 188)');assert.equal(await ready.locator('[name=q]').inputValue(),'');
  const position=await ready.evaluate(el=>({left:el.getBoundingClientRect().left,board:document.querySelector('#kanban').getBoundingClientRect().left,top:el.getBoundingClientRect().top,header:document.querySelector('#header').getBoundingClientRect().bottom}));assert.ok(Math.abs(position.left-position.board)<2);assert.ok(position.top>=position.header-1);
  await page.screenshot({path:dir+'/driver-ready-link-mobile.png',fullPage:true});
  for(const [focus,expected] of [['pickup_today',[today]],['attention',[f.orderId,delayed]]]){
   await page.locator('[data-view=home]').click();const tile=page.locator('[data-dashboard=driver-focus][data-focus="'+focus+'"]');await tile.waitFor();assert.equal(await tile.locator('strong').textContent(),String(expected.length));await tile.click();
   await page.waitForFunction(()=>document.querySelector('[data-work-view=orderList]')&&document.activeElement===document.querySelector('#main h1'));
   if(focus==='pickup_today')assert.equal(await page.locator('[data-order-table] th').nth(2).textContent(),'Olib ketish sanasi va vaqti');
   assert.equal(await page.locator('[data-order-table] tbody tr').count(),expected.length);assert.deepEqual((await page.locator('[data-dashboard=open]').evaluateAll(rows=>rows.map(r=>r.dataset.id))).sort(),expected.sort());assert.equal(await page.locator('.heading [data-dashboard=reset]').count(),1);
  }
  await page.locator('[data-view=home]').click();await page.locator('[data-dashboard=ready-warehouse]').click();await page.waitForFunction(()=>document.activeElement===document.querySelector('[data-column=ready_for_delivery] h2'));


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
import {create,command,ids} from './helpers/database.js';

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
  await page.locator('[data-column=new] [data-flow=open]').first().click();await page.locator('#detail[open]').waitFor();await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#main').inert);
  assert.equal(await page.locator('#detail').evaluate(el=>Math.round(el.getBoundingClientRect().width)),390);assert.equal(await page.locator('#main').evaluate(el=>el.inert),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:dir+'/order-panel-mobile.png',fullPage:true});await page.locator('[data-action=close-detail]').click();assert.equal(await page.locator('#main').evaluate(el=>el.inert),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await f.close();}
});

import {advance} from './helpers/database.js';

test('Chromium: доставленный заказ на главной и ровная сетка на 1440, 1024, 768 и 390 px',async()=>{
 const f=await workflowServer();let browser;try{
  await advance(f.sql,f.orderId);await f.db.rpc('crm_ready',{});
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(f.url);await page.locator('[name=email]').fill('admin@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-order-table] .delivered').waitFor();
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});
  for(const width of [1440,1024,768,390]){
   await page.setViewportSize({width,height:900});
   const metrics=await page.evaluate(()=>{const controls=[...document.querySelectorAll('[data-dashboard-filter]>label input,[data-dashboard-filter]>label select,.filter-actions button')].map(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height}));return{controls,mainTop:document.querySelector('#main').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth};});
   assert.equal(metrics.overflow,false,'overflow '+width);assert.ok(metrics.controls.every(c=>Math.abs(c.height-44)<1),'control heights '+width);
   if(width===1440){assert.ok(metrics.mainTop<=30,'main starts at the top');assert.ok(Math.max(...metrics.controls.map(c=>c.top))-Math.min(...metrics.controls.map(c=>c.top))<1,'same baseline');}
   await page.screenshot({path:dir+'/home-fixed-'+width+'.png',fullPage:true});
  }
  await page.locator('[data-dashboard-filter] [name=status]').selectOption('delivered');await page.locator('.filter-actions button').first().click();await page.locator('[data-order-table] .delivered').waitFor();
  await page.locator('[data-scope=active]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-order-table] tbody tr').length===0);
  await page.locator('[data-dashboard-filter] [name=status]').selectOption('delivered');await page.locator('.filter-actions button').first().click();await page.locator('[data-order-table] .delivered').waitFor();assert.equal(await page.locator('[data-scope=all]').getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:1440,height:900});await page.locator('[data-nav-more] summary').click();await page.locator('[data-view=adminDesk]').click();await page.locator('[data-module-help=adminDesk]').waitFor();assert.equal(await page.locator('[data-nav-more]').getAttribute('open'),'');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:900});
   const buttons=await page.locator('.cards .card').first().locator('.actions button').evaluateAll(rows=>rows.slice(0,2).map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,top:b.getBoundingClientRect().top})));
   assert.equal(buttons.length,2);assert.ok(Math.abs(buttons[0].w-buttons[1].w)<1);assert.ok(Math.abs(buttons[0].h-buttons[1].h)<1);assert.ok(Math.abs(buttons[0].top-buttons[1].top)<1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:dir+'/sections-admin-grid.png',fullPage:true});
  await page.locator('[data-view=stockroom]').click();await page.locator('[data-module-help=stockroom]').waitFor();assert.match(await page.locator('[data-module-help]').textContent(),/моющие средства/);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await f.close();}
});

test('Chromium касса: ежедневные доставки, передача водителем и приём администратором в один клик',async()=>{
 const f=await workflowServer();let browser;try{
  await advance(f.sql,f.orderId,'collected');await command(f.sql,'payment.record',{order_id:f.orderId,amount:50000,method:'cash'},'driver');await command(f.sql,'payment.record',{order_id:f.orderId,amount:112000,method:'cash'},'admin');await advance(f.sql,f.orderId);await f.db.rpc('crm_ready',{});
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});
  const dc=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),ac=await browser.newContext({viewport:{width:1440,height:950}}),driver=await dc.newPage(),administrator=await ac.newPage(),errors=[];
  for(const page of [driver,administrator])page.on('pageerror',e=>errors.push(e.message));
  const login=async(page,role)=>{await page.goto(f.url);await page.locator('[name=email]').fill(role+'@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-order-table]').waitFor();await page.locator('[data-nav-more] summary').click();await page.locator('[data-view=cashbox]').click();await page.locator('.cash-kpis').waitFor();};
  await login(driver,'driver');await driver.locator('.cash-orders').waitFor();assert.equal(await driver.locator('.cash-orders tbody tr').count(),1);assert.match(await driver.locator('.cash-kpis').textContent(),/50\s*000/);assert.equal(await driver.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const driverMetric=driver.locator('[data-cash-metric=cashHandedDaily]');assert.equal(await driverMetric.locator('span').textContent(),'Сдал');assert.match(await driverMetric.locator('strong').textContent(),/^0\s/);
  const grid=await driver.locator('.cash-daily-kpis>div').evaluateAll(rows=>rows.map(r=>({top:r.getBoundingClientRect().top,left:r.getBoundingClientRect().left})));
  assert.equal(grid.length,4);assert.equal(grid[0].top,grid[1].top);assert.equal(grid[2].top,grid[3].top);assert.ok(grid[2].top>grid[0].top);assert.equal(grid[0].left,grid[2].left);
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});await driver.screenshot({path:dir+'/cash-driver-daily.png',fullPage:true});
  await driver.locator('[data-cash=hand-in]').click();await driver.locator('[data-handover]').waitFor();assert.equal(await driver.locator('[data-cash=hand-in]').count(),0);
  assert.match(await driverMetric.locator('strong').textContent(),/^0\s/);
  await login(administrator,'admin');await administrator.locator('[data-cash=accept]').waitFor();assert.match(await administrator.locator('.cash-handover').textContent(),/50\s*000/);await administrator.screenshot({path:dir+'/cash-admin-pending.png',fullPage:true});
  const adminMetric=administrator.locator('[data-cash-metric=cashAcceptedDaily]');assert.equal(await adminMetric.locator('span').textContent(),'Принято');assert.match(await adminMetric.locator('strong').textContent(),/^0\s/);
  assert.equal(new Set(await administrator.locator('.cash-daily-kpis>div').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().top))).size,1);
  await administrator.locator('[data-cash=accept]').click();await administrator.waitForFunction(()=>!document.querySelector('[data-handover]'));assert.match(await adminMetric.locator('strong').textContent(),/50\s*000/);await driver.locator('[data-cash=refresh]').click();await driver.waitForFunction(()=>!document.querySelector('[data-handover]'));assert.match(await driverMetric.locator('strong').textContent(),/50\s*000/);
  await driver.locator('[data-language]').selectOption('uz');await driverMetric.locator('span').getByText('Topshirdim',{exact:true}).waitFor();assert.match(await driverMetric.locator('strong').textContent(),/50,000/);await driver.locator('[data-language]').selectOption('ru');await driverMetric.locator('span').getByText('Сдал',{exact:true}).waitFor();
  await administrator.screenshot({path:dir+'/cash-admin-accepted-kpi.png',fullPage:true});await driver.screenshot({path:dir+'/cash-driver-handed-kpi.png',fullPage:true});
  await driver.locator('.cash-month summary').first().click();await driver.locator('[data-cash-month-result] table').waitFor();await driver.screenshot({path:dir+'/cash-driver-month.png',fullPage:true});assert.equal(await driver.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal((await f.sql.query('select paid_amount from orders where id=$1',[f.orderId])).rows[0].paid_amount,'162000');assert.equal((await f.sql.query('select count(*) from payments')).rows[0].count,2);assert.deepEqual(errors,[]);await dc.close();await ac.close();
 }finally{await browser?.close();await f.close();}
});
