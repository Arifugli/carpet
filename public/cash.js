import {t,money,date,localizedName,intlLocale} from './i18n.js';
(()=>{
 const modules=window.crmModules,ui=()=>window.crmUI,$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={active:false,request:0,branch:null,day:null,data:null,expanded:new Set(),detail:new Map(),monthOpen:false,month:null};
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
 const dayLabel=v=>new Intl.DateTimeFormat(intlLocale(),{timeZone:'Asia/Tashkent',dateStyle:'medium'}).format(new Date(v+'T12:00:00+05:00'));
 const user=()=>ui().user(),admin=()=>user()?.role==='admin';
 const btn=(label,action,attrs='')=>'<button type="button" data-cash="'+action+'" '+attrs+'>'+esc(t(label))+'</button>';
 const params=extra=>new URLSearchParams({branch_id:state.branch,day:state.day||today(),...extra});
 const card=(label,value)=>'<div data-cash-metric="'+label+'"><span>'+esc(t(label))+'</span><strong>'+esc(value)+'</strong></div>';
 const amountText=n=>money(Number(n||0));
 function table(rows){
  return '<div class="table-scroll cash-orders"><table><thead><tr>'+['code','cashDeliveryValue','cashDriverReceived','cashClientDebt'].map(k=>'<th>'+esc(t(k))+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr><td>'+(r.can_open?'<button type="button" class="text-button" data-cash="order" data-id="'+r.order_id+'">'+esc(r.code)+'</button>':'<strong>'+esc(r.code)+'</strong>')+'</td><td>'+amountText(r.total)+'</td><td>'+amountText(r.driver_cash)+'</td><td>'+amountText(r.client_debt)+'</td></tr>').join('')+'</tbody></table></div>';
 }
 function detailMarkup(d){
  return (d.deliveries.length?table(d.deliveries):'<p class="muted">'+esc(t('cashNoDeliveries'))+'</p>')+
   (d.other_cash.length?'<details class="cash-other"><summary>'+esc(t('cashOtherReceipts'))+'</summary>'+d.other_cash.map(r=>'<div class="cash-log-row"><span>'+esc(r.code)+' · '+esc(date(r.received_at))+'</span><strong>'+amountText(r.amount)+'</strong></div>').join('')+'</details>':'')+
   (d.next_offset!=null?btn('more','details-more','data-driver="'+d.driver_id+'" data-offset="'+d.next_offset+'"'):'');
 }
 async function loadDetail(id,offset=0){
  const key=state.branch+':'+(state.day||today())+':'+id,target=$('[data-cash-detail="'+id+'"] [data-cash-orders]');if(!target)return;
  if(target.dataset.loading==='true')return;target.dataset.loading='true';
  const request=state.request;
  try{
   const d=await ui().api('/cash/details?'+params({driver_id:id,offset}));
   if(request!==state.request||!target.isConnected)return;
   const prior=state.detail.get(key);if(offset&&prior){d.deliveries=[...prior.deliveries,...d.deliveries];d.other_cash=[...prior.other_cash,...d.other_cash];}
   state.detail.set(key,d);target.innerHTML=detailMarkup(d);
  }catch(e){if(target.isConnected)target.innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>';}finally{if(target.isConnected)delete target.dataset.loading;}
 }
 function pendingMarkup(rows){
  if(!rows.length)return '';
  return '<section class="cash-pending"><h2>'+esc(t(admin()?'cashAwaitingReceive':'cashYourHandovers'))+'</h2>'+rows.map(r=>'<article class="cash-handover" data-handover="'+r.id+'"><div><strong>'+esc(r.driver_name)+'</strong><small>'+esc(dayLabel(r.business_day))+' · '+esc(t('cashDeliveredCount'))+': '+r.deliveries_count+'</small></div><strong>'+amountText(r.amount)+'</strong><div class="actions">'+
   (admin()?btn('cashAccept','accept','class="primary" data-id="'+r.id+'"')+btn('cashNotReceived','reject','data-id="'+r.id+'"'):
    btn('cashCancelHandover','cancel','data-id="'+r.id+'"'))+'</div></article>').join('')+'</section>';
 }
 function draw(d){
  const self=d.self,totals=admin()?d.totals:self;
  const root=$('#cash-results');if(!root)return;
  $('#cash-updated').textContent=t('updatedAt')+' '+date(d.generated_at);
  root.innerHTML='<div class="cash-kpis cash-daily-kpis">'+card('cashDeliveredCount',totals.deliveries_count)+card('cashDeliveryValue',amountText(totals.deliveries_total))+card(admin()?'cashToReceive':'cashToHandIn',amountText(totals.outstanding))+card(admin()?'cashAcceptedDaily':'cashHandedDaily',amountText(totals.accepted))+'</div>'+
   (!admin()?'<div class="cash-driver-action">'+
    (self.pending>0?'<p>'+esc(t('cashWaiting'))+': <strong>'+amountText(self.pending)+'</strong></p>':'')+
    (self.to_hand>0?btn('cashHanded','hand-in','class="primary"'):'<p class="muted">'+esc(t(self.pending>0?'cashWaitForAdmin':'cashNothingToHand'))+'</p>')+'</div>':
    (Number(d.admin_cash)>0?'<p class="muted">'+esc(t('cashAdminClientReceipts'))+': <strong>'+amountText(d.admin_cash)+'</strong></p>':''))+
   (Number(totals.client_debt)>0?'<p class="notice">'+esc(t('cashUnpaidWarning'))+' <strong>'+amountText(totals.client_debt)+'</strong></p>':'')+
   pendingMarkup(d.pending)+
   '<section class="cash-drivers"><h2>'+esc(t(admin()?'cashByDriver':'cashDailyDeliveries'))+'</h2>'+d.rows.map(r=>'<details class="cash-driver" data-cash-detail="'+r.driver_id+'" '+(state.expanded.has(r.driver_id)||!admin()?'open':'')+'><summary><strong><span class="cash-chevron" aria-hidden="true">›</span> '+esc(r.driver_name)+'</strong><span>'+r.deliveries_count+' '+esc(t('cashDeliveryCountShort'))+'</span><span>'+esc(t('cashToHandIn'))+': <strong>'+amountText(r.outstanding)+'</strong></span></summary><div class="cash-driver-summary"><span>'+esc(t('cashDeliveryValue'))+': '+amountText(r.deliveries_total)+'</span><span>'+esc(t('cashCollected'))+': '+amountText(r.collected)+'</span><span>'+esc(t('cashAlreadyAccepted'))+': '+amountText(r.accepted)+'</span></div><div data-cash-orders>'+esc(t('loading'))+'</div></details>').join('')+'</section>'+
   '<details class="cash-month" '+(state.monthOpen?'open':'')+'><summary>'+esc(t('cashMonthlyReport'))+'</summary><p class="muted">'+esc(t('cashMonthlyHint'))+'</p><form data-cash-month><label>'+esc(t('cashMonth'))+'<input name="month" type="month" value="'+esc(state.month||(state.day||today()).slice(0,7))+'" required></label><button>'+esc(t('filter'))+'</button></form><div data-cash-month-result></div></details>';
  root.querySelectorAll('[data-cash-detail][open]').forEach(el=>loadDetail(el.dataset.cashDetail));
  if(state.monthOpen)loadMonth();
 }
 async function load(){
  if(!state.active||!user())return;const request=++state.request;
  try{const d=await ui().api('/cash?'+params({}));if(request!==state.request||!state.active)return;state.data=d;draw(d);}
  catch(e){if(request===state.request&&$('#cash-results'))$('#cash-results').innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>';}
 }
 async function loadMonth(){
  const target=$('[data-cash-month-result]');if(!target)return;const request=state.request,month=state.month||(state.day||today()).slice(0,7);
  target.textContent=t('loading');
  try{
   const d=await ui().api('/cash/month?'+new URLSearchParams({branch_id:state.branch,month}));
   if(request!==state.request||!target.isConnected||month!==(state.month||(state.day||today()).slice(0,7)))return;
   target.innerHTML='<p><span class="pill">'+esc(t(d.closed?'cashMonthClosed':d.is_current?'cashMonthOpen':'cashMonthPending'))+'</span>'+(d.closed_at?' · '+esc(date(d.closed_at)):'')+'</p>'+
    '<div class="cash-kpis">'+card('cashDeliveredCount',d.totals.deliveries_count)+card('cashCollected',amountText(d.totals.collected))+card('cashToReceive',amountText(d.totals.outstanding))+'</div>'+
    '<div class="table-scroll"><table><thead><tr>'+['driver','cashDeliveredCount','cashDeliveryValue','cashCollected','cashAlreadyAccepted','cashToReceive'].map(k=>'<th>'+esc(t(k))+'</th>').join('')+'</tr></thead><tbody>'+d.rows.map(r=>'<tr><td>'+esc(r.driver_name)+'</td><td>'+r.deliveries_count+'</td><td>'+amountText(r.deliveries_total)+'</td><td>'+amountText(r.collected)+'</td><td>'+amountText(r.accepted)+'</td><td>'+amountText(r.outstanding)+'</td></tr>').join('')+'</tbody></table></div>';
  }catch(e){if(target.isConnected)target.textContent=e.message;}
 }
 modules.addFeature({key:'cashbox',permission:'payments',roles:['admin','driver'],render:async(main,{meta})=>{
  state.active=true;const branches=meta.branches.filter(b=>admin()||b.id===user().branch_id);
  if(!branches.some(b=>b.id===state.branch))state.branch=user().branch_id||branches[0]?.id;
  main.innerHTML='<div class="heading"><div><h1>'+esc(t('cashbox'))+'</h1><small id="cash-updated" role="status"></small></div><div class="actions">'+btn('cashToday','today')+btn('refresh','refresh')+'</div></div><p class="module-help" data-module-help="cashbox">'+esc(t('cashDailyHint'))+'</p>'+
   '<form class="cash-filters" data-cash-filter>'+(admin()?'<label>'+esc(t('branch'))+'<select name="branch_id">'+branches.map(b=>'<option value="'+b.id+'" '+(b.id===state.branch?'selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select></label>':'')+
   '<label>'+esc(t('cashWorkday'))+'<input name="day" type="date" required max="'+today()+'" value="'+esc(state.day||today())+'"></label><button>'+esc(t('filter'))+'</button></form><div id="cash-results" aria-live="polite">'+esc(t('loading'))+'</div>';
  await load();
 }});
 document.addEventListener('submit',async e=>{
  if(e.target.matches('[data-cash-filter]')){e.preventDefault();const f=Object.fromEntries(new FormData(e.target));state.day=f.day;state.branch=f.branch_id||user().branch_id;state.expanded.clear();state.detail.clear();state.month=null;await load();}
  if(e.target.matches('[data-cash-month]')){e.preventDefault();state.month=e.target.elements.month.value;await loadMonth();}
 });
 document.addEventListener('toggle',e=>{
  const el=e.target;if(!el.isConnected)return;
  if(el.matches?.('[data-cash-detail]')){if(el.open){state.expanded.add(el.dataset.cashDetail);const target=el.querySelector('[data-cash-orders]');if(!target.querySelector('table'))loadDetail(el.dataset.cashDetail);}else state.expanded.delete(el.dataset.cashDetail);}
  if(el.matches?.('.cash-month')){state.monthOpen=el.open;if(el.open)loadMonth();}
 },true);
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-cash]');if(!b||b.disabled)return;const action=b.dataset.cash;b.disabled=true;
  try{
   if(action==='refresh')await load();
   if(action==='today'){state.day=null;state.month=null;await ui().refresh();}
   if(action==='order')await ui().openOrder(b.dataset.id);
   if(action==='details-more')await loadDetail(b.dataset.driver,Number(b.dataset.offset));
   if(['hand-in','accept','reject','cancel'].includes(action)){
    const body=action==='hand-in'?{branch_id:state.branch,day:state.day||today(),expected_amount:Number(state.data.self.to_hand)}:action==='reject'?{reason:t('cashNotReceived')}:{};
    const path=action==='hand-in'?'/cash/hand-in':'/cash/'+b.dataset.id+'/'+action;
    await ui().api(path,{method:'POST',body,idempotencyKey:b.dataset.key||(b.dataset.key=crypto.randomUUID())});
    ui().toast(t(action==='hand-in'?'cashHandedSaved':action==='accept'?'cashAcceptedSaved':action==='reject'?'cashRejectedSaved':'cashCancelledSaved'));await load();
   }
  }catch(err){ui().toast(err.message);}finally{if(b.isConnected)b.disabled=false;}
 });
 const originalRender=modules.render;modules.render=async view=>{if(view!=='cashbox'){state.active=false;state.request++;}await originalRender(view);};
 const originalLogout=modules.logout;modules.logout=()=>{state.active=false;state.request++;state.branch=null;state.day=null;state.data=null;state.detail.clear();state.expanded.clear();state.monthOpen=false;state.month=null;originalLogout();};
 setInterval(()=>{if(state.active&&user()&&!document.hidden&&!$('#action').open&&!$('#detail').open)load();},15000);
})();

