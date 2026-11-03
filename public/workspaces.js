import {t,money,date,localizedName} from './i18n.js';
(()=>{
 const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ui=()=>window.crmUI,has=p=>ui()?.has(p),user=()=>ui()?.user();
 const state={meta:{branches:[],catalogs:[],staff:[]},view:null,rows:[],cursor:null,filters:{},client:null,orders:[],admin:null,adminTab:'staff',showArchived:false,extra:[],form:null,request:0,camera:null};
 const button=(label,action,attrs='')=>`<button type="button" data-desk="${action}" ${attrs}>${esc(t(label))}</button>`;
 const localDate=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
 const localTime=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value).replace(' ','T');
 const staffName=id=>state.meta.staff.find(s=>s.id===id)?.full_name||t('unknown');
 const options=kind=>state.meta.catalogs.filter(c=>c.kind===kind&&c.active&&(!state.filters.branch_id||c.branch_id===state.filters.branch_id)).map(c=>[c.code,localizedName(c)]);
 let controlId=0;
 const select=(name,label,items,value='',required=false)=>{const id=`desk-${++controlId}`;return `<div class="field"><label for="${id}">${esc(t(label))}</label><select id="${id}" name="${name}" ${required?'required':''}><option value="">${esc(t('noData'))}</option>${items.map(([id,name])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(name)}</option>`).join('')}</select></div>`;};
 const field=(name,label,type='text',value='',extra='')=>{const id=`desk-${++controlId}`;return `<div class="field"><label for="${id}">${esc(t(label))}</label><input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${type==='tel'?'inputmode="tel" autocomplete="tel" placeholder="90 123 45 67" maxlength="32"':''} ${extra}>${type==='tel'?`<small>${esc(t('phoneHint'))}</small>`:''}</div>`;};
 const choices={outcome:['new','callback','no_result','refused'],direction:['in','out'],kind:['pickup','delivery'],method:['cash','terminal','bank'],role:['operator','driver','warehouse','washer','packer','admin'],channel:['sms','telegram'],locale:['ru','uz'],catalogKind:['source','zone','slot','defect','failure','tag','cancel_reason'],setting:['urgent_pct','stains_pct','pensioner_pct','delivery_fee','free_delivery_from']};
 const enumOptions=key=>choices[key].map(v=>Array.isArray(v)?v:[v,t(v)]);
 const unitChoices=()=>[['m2',t('m2')],['piece',t('piece')]];
 const price=o=>o.pricing_state==='awaiting_measurements'?esc(t('priceAfterMeasurement')):money(o.total);
 const forms={
  'order.measure':{title:'measureAndPrice',fields:[]},
  'lead.save':{title:'newLead',fields:[['phone','phone','tel',true],['name','name'],['source','source','source'],['outcome','outcome','outcome',true],['reason_code','cancelReason','reasons'],['comment','comment','textarea'],['callback_at','callback_at','datetime-local']]},
  'call.log':{title:'newCall',fields:[['phone','phone','tel',true],['direction','direction','direction',true],['outcome','outcome','callOutcome',true],['source','source','source'],['recording_url','recording','url']]},
  'task.save':{title:'newTask',fields:[['title','newTask','text',true],['due_at','due_at','datetime-local',true],['assigned_to','assigned_to','staff'],['note','note','textarea']]},
  'client.address':{title:'newAddress',fields:[['client_id','client','hidden'],['label','label'],['region_code','region','regions',true],['district_code','district','districts'],['street','street','text',true],['house','house','text',true],['private_house','privateHouse','checkbox'],['apartment','apartment'],['landmark','landmark']]},
  'order.defect':{title:'addDefect',fields:[['order_id','entity','hidden'],['item_id','item','items'],['defect_code','defect_code','defect',true],['note','note','textarea',true]]},
  'payment.record':{title:'collectPayment',fields:[['order_id','entity','hidden'],['amount','amount','number',true],['method','method','method',true],['note','note','textarea']]},
  'staff.create':{title:'newStaff',fields:[['email','email','email',true],['password','createPassword','password',true],['full_name','full_name','text',true],['role','role','role',true],['active','active','checkbox'],['branch_id','branch','branches'],['district_codes','driverDistricts','districtMulti'],['driver_color','driverColor','color']]},
  'staff.update':{title:'editStaff',fields:[['user_id','user_id','hidden'],['full_name','full_name','text',true],['phone','phone','tel'],['role','role','role',true],['active','active','checkbox'],['branch_id','branch','branches'],['district_codes','driverDistricts','districtMulti'],['driver_color','driverColor','color']]},
  'tariff.schedule':{title:'newTariff',fields:[['code','code','text',true],['name','name_ru','text',true],['price_per_m2','price_per_m2','number',true],['unit','unit','unit',true],['effective_at','effective_at','datetime-local',true],['active','active','checkbox'],['branch_id','branch','branches',true]]},
  'setting.schedule':{title:'newSetting',fields:[['key','key','setting',true],['value','value','number',true],['effective_at','effective_at','datetime-local',true],['branch_id','branch','branches',true]]},
  'catalog.save':{title:'newCatalog',fields:[['kind','kind','catalogKind',true],['code','code','text',true],['name_ru','name_ru','text',true],['name_uz','name_uz'],['active','active','checkbox'],['branch_id','branch','branches',true],['start','start','time'],['end','end','time'],['capacity','capacity','number']]},
  'template.save':{title:'newTemplate',fields:[['code','code','text',true],['channel','channel','channel',true],['locale','locale','locale',true],['body','body','textarea',true],['active','active','checkbox'],['branch_id','branch','branches',true]]},
  'branch.save':{title:'newBranch',fields:[['code','code','text',true],['name','name_ru','text',true],['address','address'],['phone','phone','tel'],['active','active','checkbox'],['workshop_capacity_m2','workshop_capacity_m2','number',true],['sla_hours','sla_hours','number',true]]},
  photo:{title:'photo',fields:[['item_id','item','items',true],['kind','kind','photoKind',true],['photo','photo','file',true]]},
 };
 for(const [entity,original,readonly] of [['branch','branch.save',[]],['catalog','catalog.save',['kind','code','branch_id']],['reason','catalog.save',['code']],['template','template.save',['branch_id']]]){
  const fields=entity==='reason'?forms[original].fields.filter(([key])=>['code','name_ru','name_uz','active'].includes(key)):forms[original].fields;
  forms[`admin.${entity}.update`]={title:'editRecord',command:'admin.update',fields:[['entity','kind','hidden'],...(entity==='reason'?[]:[['id','entity','hidden']]),...fields],readonly};
 }
 for(const action of ['archive','restore'])forms[`admin.${action}`]={title:action==='archive'?'archiveRecord':'restoreRecord',fields:[['entity','kind','hidden'],['id','entity','hidden'],['code','code','hidden'],['branch_id','branch','hidden']],transform:d=>d.entity==='tariff'?{entity:d.entity,code:d.code,branch_id:d.branch_id}:d.entity==='reason'?{entity:d.entity,code:d.code}:{entity:d.entity,id:d.id}};
 const availableViews=u=>[...new Set([
  ...(u.permissions.includes('clients')?['clients']:[]),...(u.permissions.includes('leads')?['leads']:[]),...(u.permissions.includes('calls')?['calls']:[]),
  ...(u.permissions.includes('tasks')?['tasks']:[]),
  ...(u.permissions.includes('staff')?['adminDesk']:[]),
  ...state.extra.filter(f=>u.permissions.includes(f.permission)&&(!f.roles||f.roles.includes(u.role))).map(f=>f.key),'queue'])];
 async function prepare(){
  try{state.meta=await ui().api('/workspaces/bootstrap');await window.CRMOffline?.snapshot(user().id,'bootstrap',state.meta).catch(()=>{});}
  catch(e){if(!e.network)throw e;state.meta=await window.CRMOffline?.read(user().id,'bootstrap').catch(()=>null)||state.meta;}
  window.CRMOffline?.sync(user().id,ui().api).catch(()=>{});
 }
 async function read(view,params={}){
  const key=`${view}:${JSON.stringify(params)}`;
  try{const data=await ui().api(`/workspaces/${view}?${new URLSearchParams(Object.entries(params).filter(([,v])=>v!==''&&v!=null))}`);await window.CRMOffline?.snapshot(user().id,key,data).catch(()=>{});return data;}
  catch(e){if(!e.network)throw e;const data=await window.CRMOffline?.read(user().id,key).catch(()=>null);if(data)return data;throw new Error(t('noOfflineData'));}
 }
 async function command(name,data,{queueable=false,key=crypto.randomUUID()}={}){
  try{return await ui().api(`/actions/${name}`,{method:'POST',body:data,idempotencyKey:key});}
  catch(e){if(queueable&&(e.network||!navigator.onLine)){try{await window.CRMOffline.enqueue(user().id,name,data,{id:key});ui().toast(t('queued'));return {queued:true};}catch{throw new Error(t('saveOfflineUnavailable'));}}throw e;}
 }
 function formOptions(type,prefill){
  if(type==='regions')return (state.meta.regions||[]).map(r=>[r.code,localizedName(r)]);
  if(type==='districts')return (state.meta.districts||[]).filter(r=>r.region_code===(prefill.region_code||'fergana')).map(r=>[r.code,localizedName(r)]);
  if(type==='branches')return state.meta.branches.filter(b=>b.active||b.id===prefill.branch_id).map(b=>[b.id,b.name]);
  if(type==='staff')return state.meta.staff.filter(s=>s.active).map(s=>[s.id,s.full_name]);
  if(type==='drivers')return state.meta.staff.filter(s=>s.active&&s.role==='driver').map(s=>[s.id,s.full_name]);
  if(type==='orders')return state.orders.map(o=>[o.id,`${o.code} · ${o.client?.name||''} · ${t(o.status)}`]);
  if(type==='items')return (prefill.items||[]).map(i=>[i.id,`${t('product')} ${i.seq} · ${state.meta.tariffs?.find(t=>t.code===i.tariff_code)?.name||i.tariff_code||''}`]);
  if(type==='reasons')return (window.crmReasons||[]).map(r=>[r.code,localizedName(r)]);
  if(type==='callOutcome')return ['ringing','answered','missed','no_result'].map(v=>[v,t(v)]);
  if(type==='photoKind')return [['intake',t('intake')],['ready',t('readyPhoto')]];
  if(['source','zone','slot','defect','failure'].includes(type))return options(type);
  return type==='unit'?unitChoices():choices[type]?enumOptions(type):null;
 }
 async function openForm(name,prefill={}){
  prefill=Object.fromEntries(Object.entries(prefill).filter(([,v])=>v!==undefined));
  if(forms[name]?.fields.some(f=>f[2]==='orders'))state.orders=(await ui().api('/orders?limit=100')).data;
  const definition=forms[name];if(!definition)return;
  prefill={region_code:'fergana',driver_color:'#f9a8d4',unit:'m2',active:true,source:'call_in',outcome:'new',direction:'in',scheduled_date:state.filters.date||state.meta.date||localDate(),due_at:localTime(),effective_at:localTime(),method:'cash',kind:name==='photo'?'intake':'pickup',role:'operator',channel:'sms',locale:'ru',branch_id:state.filters.branch_id||user().branch_id||state.meta.branches[0]?.id,workshop_capacity_m2:500,sla_hours:72,...prefill};
  if(name==='staff.create')prefill.active=false;if(name==='call.log')prefill.outcome='answered';
  state.form={name,prefill,key:crypto.randomUUID()};
  $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t(definition.title))}</h2>${button('close','close')}</div>${prefill.adminLabel?`<p><strong>${esc(prefill.adminLabel)}</strong></p>`:''}${name==='admin.archive'?`<p class="notice">${esc(t('adminArchiveHint'))}</p>`:''}${name==='tariff.schedule'&&prefill.adminLabel?`<p class="notice">${esc(t('tariffVersionHint'))}</p>`:''}<form data-desk-form="${name}">${definition.fields.map(([key,label,type='text',required=false])=>{
   const value=prefill[key]??prefill.config?.[key]??'';const opts=formOptions(type,prefill);
   if(type==='districtMulti')return `<div data-driver-field><label>${esc(t(label))}<select name="district_codes" multiple size="6">${(state.meta.districts||[]).map(d=>`<option value="${esc(d.code)}" ${(prefill.district_codes||[]).includes(d.code)?'selected':''}>${esc(localizedName(d))}</option>`).join('')}</select></label><small>${esc(t('driverDistrictHint'))}</small></div>`;
   if(type==='hidden')return `<input type="hidden" name="${key}" value="${esc(value)}">`;
   if(type==='orderLookup')return `<div class="field" data-order-lookup><label for="intake-order-search">${esc(t('findComplaintOrder'))}</label><input id="intake-order-search" type="search" data-order-search autocomplete="off" maxlength="120" placeholder="${esc(t('search'))}"><label for="intake-order-choice">${esc(t('chooseComplaintOrder'))}</label><select id="intake-order-choice" name="${key}" required><option value="">${esc(t('chooseComplaintOrder'))}</option></select><small role="status" data-order-lookup-status>${esc(t('complaintOrderHint'))}</small></div>`;
   if(opts)return select(key,label,opts,value,required);
   if(type==='textarea')return `<div class="field"><label for="desk-${key}">${esc(t(label))}</label><textarea id="desk-${key}" name="${key}" maxlength="1500" ${required?'required':''}>${esc(value)}</textarea></div>`;
   if(type==='checkbox')return `<label class="check"><input name="${key}" type="checkbox" ${value?'checked':''}>${esc(t(label))}</label>`;
   return field(key,label,type,value,`${required?'required':''} ${type==='number'?'step="any"':''} ${type==='file'?'accept="image/jpeg,image/png,image/webp" capture="environment"':''} ${type==='password'?'minlength="12" autocomplete="new-password"':''}`);
  }).join('')}<div class="error" data-desk-error role="alert"></div><button class="primary">${esc(t('save'))}</button></form>`;
  for(const key of definition.readonly||((name==='tariff.schedule'&&prefill.adminLabel)?['code','branch_id']:[])){
   const el=$('#action').querySelector(`[name="${key}"]`);if(el){const hidden=document.createElement('input');hidden.type='hidden';hidden.name=key;hidden.value=el.value;el.removeAttribute('name');el.disabled=true;el.after(hidden);}
  }
  if(name==='client.address')fillAddress($('#action form'),prefill);
  driverFields($('#action form'));$('#action').showModal();setupOrderLookup($('#action form'),prefill);
 }
 function setupOrderLookup(form,prefill){
  const input=form.querySelector('[data-order-search]');if(!input)return;
  const select=form.elements.order_id,status=form.querySelector('[data-order-lookup-status]'),owner=user().id;let request=0,timer;
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();select.focus();}});
  input.addEventListener('input',()=>{
   clearTimeout(timer);const current=++request,q=input.value.trim();select.innerHTML=`<option value="">${esc(t('chooseComplaintOrder'))}</option>`;form.querySelector('[data-desk-error]').textContent='';
   if(q.length<2){status.textContent=t('complaintOrderHint');return;}status.textContent=t('loading');
   timer=setTimeout(async()=>{try{
    const params=new URLSearchParams({q,branch_id:prefill.branch_id,limit:'20',offset:'0'}),data=await ui().api('/order-table?'+params);
    if(!form.isConnected||!$('#action').open||current!==request||user()?.id!==owner)return;
    select.innerHTML=`<option value="">${esc(t('chooseComplaintOrder'))}</option>`+(data.data||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.code)} · ${esc(o.client?.name||'')} · ${esc(o.client?.phone||'')} · ${esc(t(o.status))}</option>`).join('');
    status.textContent=t(data.data?.length?'complaintOrderFound':'complaintOrderEmpty');
   }catch(e){if(form.isConnected&&current===request&&user()?.id===owner)status.textContent=e.message;}},250);
  });
 }
 function driverFields(form){if(!form?.elements.role)return;const driver=form.elements.role.value==='driver';form.querySelectorAll('[data-driver-field]').forEach(el=>el.hidden=!driver);if(form.elements.district_codes)form.elements.district_codes.required=driver;if(form.elements.driver_color)form.elements.driver_color.closest('.field').hidden=!driver;}
 function readForm(form){
  const definition=forms[form.dataset.deskForm],d=new FormData(form),data={};
  for(const [key,,type='text'] of definition.fields){
   if(type==='file')continue;
   if(type==='districtMulti'){data[key]=form.elements.role.value==='driver'?d.getAll(key):[];continue;}
   if(type==='checkbox'){data[key]=d.has(key);continue;}
   const value=d.get(key);if(value==null||value==='')continue;
   data[key]=type==='number'?Number(value):type==='datetime-local'?`${value}${value.length===16?':00':''}+05:00`:value;
  }
  if(['catalog.save','admin.catalog.update'].includes(form.dataset.deskForm)){
   if(data.kind==='slot'){data.config={capacity:data.capacity||20,start:data.start||'09:00',end:data.end||'13:00'};}
   delete data.capacity;delete data.start;delete data.end;
  }
  if(form.dataset.deskForm==='staff.create')data.branch_id??=null;
  if(form.dataset.deskForm==='tariff.schedule'&&d.get('effective_at')===state.form.prefill.effective_at)data.effective_at=new Date().toISOString();
  return definition.transform?definition.transform(data):data;
 }
 async function photoBlob(file){
  if(!file||!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>15000000)throw new Error(t('photoInvalid'));
  const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(t('photoInvalid'))),'image/jpeg',.85));
 }
 let mapOrigin='',mapRequest=0;
 const mapKey=()=>`crm:driver-map:${user()?.id}`;
 const mapEnabled=()=>{try{return localStorage.getItem(mapKey())==='on';}catch{return false;}};
 function driverRoute(v){
  if(user()?.role!=='driver')return '';
  const destination=v.route_address||v.address,enabled=mapEnabled();
  const route=new URL('https://yandex.ru/map-widget/v1/');route.searchParams.set('mode','routes');route.searchParams.set('rtext',`${mapOrigin}~${destination}`);route.searchParams.set('rtt','auto');
  const nav=new URL('https://www.google.com/maps/dir/');nav.search=new URLSearchParams({api:'1',destination,travelmode:'driving',dir_action:'navigate'});
  return `<section class="driver-route"><label class="check"><input type="checkbox" data-driver-map ${enabled?'checked':''}>${esc(t('showRouteMap'))}</label>${enabled?`<p class="muted">${esc(t('driverRouteHint'))}</p>${button('routeFromHere','route-location')}<iframe class="destination-map" title="${esc(t('routeTo')+' '+v.code)}" src="${esc(route.href)}" referrerpolicy="no-referrer" loading="lazy" allow="geolocation"></iframe><a class="button" href="${esc(nav.href)}" target="_blank" rel="noreferrer">${esc(t('navigate'))}</a>`:''}</section>`;
 }
 function districtOptions(form,value=''){
  const region=form.elements.region_code?.value,el=form.elements.district_code;if(!el)return;
  const districts=(state.meta.districts||[]).filter(d=>d.region_code===region);
  el.innerHTML=`<option value="">${esc(t(districts.length?'chooseDistrict':'districtsLater'))}</option>`+districts.map(d=>`<option value="${esc(d.code)}">${esc(localizedName(d))}</option>`).join('');
  el.disabled=!districts.length;el.required=true;el.value=districts.some(d=>d.code===value)?value:'';
 }
 function apartmentState(form){const apartment=form.elements.apartment;if(!apartment)return;apartment.required=!form.elements.private_house?.checked;apartment.disabled=!!form.elements.private_house?.checked;if(apartment.disabled)apartment.value='';}
 function fillAddress(form,data={}){
  if(!form)return;for(const key of ['region_code','street','house','apartment','landmark'])if(data[key]!=null&&form.elements[key])form.elements[key].value=data[key];
  if(form.elements.private_house)form.elements.private_house.checked=!!data.private_house;districtOptions(form,data.district_code);apartmentState(form);
 }
 function addressFields(){return `<div data-address-fields><div class="two">${select('region_code','region',(state.meta.regions||[]).map(r=>[r.code,localizedName(r)]),'fergana',true)}${select('district_code','district',(state.meta.districts||[]).filter(d=>d.region_code==='fergana').map(d=>[d.code,localizedName(d)]),'',true)}</div>${field('street','street','text','','required maxlength="150" autocomplete="address-line1"')}<div class="two">${field('house','house','text','','required maxlength="30"')}${field('apartment','apartment','text','','required maxlength="30"')}</div><label class="check"><input type="checkbox" name="private_house">${esc(t('privateHouse'))}</label>${field('landmark','landmark','text','','maxlength="250"')}</div>`;}
 function photoGallery({order_id,client_id,branch_id,client=false}){
  if(!order_id&&!client_id)return '';
  const url=order_id?`/orders/${order_id}/photos`:`/clients/${client_id}/photos${branch_id?'?branch_id='+encodeURIComponent(branch_id):''}`;
  return `<details class="photo-gallery" data-photo-gallery data-url="${esc(url)}" data-owner="${esc(user()?.id)}"><summary>${esc(t(client?'viewClientPhotos':'viewPhotos'))}</summary><div data-gallery-content></div><div data-gallery-error class="error" role="alert"></div></details>`;
 }
 async function loadGallery(target,append=false){
  if(!target.open||target.dataset.owner!==user()?.id||target.dataset.loading)return;target.dataset.loading='true';
  const content=target.querySelector('[data-gallery-content]'),error=target.querySelector('[data-gallery-error]');error.textContent='';
  try{
   const path=target.dataset.url+(append?`${target.dataset.url.includes('?')?'&':'?'}cursor=${encodeURIComponent(target.dataset.cursor)}`:'');
   const result=await ui().api(path);if(!target.isConnected||!target.open||target.dataset.owner!==user()?.id)return;
   if(!append)content.innerHTML='';content.querySelector('[data-gallery-more]')?.remove();
   content.insertAdjacentHTML('beforeend',result.data.map(p=>`<figure class="photo-card"><figcaption>${esc(p.code)} · ${esc(t('product'))} ${esc(p.seq)} · ${esc(t(p.kind==='intake'?'intake':'readyPhoto'))}<small>${esc(date(p.created_at))}</small></figcaption>${p.url?`<a href="${esc(p.url)}" target="_blank" rel="noreferrer"><img data-gallery-photo src="${esc(p.url)}" loading="lazy" alt="${esc(t('product')+' '+p.seq)}"></a>`:`<p>${esc(t('photoUnavailable'))}</p>`}</figure>`).join('')||(!append?`<p>${esc(t('noPhotos'))}</p>`:''));
   target.dataset.cursor=result.next_cursor||'';if(result.next_cursor)content.insertAdjacentHTML('beforeend',`<button type="button" data-gallery-more>${esc(t('more'))}</button>`);
  }catch(e){if(error.isConnected)error.innerHTML=`${esc(e.message)} <button type="button" data-gallery-retry>${esc(t('retry'))}</button>`;}finally{delete target.dataset.loading;}
 }
 document.addEventListener('toggle',event=>{if(event.target.matches?.('[data-photo-gallery]')&&event.target.open)loadGallery(event.target);},true);
 document.addEventListener('click',event=>{const more=event.target.closest('[data-gallery-more],[data-gallery-retry]');if(more)loadGallery(more.closest('[data-photo-gallery]'),more.hasAttribute('data-gallery-more'));});
 document.addEventListener('error',event=>{if(event.target.matches?.('[data-gallery-photo]')){const text=document.createElement('p');text.textContent=t('photoUnavailable');event.target.closest('a').replaceWith(text);}},true);
 function renderRows(){
  const view=state.view,rows=state.rows;
  if(!rows.length){$('#desk-list').innerHTML=`<div class="box empty">${esc(t('empty'))}</div>`;return;}
  $('#desk-list').innerHTML=`<div class="cards">${rows.map(row=>`<article class="card"><strong>${esc(row.title||row.name||row.phone)}</strong><p>${esc(row.phone||row.note||row.comment||'')}</p>${view==='leads'?`<p class="intake-note">${esc(row.comment||'')}</p><small>${esc(t('acceptedBy'))}: ${esc(state.meta.staff.find(p=>p.id===row.created_by)?.full_name||t('unknown'))}</small>`:''}<span class="pill">${esc(t(row.outcome||row.status))}</span><small>${esc(date(row.due_at||row.callback_at||row.started_at||row.created_at))}</small>${row.recording_url?`<a href="${esc(row.recording_url)}" target="_blank" rel="noreferrer">${esc(t('recording'))}</a>`:''}${view==='tasks'&&row.status==='open'?button('complete','task-complete',`data-id="${row.id}"`):''}${view==='calls'?button('clientSearch','phone-client',`data-phone="${esc(row.phone)}"`)+(window.crmModules?.callActions?.(row)||''):''}</article>`).join('')}</div>`;
  $('#desk-pagination').innerHTML=state.cursor?button('more','more'):'';
 }
 async function load(append=false){
  const request=++state.request;
  const view=state.view;
  const response=await read(view,{...state.filters,...(append?{cursor:state.cursor}:{})});
  if(request!==state.request)return;
  state.rows=append?[...state.rows,...response.data]:response.data;state.cursor=response.next_cursor;renderRows();
 }
 async function renderClient(phone){
  const data=await read('client',{phone,...(state.filters.branch_id?{branch_id:state.filters.branch_id}:{})});state.client=data;
  $('#desk-list').innerHTML=data.client?`<section class="box"><h2>${esc(data.client.name)}</h2><p>${esc(data.client.phone)}</p><h3>${esc(t('addresses'))}</h3><ul>${data.addresses.map(a=>`<li>${esc(a.label)} ${esc(a.address)}</li>`).join('')}</ul>${button('newAddress','address')}${photoGallery({client_id:data.client.id,branch_id:state.filters.branch_id,client:true})}<h3>${esc(t('orders'))}</h3><div class="cards">${data.orders.map(o=>`<article class="card"><strong>${esc(o.code)}</strong><span class="pill">${esc(t(o.status))}</span><p>${price(o)}</p><p>${esc(o.address)}</p>${button('details','order',`data-order="${o.id}"`)}${button('repeatOrder','repeat',`data-id="${o.id}"`)}</article>`).join('')}</div></section>`:`<p class="muted">${esc(t('clientNotFound'))}</p>`;
 }
 const adminRows=()=>({staff:state.admin.staff.map(r=>({...r,entity:'staff'})),branches:state.admin.branches.map(r=>({...r,entity:'branch'})),tariffs:state.admin.tariffs.map(r=>({...r,entity:'tariff'})),catalogs:[...state.admin.catalogs.map(r=>({...r,entity:'catalog'})),...state.admin.reasons.map(r=>({...r,entity:'reason'}))],templates:state.admin.templates.map(r=>({...r,entity:'template'}))})[state.adminTab];
 const adminLabel=r=>r.full_name||localizedName(r)||r.code;
 function renderAdminRows(){
  const rows=adminRows().filter(r=>state.showArchived||!r.archived_at),branchName=id=>state.admin.branches.find(b=>b.id===id)?.name||t('noData');
  $('#desk-list').innerHTML=`<div class="admin-tabs" role="group" aria-label="${esc(t('adminSections'))}">${['staff','branches','tariffs','catalogs','templates'].map(tab=>button(tab,'admin-tab',`data-tab="${tab}" aria-pressed="${state.adminTab===tab}"`)).join('')}</div><label class="check"><input type="checkbox" data-admin-archived ${state.showArchived?'checked':''}>${esc(t('showArchived'))}</label><p class="muted">${esc(t('adminArchiveSummary'))}</p><div class="cards">${rows.map((r,index)=>`<article class="card" data-admin-entity="${r.entity}" data-admin-id="${esc(r.id||r.code)}"><div class="row"><h2>${esc(adminLabel(r))}</h2><span class="pill">${esc(t(r.archived_at?'archived':r.active?'active':'inactive'))}</span></div>${r.role?`<p>${esc(t(['operator','driver','warehouse','washer','packer','admin'].includes(r.role)?r.role:'retiredRole'))}</p>`:''}${r.code?`<small>${esc(r.code)}${r.kind?` · ${esc(t(r.kind))}`:''}</small>`:''}${r.branch_id?`<small>${esc(branchName(r.branch_id))}</small>`:''}${r.price_per_m2!=null?`<strong>${money(r.price_per_m2)} / ${esc(t(r.unit==='piece'?'piece':'m2'))}</strong><small>${esc(t('effective_at'))}: ${esc(date(r.effective_at))}</small>`:''}${r.body?`<p>${esc(r.body)}</p><small>${esc(t(r.channel))} · ${esc(t(r.locale))}</small>`:''}${r.address?`<p>${esc(r.address)}</p>`:''}<div class="actions">${r.archived_at?button('restoreRecord','admin-restore',`data-index="${index}"`):`${button('editRecord','admin-edit',`data-index="${index}"`)}${r.entity==='staff'?button('accessLink','access-link',`data-id="${r.id}"`):''}${button('archiveRecord','admin-archive',`data-index="${index}" class="danger" ${r.entity==='staff'&&r.id===user().id?'disabled':''}`)}`}</div></article>`).join('')||`<div class="box empty">${esc(t('empty'))}</div>`}</div>${state.adminTab==='tariffs'?`<details class="box"><summary>${esc(t('tariffVersions'))}</summary>${state.admin.tariff_versions.map(v=>`<p>${esc(v.name)} · ${esc(branchName(v.branch_id))} · ${money(v.price_per_m2)} · ${esc(date(v.effective_at))}</p>`).join('')}</details>`:''}${state.adminTab==='branches'?`<details class="box"><summary>${esc(t('settingVersions'))}</summary>${state.admin.setting_versions.map(v=>`<p>${esc(t(v.key))} · ${esc(v.value)} · ${esc(date(v.effective_at))}</p>`).join('')}</details>`:''}`;
 }
 async function renderAdmin(){state.admin=await read('admin');renderAdminRows();}
 async function renderQueue(){
  let rows=[];try{rows=await window.CRMOffline.list(user().id);}catch{}
  $('#desk-list').innerHTML=`<div class="cards">${rows.map(e=>`<article class="card"><strong>${esc(t(e.command==='photo'?'photo':e.command.split('.')[0]))}</strong><small>${esc(date(e.created_at))}</small>${e.error?`<p class="error">${esc(t('queueReview'))} ${esc(e.error)}</p>`:`<p>${esc(t('queued'))}</p>`}<div class="actions">${button('retry','queue-retry',`data-id="${e.id}"`)}${button('discard','queue-discard',`data-id="${e.id}"`)}</div></article>`).join('')||`<p class="muted">${esc(t('empty'))}</p>`}</div>`;
 }
 async function render(view){
  state.view=view;state.rows=[];state.cursor=null;
  const feature=state.extra.find(f=>f.key===view);if(feature){await feature.render($('#main'),{api:ui().api,meta:state.meta,command,openForm,read});return;}
  const actions=({leads:[['newLead','lead.save']],calls:[['newCall','call.log']],tasks:[['newTask','task.save']],adminDesk:[['newStaff','staff.create'],['newTariff','tariff.schedule'],['newSetting','setting.schedule'],['newCatalog','catalog.save'],['newTemplate','template.save'],['newBranch','branch.save']],queue:[['sync','sync']]})[view]||[];
  $('#main').innerHTML=`<div class="heading"><h1>${esc(t(view))}</h1><div class="actions">${actions.map(([label,name])=>button(label,'form',`data-form-name="${name}"`)).join('')}${button('refresh','refresh')}</div></div>${!navigator.onLine?`<p class="notice">${esc(t('offline'))}</p>`:''}
   ${view==='queue'||view==='adminDesk'?'':`<form class="filters" data-desk-filter>${user().role==='admin'?select('branch_id','branch',state.meta.branches.map(b=>[b.id,b.name]),state.filters.branch_id):''}${view==='clients'?field('phone','phone','tel',state.filters.phone||'+998'):''}<button>${esc(t(view==='clients'?'clientSearch':'filter'))}</button></form>`}<div id="desk-list" aria-live="polite">${esc(t('loading'))}</div><div id="desk-pagination"></div>`;
  if(view==='clients'){if(state.filters.phone)await renderClient(state.filters.phone);else $('#desk-list').textContent='';}
  else if(view==='adminDesk')await renderAdmin();else if(view==='queue')await renderQueue();else await load();
 }
 async function scan(){
  $('#action').innerHTML=`<div class="row"><h2>${esc(t('scan'))}</h2>${button('close','close')}</div><form data-desk-scan>${field('label','scanLabel','text','','required pattern="[Kk]-[0-9]+(-[0-9]+)?"')}<button class="primary">${esc(t('filter'))}</button></form>${button('startCamera','camera')}<video id="qr-camera" playsinline muted></video><p id="scan-result" role="status"></p>`;$('#action').showModal();
 }
 function stopCamera(){state.camera?.getTracks().forEach(track=>track.stop());state.camera=null;}
 async function startCamera(){
  try{
   if(!('BarcodeDetector' in window)||!navigator.mediaDevices)throw new Error();
   state.camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});const video=$('#qr-camera');video.srcObject=state.camera;await video.play();
   const detector=new BarcodeDetector({formats:['qr_code']});
   const loop=async()=>{if(!state.camera)return;try{const found=await detector.detect(video);if(found[0]){stopCamera();await resolveScan(found[0].rawValue);return;}}catch{}requestAnimationFrame(loop);};loop();
  }catch{$('#scan-result').textContent=t('cameraUnavailable');}
 }
 async function resolveScan(label){
  const data=await read('scan',{label:label.trim().toUpperCase()});stopCamera();$('#action').close();await ui().openOrder(data.order_id);
 }
 document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.hasAttribute('data-desk-filter')){event.preventDefault();state.filters=Object.fromEntries(new FormData(form));try{if(state.view==='clients')await renderClient(state.filters.phone);else await load();}catch(e){ui().toast(e.message);}return;}
  if(form.hasAttribute('data-desk-scan')){event.preventDefault();try{await resolveScan(new FormData(form).get('label'));}catch(e){$('#scan-result').textContent=e.message;}return;}
  if(!form.dataset.deskForm)return;event.preventDefault();const submit=form.querySelector('button:not([type=button])');if(submit.disabled)return;submit.disabled=true;
  try{
   const name=form.dataset.deskForm,data=readForm(form);
   if(name==='photo'){
    const blob=await photoBlob(new FormData(form).get('photo')),entry=await window.CRMOffline.enqueue(user().id,'photo',{}, {blob,item_id:data.item_id,kind:data.kind,id:state.form.key});await window.CRMOffline.sync(user().id,ui().api);const pending=(await window.CRMOffline.list(user().id)).find(e=>e.id===entry.id);if(pending?.state==='review')throw Error(t('photoNeedsRetry')+' '+(pending.error||''));ui().toast(t(pending?'photoQueued':'photoSaved'));
   }else if(name==='staff.create'){await ui().api('/staff/create',{method:'POST',body:data,idempotencyKey:state.form.key});ui().toast(t('staffCreated'));}
   else {const result=await command(forms[name].command||name,data,{queueable:['payment.record','order.defect'].includes(name),key:state.form.key});await forms[name].onResult?.(result,data);}
   const photoOrder=name==='photo'?state.form.prefill.order_id:null;await prepare();if(state.view)await render(state.view);if(photoOrder)await ui().openOrder(photoOrder);$('#action').close();
  }catch(e){form.querySelector('[data-desk-error]').textContent=e.message;const invalid=(e.fields||[]).map(path=>[...form.elements].find(el=>el.name===path)).filter(Boolean);for(const el of invalid)el.setAttribute('aria-invalid','true');invalid[0]?.focus();}finally{submit.disabled=false;}
 });
 document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-desk]');if(!el||el.disabled)return;el.disabled=true;
  try{
   const action=el.dataset.desk;
   if(action==='admin-tab'){state.adminTab=el.dataset.tab;renderAdminRows();}
   if(['admin-edit','admin-archive','admin-restore'].includes(action)){
    const row=adminRows().filter(r=>state.showArchived||!r.archived_at)[Number(el.dataset.index)],label=adminLabel(row);
    const target=row.entity==='tariff'?{entity:row.entity,code:row.code,branch_id:row.branch_id}:row.entity==='reason'?{entity:row.entity,code:row.code}:{entity:row.entity,id:row.id};
    if(action==='admin-archive')await openForm('admin.archive',{...target,adminLabel:label});
    else if(action==='admin-restore'){await command('admin.restore',target);ui().toast(t(row.entity==='staff'?'staffRestoredInactive':'recordRestored'));await prepare();await renderAdmin();}
    else if(row.entity==='staff')await openForm('staff.update',{...row,user_id:row.id});
    else if(row.entity==='tariff')await openForm('tariff.schedule',{...row,adminLabel:label,effective_at:localTime()});
    else await openForm(`admin.${row.entity}.update`,{...row,adminLabel:label});
   }
   if(action==='route-location'&&user().role==='driver'){const request=++mapRequest;navigator.geolocation?.getCurrentPosition(pos=>{if(request!==mapRequest||user()?.role!=='driver'||!mapEnabled())return;mapOrigin=`${pos.coords.latitude},${pos.coords.longitude}`;window.CRMWorkflow?.refreshMaps();},()=>ui().toast(t('routeLocationDenied')),{enableHighAccuracy:true,timeout:12000,maximumAge:60000});}
   if(action==='close'){stopCamera();$('#action').close();}
   if(action==='refresh')await render(state.view);
   if(action==='more')await load(true);
   if(action==='form'){const name=el.dataset.formName;if(name==='scan')await scan();else if(name==='sync'){await window.CRMOffline.sync(user().id,ui().api);await renderQueue();}else await openForm(name);}
   if(action==='order')await ui().openOrder(el.dataset.order);
   if(action==='defect-detail')await openForm('order.defect',{order_id:state.detailOrder.id,items:state.detailOrder.items});
   if(action==='payments'){
    const payments=await read('payments',{order_id:el.dataset.order});state.paymentOrder=el.dataset.order;
    $('#action').innerHTML=`<div class="row"><h2>${esc(t('paymentHistory'))}</h2>${button('close','close')}</div>${payments.data.map(p=>`<div class="items"><strong>${money(p.amount)}</strong> · ${esc(t(p.method))} · ${esc(t('payment_'+p.state))}<small>${esc(date(p.created_at))}</small>${p.state==='pending'&&user().role==='admin'?button('confirmPayment','payment-confirm',`data-id="${p.id}"`):''}</div>`).join('')||`<p>${esc(t('empty'))}</p>`}`;$('#action').showModal();
   }
   if(action==='payment-confirm'){await command('payment.confirm',{payment_id:el.dataset.id,confirm:true});$('#action').close();await ui().openOrder(state.paymentOrder);}
   if(action==='phone-client'){state.filters={phone:el.dataset.phone};await ui().navigate('clients');}
   if(action==='address')await openForm('client.address',{client_id:state.client.client.id});
   if(action==='repeat'){const previous=state.client.orders.find(o=>o.id===el.dataset.id);ui().newOrder({...state.client.client,...previous,phone:state.client.client.phone});}
   if(action==='task-complete'){await command('task.complete',{task_id:el.dataset.id});await load();}
   if(action==='payment')await openForm('payment.record',{order_id:el.dataset.order});
   if(action==='photo'){const o=await ui().api(`/orders/${el.dataset.order}`),next=o.items.find(i=>!i.photos?.some(p=>p.kind==='intake'))||o.items[0];await openForm('photo',{items:o.items,order_id:o.id,item_id:next?.id});}
   if(action==='staff-edit'){const person=state.admin.staff.find(p=>p.id===el.dataset.id);await openForm('staff.update',{...person,user_id:person.id});}
   if(action==='access-link'){const r=await ui().api(`/staff/${el.dataset.id}/access-link`,{method:'POST',body:{}});$('#action').innerHTML=`<h2>${esc(t('accessLink'))}</h2><p>${esc(t('accessLinkHint'))}</p><textarea readonly>${esc(r.action_link)}</textarea>${button('close','close')}`;$('#action').showModal();}
   if(action==='queue-retry'){await window.CRMOffline.retry(el.dataset.id,user().id);await window.CRMOffline.sync(user().id,ui().api);await renderQueue();}
   if(action==='queue-discard'){await window.CRMOffline.discard(el.dataset.id,user().id);await renderQueue();}
   if(action==='camera')await startCamera();
  }catch(e){ui().toast(e.message);}finally{el.disabled=false;}
 });
 document.addEventListener('change',event=>{const el=event.target,form=el.closest('form');if(el.name==='region_code'&&form)districtOptions(form);if(el.name==='private_house'&&form)apartmentState(form);if(el.matches('[data-driver-map]')&&user()?.role==='driver'){try{localStorage.setItem(mapKey(),el.checked?'on':'off');}catch{}if(!el.checked){mapOrigin='';mapRequest++;}window.CRMWorkflow?.refreshMaps();}if(el.name==='role'&&form)driverFields(form);if(el.name==='saved_structured_address'&&form){const address=state.savedAddresses?.find(a=>a.id===el.value);if(address)fillAddress(form,address);}});
 document.addEventListener('change',event=>{if(event.target.matches('[data-admin-archived]')){state.showArchived=event.target.checked;renderAdminRows();}});
 document.addEventListener('input',event=>event.target.removeAttribute?.('aria-invalid'));
 window.addEventListener('online',()=>{if(user())window.CRMOffline?.sync(user().id,ui().api).catch(()=>{});});
 window.addEventListener('crm-queue',()=>{if(!user())return;if(state.view==='queue')renderQueue().catch(()=>{});else window.CRMWorkflow?.refresh();});
 $('#action').addEventListener('close',stopCamera);
 window.crmModules={views:availableViews,home:()=> 'kanban',prepare,render,
  clearClientAutofill:form=>{
   const key=form.elements.phone.value.replace(/\D/g,'').slice(-9);
   if(form.dataset.clientPhone&&form.dataset.clientPhone!==key){for(const [name,value]of Object.entries(form._clientFilled||{})){const el=form.elements[name];if(!el)continue;if(el.type==='checkbox'){if(el.checked===value)el.checked=false;}else if(el.value===value)el.value=name==='region_code'?'fergana':'';}form.querySelector('[data-client-addresses]')?.remove();form.querySelector('[data-client-status]').textContent='';delete form.dataset.clientPhone;form._clientFilled={};districtOptions(form);apartmentState(form);}
  },
  lookupInOrderForm:async(form,phone)=>{
   const names=['name','region_code','district_code','street','house','apartment','landmark','private_house'],initial=Object.fromEntries(names.map(k=>[k,form.elements[k]?.type==='checkbox'?form.elements[k].checked:form.elements[k]?.value]));
   const request=(form._clientRequest||0)+1;form._clientRequest=request;
   const status=form.querySelector('[data-client-status]');if(status)status.textContent=t('clientLookupLoading');
   try{
    const data=await read('client',{phone});
    if(!form.isConnected||!form.closest('dialog')?.open||request!==form._clientRequest||form.elements.phone.value.replace(/\D/g,'').slice(-9)!==phone.replace(/\D/g,'').slice(-9))return;
    if(!data.client){if(status)status.textContent=t('newClientNumber');return;}
    const address=data.addresses.find(a=>a.address===data.client.address&&a.region_code&&a.district_code)||data.addresses.find(a=>a.region_code&&a.district_code),values={name:data.client.name,...(address||{})};
    const current=Object.fromEntries(names.map(k=>[k,form.elements[k]?.type==='checkbox'?form.elements[k].checked:form.elements[k]?.value]));
    const next={...current};for(const k of names)if(values[k]!=null&&current[k]===initial[k])next[k]=values[k];
    if(current.name===initial.name)form.elements.name.value=next.name||'';
    fillAddress(form,next);form._clientFilled=Object.fromEntries(names.map(k=>[k,form.elements[k]?.type==='checkbox'?form.elements[k].checked:form.elements[k]?.value]));form.dataset.clientPhone=phone.replace(/\D/g,'').slice(-9);
    if(status)status.textContent=t(address?'clientAutofilled':'clientAddressNeeded');
    state.savedAddresses=data.addresses;let target=form.querySelector('[data-client-addresses]');if(!target){target=document.createElement('div');target.dataset.clientAddresses='';form.querySelector('[data-address-fields]')?.before(target);}
    target.innerHTML=data.addresses.length>1?select('saved_structured_address','addresses',data.addresses.filter(a=>a.region_code&&a.district_code).map(a=>[a.id,`${a.label||''} ${a.address}`]),address?.id):'';
   }catch(e){if(status?.isConnected&&request===form._clientRequest)status.textContent=t('clientLookupFailed');}
  },
  logout:()=>{state.view=null;state.request++;mapOrigin='';mapRequest++;state.measuredItems=[];state.detailOrder=null;state.savedAddresses=[];stopCamera();},addFeature:feature=>state.extra.push(feature),
  orderFields:()=>`${user()?.role==='admin'?select('branch_id','branch',state.meta.branches.filter(b=>b.active).map(b=>[b.id,b.name]),user()?.branch_id||state.meta.branches[0]?.id,true):`<input type="hidden" name="branch_id" value="${esc(user()?.branch_id)}">`}${addressFields()}`,fillAddress,afterOrderDetail:o=>window.CRMWorkflow?.detail(o),
  openScan:scan,photoBlob,driverRoute,photoGallery,sourceOptions:()=>options('source'),getMeta:()=>state.meta,openForm,command,forms,choices,
  orderActions:o=>{state.detailOrder=o;return `${window.CRMWorkflow?.actions(o)||''}<div class="actions desk-order-actions">${has('defects')?button('addDefect','defect-detail'):''}${has('payments')&&o.pricing_state==='priced'?button('collectPayment','payment',`data-order="${o.id}"`):''}${['admin','operator','driver'].includes(user().role)?button('paymentHistory','payments',`data-order="${o.id}"`):''}</div>`;},
 };
})();
