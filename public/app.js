import {t,money,date,locale,setLocale,text,localizedName} from './i18n.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={token:sessionStorage.getItem('crm_access_token'),user:null,view:'orders',rows:[],cursor:null,filters:{},reasons:[],staff:[],tariffs:[],selected:null,request:0};
const moduleGroups=[
 ['navClients',['leads','calls','qualityDesk','rewashDesk']],
 ['navFinance',['cashbox','loyaltyDesk','payrollDesk']],
 ['navProduction',['stockroom','planningDesk']],
 ['navControl',['adminDesk','orderMetrics','alerts','requests','trash','audit']],
 ['navService',['integrationsDesk','clientsExport','queue']]
];
const moduleHints=new Set(moduleGroups.flatMap(([,views])=>views));
function explainModule(view){
 if(!moduleHints.has(view)||$('#main [data-module-help]'))return;
 const heading=$('#main .heading')||$('#main h1');
 heading?.insertAdjacentHTML('afterend','<p class="module-help" data-module-help="'+view+'">'+esc(t('help_'+view))+'</p>');
}
const has=permission=>state.user?.permissions?.includes(permission);
const button=(key,action,attrs='')=>`<button type="button" data-action="${action}" ${attrs}>${esc(t(key))}</button>`;
const field=(key,name,type='text',extra='',id=name)=>`<div class="field"><label for="${id}">${esc(t(key))}</label><input id="${id}" name="${name}" type="${type}" ${type==='tel'?'inputmode="tel" placeholder="90 123 45 67"':''} ${extra}>${type==='tel'?`<small>${esc(t('phoneHint'))}</small>`:''}</div>`;
const orderPrice=o=>o.pricing_state==='awaiting_measurements'?esc(t('priceAfterMeasurement')):money(o.total);
const statusPill=value=>`<span class="pill ${esc(value)}">${esc(t(value))}</span>`;
const actor=id=>state.staff.find(x=>x.id===id)?.full_name||id||t('noData');
const toast=message=>{$('#toast').textContent=message;setTimeout(()=>$('#toast').textContent='',5000);};

async function api(path,{method='GET',body,file,idempotencyKey}={}) {
 let response;
 try { response=await fetch(`/api${path}`,{method,headers:{...(state.token?{Authorization:`Bearer ${state.token}`} : {}),...(file?{'Content-Type':file.type}:body!==undefined?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(file?{body:file}:body!==undefined?{body:JSON.stringify(body)}:{})}); }
 catch {throw Object.assign(new Error(t('networkError')),{network:true});}
 let data;try{data=await response.json();}catch{throw Object.assign(new Error(t('networkError')),{network:true});}
 if (!response.ok) {
  if (response.status===401&&state.user) {logout();throw new Error(t('expired'));}
  throw Object.assign(new Error(text(data.error)||t('error')),{status:response.status,code:data.code,fields:data.fields});
 }
 return data;
}
function logout() {
 const previousUser=state.user?.id;if(previousUser)window.CRMOffline?.purgeSnapshots(previousUser).catch(()=>{});
 state.token=null;state.user=null;state.rows=[];state.staff=[];state.selected=null;state.request++;
 try{if(previousUser)sessionStorage.removeItem(`crm:new-order:${previousUser}`);}catch{}
 $('#toast').textContent='';
 sessionStorage.removeItem('crm_access_token');
 sessionStorage.removeItem('crm_user_id');window.crmModules?.logout?.();state.navMoreOpen=false;
 $('#detail').close();$('#detail').innerHTML='';$('#action').close();$('#action').innerHTML='';loginScreen();
}
function shell() {
 const identity=window.CRMBranding?.identity()||{name:t('title'),subtitle:t('subtitle')};
 document.title=identity.name;document.documentElement.lang=locale;document.body.classList.toggle('crm-staff',!!state.user);
 const views=state.user?[...(window.crmModules?.views(state.user)||[]),...(has('trash')?['requests','trash']:[]),...(has('audit')?['audit']:[])]:[];
 const primary=[['home','home'],['tasks','tasks'],['clients','clients'],['leads','leads'],['qualityDesk','qualityDesk'],['orderList','orders'],['reports','analyticsNav']].filter(([key])=>views.includes(key));
 const omitted=new Set([...primary.map(([key])=>key),'kanban','appearance']);const more=views.filter(v=>!omitted.has(v));
 const navButton=(view,label)=>'<button type="button" data-view="'+view+'" aria-current="'+(state.view===view||(view==='orderList'&&state.view==='kanban')?'page':'false')+'">'+esc(t(label||view))+'</button>';
 $('#header').innerHTML='<div class="bar"><div class="brand"><img data-brand-logo alt="" '+(identity.logo?'src="'+esc(identity.logo)+'"':'hidden')+'><div class="brand-text"><span data-brand-name>'+esc(identity.name)+'</span><small data-brand-subtitle '+(!identity.subtitle?'hidden':'')+'>'+esc(identity.subtitle)+'</small></div></div><div class="header-controls"><div class="account-row">'+(state.user?'<div class="user">'+esc(state.user.full_name)+'<small>'+esc(t(state.user.role))+'</small></div>':'')+
 '<details class="account-settings" data-account-settings><summary aria-label="'+esc(t('settingsMenu'))+'" title="'+esc(t('settingsMenu'))+'"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M9 3.6 9.5 2h5l.5 1.6 1.7 1 1.6-.3 2.5 4.3-1.1 1.3v2l1.1 1.3-2.5 4.3-1.6-.3-1.7 1-.5 1.8h-5L9 18l-1.7-1-1.6.3-2.5-4.3 1.1-1.3v-2L3.2 8.4l2.5-4.3 1.6.3Z"/></svg></summary><div class="account-menu">'+(state.user?'<div class="account-identity">'+esc(state.user.full_name)+'<small>'+esc(t(state.user.role))+'</small></div>':'')+'<label class="language-switch" for="interface-language"><span>'+esc(t('language'))+'</span><span class="locale-control"><select id="interface-language" data-language aria-label="'+esc(t('language'))+'"><option value="ru" '+(locale==='ru'?'selected':'')+'>RU</option><option value="uz" '+(locale==='uz'?'selected':'')+'>UZ</option></select></span></label>'+
 (state.user?.role==='admin'?'<button type="button" data-view="appearance">'+esc(t('themeSettings'))+'</button>':'')+(state.user?button('logout','logout'):'')+'</div></details></div></div></div>'+
 (state.user?'<nav aria-label="'+esc(t('navigation'))+'">'+primary.map(([view,label])=>navButton(view,label)).join('')+
 (more.length?'<details class="nav-more" data-nav-more '+(state.navMoreOpen?'open':'')+'><summary>'+esc(t('moreSections'))+'</summary><p class="nav-help">'+esc(t('extraSectionsHint'))+'</p><div class="nav-groups">'+moduleGroups.map(([label,keys])=>{
 const allowed=keys.filter(v=>more.includes(v));return allowed.length?'<div class="nav-group"><span class="nav-group-title">'+esc(t(label))+'</span>'+allowed.map(v=>navButton(v,v==='stockroom'?'materials':v==='payrollDesk'?'payrollNav':v)).join('')+'</div>':'';
 }).join('')+more.filter(v=>!moduleHints.has(v)).map(v=>navButton(v)).join('')+'</div></details>':'')+'</nav>':'');
}
function loginScreen() {
 shell();
 $('#main').innerHTML=`<section class="box login"><h1>${esc(t('loginTitle'))}</h1><form data-form="login">${field('loginIdentifier','identifier','text','required autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254"')}${field('password','password','password','required minlength="6" autocomplete="current-password"')}<div class="error" data-error role="alert"></div><button class="primary">${esc(t('login'))}</button></form></section>`;
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
 return `<form class="filters" data-form="filters"><div class="field search"><label for="q">${esc(t('search'))}</label><input id="q" name="q" maxlength="120" value="${esc(f.q||'')}"></div><div class="field"><label for="status-filter">${esc(t('status'))}</label><select id="status-filter" name="status"><option value="">${esc(t('allStatuses'))}</option>${['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled'].map(v=>`<option value="${v}" ${f.status===v?'selected':''}>${esc(t(v))}</option>`).join('')}</select></div><button>${esc(t('filter'))}</button></form>`;
}
async function listScreen() {
 if(state.view!=='appearance')window.CRMBranding?.leave?.();
 shell();
 if(window.crmModules?.views(state.user).includes(state.view)){await window.crmModules.render(state.view);explainModule(state.view);return;}
 $('#main').innerHTML=`<div class="heading"><h1>${esc(t(state.view))}</h1><div class="actions">${has('create')&&state.view==='orders'?button('newOrder','new-order','class="primary"'):''}${button('refresh','refresh')}</div></div>${filterForm()}<div id="list" aria-live="polite"></div><div id="pagination"></div>`;
 await loadList();explainModule(state.view);
}
async function loadList(append=false) {
 if(window.crmModules?.views(state.user).includes(state.view)){await window.crmModules.render(state.view);explainModule(state.view);return;}
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
  return `<article class="card"><div class="row"><h2>${esc(o.code)}</h2>${statusPill(trash?o.deleted_status:o.status)}</div><strong>${esc(client?.name||t('noData'))}</strong><p>${esc(client?.phone||t('noData'))}</p><p class="muted">${esc(trash?o.delete_snapshot?.order?.address:o.address)}</p><strong>${orderPrice(o)}</strong>${trash?`<small>${esc(date(o.deleted_at))} · ${esc(o.delete_snapshot?.actor?.full_name||actor(o.deleted_by))}</small><p>${esc(o.delete_reason)}</p>`:o.delete_requested_at?`<span class="pill">${esc(t('pending'))}</span><p>${esc(o.delete_request_reason)}</p>`:''}${button('details','details',`data-id="${esc(o.id)}"`)}</article>`;
 }).join('')}</div>`;
 $('#pagination').innerHTML=state.cursor?button('more','more','class="more"'):'';
}
function paneCleanup(){
 document.body.classList.remove('detail-visible');$('#main').inert=false;$('#header').inert=false;
 state.detailRequest=(state.detailRequest||0)+1;state.pane=null;state.selected=null;
 const origin=state.detailOrigin;state.detailOrigin=null;
 if(origin&&origin.view===state.view)(window.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>{if($('#kanban'))$('#kanban').scrollLeft=origin.left;if(window.scrollY!==origin.y)window.scrollTo(0,origin.y);});
}
function closeDetail(){if($('#detail').open)$('#detail').close();paneCleanup();$('#detail').innerHTML='';}
function showPane(){
 if(!$('#detail').open){state.detailOrigin={view:state.view,y:window.scrollY,left:$('#kanban')?.scrollLeft||0};document.body.classList.add('detail-visible');if(typeof $('#detail').show==='function')$('#detail').show();else $('#detail').showModal();}
 const mobile=innerWidth<=950;$('#main').inert=mobile;$('#header').inert=mobile;$('#detail').scrollTop=0;
}
function clientMarkup(data){
 const c=data.client,address=data.addresses.find(a=>a.address===c.address)||data.addresses[0];
 state.clientDetail=data;
 return '<div class="client-overview"><h3>'+esc(c.name)+'</h3><p><a href="tel:'+esc(c.phone)+'">'+esc(c.phone)+'</a></p><p>'+esc(c.address)+'</p>'+
  (has('create')?button('newOrder','new-order-client','class="primary"'):'')+
  '<details><summary>'+esc(t('addresses'))+'</summary>'+data.addresses.map(a=>'<p>'+esc(a.address)+'</p>').join('')+'</details>'+
  '<details open><summary>'+esc(t('recentOrders'))+' · '+data.orders_count+'</summary><div class="client-order-list">'+data.orders.map(o=>'<button type="button" class="client-order-row" data-action="details" data-id="'+o.id+'"><strong>'+esc(o.code)+'</strong><span>'+esc(t(o.status))+'</span><span>'+orderPrice(o)+'</span></button>').join('')+'</div>'+
  (data.orders_count>data.orders.length?button('allClientOrders','client-orders','data-id="'+c.id+'"'):'')+'</details>'+
  (window.crmModules?.photoGallery?.({client_id:c.id,branch_id:data.branch_id,client:true})||'')+'</div>';
}
async function openClient(id,branch){
 if(!has('clients'))return;const request=state.detailRequest=(state.detailRequest||0)+1;
 const data=await api('/client-card/'+id+(branch?'?branch_id='+encodeURIComponent(branch):''));
 if(request!==state.detailRequest)return;state.selected=null;state.pane={kind:'client',id,branch};
 $('#detail').innerHTML='<div class="row dialog-head"><h2 id="detail-title">'+esc(t('client'))+'</h2>'+button('close','close-detail')+'</div>'+clientMarkup(data);
 showPane();
}
async function openDetail(id) {
 const request=state.detailRequest=(state.detailRequest||0)+1,trash=state.view==='trash',o=await api((trash?'/trash':'/orders')+'/'+id);
 if(request!==state.detailRequest)return;state.selected={...o,isTrash:trash};state.pane={kind:'order',id,trash};
 const d=trash?o.delete_snapshot?.order||o:o,client=trash?o.delete_snapshot?.client:o.client,items=trash?o.delete_snapshot?.items||[]:o.items;
 const closed=['cancelled','delivered'].includes(o.status),deleteBlocked=Number(o.paid_amount)>0||o.payment_recorded_at||o.washing_started_at||o.status==='delivered';
 const primary=!trash?(window.CRMWorkflow?.actions(o)||''):'';
 let extras=!trash?(window.crmModules?.orderActions?.(o)||''):'';
 if(primary&&extras.startsWith(primary))extras=extras.slice(primary.length);
 const dangerous='<div class="actions">'+(trash&&has('restore')?button('restore','restore','class="primary"'):'')+
  (!trash&&has('cancel')&&!closed?button('cancel','cancel','class="danger"'):'')+
  (!trash&&has('delete')&&!deleteBlocked?button('remove','delete','class="danger"'):'')+
  (!trash&&has('requestDeletion')&&o.status==='new'&&!o.delete_requested_at&&!deleteBlocked?button('requestDeletion','request-deletion'):'')+'</div>';
 $('#detail').innerHTML='<div class="row dialog-head"><div><h2 id="detail-title">'+esc(o.code)+'</h2>'+statusPill(trash?o.deleted_status:o.status)+'</div>'+button('close','close-detail')+'</div>'+
  '<div class="detail-tabs" role="tablist" aria-label="'+esc(t('details'))+'"><button type="button" role="tab" aria-selected="true" data-detail-tab="order">'+esc(t('orderTab'))+'</button>'+
  (!trash&&has('clients')?'<button type="button" role="tab" aria-selected="false" data-detail-tab="client">'+esc(t('client'))+'</button>':'')+
  '<button type="button" role="tab" aria-selected="false" data-detail-tab="history">'+esc(t('history'))+'</button></div>'+
  '<section data-detail-pane="order"><div class="detail-grid"><div><small>'+esc(t('client'))+'</small><strong>'+esc(client?.name)+'</strong>'+esc(client?.phone)+'</div><div><small>'+esc(t('address'))+'</small><strong>'+esc(d.address)+'</strong></div><div><small>'+esc(t('sum'))+'</small><strong>'+orderPrice(d)+'</strong></div><div><small>'+esc(t('paid'))+'</small><strong>'+money(d.paid_amount)+'</strong></div></div>'+
  (primary?'<div class="stage-action">'+primary+'</div>':'')+
  '<div data-order-extra>'+
  (trash?'<details><summary>'+esc(t('snapshot'))+'</summary>'+items.map(i=>'<p>'+esc(t(i.tariff_code))+' · '+esc(i.length_m??i.quantity??'')+' '+(i.length_m?'× '+esc(i.width_m):'')+' · '+money(i.price)+'</p>').join('')+'</details>':(window.crmModules?.photoGallery?.({order_id:o.id})||''))+
  '</div><details class="secondary-actions"><summary>'+esc(t('moreActions'))+'</summary>'+extras+dangerous+
  (!trash&&deleteBlocked?'<p class="muted">'+esc(t('blockedDeletion'))+'</p>':'')+'</details></section>'+
  '<section data-detail-pane="client" hidden></section>'+
  '<section data-detail-pane="history" hidden>'+
  (trash?'<div class="notice">'+esc(t('deletedAt'))+': '+esc(date(o.deleted_at))+'<p>'+esc(o.delete_reason)+'</p></div>':'')+
  (o.cancelled_at?'<div class="notice">'+esc(t('cancelledAt'))+': '+esc(date(o.cancelled_at))+'<p>'+esc(o.cancel_comment)+'</p></div>':'')+
  '<ul class="status-history">'+(o.history||[]).map(h=>'<li>'+esc(date(h.created_at))+' — '+esc(t(h.status))+(h.note?'<small>'+esc(text(h.note))+'</small>':'')+'</li>').join('')+'</ul></section>';
 showPane();if(!trash)await window.crmModules?.afterOrderDetail?.(o);
}
async function changeDetailTab(tab){
 $('#detail').querySelectorAll('[data-detail-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.detailTab===tab)));
 $('#detail').querySelectorAll('[data-detail-pane]').forEach(p=>p.hidden=p.dataset.detailPane!==tab);
 if(tab==='client'&&state.selected&&has('clients')){
  const o=state.selected,target=$('#detail [data-detail-pane=client]');if(target.dataset.loaded)return;target.textContent=t('loading');
  try{const data=await api('/client-card/'+o.client_id+'?branch_id='+encodeURIComponent(o.branch_id));if(state.selected?.id!==o.id||!target.isConnected)return;target.innerHTML=clientMarkup(data);target.dataset.loaded='true';}catch(e){if(target.isConnected)target.textContent=e.message;}
 }
}

function actionForm(kind) {
 const o=state.selected;
 const title={cancel:'cancel',delete:'remove','request-deletion':'requestDeletion'}[kind];
 $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t(title))} · ${esc(o.code)}</h2>${button('close','close-action')}</div><form data-form="${kind}">
  ${kind==='cancel'?`<div class="field"><label for="reason_code">${esc(t('cancelReason'))}</label><select id="reason_code" name="reason_code" required><option value="">${esc(t('chooseReason'))}</option>${state.reasons.map(r=>`<option value="${esc(r.code)}">${esc(localizedName(r))}</option>`).join('')}</select></div><div class="field"><label for="comment">${esc(t('comment'))}</label><textarea id="comment" name="comment" maxlength="1000" required></textarea></div><p class="muted">${esc(t('moneyHint'))}</p><div class="two">${field('workAmount','completed_work_amount','number','min="0" max="999999999999" step="1" value="0" required')}${field('paymentAmount','payment_amount','number','min="0" max="999999999999" step="1" value="0" required')}</div>`:`<p class="muted">${esc(t(kind==='delete'?'deleteHint':'requestHint'))}</p><div class="field"><label for="reason">${esc(t('reason'))}</label><textarea id="reason" name="reason" maxlength="500" required>${esc(o.delete_request_reason||'')}</textarea></div>`}
  <div data-error class="error" role="alert"></div><button class="primary">${esc(t('save'))}</button></form>`;
 $('#action').showModal();
}
let itemSequence=0;
function itemFields() {
 const seq=++itemSequence;
 return `<fieldset data-item><legend>${esc(t('product'))}</legend><div class="two"><label>${esc(t('productType'))}<select name="tariff" required>${state.tariffs.map(r=>`<option value="${esc(r.code)}">${esc(localizedName(r))} · ${money(r.price_per_m2)} / ${esc(t(r.unit==='piece'?'piece':'m2'))}</option>`).join('')}</select></label>${field('quantity','quantity','number','min="1" max="30" step="1" value="1" required',`quantity-${seq}`)}</div>${button('removeItem','remove-item')}</fieldset>`;
}
const orderDraftKey=()=>`crm:new-order:${state.user?.id}`;
function saveOrderDraft(form){
 if(!state.user||!form.isConnected||!$('#action').open)return;
 try{sessionStorage.setItem(orderDraftKey(),JSON.stringify({...orderBody(form),create_key:form.dataset.idempotencyKey}));}catch{}
}
function newOrder(prefill={},skipDraft=false) {
 let restored=false;
 if(!skipDraft&&!Object.keys(prefill).length){try{const draft=JSON.parse(sessionStorage.getItem(orderDraftKey())||'null');if(draft){prefill=draft;restored=true;}}catch{}}
 const source=prefill.source||window.crmModules?.sourceOptions?.().find(([code])=>code==='call_in')?.[0]||window.crmModules?.sourceOptions?.()[0]?.[0]||'call_in';
 $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t('newOrder'))}</h2>${button('close','close-action')}</div><form data-form="create">
  ${restored?`<p class="notice">${esc(t('orderDraftRestored'))} ${button('discardDraft','discard-order-draft')}</p>`:''}
  ${field('phone','phone','tel','value="+998" maxlength="32" required autocomplete="tel"')}<p data-client-status class="muted" role="status"></p>
  ${field('clientFullName','name','text','required maxlength="120" autocomplete="name"')}
  <input type="hidden" name="source" value="${esc(source)}">
  ${window.crmModules?.orderFields?.()||''}
  <p class="muted">${esc(t('operatorSimpleHint'))}</p><small>${esc(t('orderDraftHint'))}</small>
  <div data-error class="error" role="alert"></div><button class="primary">${esc(t('create'))}</button></form>`;
 const form=$('#action form');for(const key of ['name','phone'])if(prefill[key]!=null)form.elements[key].value=prefill[key];
 if(prefill.branch_id&&form.elements.branch_id)form.elements.branch_id.value=prefill.branch_id;
 window.crmModules?.fillAddress?.(form,prefill);
 form.dataset.idempotencyKey=prefill.create_key||crypto.randomUUID();
 $('#action').showModal();form.elements.phone.focus();
 if(/^(?:\+?998)?\d{9}$/.test(form.elements.phone.value.replace(/[\s()-]/g,'')))window.crmModules?.lookupInOrderForm(form,form.elements.phone.value).catch(()=>{});
}
function orderBody(form) {
 const d=new FormData(form);
 return {name:d.get('name'),phone:d.get('phone'),source:d.get('source')||'call_in',private_house:d.has('private_house'),
  ...Object.fromEntries(['branch_id','region_code','district_code','street','house','apartment','landmark'].filter(k=>d.get(k)).map(k=>[k,d.get(k)]))};
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
  else if(kind==='create') {await api('/orders',{method:'POST',body:orderBody(form),idempotencyKey:form.dataset.idempotencyKey});try{sessionStorage.removeItem(orderDraftKey());}catch{}await finishAction();}
  else {
   const path={cancel:'cancel','request-deletion':'deletion-request',delete:''}[kind];
   const body=kind==='cancel'?{...d,completed_work_amount:Number(d.completed_work_amount),payment_amount:Number(d.payment_amount)}:d;
   await api(`/orders/${state.selected.id}${path?`/${path}`:''}`,{method:kind==='delete'?'DELETE':'POST',body});await finishAction();
  }
 } catch(e){if(error?.isConnected)error.textContent=e.message;else toast(e.message);}
 finally{if(submit)submit.disabled=false;}
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('[data-nav-more]')&&event.target.isConnected)state.navMoreOpen=event.target.open;},true);
document.addEventListener('click',async event=>{
 const el=event.target.closest('button');if(!el||el.disabled)return;
 try {
  if(el.dataset.view){if(innerWidth<=950)state.navMoreOpen=false;state.view=el.dataset.view;state.filters={};await listScreen();return;}
  if(el.dataset.detailTab){await changeDetailTab(el.dataset.detailTab);return;}
  const action=el.dataset.action;
  if(action==='logout')logout();
  if(action==='refresh')await loadList();
  if(action==='more'){el.disabled=true;await loadList(true);}
  if(action==='details')await openDetail(el.dataset.id);
  if(action==='close-detail')closeDetail();
  if(action==='close-action')$('#action').close();
  if(['cancel','delete','request-deletion'].includes(action))actionForm(action);
  if(action==='restore'){el.disabled=true;await api(`/orders/${state.selected.id}/restore`,{method:'POST',body:{}});await finishAction();}
  if(action==='new-order')newOrder();
  if(action==='new-order-client'){const data=state.clientDetail,a=data.addresses.find(x=>x.address===data.client.address)||data.addresses[0]||{};newOrder({...a,name:data.client.name,phone:data.client.phone,...(data.branch_id?{branch_id:data.branch_id}:{})});}
  if(action==='client-orders'){const id=el.dataset.id;closeDetail();await window.CRMDashboard.clientOrders(id);}
  if(action==='discard-order-draft'){const previous=sessionStorage.getItem(orderDraftKey());sessionStorage.removeItem(orderDraftKey());newOrder({},true);if(previous){$('#action form').insertAdjacentHTML('afterbegin',`<button type="button" data-action="undo-order-draft">${esc(t('undo'))}</button>`);$('#action form')._discardedDraft=previous;}}
  if(action==='undo-order-draft'){sessionStorage.setItem(orderDraftKey(),el.closest('form')._discardedDraft);newOrder();}
  if(action==='add-item'&&$('#order-items').children.length<30)$('#order-items').insertAdjacentHTML('beforeend',itemFields());
  if(action==='remove-item'&&$('#order-items').children.length>1)el.closest('[data-item]').remove();
  if(action==='quote'){
   const form=el.closest('form');if(!form.reportValidity())return;el.disabled=true;
   const quote=await api('/quote',{method:'POST',body:orderBody(form)});$('#quote-result').textContent=quote.pending_measurements?t('priceAfterMeasurement'):`${t('sum')}: ${money(quote.total)}`;
  }
 }catch(e){toast(e.message);}finally{el.disabled=false;}
});
document.addEventListener('input',event=>{if(event.target.closest('[data-form=create]')&&$('#quote-result'))$('#quote-result').textContent='';});
document.addEventListener('change',async event=>{
 if(event.target.matches('[data-language]')){
  const next=event.target.value;if(next===locale)return;
  const login=$('[data-form=login]'),draft=login?{identifier:login.elements.identifier.value,password:login.elements.password.value}:null;
  if(!setLocale(next))return;
  try{if(location.pathname.startsWith('/track/'))await start();else if(state.user){const pane=state.pane;await listScreen();if(pane?.kind==='order')await openDetail(pane.id);else if(pane?.kind==='client')await openClient(pane.id,pane.branch);}else{loginScreen();if(draft)for(const [key,value]of Object.entries(draft))$('[data-form=login]').elements[key].value=value;}}
  catch(e){toast(e.message);}return;
 }
 const form=event.target.closest('[data-form=create]');if(!form||event.target.name!=='branch_id')return;
 const branch=event.target.value;
 try{const meta=await api('/workspaces/bootstrap?'+new URLSearchParams({branch_id:branch}));if(!form.isConnected||form.elements.branch_id.value!==branch)return;state.tariffs=meta.tariffs.filter(t=>t.active);
 for(const el of form.querySelectorAll('[name=tariff]')){const previous=el.value;el.innerHTML=state.tariffs.map(r=>`<option value="${esc(r.code)}">${esc(localizedName(r))} · ${money(r.price_per_m2)} / ${esc(t(r.unit==='piece'?'piece':'m2'))}</option>`).join('');if(state.tariffs.some(r=>r.code===previous))el.value=previous;}
 if($('#quote-result'))$('#quote-result').textContent='';
 }catch(e){toast(e.message);}
});
let phoneLookupTimer;
document.addEventListener('input',event=>{const form=event.target.closest('[data-form=create]');if(!form)return;saveOrderDraft(form);if(event.target.name==='phone'){clearTimeout(phoneLookupTimer);window.crmModules?.clearClientAutofill?.(form);const phone=event.target.value.replace(/[\s()-]/g,'');if(/^(?:\+?998)?\d{9}$/.test(phone))phoneLookupTimer=setTimeout(()=>window.crmModules?.lookupInOrderForm(form,phone).then(()=>saveOrderDraft(form)).catch(()=>{}),350);}});
document.addEventListener('change',event=>{const form=event.target.closest('[data-form=create]');if(form)saveOrderDraft(form);});
document.addEventListener('change',event=>{if(event.target.name==='saved_address'){const form=event.target.closest('[data-form=create]');if(form&&form.elements.address)form.elements.address.value=event.target.value;}});

async function start() {
 await window.CRMBranding?.load?.();
 document.title=window.CRMBranding?.identity().name||t('title');
 const token=location.pathname.match(/^\/track\/([^/]+)$/)?.[1];
 if(token){
  shell();$('#main').textContent=t('loading');
  try{const o=await api(`/public/track/${encodeURIComponent(token)}`);$('#main').innerHTML=`<section class="box"><h1>${esc(t('trackTitle'))} ${esc(o.code)}</h1><p class="muted">${esc(t('trackHint'))}</p>${statusPill(o.status)}<p>${orderPrice(o)}</p><ul>${(o.history||[]).map(h=>`<li>${esc(date(h.at))} — ${esc(t(h.status))}</li>`).join('')}</ul></section>`;}
  catch{$('#main').innerHTML=`<section class="box"><h1>${esc(t('trackTitle'))}</h1><p>${esc(t('trackUnavailable'))}</p></section>`;}
  return;
 }
 if(!state.token)return loginScreen();
 try{await initializeStaff();}catch(e){logout();toast(e.message);}
}
window.crmUI={api,user:()=>state.user,has,toast,openOrder:openDetail,openClient,closeDetail,newOrder,navigate:async view=>{state.view=view;state.filters={};await listScreen();},refresh:()=>listScreen(),download:async(path,filename)=>{const response=await fetch(`/api${path}`,{headers:{Authorization:`Bearer ${state.token}`}});if(!response.ok){const data=await response.json();throw new Error(data.error||t('error'));}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {nextCursor:response.headers.get('X-Next-Cursor')};},print:async path=>{const win=window.open('','_blank');if(!win)throw Error(t('popupBlocked'));try{const response=await fetch(`/api${path}`,{headers:{Authorization:`Bearer ${state.token}`}});if(!response.ok){const data=await response.json();throw Error(data.error||t('error'));}const html=await response.text();win.document.open();win.document.write(html);win.document.close();win.addEventListener('load',()=>win.print(),{once:true});}catch(e){win.close();throw e;}}};
$('#detail').setAttribute('aria-labelledby','detail-title');
$('#detail').addEventListener('close',()=>{if(!$('#detail').open)paneCleanup();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#detail').open&&!$('#action').open){e.preventDefault();closeDetail();}});
document.addEventListener('keydown',e=>{const menu=$('[data-account-settings]');if(e.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});
document.addEventListener('click',e=>{const menu=$('[data-account-settings]');if(menu?.open&&!menu.contains(e.target))menu.open=false;});
window.addEventListener('resize',()=>{if($('#detail').open){const mobile=innerWidth<=950;$('#main').inert=mobile;$('#header').inert=mobile;}});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
start();
