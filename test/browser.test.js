import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {workflowServer} from './helpers/workflow-server.js';
test('Chromium mobile: шесть колонок driver, десять operator, обязательный район и отсутствие размеров',async()=>{
 const f=await workflowServer();let browser;try{
  browser=await chromium.launch({headless:true,...(process.env.CRM_BROWSER_CHANNEL?{channel:process.env.CRM_BROWSER_CHANNEL}:{})});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const login=async role=>{await page.goto(f.url);await page.locator('[name=email]').fill(role+'@example.test');await page.locator('[name=password]').fill('test');await page.locator('[data-form=login] button').click();await page.locator('[data-column]').first().waitFor();};
  await page.goto(f.url);await page.locator('[data-language]').selectOption('uz');await page.getByRole('heading',{name:'Xodimlar uchun kirish'}).waitFor();await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'uz');
  await login('driver');assert.equal(await page.locator('[data-column]').count(),6);assert.equal(await page.locator('[data-column=new] h2').textContent(),'Yangi buyurtmalar');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const dir=fileURLToPath(new URL('../test-artifacts/',import.meta.url));await mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/driver-mobile.png',fullPage:true});
  await page.locator('[data-flow=open]').first().click();await page.locator('#detail[open]').waitFor();assert.equal(await page.locator('#detail [data-photo-gallery]').count(),1);assert.equal(await page.locator('#detail [data-photo-gallery]').getAttribute('open'),null);await page.locator('[data-action=close-detail]').click();
  await page.locator('[data-action=logout]').click();await login('operator');assert.equal(await page.locator('[data-column]').count(),10);await page.locator('[data-flow=create]').click();assert.equal(await page.locator('[data-form=create] [name=district_code]').getAttribute('required'),'');assert.equal(await page.locator('[data-form=create] [name=length_m]').count(),0);await page.screenshot({path:dir+'/operator-mobile.png',fullPage:true});await page.locator('[data-action=close-action]').click();await page.locator('[data-language]').selectOption('ru');await page.getByRole('heading',{name:'Новые заказы',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ru');assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await f.close();}
});
