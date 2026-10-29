import {t,money,date} from './i18n.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={token:sessionStorage.getItem('crm_access_token'),user:null,view:'orders',rows:[],cursor:null,filters:{},reasons:[],staff:[],tariffs:[],selected:null,request:0};
const has=permission=>state.user?.permissions?.includes(permission);
const button=(key,action,attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${esc(t(key))}</button>`;
const field=(key,name,type='text',extra='',id=name)=>`<div class="field"><label for="${id}">${esc(t(key))}</label><input id="${id}" name="${name}" type="${type}" ${type==='tel'?'inputmode="tel" placeholder="90 123 45 67"':''} ${extra}>${type==='tel'?`<small>${esc(t('phoneHint'))}</small>`:''}</div>`;
const statusPill=value=>`<span class="pill ${esc(value)}">${esc(t(value))}</span>`;
const actor=id=>state.staff.find(x=>x.id===id)?.full_name||id||t('noData');
const toast=message=>{$('#toast').textContent=message;setTimeout(()=>$('#toast').textContent='',5000);};

async function api(path,{method='GET',body,idempotencyKey}={}) {
 let response;
 try { response=await fetch(`/api${path}`,{method,headers:{...(state.token?{Authorization:`Bearer ${state.token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}); }
 catch {throw Object.assign(new Error(t('networkError')),{network:true});}
 let data;try{data=await response.json();}catch{throw Object.assign(new Error(t('networkError')),{network:true});}
 if (!response.ok) {
  if (response.status===401&&state.user) {logout();throw new Error(t('expired'));}
  throw Object.assign(new Error(data.error||t('error')),{status:response.status,code:data.code,fields:data.fields});
 }
 return data;
}
function logout() {
 const previousUser=state.user?.id;if(previousUser)window.CRMOffline?.purgeSnapshots(previousUser).catch(()=>{});
 state.token=null;state.user=null;state.rows=[];state.staff=[];state.selected=null;state.request++;
 sessionStorage.removeItem('crm_access_token');
 sessionStorage.removeItem('crm_user_id');window.crmModules?.logout?.();
 $('#detail').close();$('#action').close();loginScreen();
}
function shell() {
 document.title=t('title');
 $('#header').innerHTML=`<div class="bar"><div class="brand">${esc(t('title'))}<small>${esc(t('subtitle'))}</small></div>${state.user?`<div class="actions"><div class="user">${esc(state.user.full_name)}<small>${esc(t(state.user.role))}</small></div>${button('logout','logout')}</div>`:''}</div>${state.user?`<nav>${[...(window.crmModules?.views(state.user)||[]),'orders',...(has('trash')?['requests','trash']:[]),...(has('audit')?['audit']:[])].map(view=>`<button type="button" data-view="${view}" aria-current="${state.view===view}">${esc(t(view))}</button>`).join('')}</nav>`:''}`;
}
function loginScreen() {
 shell();
 $('#main').innerHTML=`<section class="box login"><h1>${esc(t('loginTitle'))}</h1><p class="muted">${esc(t('loginHint'))}</p><form data-form="login">${field('email','email','email','required autocomplete="username"')}${field('password','password','password','required autocomplete="current-password"')}<div class="error" data-error role="alert"></div><button class="primary">${esc(t('login'))}</button></form></section>`;
}
async function initializeStaff() {
 try{
 state.user=await api('/me');
 const [reasons,staff,tariffs]=await Promise.all([api('/cancel-reasons'),has('trash')?api('/staff'):[],has('create')?api('/tariffs'):{tariffs:[]}]);
 state.reasons=reasons;state.staff=staff;state.tariffs=tariffs.tariffs.filter(t=>t.active);
 window.crmReasons=state.reasons;
 sessionStorage.setItem('crm_user_id',state.user.id);
 await window.CRMOffline?.snapshot(state.user.id,'profile',{user:state.user,reasons,staff,tariffs:state.tariffs}).catch(()=>{});
 }catch(error){
  if(!error.network)throw error;
  const id=sessionStorage.getItem('crm_user_id'),cached=id?await window.CRMOffline?.read(id,'profile').catch(()=>null):null;
  if(!cached)throw error;Object.assign(state,cached);
 }
 await window.crmModules?.prepare?.();
 if(window.crmModules?.getMeta().tariffs)state.tariffs=window.crmModules.getMeta().tariffs.filter(t=>t.active);
 state.view=window.crmModules?.home(state.user)||'orders';state.filters={};
 await listScreen();
}
function filterForm() {
 const f=state.filters;
 if (state.view==='trash') return `<form class="filters" data-form="filters">
  <div class="field"><label for="deleted_by">${esc(t('deletedBy'))}</label><select name="deleted_by" id="deleted_by"><option value="">${esc(t('allStaff'))}</option>${state.staff.map(u=>`<option value="${esc(u.id)}" ${u.id===f.deleted_by?'selected':''}>${esc(u.full_name||u.id)}</option>`).join('')}</select></div>
  ${field('from','from','date',`value="${esc(f.from||'')}"`)}${field('to','to','date',`value="${esc(f.to||'')}"`)}${field('reason','reason','text',`maxlength="500" value="${esc(f.reason||'')}"`)}<button>${esc(t('filter'))}</button></form>`;
 if (state.view==='audit') return `<p class="muted">${esc(t('auditHint'))}</p><form class="filters" data-form="filters">${field('entity','entity_id','text',`placeholder="UUID" value="${esc(f.entity_id||'')}"`)}<div class="field"><label for="action-filter">${esc(t('action'))}</label><select id="action-filter" name="action"><option value="">${esc(t('noData'))}</option>${['created','cancelled','deletion_requested','deleted','restored','status_changed','driver_assigned','updated'].map(v=>`<option value="${v}" ${f.action===v?'selected':''}>${esc(t(v))}</option>`).join('')}</select></div><button>${esc(t('filter'))}</button></form>`;
 return `<form class="filters" data-form="filters"><div class="field search"><label for="q">${esc(t('search'))}</label><input id="q" name="q" maxlength="120" value="${esc(f.q||'')}"></div><div class="field"><label for="status-filter">${esc(t('status'))}</label><select id="status-filter" name="status"><option value="">${esc(t('allStatuses'))}</option>${['new','pickup_assigned','received','washing','drying','ready','delivering','delivered','cancelled'].map(v=>`<option value="${v}" ${f.status===v?'selected':''}>${esc(t(v))}</option>`).join('')}</select></div><button>${esc(t('filter'))}</button></form>`;
}
async function listScreen() {
 shell();
 if(window.crmModules?.views(state.user).includes(state.view)){await window.crmModules.render(state.view);return;}
 $('#main').innerHTML=`<div class="heading"><h1>${esc(t(state.view))}</h1><div class="actions">${has('create')&&state.view==='orders'?button('newOrder','new-order','class="primary"'):''}${button('refresh','refresh')}</div></div>${filterForm()}<div id="list" aria-live="polite"></div><div id="pagination"></div>`;
 await loadList();
}
async function loadList(append=false) {
 const request=++state.request,view=state.view;
 if(!append) {state.rows=[];$('#list').textContent=t('loading');}
 const params=new URLSearchParams(Object.entries(state.filters).filter(([,v])=>v));
 if (view==='trash') {
  if (params.has('from')) params.set('from',`${params.get('from')}T00:00:00+05:00`);
  if (params.has('to')) params.set('to',`${params.get('to')}T23:59:59.999+05:00`);
 }
 if (view==='requests') params.set('deletion_requested','true');
 if(append&&state.cursor) params.set('cursor',state.cursor);
 const path=view==='trash'?'/trash':view==='audit'?'/audit-log':'/orders';
 try {
  const result=await api(`${path}?${params}`);
  if(request!==state.request||!state.user) return;
  state.rows=append?[...state.rows,...result.data]:result.data;state.cursor=result.next_cursor;
  renderList();
 } catch(error) {
  if(request===state.request&&$('#list')) {$('#list').className='error';$('#list').textContent=error.message;}
 }
}
function renderList() {
 $('#list').className='';
 if(!state.rows.length) $('#list').innerHTML=`<div class="box empty">${esc(t(state.view==='audit'?'emptyAudit':'empty'))}</div>`;
 else if(state.view==='audit') $('#list').innerHTML=`<div class="events">${state.rows.map(a=>`<article class="event"><div class="row"><strong>${esc(t(a.action))}</strong><small>${esc(date(a.at))}</small></div><p>${esc(actor(a.user_id))} · ${esc(t(a.role))} · ${esc(t(a.entity))} ${esc(a.entity_id)}</p><small>${esc(t('ip'))}: ${esc(a.ip||t('noData'))}</small><details><summary>${esc(t('details'))}</summary><h3>${esc(t('before'))}</h3><pre>${esc(JSON.stringify(a.before,null,2))}</pre><h3>${esc(t('after'))}</h3><pre>${esc(JSON.stringify(a.after,null,2))}</pre></details></article>`).join('')}</div>`;
 else $('#list').innerHTML=`<div class="cards">${state.rows.map(o=>{
  const trash=state.view==='trash',client=trash?o.delete_snapshot?.client:o.client;
  return `<article class="card"><div class="row"><h2>${esc(o.code)}</h2>${statusPill(trash?o.deleted_status:o.status)}</div><strong>${esc(client?.name||t('noData'))}</strong><p>${esc(client?.phone||t('noData'))}</p><p class="muted">${esc(trash?o.delete_snapshot?.order?.address:o.address)}</p><strong>${money(o.total)}</strong>${trash?`<small>${esc(date(o.deleted_at))} · ${esc(o.delete_snapshot?.actor?.full_name||actor(o.deleted_by))}</small><p>${esc(o.delete_reason)}</p>`:o.delete_requested_at?`<span class="pill">${esc(t('pending'))}</span><p>${esc(o.delete_request_reason)}</p>`:''}${button('details','details',`data-id="${esc(o.id)}"`)}</article>`;
 }).join('')}</div>`;
 $('#pagination').innerHTML=state.cursor?button('more','more','class="more"'):'';
}
async function openDetail(id) {
 const trash=state.view==='trash',o=await api(`${trash?'/trash':'/orders'}/${id}`);
 state.selected={...o,isTrash:trash};
 const d=trash?o.delete_snapshot?.order||o:o,client=trash?o.delete_snapshot?.client:o.client,items=trash?o.delete_snapshot?.items||[]:o.items;
 const closed=['cancelled','delivered'].includes(o.status);
 const cancel=has('cancel')&&!closed&&(state.user.role!=='operator'||o.status==='new');
 const deleteBlocked=Number(o.paid_amount)>0||o.payment_recorded_at||o.washing_started_at||o.status==='delivered';
 $('#detail').innerHTML=`<div class="row dialog-head"><h2>${esc(o.code)}</h2>${button('close','close-detail')}</div>${statusPill(trash?o.deleted_status:o.status)}
  <div class="detail-grid"><div><small>${esc(t('client'))}</small><strong>${esc(client?.name)}</strong>${esc(client?.phone)}</div><div><small>${esc(t('address'))}</small><strong>${esc(d.address)}</strong></div><div><small>${esc(t('sum'))}</small><strong>${money(d.total)}</strong></div><div><small>${esc(t('paid'))}</small><strong>${money(d.paid_amount)}</strong></div></div>
  ${trash?`<div class="notice"><strong>${esc(t('deletedAt'))}: ${esc(date(o.deleted_at))}</strong><p>${esc(t('by'))}: ${esc(o.delete_snapshot?.actor?.full_name||actor(o.deleted_by))}</p><p>${esc(o.delete_reason)}</p><small>${esc(t('snapshotHint'))}</small></div>`:''}
  ${o.delete_requested_at?`<div class="notice">${esc(t('requestedAt'))}: ${esc(date(o.delete_requested_at))}<p>${esc(o.delete_request_reason)}</p><small>${esc(actor(o.delete_requested_by))}</small></div>`:''}
  ${o.cancelled_at?`<div class="notice">${esc(t('cancelledAt'))}: ${esc(date(o.cancelled_at))}<p>${esc(state.reasons.find(r=>r.code===o.cancel_reason_code)?.name_ru||o.cancel_reason_code)}: ${esc(o.cancel_comment)}</p><p>${esc(t('workAmount'))}: ${money(o.completed_work_amount)} · ${esc(t('paymentAmount'))}: ${money(o.cancellation_payment_amount)}</p></div>`:''}
  ${o.restored_at?`<p class="muted">${esc(t('restoredAt'))}: ${esc(date(o.restored_at))} · ${esc(actor(o.restored_by))}</p>`:''}
  <h3>${esc(t('snapshot'))}</h3>${items.map(i=>`<div class="items">${esc(t('item'))} ${esc(i.seq)} · ${esc(i.length_m)} × ${esc(i.width_m)} ${esc(t('unitM'))} · ${esc(i.tariff_code)}<br>${money(i.price)}${i.note?`<p>${esc(i.note)}</p>`:''}</div>`).join('')}
  <h3>${esc(t('history'))}</h3><ul>${o.history.map(h=>`<li>${esc(date(h.created_at))} — ${esc(t(h.status))}${h.note?`<br><small>${esc(h.note)}</small>`:''}</li>`).join('')}</ul>
  ${!trash&&deleteBlocked?`<p class="muted">${esc(t('blockedDeletion'))}</p>`:''}<div class="actions">${trash&&has('restore')?button('restore','restore','class="primary"'):''}${!trash&&cancel?button('cancel','cancel','class="danger"'):''}${!trash&&has('delete')&&!deleteBlocked?button('remove','delete','class="danger"'):''}${!trash&&has('requestDeletion')&&o.status==='new'&&!o.delete_requested_at&&!deleteBlocked?button('requestDeletion','request-deletion'):''}</div>`;
 if(!trash)$('#detail').insertAdjacentHTML('beforeend',window.crmModules?.orderActions?.(o)||'');
 $('#detail').showModal();
}
function actionForm(kind) {
 const o=state.selected;
 const title={cancel:'cancel',delete:'remove','request-deletion':'requestDeletion'}[kind];
 $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t(title))} · ${esc(o.code)}</h2>${button('close','close-action')}</div><form data-form="${kind}">
  ${kind==='cancel'?`<div class="field"><label for="reason_code">${esc(t('cancelReason'))}</label><select id="reason_code" name="reason_code" required><option value="">${esc(t('chooseReason'))}</option>${state.reasons.map(r=>`<option value="${esc(r.code)}">${esc(r.name_ru)}</option>`).join('')}</select></div><div class="field"><label for="comment">${esc(t('comment'))}</label><textarea id="comment" name="comment" maxlength="1000" required></textarea></div><p class="muted">${esc(t('moneyHint'))}</p><div class="two">${field('workAmount','completed_work_amount','number','min="0" max="999999999999" step="1" value="0" required')}${field('paymentAmount','payment_amount','number','min="0" max="999999999999" step="1" value="0" required')}</div>`:`<p class="muted">${esc(t(kind==='delete'?'deleteHint':'requestHint'))}</p><div class="field"><label for="reason">${esc(t('reason'))}</label><textarea id="reason" name="reason" maxlength="500" required>${esc(o.delete_request_reason||'')}</textarea></div>`}
  <div data-error class="error" role="alert"></div><button class="primary">${esc(t('save'))}</button></form>`;
 $('#action').showModal();
}
let itemSequence=0;
function itemFields() {
 const seq=++itemSequence;
 return `<fieldset data-item><legend>${esc(t('item'))}</legend><div class="two">${field('length','length_m','number','min="0.3" max="20" step="0.01" value="3" required',`length-${seq}`)}${field('width','width_m','number','min="0.3" max="20" step="0.01" value="2" required',`width-${seq}`)}</div><label>${esc(t('tariff'))}<select name="tariff" required>${state.tariffs.map(r=>`<option value="${esc(r.code)}">${esc(r.name)}</option>`).join('')}</select></label>${button('removeItem','remove-item')}</fieldset>`;
}
function newOrder(prefill={}) {
 $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t('newOrder'))}</h2>${button('close','close-action')}</div><form data-form="create">
  ${field('name','name','text','maxlength="120"')}${field('phone','phone','tel','value="+998" maxlength="32" required autocomplete="tel"')}${field('address','address','text','minlength="3" maxlength="300" required')}
  <div class="two">${field('pickupDate','pickup_date','date','required')}${field('pickupSlot','pickup_slot','text','maxlength="40"')}</div><label>${esc(t('source'))}<select name="source">${(window.crmModules?.sourceOptions?.()||['call_in','call_out','instagram','telegram'].map(v=>[v,t(v)])).map(([v,label])=>`<option value="${esc(v)}">${esc(label)}</option>`).join('')}</select></label>
  ${window.crmModules?.orderFields?.()||''}<div id="order-items">${(prefill.items?.length?prefill.items:[{}]).map(()=>itemFields()).join('')}</div>${button('addItem','add-item')}<div class="actions">${['urgent','stains','pensioner'].map(v=>`<label class="check"><input type="checkbox" name="${v}">${esc(t(v))}</label>`).join('')}</div><p class="muted">${esc(t('quoteHint'))}</p><p id="quote-result" class="success"></p><div data-error class="error" role="alert"></div><div class="actions">${button('quote','quote')}<button class="primary">${esc(t('create'))}</button></div></form>`;
 const form=$('#action form');for(const key of ['name','phone','address','source','pickup_slot','zone_code','latitude','longitude'])if(prefill[key]!=null&&form.elements[key])form.elements[key].value=prefill[key];
 for(const flag of ['urgent','stains','pensioner'])if(prefill[flag])form.elements[flag].checked=true;
 form.querySelectorAll('[data-item]').forEach((el,index)=>{const it=prefill.items?.[index];if(it)for(const key of ['length_m','width_m','tariff'])el.querySelector(`[name=${key}]`).value=it[key];});
 $('#action').querySelector('form').dataset.idempotencyKey=crypto.randomUUID();
 $('#action').showModal();
}
function orderBody(form) {
 const d=new FormData(form);
 return {name:d.get('name'),phone:d.get('phone'),address:d.get('address'),pickup_date:d.get('pickup_date'),pickup_slot:d.get('pickup_slot'),source:d.get('source'),urgent:d.has('urgent'),stains:d.has('stains'),pensioner:d.has('pensioner'),
  ...(d.get('branch_id')?{branch_id:d.get('branch_id')}:{}),...(d.get('zone_code')?{zone_code:d.get('zone_code')}:{}),...(d.get('latitude')?{latitude:Number(d.get('latitude'))}:{}),...(d.get('longitude')?{longitude:Number(d.get('longitude'))}:{}),
  items:[...form.querySelectorAll('[data-item]')].map(el=>({length_m:Number(el.querySelector('[name=length_m]').value),width_m:Number(el.querySelector('[name=width_m]').value),tariff:el.querySelector('[name=tariff]').value}))};
}
async function finishAction() {$('#action').close();$('#detail').close();toast(t('saved'));await loadList();}

document.addEventListener('submit',async event=>{
 const form=event.target;if(!form.dataset.form)return;event.preventDefault();
 const submit=form.querySelector('button:not([type=button])'),error=form.querySelector('[data-error]');
 if(submit?.disabled)return;if(submit)submit.disabled=true;if(error)error.textContent='';
 try {
  const d=Object.fromEntries(new FormData(form)),kind=form.dataset.form;
  if(kind==='login') {
   const session=await api('/public/login',{method:'POST',body:d});state.token=session.access_token;sessionStorage.setItem('crm_access_token',state.token);await initializeStaff();
  } else if(kind==='filters') {state.filters=d;await loadList();}
  else if(kind==='create') {await api('/orders',{method:'POST',body:orderBody(form),idempotencyKey:form.dataset.idempotencyKey});await finishAction();}
  else {
   const path={cancel:'cancel','request-deletion':'deletion-request',delete:''}[kind];
   const body=kind==='cancel'?{...d,completed_work_amount:Number(d.completed_work_amount),payment_amount:Number(d.payment_amount)}:d;
   await api(`/orders/${state.selected.id}${path?`/${path}`:''}`,{method:kind==='delete'?'DELETE':'POST',body});await finishAction();
  }
 } catch(e){if(error?.isConnected)error.textContent=e.message;else toast(e.message);}
 finally{if(submit)submit.disabled=false;}
});
document.addEventListener('click',async event=>{
 const el=event.target.closest('button');if(!el||el.disabled)return;
 try {
  if(el.dataset.view){state.view=el.dataset.view;state.filters={};await listScreen();return;}
  const action=el.dataset.action;
  if(action==='logout')logout();
  if(action==='refresh')await loadList();
  if(action==='more'){el.disabled=true;await loadList(true);}
  if(action==='details')await openDetail(el.dataset.id);
  if(action==='close-detail')$('#detail').close();
  if(action==='close-action')$('#action').close();
  if(['cancel','delete','request-deletion'].includes(action))actionForm(action);
  if(action==='restore'){el.disabled=true;await api(`/orders/${state.selected.id}/restore`,{method:'POST',body:{}});await finishAction();}
  if(action==='new-order')newOrder();
  if(action==='add-item'&&$('#order-items').children.length<30)$('#order-items').insertAdjacentHTML('beforeend',itemFields());
  if(action==='remove-item'&&$('#order-items').children.length>1)el.closest('[data-item]').remove();
  if(action==='quote'){
   const form=el.closest('form');if(!form.reportValidity())return;el.disabled=true;
   const quote=await api('/quote',{method:'POST',body:orderBody(form)});$('#quote-result').textContent=`${t('sum')}: ${money(quote.total)}`;
  }
 }catch(e){toast(e.message);}finally{el.disabled=false;}
});
document.addEventListener('input',event=>{if(event.target.closest('[data-form=create]')&&$('#quote-result'))$('#quote-result').textContent='';});
let phoneLookupTimer;
document.addEventListener('input',event=>{const form=event.target.closest('[data-form=create]');if(form&&event.target.name==='phone'){clearTimeout(phoneLookupTimer);const phone=event.target.value.replace(/[\s()-]/g,'');if(/^(?:\+?998)?\d{9}$/.test(phone))phoneLookupTimer=setTimeout(()=>window.crmModules?.lookupInOrderForm(form,phone).catch(()=>{}),400);}});
document.addEventListener('change',event=>{if(event.target.name==='saved_address'){const form=event.target.closest('[data-form=create]');if(form)form.elements.address.value=event.target.value;}});

async function start() {
 document.title=t('title');
 const token=location.pathname.match(/^\/track\/([^/]+)$/)?.[1];
 if(token){
  shell();$('#main').textContent=t('loading');
  try{const o=await api(`/public/track/${encodeURIComponent(token)}`);$('#main').innerHTML=`<section class="box"><h1>${esc(t('trackTitle'))} ${esc(o.code)}</h1><p class="muted">${esc(t('trackHint'))}</p>${statusPill(o.status)}<p>${money(o.total)}</p><ul>${o.history.map(h=>`<li>${esc(date(h.at))} — ${esc(t(h.status))}</li>`).join('')}</ul></section>`;}
  catch{$('#main').innerHTML=`<section class="box"><h1>${esc(t('trackTitle'))}</h1><p>${esc(t('trackUnavailable'))}</p></section>`;}
  return;
 }
 if(!state.token)return loginScreen();
 try{await initializeStaff();}catch(e){logout();toast(e.message);}
}
window.crmUI={api,user:()=>state.user,has,toast,openOrder:openDetail,newOrder,navigate:async view=>{state.view=view;state.filters={};await listScreen();},refresh:()=>listScreen(),download:async(path,filename)=>{const response=await fetch(`/api${path}`,{headers:{Authorization:`Bearer ${state.token}`}});if(!response.ok){const data=await response.json();throw new Error(data.error||t('error'));}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {nextCursor:response.headers.get('X-Next-Cursor')};},print:async path=>{const win=window.open('','_blank');if(!win)throw Error(t('popupBlocked'));try{const response=await fetch(`/api${path}`,{headers:{Authorization:`Bearer ${state.token}`}});if(!response.ok){const data=await response.json();throw Error(data.error||t('error'));}const html=await response.text();win.document.open();win.document.write(html);win.document.close();win.addEventListener('load',()=>win.print(),{once:true});}catch(e){win.close();throw e;}}};
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
start();
