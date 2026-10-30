import {t,money,date} from './i18n.js';
(()=>{
 const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ui=()=>window.crmUI,has=p=>ui()?.has(p),user=()=>ui()?.user();
 const state={meta:{branches:[],catalogs:[],staff:[]},view:null,rows:[],cursor:null,filters:{},client:null,orders:[],admin:null,adminTab:'staff',showArchived:false,extra:[],form:null,request:0,camera:null};
 const button=(label,action,attrs='')=>`<button type="button" data-desk="${action}" ${attrs}>${esc(t(label))}</button>`;
 const localDate=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
 const localTime=(value=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(value).replace(' ','T');
 const staffName=id=>state.meta.staff.find(s=>s.id===id)?.full_name||t('unknown');
 const options=kind=>state.meta.catalogs.filter(c=>c.kind===kind&&c.active&&(!state.filters.branch_id||c.branch_id===state.filters.branch_id)).map(c=>[c.code,c.name_ru]);
 let controlId=0;
 const select=(name,label,items,value='',required=false)=>{const id=`desk-${++controlId}`;return `<div class="field"><label for="${id}">${esc(t(label))}</label><select id="${id}" name="${name}" ${required?'required':''}><option value="">${esc(t('noData'))}</option>${items.map(([id,name])=>`<option value="${esc(id)}" ${String(id)===String(value)?'selected':''}>${esc(name)}</option>`).join('')}</select></div>`;};
 const field=(name,label,type='text',value='',extra='')=>{const id=`desk-${++controlId}`;return `<div class="field"><label for="${id}">${esc(t(label))}</label><input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${type==='tel'?'inputmode="tel" autocomplete="tel" placeholder="90 123 45 67" maxlength="32"':''} ${extra}>${type==='tel'?`<small>${esc(t('phoneHint'))}</small>`:''}</div>`;};
 const choices={outcome:['new','callback','no_result','refused'],direction:['in','out'],kind:['pickup','delivery'],method:['cash','terminal','bank'],role:['admin','manager','operator','dispatcher','driver','workshop'],channel:['sms','telegram'],locale:['ru','uz'],catalogKind:['source','zone','slot','defect','failure','tag','cancel_reason'],setting:['urgent_pct','stains_pct','pensioner_pct','delivery_fee','free_delivery_from']};
 const enumOptions=key=>choices[key].map(v=>Array.isArray(v)?v:[v,t(v)]);
 choices.unit=[['m2','м²'],['piece','шт.']];
 const price=o=>o.pricing_state==='awaiting_measurements'?esc(t('priceAfterMeasurement')):money(o.total);
 const forms={
  'order.measure':{title:'measureAndPrice',fields:[]},
  'item.measure':{title:'measureProduct',fields:[['item_id','product','hidden'],['expected_id','entity','hidden'],['length_m','length','number'],['width_m','width','number'],['reason','measurementReason','textarea']]},
  'lead.save':{title:'newLead',fields:[['phone','phone','tel',true],['name','name'],['source','source','source'],['outcome','outcome','outcome',true],['reason_code','cancelReason','reasons'],['comment','comment','textarea'],['callback_at','callback_at','datetime-local']]},
  'call.log':{title:'newCall',fields:[['phone','phone','tel',true],['direction','direction','direction',true],['outcome','outcome','callOutcome',true],['source','source','source'],['recording_url','recording','url']]},
  'task.save':{title:'newTask',fields:[['title','newTask','text',true],['due_at','due_at','datetime-local',true],['assigned_to','assigned_to','staff'],['note','note','textarea']]},
  'client.address':{title:'newAddress',fields:[['client_id','client','hidden'],['label','label'],['region_code','region','regions',true],['district_code','district','districts'],['street','street','text',true],['house','house','text',true],['private_house','privateHouse','checkbox'],['apartment','apartment'],['landmark','landmark']]},
  'visit.schedule':{title:'scheduleVisit',fields:[['order_id','entity','orders',true],['kind','kind','kind',true],['scheduled_date','date','date',true],['slot_code','slot','slot',true],['zone_code','zone','zone'],['driver_id','driver','drivers'],['position','position','number'],['note','note','textarea']]},
  'visit.problem':{title:'failedVisit',command:'visit.event',fields:[['visit_id','entity','hidden'],['event','action','hidden'],['expected_state','status','hidden'],['failure_reason','failure_reason','failure',true],['note','note','textarea']]},
  'workshop.defect':{title:'addDefect',fields:[['order_id','entity','hidden'],['item_id','item','items'],['defect_code','defect_code','defect',true],['note','note','textarea',true]]},
  'payment.record':{title:'collectPayment',fields:[['order_id','entity','hidden'],['amount','amount','number',true],['method','method','method',true],['note','note','textarea']]},
  'staff.create':{title:'newStaff',fields:[['email','email','email',true],['password','createPassword','password',true],['full_name','full_name','text',true],['role','role','role',true],['active','active','checkbox'],['branch_id','branch','branches']]},
  'staff.update':{title:'editStaff',fields:[['user_id','user_id','hidden'],['full_name','full_name','text',true],['phone','phone','tel'],['role','role','role',true],['active','active','checkbox'],['branch_id','branch','branches']]},
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
 const availableViews=u=>[
  ...(u.permissions.includes('clients')?['clients']:[]),...(u.permissions.includes('leads')?['leads']:[]),...(u.permissions.includes('calls')?['calls']:[]),
  ...(u.permissions.includes('tasks')?['tasks']:[]),...(u.permissions.includes('dispatch')?['dispatch']:[]),...(u.role==='driver'?['driverDesk']:[]),
  ...(u.permissions.includes('workshop')?['workshopDesk']:[]),...(u.permissions.includes('staff')?['adminDesk']:[]),
  ...state.extra.filter(f=>u.permissions.includes(f.permission)&&(!f.roles||f.roles.includes(u.role))).map(f=>f.key),'queue'];
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
  if(type==='regions')return (state.meta.regions||[]).map(r=>[r.code,r.name_ru]);
  if(type==='districts')return (state.meta.districts||[]).filter(r=>r.region_code===(prefill.region_code||'fergana')).map(r=>[r.code,r.name_ru]);
  if(type==='branches')return state.meta.branches.filter(b=>b.active||b.id===prefill.branch_id).map(b=>[b.id,b.name]);
  if(type==='staff')return state.meta.staff.filter(s=>s.active).map(s=>[s.id,s.full_name]);
  if(type==='drivers')return state.meta.staff.filter(s=>s.active&&s.role==='driver').map(s=>[s.id,s.full_name]);
  if(type==='orders')return state.orders.map(o=>[o.id,`${o.code} · ${o.client?.name||''} · ${t(o.status)}`]);
  if(type==='items')return (prefill.items||[]).map(i=>[i.id,`${t('product')} ${i.seq} · ${state.meta.tariffs?.find(t=>t.code===i.tariff_code)?.name||i.tariff_code||''}`]);
  if(type==='reasons')return (window.crmReasons||[]).map(r=>[r.code,r.name_ru]);
  if(type==='callOutcome')return ['ringing','answered','missed','no_result'].map(v=>[v,t(v)]);
  if(type==='photoKind')return [['intake',t('intake')],['ready',t('readyPhoto')]];
  if(['source','zone','slot','defect','failure'].includes(type))return options(type);
  return choices[type]?enumOptions(type):null;
 }
 async function openForm(name,prefill={}){
  prefill=Object.fromEntries(Object.entries(prefill).filter(([,v])=>v!==undefined));
  if(forms[name]?.fields.some(f=>f[2]==='orders')){state.orders=(await ui().api('/orders?limit=100')).data;if(name==='visit.schedule')state.orders=state.orders.filter(o=>!['cancelled','delivered'].includes(o.status));}
  const definition=forms[name];if(!definition)return;
  prefill={region_code:'fergana',unit:'m2',active:true,source:'call_in',outcome:'new',direction:'in',scheduled_date:state.filters.date||state.meta.date||localDate(),due_at:localTime(),effective_at:localTime(),method:'cash',kind:name==='photo'?'intake':'pickup',role:'operator',channel:'sms',locale:'ru',branch_id:state.filters.branch_id||user().branch_id||state.meta.branches[0]?.id,workshop_capacity_m2:500,sla_hours:72,...prefill};
  if(name==='staff.create')prefill.active=false;if(name==='call.log')prefill.outcome='answered';
  state.form={name,prefill,key:crypto.randomUUID()};
  $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t(definition.title))}</h2>${button('close','close')}</div>${prefill.adminLabel?`<p><strong>${esc(prefill.adminLabel)}</strong></p>`:''}${name==='admin.archive'?`<p class="notice">${esc(t('adminArchiveHint'))}</p>`:''}${name==='tariff.schedule'&&prefill.adminLabel?`<p class="notice">${esc(t('tariffVersionHint'))}</p>`:''}<form data-desk-form="${name}">${definition.fields.map(([key,label,type='text',required=false])=>{
   const value=prefill[key]??prefill.config?.[key]??'';const opts=formOptions(type,prefill);
   if(name==='item.measure'&&['length_m','width_m'].includes(key)&&prefill.unit==='piece')return '';
   if(type==='hidden')return `<input type="hidden" name="${key}" value="${esc(value)}">`;
   if(opts)return select(key,label,opts,value,required);
   if(type==='textarea')return `<div class="field"><label for="desk-${key}">${esc(t(label))}</label><textarea id="desk-${key}" name="${key}" maxlength="1500" ${required?'required':''}>${esc(value)}</textarea></div>`;
   if(type==='checkbox')return `<label class="check"><input name="${key}" type="checkbox" ${value?'checked':''}>${esc(t(label))}</label>`;
   return field(key,label,type,value,`${required?'required':''} ${type==='number'?'step="any"':''} ${type==='file'?'accept="image/jpeg,image/png,image/webp" capture="environment"':''} ${type==='password'?'minlength="12" autocomplete="new-password"':''}`);
  }).join('')}<div class="error" data-desk-error role="alert"></div><button class="primary">${esc(t('save'))}</button></form>`;
  for(const key of definition.readonly||((name==='tariff.schedule'&&prefill.adminLabel)?['code','branch_id']:[])){
   const el=$('#action').querySelector(`[name="${key}"]`);if(el){const hidden=document.createElement('input');hidden.type='hidden';hidden.name=key;hidden.value=el.value;el.removeAttribute('name');el.disabled=true;el.after(hidden);}
  }
  if(name==='client.address')fillAddress($('#action form'),prefill);
  $('#action').showModal();
 }
 function readForm(form){
  if(form.dataset.deskForm==='order.measure')return {order_id:form.dataset.order,items:[...form.querySelectorAll('[data-measure-item]')].filter(el=>el.dataset.unit==='m2'||el.querySelector('[name=confirm_piece]').checked).map(el=>({item_id:el.dataset.measureItem,expected_id:el.dataset.expected||null,...(el.dataset.unit==='m2'?{length_m:Number(el.querySelector('[name=length_m]').value),width_m:Number(el.querySelector('[name=width_m]').value)}:{}),...(el.querySelector('[name=reason]').value.trim()?{reason:el.querySelector('[name=reason]').value.trim()}:{})}))};
  const definition=forms[form.dataset.deskForm],d=new FormData(form),data={};
  for(const [key,,type='text'] of definition.fields){
   if(type==='file')continue;
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
  if(form.dataset.deskForm==='item.measure'){data.expected_id=d.get('expected_id')||null;}
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
  el.innerHTML=`<option value="">${esc(t(districts.length?'chooseDistrict':'districtsLater'))}</option>`+districts.map(d=>`<option value="${esc(d.code)}">${esc(d.name_ru)}</option>`).join('');
  el.disabled=!districts.length;el.required=region==='fergana';el.value=districts.some(d=>d.code===value)?value:'';
 }
 function apartmentState(form){const apartment=form.elements.apartment;if(!apartment)return;apartment.required=!form.elements.private_house?.checked;apartment.disabled=!!form.elements.private_house?.checked;if(apartment.disabled)apartment.value='';}
 function fillAddress(form,data={}){
  if(!form)return;for(const key of ['region_code','street','house','apartment','landmark'])if(data[key]!=null&&form.elements[key])form.elements[key].value=data[key];
  if(form.elements.private_house)form.elements.private_house.checked=!!data.private_house;districtOptions(form,data.district_code);apartmentState(form);
 }
 function addressFields(){return `<div data-address-fields><div class="two">${select('region_code','region',(state.meta.regions||[]).map(r=>[r.code,r.name_ru]),'fergana',true)}${select('district_code','district',(state.meta.districts||[]).filter(d=>d.region_code==='fergana').map(d=>[d.code,d.name_ru]),'',true)}</div>${field('street','street','text','','required maxlength="150" autocomplete="address-line1"')}<div class="two">${field('house','house','text','','required maxlength="30"')}${field('apartment','apartment','text','','required maxlength="30"')}</div><label class="check"><input type="checkbox" name="private_house">${esc(t('privateHouse'))}</label>${field('landmark','landmark','text','','maxlength="250"')}</div>`;}
 async function measurementPanel(o){
  const target=$('#detail [data-measurements]');if(!target||o.measurement_mode!=='verified')return;
  try{
   const items=await ui().api(`/orders/${o.id}/measurements`);if(state.detailOrder?.id!==o.id||!target.isConnected)return;state.measuredItems=items;
   const role=user().role,editable=!o.washing_started_at&&(role==='driver'?o.driver_measurement_closed_at==null&&['pending','picked_up'].includes(o.pickup_state):role==='workshop'&&o.status==='received'&&o.pickup_state==='accepted');
   target.innerHTML=`<h3>${esc(t('verifiedMeasurements'))}</h3><p class="muted">${esc(t('measurementHint'))}</p>`+items.map(i=>{
    const driver=i.measurements.find(m=>m.source_role==='driver'),shop=i.measurements.find(m=>m.source_role==='workshop'),own=role==='driver'?driver:shop;
    const show=m=>m?`${m.length_m!=null?`${esc(m.length_m)} × ${esc(m.width_m)} м · ${esc(m.area_m2)} м²`:esc(t('pieceConfirmed'))}<small>${esc(m.measured_name)} · ${esc(date(m.created_at))}</small>${m.reason?`<p>${esc(m.reason)}</p>`:''}`:esc(t('notMeasured'));
    return `<article class="items"><strong>${esc(t('product'))} ${i.seq} · ${esc(state.meta.tariffs?.find(t=>t.code===i.tariff_code)?.name||i.tariff_code)}</strong><p>${money(i.unit_rate)} / ${esc(t(i.unit==='piece'?'piece':'m2'))}</p><div class="two"><div>${esc(t('driver'))}: ${show(driver)}</div><div>${esc(t('workshop'))}: ${show(shop)}</div></div>${driver?.area_m2!=null&&shop?.area_m2!=null&&Math.abs(Number(driver.area_m2)-Number(shop.area_m2))>.01?`<p class="notice">${esc(t('areaDiscrepancy'))}: ${esc(Math.round((Number(shop.area_m2)-Number(driver.area_m2))*100)/100)} м²</p>`:''}${editable?button(own?'correctMeasurement':'measureProduct','measure',`data-id="${i.id}"`):''}<details><summary>${esc(t('measurementHistory'))}</summary>${i.measurements.map(m=>`<p>${esc(t(m.source_role))}: ${show(m)}</p>`).join('')||esc(t('empty'))}</details></article>`;
   }).join('');
  }catch(e){target.textContent=e.message;}
 }

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
 async function openMeasurements(orderId){
  const o=await ui().api(`/orders/${orderId}`),items=await ui().api(`/orders/${orderId}/measurements`),role=user().role;
  state.form={name:'order.measure',prefill:{order_id:orderId},key:crypto.randomUUID()};
  $('#action').innerHTML=`<div class="row dialog-head"><h2>${esc(t(role==='driver'?'measureAndPrice':'workshopMeasurements'))} · ${esc(o.code)}</h2>${button('close','close')}</div><form data-desk-form="order.measure" data-order="${o.id}"><p>${esc(t(role==='driver'?'driverMeasurementHint':'shopMeasurementHint'))}</p>${items.map(i=>{
   const own=i.measurements.find(m=>m.source_role===role);return `<fieldset data-measure-item="${i.id}" data-unit="${i.unit}" data-expected="${own?.id||''}"><legend>${esc(state.meta.tariffs?.find(t=>t.code===i.tariff_code)?.name||i.tariff_code)} · №${i.seq}</legend>${i.unit==='m2'?`<div class="two">${field('length_m','length','number',own?.length_m??'','required min="0.3" max="20" step="0.01"')}${field('width_m','width','number',own?.width_m??'','required min="0.3" max="20" step="0.01"')}</div>`:`<label class="check"><input name="confirm_piece" type="checkbox" required ${own?'checked':''}>${esc(t('confirmOnePiece'))}</label>`}${field('reason','measurementReason','text','','maxlength="500"')}<small>${money(i.unit_rate)} / ${esc(t(i.unit==='piece'?'piece':'m2'))}</small></fieldset>`;
  }).join('')}<p class="muted">${esc(t('priceFromServer'))}</p><div class="error" data-desk-error role="alert"></div><button class="primary">${esc(t(role==='driver'?'saveAndCalculate':'confirmMeasurements'))}</button></form>`;
  $('#action').showModal();
 }
 function pickupButtons(v){
  const ready=v.items_count>0&&v.driver_measured_count===v.items_count&&v.photo_items_count===v.items_count&&v.pricing_state==='priced';
  return `<p class="pickup-state">${esc(t('pickup_'+v.pickup_state))}</p><p class="muted">${esc(t('measurementsSaved'))}: ${v.driver_measured_count}/${v.items_count} · ${esc(t('photosUploaded'))}: ${v.photo_items_count}/${v.items_count}</p><div class="actions">${v.can_driver_measure?button('measureAndPrice','measure-order',`data-order="${v.order_id}" class="primary"`):''}${['pending','picked_up'].includes(v.pickup_state)?button('productPhotos','photo',`data-order="${v.order_id}"`):''}${v.pickup_state==='pending'?button('markPickup','pickup-collect',`data-order="${v.order_id}" class="primary" ${ready?'':'disabled'}`):''}${v.pickup_state==='picked_up'?button('handoverWorkshop','pickup-handover',`data-order="${v.order_id}" class="primary" ${ready?'':'disabled'}`):''}${has('payments')&&v.pricing_state==='priced'?button('collectPayment','payment',`data-order="${v.order_id}"`):''}${button('details','order',`data-order="${v.order_id}"`)}</div>${!ready&&['pending','picked_up'].includes(v.pickup_state)?`<p class="muted">${esc(t('pickupChecklist'))}</p>`:''}`;
 }
 function visitButtons(v,view){
  if(view==='driverDesk'&&v.kind==='pickup'&&v.measurement_mode==='verified')return pickupButtons(v);
  return `<div class="actions">${v.state==='planned'?button('departed','visit-event',`data-id="${v.id}" data-event="departed"`):''}${v.state==='en_route'&&!v.arrived_at?button('arrived','visit-arrived',`data-id="${v.id}"`):''}${v.state==='en_route'?button(v.kind==='pickup'?'markPickup':'markDelivery','visit-event',`data-id="${v.id}" data-event="completed"`):''}${['planned','en_route'].includes(v.state)?button('failedVisit','visit-problem',`data-id="${v.id}"`):''}${v.pricing_state!=='awaiting_measurements'&&has('payments')?button('collectPayment','payment',`data-order="${v.order_id}"`):''}${has('photos')?button('productPhotos','photo',`data-order="${v.order_id}"`):''}${view==='dispatch'?button('scheduleVisit','reschedule',`data-id="${v.id}"`):''}${button('details','order',`data-order="${v.order_id}"`)}</div>`;
 }
 function workshopButtons(o){
  if(o.measurement_mode==='verified'&&o.pickup_state==='handed_over')return `<div class="actions">${button('acceptProducts','workshop-accept',`data-order="${o.id}" class="primary"`)}${button('details','order',`data-order="${o.id}"`)}</div>`;
  return `<div class="actions">${o.measurement_mode==='verified'&&o.stage==='received'&&user()?.role==='workshop'?button('workshopMeasurements','measure-order',`data-order="${o.id}" class="primary"`):''}${o.stage!=='ready'?button('nextStage','advance',`data-id="${o.id}" ${o.measurement_mode==='verified'&&o.stage==='received'&&o.workshop_measured_count<o.items_count?'disabled':''}`):''}${button('addDefect','defect',`data-id="${o.id}"`)}${button('productPhotos','photo',`data-order="${o.id}"`)}${button('details','order',`data-order="${o.id}"`)}</div>`;
 }

 function renderRows(){
  const view=state.view,rows=state.rows;
  if(!rows.length){$('#desk-list').innerHTML=`<div class="box empty">${esc(t('empty'))}</div>`;return;}
  if(view==='dispatch'||view==='driverDesk'){
   const slotStart=v=>state.meta.catalogs.find(c=>c.kind==='slot'&&c.code===v.slot_code&&c.branch_id===v.branch_id)?.config?.start||v.slot_code;
   const sorted=[...rows].sort((a,b)=>String(slotStart(a)).localeCompare(String(slotStart(b)))||String(a.zone_code).localeCompare(String(b.zone_code))||a.position-b.position);
   const load=Object.entries(rows.filter(v=>['planned','en_route'].includes(v.state)).reduce((a,v)=>{a[v.driver_id||'']=(a[v.driver_id||'']||0)+1;return a;},{})).map(([id,n])=>`${esc(staffName(id))}: ${n}`).join(' · ');
   $('#desk-list').innerHTML=`${view==='dispatch'?`<section class="box"><h2>${esc(t('load'))}</h2><p>${load}</p></section>`:''}<div class="cards">${sorted.map(v=>`<article class="card"><div class="row"><h2>${esc(v.code)}</h2><span class="pill">${esc(t(v.kind))} · ${esc(t(v.state))}</span></div><strong>${esc(v.client_name)}</strong><p>${esc(v.address)}</p>${driverRoute(v)}<small>${esc(options('slot').find(x=>x[0]===v.slot_code)?.[1]||v.slot_code)} · ${esc(v.zone_code||'')}</small><p>${esc(staffName(v.driver_id))}</p><p>${price(v)} · ${esc(t('paid'))}: ${money(v.paid_amount)}</p><div class="actions"><a class="button" href="tel:${esc(String(v.phone).replace(/[^+\d]/g,''))}">${esc(t('callClient'))}</a></div>${visitButtons(v,view)}</article>`).join('')}</div>`;
  }else if(view==='workshopDesk')$('#desk-list').innerHTML=`<div class="cards">${rows.map(o=>`<article class="card"><div class="row"><h2>${esc(o.code)}</h2><span class="pill">${esc(t(o.stage))}</span></div>${o.urgent?`<strong class="danger">${esc(t('urgent'))}</strong>`:''}<p>${esc(t('area'))}: ${esc(o.area_m2)}</p><small>${esc(t('stageStarted'))}: ${esc(date(o.stage_at))}</small><small>${esc(t('deadline'))}: ${esc(date(o.promised_at))}</small>${workshopButtons(o)}</article>`).join('')}</div>`;
  else $('#desk-list').innerHTML=`<div class="cards">${rows.map(row=>`<article class="card"><strong>${esc(row.title||row.name||row.phone)}</strong><p>${esc(row.phone||row.note||row.comment||'')}</p><span class="pill">${esc(t(row.outcome||row.status))}</span><small>${esc(date(row.due_at||row.callback_at||row.started_at||row.created_at))}</small>${row.recording_url?`<a href="${esc(row.recording_url)}" target="_blank" rel="noreferrer">${esc(t('recording'))}</a>`:''}${view==='tasks'&&row.status==='open'?button('complete','task-complete',`data-id="${row.id}"`):''}${view==='calls'?button('clientSearch','phone-client',`data-phone="${esc(row.phone)}"`)+(window.crmModules?.callActions?.(row)||''):''}</article>`).join('')}</div>`;
  $('#desk-pagination').innerHTML=state.cursor?button('more','more'):'';
 }
 async function load(append=false){
  const request=++state.request;
  const view=({driverDesk:'driver',workshopDesk:'workshop'})[state.view]||state.view;
  const response=await read(view,{...state.filters,...(append?{cursor:state.cursor}:{})});
  if(request!==state.request)return;
  state.rows=append?[...state.rows,...response.data]:response.data;state.cursor=response.next_cursor;renderRows();
 }
 async function renderClient(phone){
  const data=await read('client',{phone,...(state.filters.branch_id?{branch_id:state.filters.branch_id}:{})});state.client=data;
  $('#desk-list').innerHTML=data.client?`<section class="box"><h2>${esc(data.client.name)}</h2><p>${esc(data.client.phone)}</p><h3>${esc(t('addresses'))}</h3><ul>${data.addresses.map(a=>`<li>${esc(a.label)} ${esc(a.address)}</li>`).join('')}</ul>${button('newAddress','address')}${photoGallery({client_id:data.client.id,branch_id:state.filters.branch_id,client:true})}<h3>${esc(t('orders'))}</h3><div class="cards">${data.orders.map(o=>`<article class="card"><strong>${esc(o.code)}</strong><span class="pill">${esc(t(o.status))}</span><p>${price(o)}</p><p>${esc(o.address)}</p>${button('details','order',`data-order="${o.id}"`)}${button('repeatOrder','repeat',`data-id="${o.id}"`)}</article>`).join('')}</div></section>`:`<p class="muted">${esc(t('clientNotFound'))}</p>`;
 }
 const adminRows=()=>({staff:state.admin.staff.map(r=>({...r,entity:'staff'})),branches:state.admin.branches.map(r=>({...r,entity:'branch'})),tariffs:state.admin.tariffs.map(r=>({...r,entity:'tariff'})),catalogs:[...state.admin.catalogs.map(r=>({...r,entity:'catalog'})),...state.admin.reasons.map(r=>({...r,entity:'reason'}))],templates:state.admin.templates.map(r=>({...r,entity:'template'}))})[state.adminTab];
 const adminLabel=r=>r.full_name||r.name||r.name_ru||r.code;
 function renderAdminRows(){
  const rows=adminRows().filter(r=>state.showArchived||!r.archived_at),branchName=id=>state.admin.branches.find(b=>b.id===id)?.name||t('noData');
  $('#desk-list').innerHTML=`<div class="admin-tabs" role="group" aria-label="${esc(t('adminSections'))}">${['staff','branches','tariffs','catalogs','templates'].map(tab=>button(tab,'admin-tab',`data-tab="${tab}" aria-pressed="${state.adminTab===tab}"`)).join('')}</div><label class="check"><input type="checkbox" data-admin-archived ${state.showArchived?'checked':''}>${esc(t('showArchived'))}</label><p class="muted">${esc(t('adminArchiveSummary'))}</p><div class="cards">${rows.map((r,index)=>`<article class="card" data-admin-entity="${r.entity}" data-admin-id="${esc(r.id||r.code)}"><div class="row"><h2>${esc(adminLabel(r))}</h2><span class="pill">${esc(t(r.archived_at?'archived':r.active?'active':'inactive'))}</span></div>${r.role?`<p>${esc(t(r.role))}</p>`:''}${r.code?`<small>${esc(r.code)}${r.kind?` · ${esc(t(r.kind))}`:''}</small>`:''}${r.branch_id?`<small>${esc(branchName(r.branch_id))}</small>`:''}${r.price_per_m2!=null?`<strong>${money(r.price_per_m2)} / ${esc(t(r.unit==='piece'?'piece':'m2'))}</strong><small>${esc(t('effective_at'))}: ${esc(date(r.effective_at))}</small>`:''}${r.body?`<p>${esc(r.body)}</p><small>${esc(t(r.channel))} · ${esc(t(r.locale))}</small>`:''}${r.address?`<p>${esc(r.address)}</p>`:''}<div class="actions">${r.archived_at?button('restoreRecord','admin-restore',`data-index="${index}"`):`${button('editRecord','admin-edit',`data-index="${index}"`)}${r.entity==='staff'?button('accessLink','access-link',`data-id="${r.id}"`):''}${button('archiveRecord','admin-archive',`data-index="${index}" class="danger" ${r.entity==='staff'&&r.id===user().id?'disabled':''}`)}`}</div></article>`).join('')||`<div class="box empty">${esc(t('empty'))}</div>`}</div>${state.adminTab==='tariffs'?`<details class="box"><summary>${esc(t('tariffVersions'))}</summary>${state.admin.tariff_versions.map(v=>`<p>${esc(v.name)} · ${esc(branchName(v.branch_id))} · ${money(v.price_per_m2)} · ${esc(date(v.effective_at))}</p>`).join('')}</details>`:''}${state.adminTab==='branches'?`<details class="box"><summary>${esc(t('settingVersions'))}</summary>${state.admin.setting_versions.map(v=>`<p>${esc(t(v.key))} · ${esc(v.value)} · ${esc(date(v.effective_at))}</p>`).join('')}</details>`:''}`;
 }
 async function renderAdmin(){state.admin=await read('admin');renderAdminRows();}
 async function renderQueue(){
  let rows=[];try{rows=await window.CRMOffline.list(user().id);}catch{}
  $('#desk-list').innerHTML=`<div class="cards">${rows.map(e=>`<article class="card"><strong>${esc(t(e.command==='photo'?'photo':e.command.split('.')[0]))}</strong><small>${esc(date(e.created_at))}</small>${e.error?`<p class="error">${esc(t('queueReview'))} ${esc(e.error)}</p>`:`<p>${esc(t('queued'))}</p>`}<div class="actions">${button('retry','queue-retry',`data-id="${e.id}"`)}${button('discard','queue-discard',`data-id="${e.id}"`)}</div></article>`).join('')||`<p class="muted">${esc(t('empty'))}</p>`}</div>`;
 }
 async function render(view){
  state.view=view;state.rows=[];state.cursor=null;
  const feature=state.extra.find(f=>f.key===view);if(feature){await feature.render($('#main'),{api:ui().api,meta:state.meta,command,openForm,read});return;}
  const actions=({leads:[['newLead','lead.save']],calls:[['newCall','call.log']],tasks:[['newTask','task.save']],dispatch:[['scheduleVisit','visit.schedule']],workshopDesk:[['scan','scan']],adminDesk:[['newStaff','staff.create'],['newTariff','tariff.schedule'],['newSetting','setting.schedule'],['newCatalog','catalog.save'],['newTemplate','template.save'],['newBranch','branch.save']],queue:[['sync','sync']]})[view]||[];
  $('#main').innerHTML=`<div class="heading"><h1>${esc(t(view))}</h1><div class="actions">${actions.map(([label,name])=>button(label,'form',`data-form-name="${name}"`)).join('')}${button('refresh','refresh')}</div></div>${!navigator.onLine?`<p class="notice">${esc(t('offline'))}</p>`:''}
   ${view==='queue'||view==='adminDesk'?'':`<form class="filters" data-desk-filter>${user().role==='admin'||user().role==='manager'?select('branch_id','branch',state.meta.branches.map(b=>[b.id,b.name]),state.filters.branch_id):''}${['dispatch','driverDesk'].includes(view)?field('date','date','date',state.filters.date||state.meta.date||localDate()):''}${view==='clients'?field('phone','phone','tel',state.filters.phone||'+998'):''}${view==='workshopDesk'?select('stage','stage',['received','washing','drying','quality_check','packing','ready'].map(s=>[s,t(s)]),state.filters.stage):''}<button>${esc(t(view==='clients'?'clientSearch':'filter'))}</button></form>`}<div id="desk-list" aria-live="polite">${esc(t('loading'))}</div><div id="desk-pagination"></div>`;
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
   else {const result=await command(forms[name].command||name,data,{queueable:['visit.problem','payment.record','workshop.defect'].includes(name),key:state.form.key});await forms[name].onResult?.(result,data);if(name==='order.measure')ui().toast(user().role==='driver'?t('calculatedPrice')+': '+money(result.total):t('measurementsConfirmed'));}
   const photoOrder=name==='photo'?state.form.prefill.order_id:null;await prepare();if(state.view)await render(state.view);if(name==='item.measure')await ui().openOrder(state.detailOrder.id);if(photoOrder)await ui().openOrder(photoOrder);$('#action').close();
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
   if(action==='measure-order')await openMeasurements(el.dataset.order);
   if(['pickup-collect','pickup-handover','workshop-accept'].includes(action)){const commandName={'pickup-collect':'pickup.collect','pickup-handover':'pickup.handover','workshop-accept':'workshop.accept'}[action],expected={'pickup-collect':'pending','pickup-handover':'picked_up','workshop-accept':'handed_over'}[action];await command(commandName,{order_id:el.dataset.order,expected_state:expected},{key:el.dataset.key||(el.dataset.key=crypto.randomUUID())});await load();ui().toast(t('saved'));}
   if(action==='measure'){const i=state.measuredItems.find(i=>i.id===el.dataset.id),own=i.measurements.find(m=>m.source_role===user().role);await openForm('item.measure',{item_id:i.id,unit:i.unit,expected_id:own?.id||'',length_m:own?.length_m||'',width_m:own?.width_m||''});}
   if(action==='route-location'&&user().role==='driver'){const request=++mapRequest;navigator.geolocation?.getCurrentPosition(pos=>{if(request!==mapRequest||user()?.role!=='driver'||!mapEnabled())return;mapOrigin=`${pos.coords.latitude},${pos.coords.longitude}`;renderRows();},()=>ui().toast(t('routeLocationDenied')),{enableHighAccuracy:true,timeout:12000,maximumAge:60000});}
   if(action==='close'){stopCamera();$('#action').close();}
   if(action==='refresh')await render(state.view);
   if(action==='more')await load(true);
   if(action==='form'){const name=el.dataset.formName;if(name==='scan')await scan();else if(name==='sync'){await window.CRMOffline.sync(user().id,ui().api);await renderQueue();}else await openForm(name);}
   if(action==='order')await ui().openOrder(el.dataset.order);
   if(action==='visit-arrived'){await command('visit.arrived',{visit_id:el.dataset.id},{queueable:true});await load();}
   if(action==='advance-detail'){const result=await command('workshop.advance',{order_id:el.dataset.order,expected_stage:el.dataset.stage},{queueable:true});if(!result.queued)await ui().openOrder(el.dataset.order);}
   if(action==='defect-detail')await openForm('workshop.defect',{order_id:state.detailOrder.id,items:state.detailOrder.items});
   if(action==='payments'){
    const payments=await read('payments',{order_id:el.dataset.order});state.paymentOrder=el.dataset.order;
    $('#action').innerHTML=`<div class="row"><h2>${esc(t('paymentHistory'))}</h2>${button('close','close')}</div>${payments.data.map(p=>`<div class="items"><strong>${money(p.amount)}</strong> · ${esc(t(p.method))} · ${esc(t('payment_'+p.state))}<small>${esc(date(p.created_at))}</small>${p.state==='pending'&&['admin','dispatcher'].includes(user().role)?button('confirmPayment','payment-confirm',`data-id="${p.id}"`):''}</div>`).join('')||`<p>${esc(t('empty'))}</p>`}`;$('#action').showModal();
   }
   if(action==='payment-confirm'){await command('payment.confirm',{payment_id:el.dataset.id,confirm:true});$('#action').close();await ui().openOrder(state.paymentOrder);}
   if(action==='phone-client'){state.filters={phone:el.dataset.phone};await ui().navigate('clients');}
   if(action==='address')await openForm('client.address',{client_id:state.client.client.id});
   if(action==='repeat'){const previous=state.client.orders.find(o=>o.id===el.dataset.id);ui().newOrder({...state.client.client,...previous,phone:state.client.client.phone});}
   if(action==='task-complete'){await command('task.complete',{task_id:el.dataset.id});await load();}
   if(['visit-event','visit-problem','reschedule'].includes(action)){
    const v=state.rows.find(v=>v.id===el.dataset.id);
    if(action==='visit-event'){await command('visit.event',{visit_id:v.id,event:el.dataset.event,expected_state:v.state},{queueable:true});await load();}
    else if(action==='visit-problem')await openForm('visit.problem',{visit_id:v.id,event:'failed',expected_state:v.state});
    else await openForm('visit.schedule',v);
   }
   if(action==='advance'){const o=state.rows.find(o=>o.id===el.dataset.id);await command('workshop.advance',{order_id:o.id,expected_stage:o.stage},{queueable:true});await load();}
   if(action==='defect'){const o=state.rows.find(o=>o.id===el.dataset.id);await openForm('workshop.defect',{order_id:o.id,items:o.items});}
   if(action==='payment')await openForm('payment.record',{order_id:el.dataset.order});
   if(action==='photo'){const o=await ui().api(`/orders/${el.dataset.order}`),next=o.items.find(i=>!i.photos?.some(p=>p.kind==='intake'))||o.items[0];await openForm('photo',{items:o.items,order_id:o.id,item_id:next?.id});}
   if(action==='staff-edit'){const person=state.admin.staff.find(p=>p.id===el.dataset.id);await openForm('staff.update',{...person,user_id:person.id});}
   if(action==='access-link'){const r=await ui().api(`/staff/${el.dataset.id}/access-link`,{method:'POST',body:{}});$('#action').innerHTML=`<h2>${esc(t('accessLink'))}</h2><p>${esc(t('accessLinkHint'))}</p><textarea readonly>${esc(r.action_link)}</textarea>${button('close','close')}`;$('#action').showModal();}
   if(action==='queue-retry'){await window.CRMOffline.retry(el.dataset.id,user().id);await window.CRMOffline.sync(user().id,ui().api);await renderQueue();}
   if(action==='queue-discard'){await window.CRMOffline.discard(el.dataset.id,user().id);await renderQueue();}
   if(action==='camera')await startCamera();
  }catch(e){ui().toast(e.message);}finally{el.disabled=false;}
 });
 document.addEventListener('change',event=>{const el=event.target,form=el.closest('form');if(el.name==='region_code'&&form)districtOptions(form);if(el.name==='private_house'&&form)apartmentState(form);if(el.matches('[data-driver-map]')&&user()?.role==='driver'){try{localStorage.setItem(mapKey(),el.checked?'on':'off');}catch{}if(!el.checked){mapOrigin='';mapRequest++;}renderRows();}if(el.name==='saved_structured_address'&&form){const address=state.savedAddresses?.find(a=>a.id===el.value);if(address)fillAddress(form,address);}});
 document.addEventListener('change',event=>{if(event.target.matches('[data-admin-archived]')){state.showArchived=event.target.checked;renderAdminRows();}});
 document.addEventListener('input',event=>event.target.removeAttribute?.('aria-invalid'));
 window.addEventListener('online',()=>{if(user())window.CRMOffline?.sync(user().id,ui().api).catch(()=>{});});
 window.addEventListener('crm-queue',()=>{if(!user())return;if(state.view==='queue')renderQueue().catch(()=>{});else if(['driverDesk','workshopDesk'].includes(state.view))load().catch(()=>{});});
 $('#action').addEventListener('close',stopCamera);
 window.crmModules={views:availableViews,home:u=>u.role==='driver'?'driverDesk':u.role==='workshop'?'workshopDesk':u.role==='dispatcher'?'dispatch':u.role==='manager'&&state.extra.some(f=>f.key==='reports')?'reports':'orders',prepare,render,
  lookupInOrderForm:async(form,phone)=>{const data=await read('client',{phone});if(!data.client||!form.isConnected||form.elements.phone.value.replace(/\D/g,'').slice(-9)!==phone.replace(/\D/g,'').slice(-9))return;if(!form.elements.name.value)form.elements.name.value=data.client.name||'';state.savedAddresses=data.addresses;let target=form.querySelector('[data-client-addresses]');if(!target){target=document.createElement('div');target.dataset.clientAddresses='';form.querySelector('[data-address-fields]')?.before(target);}target.innerHTML=data.addresses.length?select('saved_structured_address','addresses',data.addresses.map(a=>[a.id,`${a.label} ${a.address}`])):'';},
  logout:()=>{state.view=null;state.request++;mapOrigin='';mapRequest++;state.measuredItems=[];state.detailOrder=null;state.savedAddresses=[];stopCamera();},addFeature:feature=>state.extra.push(feature),
  orderFields:()=>`${select('branch_id','branch',state.meta.branches.filter(b=>b.active).map(b=>[b.id,b.name]),user()?.branch_id||state.meta.branches[0]?.id,true)}${addressFields()}`,fillAddress,afterOrderDetail:measurementPanel,
  photoGallery,sourceOptions:()=>options('source'),getMeta:()=>state.meta,openForm,command,forms,choices,
  orderActions:o=>{state.detailOrder=o;const stage=o.production_stage||o.status;return `${o.measurement_mode==='verified'?'<section data-measurements aria-live="polite"></section>':''}<div class="actions desk-order-actions">${has('workshop')&&o.pickup_state!=='handed_over'&&!['ready','cancelled','delivered'].includes(stage)?button('nextStage','advance-detail',`data-order="${o.id}" data-stage="${esc(stage)}"`):''}${has('workshop')?button('addDefect','defect-detail'):''}${has('photos')?button('photo','photo',`data-order="${o.id}"`):''}${has('payments')&&o.pricing_state!=='awaiting_measurements'?button('collectPayment','payment',`data-order="${o.id}"`):''}${user().role!=='workshop'?button('paymentHistory','payments',`data-order="${o.id}"`):''}</div>`;},
 };
})();
