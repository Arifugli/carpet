import {t,money,date,localizedName} from './i18n.js';
(()=>{
 const modules=window.crmModules,ui=()=>window.crmUI,$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={view:null,request:0,views:{home:{filters:{},offset:0},orderList:{filters:{},offset:0},clients:{filters:{},offset:0}},scroll:{},searchTimer:null};
 const active=()=>state.views[state.view],meta=()=>modules.getMeta(),user=()=>ui().user();
 const button=(label,action,attrs='')=>'<button type="button" data-dashboard="'+action+'" '+attrs+'>'+esc(t(label))+'</button>';
 const statuses=()=>user().role==='driver'?['new','pickup_planned','ready_for_delivery','in_transit','delivered','postponed']:({warehouse:['warehouse'],washer:['washing'],packer:['packing']})[user().role]||['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled'];
 const input=(name,label,type,value)=>'<label>'+esc(t(label))+'<input name="'+name+'" type="'+type+'" value="'+esc(value||'')+'" '+(['min_price','max_price'].includes(name)?'min="0" step="1"':'')+'></label>';
 const select=(name,label,rows,value)=>'<label>'+esc(t(label))+'<select name="'+name+'"><option value="">'+esc(t('all'))+'</option>'+rows.map(([id,label])=>'<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
 const price=o=>o.pricing_state==='awaiting_measurements'?t('pricePendingShort'):money(o.total);
 function filters(){
  const f=active().filters,clients=state.view==='clients';
  return '<form data-dashboard-filter class="work-filters '+(user().role==='admin'?'work-filters-admin ':'')+(clients?'work-filters-clients':'')+'"><label class="work-search">'+esc(t('search'))+'<input type="search" name="q" maxlength="120" value="'+esc(f.q||'')+'" placeholder="'+esc(t('search'))+'"></label>'+
   (!clients?select('status','status',statuses().map(s=>[s,t(s)]),f.status):'')+
   (user().role==='admin'?select('branch_id','branch',meta().branches.map(b=>[b.id,b.name]),f.branch_id):'')+
   '<div class="filter-actions"><button>'+esc(t('filter'))+'</button>'+button('resetFilters','reset')+'</div>'+
   (!clients?'<details class="work-extra-filters"><summary>'+esc(t('moreFilters'))+'</summary><div class="work-filter-grid">'+input('from','stageFrom','date',f.from)+input('to','stageTo','date',f.to)+select('product','productType',['carpet','blanket','tushak'].map(s=>[s,t(s)]),f.product)+select('district_code','district',meta().districts.map(d=>[d.code,localizedName(d)]),f.district_code)+select('driver_id','driver',meta().staff.filter(p=>p.role==='driver').map(p=>[p.id,p.full_name]),f.driver_id)+select('operator_id','operator',meta().staff.filter(p=>p.role==='operator').map(p=>[p.id,p.full_name]),f.operator_id)+input('min_price','priceFrom','number',f.min_price)+input('max_price','priceTo','number',f.max_price)+'</div></details>':'')+'</form>';
 }
 function stageTotals(n){
  return '<details class="work-totals"><summary>'+esc(t('orderCount'))+': '+n.orders+' · '+money(n.amount)+'</summary><span>'+esc(t('carpet'))+': '+n.carpet_m2+' '+esc(t('m2'))+' · '+esc(t('blanket'))+': '+n.blankets+' '+esc(t('piece'))+' · '+esc(t('tushak'))+': '+n.tushaks+' '+esc(t('piece'))+'</span></details>';
 }
 function orderTable(rows){
  return '<div class="table-scroll work-table"><table data-order-table><thead><tr>'+['orderClient','status','deadline','responsible','sum'].map(k=>'<th>'+esc(t(k))+'</th>').join('')+'</tr></thead><tbody>'+rows.map(o=>'<tr><td><button class="text-button" data-dashboard="open" data-id="'+o.id+'"><strong>'+esc(o.code)+' · '+esc(o.client.name)+'</strong></button><small>'+esc(meta().districts.find(d=>d.code===o.district_code)?localizedName(meta().districts.find(d=>d.code===o.district_code)):o.street||'')+'</small></td><td><span class="pill '+o.status+'">'+esc(t(o.status))+'</span></td><td class="'+(o.is_overdue?'overdue':'')+'">'+esc(date(o.promised_at))+(o.is_overdue?'<small>'+esc(t('overdue'))+'</small>':'')+'</td><td>'+esc(o.responsible_name||t(o.responsible_role)||t('unknown'))+'</td><td class="amount">'+esc(price(o))+'</td></tr>').join('')+'</tbody></table>'+(!rows.length?'<div class="empty"><p>'+esc(t('emptyFiltered'))+'</p>'+button('showAllOrders','reset')+'</div>':'')+'</div>';
 }
 function clientTable(rows){
  return '<div class="table-scroll work-table"><table data-client-table><thead><tr>'+['client','phone','address','orderCount'].map(k=>'<th>'+esc(t(k))+'</th>').join('')+'</tr></thead><tbody>'+rows.map(c=>'<tr><td><button class="text-button" data-dashboard="client" data-id="'+c.id+'">'+esc(c.name)+'</button></td><td>'+esc(c.phone)+'</td><td>'+esc(c.address)+'</td><td>'+c.orders+'</td></tr>').join('')+'</tbody></table>'+(!rows.length?'<p class="empty">'+esc(t('clientNotFound'))+'</p>':'')+'</div>';
 }
 async function load(){
  const v=active();if(!v||!user())return;const view=state.view,request=++state.request;
  try{
   const params=new URLSearchParams(Object.entries({...v.filters,offset:v.offset,limit:50}).filter(([,x])=>x!==''&&x!=null));
   const data=await ui().api((view==='clients'?'/client-list':view==='home'?'/home':'/order-table')+'?'+params);
   if(request!==state.request||state.view!==view||!$('#work-results'))return;
   if(v.offset>=data.count&&v.offset>0){v.offset=Math.max(0,Math.floor(Math.max(0,data.count-1)/50)*50);return load();}
   if($('#home-tiles')){
    const keys=['warehouse','washer','packer'].includes(user().role)?['attention']:['attention','pickup_today','ready'];
    $('#home-tiles').innerHTML=keys.map(k=>'<button type="button" class="home-tile" data-dashboard="focus" data-focus="'+k+'" aria-pressed="'+(v.filters.focus===k)+'"><span>'+esc(t('tile_'+k))+'</span><strong>'+data.tiles[k]+'</strong></button>').join('');
   }
   document.querySelectorAll('[data-dashboard=scope]').forEach(b=>b.setAttribute('aria-pressed',String((v.filters.scope||'all')===b.dataset.scope)));
   $('#work-results').innerHTML=(data.totals?stageTotals(data.totals):'')+(view==='clients'?clientTable(data.data):orderTable(data.data));
   $('#work-page').innerHTML='<span>'+esc(t('shownRows'))+': '+(data.count?v.offset+1:0)+'–'+Math.min(v.offset+data.data.length,data.count)+' / '+data.count+'</span><div class="actions">'+(data.previous_offset!=null?button('previousPage','page','data-offset="'+data.previous_offset+'"'):'')+(data.next_offset!=null?button('nextOrders','page','data-offset="'+data.next_offset+'"'):'')+'</div>';
   $('#work-updated').textContent=t('updatedAt')+' '+date(data.generated_at||new Date().toISOString());
  }catch(e){if(request===state.request&&$('#work-results'))$('#work-results').innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>';}
 }
 async function render(view,main){
  const clients=view==='clients';
  main.innerHTML='<section data-work-view="'+view+'"><div class="heading"><div><h1>'+esc(t(view))+'</h1><small id="work-updated" role="status"></small></div><div class="actions">'+(ui().has('create')?button('newOrder','create','class="primary"'):'')+(['warehouse','washer','packer'].includes(user().role)?button('scan','scan'):'')+button('refresh','refresh')+'</div></div>'+(view==='home'?'<p class="work-hint">'+esc(t(['warehouse','washer','packer'].includes(user().role)?'homeStageHint':user().role==='driver'?'homeDriverHint':'homeAllHint'))+'</p>':'')+filters()+
   (view==='home'?'<div id="home-tiles" class="home-tiles"></div>':'')+
   (!clients?'<div class="work-mode">'+(view==='home'?'<div class="work-scope" role="group" aria-label="'+esc(t('orderScope'))+'">'+button('allOrders','scope','data-scope="all" aria-pressed="true"')+button('activeOrders','scope','data-scope="active" aria-pressed="false"')+'</div>':'<span>'+esc(t('orders'))+'</span>')+'<div class="actions mode-switch"><button type="button" aria-pressed="true">'+esc(t('tableView'))+'</button><button type="button" data-view="kanban">'+esc(t('kanban'))+'</button></div></div>':'')+
   '<div id="work-results" aria-live="polite">'+esc(t('loading'))+'</div><div id="work-page" class="row work-pagination"></div></section>';
  await load();
 }
 for(const view of ['home','orderList','clients'])modules.addFeature({key:view,permission:view==='clients'?'clients':'read',render:main=>render(view,main)});
 modules.home=()=> 'home';
 const original=modules.render;
 modules.render=async view=>{
  if(state.view)state.scroll[state.view]={y:window.scrollY,left:$('#kanban')?.scrollLeft||0};
  state.view=view;state.request++;await original(view);
  const saved=state.scroll[view];if(saved)(window.requestAnimationFrame||((fn)=>setTimeout(fn,0)))(()=>{if(state.view!==view)return;if($('#kanban'))$('#kanban').scrollLeft=saved.left;if(window.scrollY!==saved.y)window.scrollTo(0,saved.y);});
 };
 const logout=modules.logout;modules.logout=()=>{state.view=null;state.request++;state.views={home:{filters:{},offset:0},orderList:{filters:{},offset:0},clients:{filters:{},offset:0}};state.scroll={};clearTimeout(state.searchTimer);logout();};
 document.addEventListener('submit',async e=>{if(!e.target.matches('[data-dashboard-filter]'))return;e.preventDefault();const v=active();const next=Object.fromEntries([...new FormData(e.target)].filter(([,x])=>x!==''));v.filters={...next,...(v.filters.client_id?{client_id:v.filters.client_id}:{}),...(v.filters.focus?{focus:v.filters.focus}:{}),...(v.filters.scope==='active'&&!['delivered','cancelled'].includes(next.status)?{scope:'active'}:{})};v.offset=0;await load();});
 document.addEventListener('input',e=>{if(!e.target.matches('[data-dashboard-filter] [name=q]'))return;clearTimeout(state.searchTimer);const form=e.target.form;state.searchTimer=setTimeout(()=>{if(form.isConnected)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));},350);});
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-dashboard]');if(!b||b.disabled)return;const action=b.dataset.dashboard;
  try{
   if(action==='open')await ui().openOrder(b.dataset.id);
   if(action==='client')await ui().openClient(b.dataset.id,active().filters.branch_id);
   if(action==='create')ui().newOrder();
   if(action==='scan')await modules.openScan();
   if(action==='refresh')await load();
   if(action==='page'){active().offset=Number(b.dataset.offset);await load();}
   if(action==='scope'){const v=active();v.filters.scope=b.dataset.scope;if(b.dataset.scope==='active'&&['delivered','cancelled'].includes(v.filters.status)){delete v.filters.status;document.querySelector('[data-dashboard-filter] [name=status]').value='';}v.offset=0;await load();}
   if(action==='reset'){active().filters={};active().offset=0;await ui().refresh();}
   if(action==='focus'){const v=active();if(v.filters.focus===b.dataset.focus)delete v.filters.focus;else v.filters.focus=b.dataset.focus;v.offset=0;await load();}
  }catch(err){ui().toast(err.message);}
 });
 window.CRMDashboard={refresh:load,clientOrders:async id=>{state.views.orderList={filters:{client_id:id},offset:0};await ui().navigate('orderList');}};
 setInterval(()=>{if(active()&&!document.hidden&&!$('#action').open&&!$('#detail').open)load();},15000);
})();
