import {t,money,date} from './i18n.js';
(()=>{
 const modules=window.crmModules,ui=()=>window.crmUI,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={view:null,filters:{},data:null,order:null,request:0,pendingImport:null,exportCursor:null},$=s=>document.querySelector(s);
 const btn=(key,action,attrs='')=>`<button type="button" data-ops="${action}" ${attrs}>${esc(t(key))}</button>`;
 const name=id=>modules.getMeta().staff.find(p=>p.id===id)?.full_name||t('unknown');
 const fields={order:['order_id','entity','hidden'],branch:['branch_id','branch','branches',true],note:['note','note','textarea',true]};
 Object.assign(modules.choices,{discountKind:['promo','loyalty'],resolution:['rewash','discount','compensation','no_issue'],provider:['payme','click'],rateRole:['driver','workshop'],rateEvent:['pickup','delivery','washing','packing'],rateUnit:['order','m2'],photoRef:[]});
 const form=(title,list,other={})=>({title,fields:list,...other});
 Object.assign(modules.forms,{
  'call.link':form('linkCall',[['call_id','entity','hidden'],['order_id','entity','orders',true]]),
  'discount.rule':form('newDiscount',[fields.branch,['code','promoCode','text',true],['kind','kind','discountKind',true],['percent','discountPercent','number',true],['min_orders','minOrders','number'],['min_total','minTotal','number'],['max_uses','maxUses','number'],['valid_from','validFrom','datetime-local',true],['valid_to','validTo','datetime-local',true],['active','active','checkbox']]),
  'discount.apply':form('applyDiscount',[fields.order,['code','promoOrLoyalty']]),
  'payment.refund':form('refundPayment',[fields.order,['amount','amount','number',true],['method','method','method',true],fields.note]),
  'payment.intent':form('onlinePayment',[fields.order,['provider','provider','provider',true],['amount','amount','number',true]]),
  'cash.close':form('closeCash',[fields.branch,['driver_id','driver','drivers',true],['day','date','date',true],['counted','countedCash','number',true],fields.note]),
  'client.preferences':form('clientPreferences',[fields.branch,['client_id','client','hidden'],['tags','clientTags'],['sms_consent','smsConsent','checkbox'],['telegram_consent','telegramConsent','checkbox'],['telegram_chat_id','telegramChat']],{transform:d=>({...d,tags:(d.tags||'').split(',').map(s=>s.trim()).filter(Boolean)})}),
  'intake.create':form('newIntake',[fields.order,fields.note]),
  'complaint.create':form('newComplaint',[fields.order,['reason','complaintReason','text',true],fields.note,['photo_id','photo','photoRef'],['responsible_id','assigned_to','staff'],['due_at','due_at','datetime-local',true]],{transform:d=>{if(d.photo_id)d.photo_ids=[d.photo_id];delete d.photo_id;return d;}}),
  'complaint.resolve':form('resolveComplaint',[['complaint_id','entity','hidden'],['resolution','resolution','resolution',true],['amount','amount','number'],fields.note]),
  'material.save':form('newMaterial',[fields.branch,['code','code','text',true],['name','name','text',true],['unit','unit','text',true],['norm_per_m2','normPerM2','number',true],['active','active','checkbox']]),
  'stock.adjust':form('adjustStock',[['material_id','entity','hidden'],['quantity','quantity','number',true],fields.note]),
  'piece_rate.save':form('newPieceRate',[fields.branch,['role','role','rateRole',true],['event','action','rateEvent',true],['unit','unit','rateUnit',true],['rate','rate','number',true],['effective_at','effective_at','datetime-local',true]]),
  'slot_limit.save':form('slotLimit',[fields.branch,['day','date','date',true],['zone_code','zone','zone',true],['slot_code','slot','slot',true],['capacity','capacity','number',true]]),
  'webhook.save':form('newWebhook',[fields.branch,['name','name','text',true],['url','webhookURL','url',true],['secret_env','secretEnv','text',true],['active','active','checkbox']]),
 });
 modules.forms['client.policy']={...modules.forms['client.preferences'],command:'client.preferences',fields:[...modules.forms['client.preferences'].fields,['blacklisted','blacklisted','checkbox'],['blacklist_reason','blacklistReason','textarea']]};
 const definitions={
  cashbox:{view:'cash',permission:'payments',roles:['admin','dispatcher','driver'],actions:[['closeCash','cash.close','dispatch']]},
  stockroom:{view:'stock',permission:'inventory',actions:[['newMaterial','material.save','staff']]},
  qualityDesk:{view:'quality',permission:'complaints'},rewashDesk:{view:'rewash',permission:'workshop'},
  loyaltyDesk:{view:'loyalty',permission:'discounts',actions:[['newDiscount','discount.rule','discounts']]},
  payrollDesk:{view:'payroll',permission:'payroll',actions:[['newPieceRate','piece_rate.save','staff']]},
  planningDesk:{view:'planning',permission:'read',roles:['admin','dispatcher','operator'],actions:[['slotLimit','slot_limit.save','dispatch']]},
  integrationsDesk:{view:'integrations',permission:'integrations',actions:[['newWebhook','webhook.save','integrations']]},
  alerts:{view:'alerts',permission:'reports'},
 };
 const value=(v,key)=>v==null?'—':key.endsWith('_at')?date(v):typeof v==='boolean'?t(v?'yes':'no'):['amount','rate','total','counted','expected','difference','issued_total','min_total'].includes(key)?money(v):['role','state','stage','event','unit','kind','resolution','channel'].includes(key)?esc(t(v)):esc(v);
 const table=(rows,columns,action)=>rows?.length?`<div class="table-scroll"><table><thead><tr>${columns.map(([key,label])=>`<th>${esc(t(label||key))}</th>`).join('')}${action?`<th>${esc(t('action'))}</th>`:''}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key])=>`<td>${['employee_id','driver_id','received_by','responsible_id'].includes(key)?esc(name(row[key])):value(row[key],key)}</td>`).join('')}${action?`<td>${action(row)}</td>`:''}</tr>`).join('')}</tbody></table></div>`:`<p class="muted">${esc(t('empty'))}</p>`;
 const section=(title,html)=>`<section class="box"><h2>${esc(t(title))}</h2>${html}</section>`;
 function draw(){
  const d=state.data,v=state.view;let html='';
  if(v==='cashbox')html=section('cashbox',table(d.cash,[['received_by','driver'],['expected','expectedCash'],['operations','operations']]))+section('cashClosings',table(d.closings,[['driver_id','driver'],['day','date'],['expected','expectedCash'],['counted','countedCash'],['difference','difference'],['note','note']]));
  if(v==='stockroom')html=section('materials',table(d.materials,[['name','name'],['unit','unit'],['stock','stock'],['norm_per_m2','normPerM2']],ui().has('staff')?r=>btn('adjustStock','adjust',`data-id="${r.id}"`):null))+section('stockMovements',table(d.movements,[['created_at','date'],['quantity','quantity'],['source','source'],['note','note']]));
  if(v==='qualityDesk')html=section('complaints',table(d.complaints,[['code','code'],['reason','complaintReason'],['state','status'],['responsible_id','assigned_to'],['due_at','due_at'],['resolution','resolution'],['resolution_note','note']],r=>`${btn('details','order',`data-id="${r.order_id}"`)}${ui().has('discounts')&&!r.resolution?btn('resolveComplaint','resolve',`data-id="${r.id}"`):''}`))+section('compensations',table(d.compensations,[['amount','amount'],['note','note']],ui().has('discounts')?r=>btn('markPaid','compensate',`data-id="${r.id}"`):null));
  if(v==='rewashDesk')html=table(d.jobs,[['code','code'],['reason','complaintReason'],['stage','stage']],r=>btn('nextStage','rewash',`data-id="${r.id}" data-stage="${r.stage}"`));
  if(v==='loyaltyDesk')html=table(d.rules,[['code','promoCode'],['kind','kind'],['percent','discountPercent'],['min_orders','minOrders'],['uses','uses'],['max_uses','maxUses'],['valid_to','validTo'],['active','active']]);
  if(v==='payrollDesk')html=section('payrollAccruals',`<p>${esc(t('payrollHint'))}</p>`+table(d.accruals,[['full_name','full_name'],['role','role'],['operations','operations'],['amount','amount']]))+section('operatorKpi',table(d.operators,[['full_name','full_name'],['orders','orders'],['cancellations','cancellations'],['delivered','delivered'],['issued_total','issuedTotal']]))+section('pieceRates',table(d.rates,[['role','role'],['event','action'],['unit','unit'],['rate','rate'],['effective_at','effective_at']]));
  if(v==='planningDesk'){
   const free=d.slots?.find(s=>s.remaining>0&&Number(s.workshop_remaining_m2)>0);html=section('nearestSlot',free?`<p><strong>${esc(free.date)} · ${esc(free.name_ru)}</strong> · ${esc(t('remaining'))}: ${free.remaining} · ${esc(t('workshopRemaining'))}: ${free.workshop_remaining_m2}</p>`:`<p>${esc(t('noSlots'))}</p>`)+table(d.slots,[['date','date'],['name_ru','slot'],['remaining','remaining'],['workshop_remaining_m2','workshopRemaining']])+section('suggestedRoute',`<p class="muted">${esc(t('routeHint'))}</p>`+table(d.route,[['zone_code','zone'],['slot_code','slot'],['code','code'],['address','address'],['driver_id','driver']],r=>btn('details','order',`data-id="${r.order_id}"`)));
  }
  if(v==='integrationsDesk')html=section('webhooks',table(d.subscriptions,[['name','name'],['url','webhookURL'],['secret_env','secretEnv'],['active','active']]))+section('outbox',table(d.outbox,[['created_at','date'],['channel','channel'],['state','status'],['attempts','attempts'],['last_error','lastError']],r=>r.state==='dead'?btn('retry','outbox-retry',`data-id="${r.id}"`):''))+importPanel();
  if(v==='alerts')html=table(d.tasks,[['title','newTask'],['due_at','due_at'],['note','note']],r=>btn('details','order',`data-id="${r.order_id}"`));
  $('#operations-result').innerHTML=html+(d.next_cursor?btn('more','more'):'');
 }
 async function load(more=false){const request=++state.request,params=new URLSearchParams(Object.entries(state.filters).filter(([,v])=>v));if(more&&state.data.next_cursor)params.set('cursor',state.data.next_cursor);const d=await ui().api(`/ops/${definitions[state.view].view}?${params}`);if(request!==state.request||!$('#operations-result'))return;
  if(more){const list=({stockroom:'movements',qualityDesk:'complaints',integrationsDesk:'outbox'})[state.view];d[list]=[...state.data[list],...d[list]];}state.data=d;draw();}
 for(const [key,definition] of Object.entries(definitions))modules.addFeature({key,...definition,render:async(main,{meta})=>{
  state.view=key;state.filters={date:meta.date,...state.filters};state.pendingImport=null;
  const branches=meta.branches.filter(b=>ui().user().role==='admin'||ui().user().role==='manager'||b.id===ui().user().branch_id);
  main.innerHTML=`<div class="heading"><h1>${esc(t(key))}</h1><div class="actions">${(definition.actions||[]).filter(a=>ui().has(a[2])).map(([label,command])=>btn(label,'form',`data-form="${command}"`)).join('')}${btn('refresh','refresh')}</div></div><form class="filters" data-ops-filter><label>${esc(t('branch'))}<select name="branch_id">${branches.map(b=>`<option value="${b.id}" ${b.id===state.filters.branch_id?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label><label>${esc(t('date'))}<input name="date" type="date" value="${esc(state.filters.date)}" required></label>${key==='payrollDesk'?`<label>${esc(t('periodFrom'))}<input name="from" type="date" value="${esc(state.filters.from||'')}"></label><label>${esc(t('periodTo'))}<input name="to" type="date" value="${esc(state.filters.to||'')}"></label>`:''}${key==='planningDesk'?`<label>${esc(t('zone'))}<select name="zone_code"><option value="">${esc(t('all'))}</option>${meta.catalogs.filter(c=>c.kind==='zone'&&c.active).map(c=>`<option value="${c.code}">${esc(c.name_ru)}</option>`).join('')}</select></label>`:''}<button>${esc(t('filter'))}</button></form><div id="operations-result">${esc(t('loading'))}</div>`;
  state.filters.branch_id=$('[data-ops-filter] select[name=branch_id]').value;await load();
 }});
 function importPanel(){return `<section class="box"><h2>${esc(t('importData'))}</h2><p>${esc(t('importHint'))}</p><form data-ops-import><label>${esc(t('kind'))}<select name="kind"><option value="clients">${esc(t('clients'))}</option><option value="orders">${esc(t('orders'))}</option></select></label><input name="file" type="file" accept=".csv,.xlsx" required><button>${esc(t('previewImport'))}</button></form><div class="actions">${btn('clientTemplate','template',`data-kind="clients"`)}${btn('orderTemplate','template',`data-kind="orders"`)}</div><div id="import-preview"></div></section>`;}
 modules.addFeature({key:'clientsExport',permission:'exports',render:async main=>{state.exportCursor=null;main.innerHTML=`<section class="box"><h1>${esc(t('clientsExport'))}</h1><p>${esc(t('exportClientsHint'))}</p>${btn('exportCSV','export-clients',`data-format="csv"`)}${btn('exportExcel','export-clients',`data-format="xlsx"`)}<div id="export-next"></div></section>`;}});
 modules.callActions=row=>btn('linkCall','call-link',`data-id="${row.id}"`);
 const originalActions=modules.orderActions;modules.orderActions=o=>{state.order=o;return originalActions(o)+`<div class="actions">${btn('printLabels','print',`data-kind="labels"`)}${ui().user().role!=='workshop'?btn('printReceipt','print',`data-kind="receipt"`)+btn('orderDocuments','documents'):''}${o.pricing_state!=='awaiting_measurements'&&ui().has('photos')&&ui().user().role!=='workshop'&&['pickup_assigned','received'].includes(o.status)?btn('newIntake','form',`data-form="intake.create"`):''}${ui().has('create')&&o.pricing_state!=='awaiting_measurements'?btn('applyDiscount','form',`data-form="discount.apply"`):''}${ui().has('payments')&&o.pricing_state!=='awaiting_measurements'?btn('onlinePayment','form',`data-form="payment.intent"`):''}${ui().has('discounts')?btn('refundPayment','form',`data-form="payment.refund"`):''}${ui().has('complaints')?btn('newComplaint','form',`data-form="complaint.create"`):''}${ui().has('clients')?btn('clientPreferences','preferences'):''}${ui().has('read')&&['admin','operator','dispatcher'].includes(ui().user().role)?btn('nearestSlot','planning'):''}</div>`;};
 async function documents(){const d=await ui().api(`/ops/documents?order_id=${state.order.id}`);$('#action').innerHTML=`<h2>${esc(t('orderDocuments'))}</h2>${d.acts.map(a=>`<section class="box"><p>${esc(date(a.created_at))} · ${esc(a.confirmed_at?t('confirmed'):t('pending'))}</p><a href="/intake/${a.public_token}" target="_blank" rel="noreferrer">${esc(t('clientIntakeLink'))}</a>${!a.confirmed_at?btn('sendOtp','otp',`data-id="${a.id}"`):''}${btn('printAct','print',`data-kind="act"`)}</section>`).join('')}${table(d.intents,[['provider','provider'],['amount','amount'],['state','status']],r=>[0,1].includes(r.state)?btn('paymentLink','payment-link',`data-id="${r.id}"`):'')}${btn('close','close')}`;$('#action').showModal();}
 document.addEventListener('submit',async event=>{
  const f=event.target;if(f.matches('[data-ops-filter]')){event.preventDefault();state.filters=Object.fromEntries(new FormData(f));try{await load();}catch(e){ui().toast(e.message);}}
  if(!f.matches('[data-ops-import]'))return;event.preventDefault();state.pendingImport=null;const button=f.querySelector('button');button.disabled=true;
  try{const d=new FormData(f),file=d.get('file');if(!file||file.size>2000000)throw Error(t('importFileTooLarge'));const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const body={format:file.name.toLowerCase().endsWith('.xlsx')?'xlsx':'csv',data:btoa(binary),branch_id:state.filters.branch_id,dry_run:true},kind=d.get('kind'),key=crypto.randomUUID(),r=await ui().api(`/imports/${kind}`,{method:'POST',body,idempotencyKey:key});state.pendingImport={body,kind,key};$('#import-preview').innerHTML=`<p>${esc(t('validRows'))}: ${r.rows}</p>${table(r.preview,[['name','name'],['phone','phone'],['address','address']])}${btn('commitImport','commit-import')}`;}catch(e){ui().toast(e.message);}finally{button.disabled=false;}
 });
 document.addEventListener('change',event=>{if(event.target.closest('[data-ops-import]')){state.pendingImport=null;if($('#import-preview'))$('#import-preview').textContent='';}});
 document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-ops]');if(!el||el.disabled)return;el.disabled=true;
  try{
   const action=el.dataset.ops,id=el.dataset.id,o=state.order;
   if(action==='form'){modules.choices.photoRef=(o?.items||[]).flatMap(i=>(i.photos||[]).map(p=>[p.id,`${t('item')} ${i.seq} · ${t(p.kind)}`]));await modules.openForm(el.dataset.form,{branch_id:state.filters.branch_id,order_id:o?.id,day:state.filters.date,valid_from:new Date().toISOString().slice(0,16),valid_to:new Date(Date.now()+30*86400000).toISOString().slice(0,16),percent:10,min_orders:0,min_total:0,amount:Math.max(0,Number(o?.total)-Number(o?.paid_amount||0)),provider:'payme',kind:'promo',unit:'л',norm_per_m2:0,rate:0});}
   if(action==='refresh'||action==='more')await load(action==='more');
   if(action==='order')await ui().openOrder(id);
   if(action==='close')$('#action').close();
   if(action==='call-link')await modules.openForm('call.link',{call_id:id});
   if(action==='print')await ui().print(`/orders/${o.id}/print/${el.dataset.kind}`);
   if(action==='documents')await documents();
   if(action==='preferences')await modules.openForm(ui().user().role==='admin'?'client.policy':'client.preferences',{client_id:o.client_id,tags:(o.client.tags||[]).join(', '),sms_consent:o.client.sms_consent,telegram_consent:o.client.telegram_consent,telegram_chat_id:o.client.telegram_chat_id,blacklisted:o.client.blacklisted,blacklist_reason:o.client.blacklist_reason});
   if(action==='planning')await ui().navigate('planningDesk');
   if(action==='adjust')await modules.openForm('stock.adjust',{material_id:id});
   if(action==='resolve')await modules.openForm('complaint.resolve',{complaint_id:id,amount:0});
   if(action==='rewash'){await modules.command('rewash.advance',{job_id:id,expected_stage:el.dataset.stage});await load();}
   if(action==='compensate'){await modules.command('compensation.paid',{compensation_id:id});await load();}
   if(action==='outbox-retry'){await modules.command('outbox.retry',{outbox_id:id});await load();}
   if(action==='otp'){await ui().api(`/intake/${id}/challenge`,{method:'POST',body:{},idempotencyKey:el.dataset.key||(el.dataset.key=crypto.randomUUID())});ui().toast(t('otpQueued'));}
   if(action==='payment-link'){const win=window.open('','_blank');try{const r=await ui().api(`/payment-intents/${id}/link`);if(win)win.location.href=r.url;else ui().toast(r.url);}catch(e){win?.close();throw e;}}
   if(action==='template')await ui().download(`/imports/${el.dataset.kind}/template`,`template-${el.dataset.kind}.csv`);
   if(action==='commit-import'){const p=state.pendingImport;if(!p)throw Error(t('previewFirst'));const r=await ui().api(`/imports/${p.kind}`,{method:'POST',body:{...p.body,dry_run:false},idempotencyKey:p.key});state.pendingImport=null;$('#import-preview').textContent=`${t('imported')}: ${r.imported}`;}
   if(action==='export-clients'){const r=await ui().download(`/exports/clients?format=${el.dataset.format}${state.exportCursor?'&cursor_id='+state.exportCursor:''}`,`clients.${el.dataset.format}`);state.exportCursor=r?.nextCursor||null;$('#export-next').textContent=state.exportCursor?t('exportHasMore'):t('exportFinished');}
  }catch(e){ui().toast(e.message);}finally{el.disabled=false;}
 });
 const originalLogout=modules.logout;modules.logout=()=>{originalLogout();state.order=null;state.pendingImport=null;state.data=null;state.filters={};state.request++;document.querySelectorAll('.incoming-call').forEach(e=>e.remove());};
 let lastUser=null,seen=new Set(),polling=false;
 setInterval(async()=>{
  const user=ui()?.user();if(!user||!ui().has('calls')||document.hidden||!navigator.onLine||polling)return;if(lastUser!==user.id){seen=new Set();lastUser=user.id;}
  polling=true;try{const r=await ui().api('/workspaces/calls?limit=20');if(ui()?.user()?.id!==user.id)return;for(const c of r.data||[]){if(c.outcome!=='ringing'||seen.has(c.id)||Date.now()-Date.parse(c.started_at)>120000)continue;seen.add(c.id);let client=null;if(ui().has('clients'))try{client=await ui().api('/workspaces/client?phone='+encodeURIComponent(c.phone));}catch{}if(ui()?.user()?.id!==user.id)return;const box=document.createElement('aside');box.className='box incoming-call';box.innerHTML=`<strong>${esc(t('incomingCall'))} ${esc(c.phone)}</strong>${client?.client?`<p>${esc(client.client.name)}</p><small>${esc(t('orders'))}: ${esc((client.orders||[]).slice(0,3).map(o=>o.code).join(', '))}</small>`:''}<div class="actions">${btn('clientSearch','incoming-client',`data-phone="${esc(c.phone)}"`)}${btn('close','dismiss-call')}</div>`;document.body.append(box);}}catch{}finally{polling=false;}
 },10000);
 document.addEventListener('click',async event=>{const el=event.target.closest('[data-ops="incoming-client"],[data-ops="dismiss-call"]');if(!el)return;const box=el.closest('.incoming-call');if(el.dataset.ops==='incoming-client'){await ui().navigate('clients');const input=$('[data-desk-filter] input[name=phone]');if(input){input.value=el.dataset.phone;input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}}box?.remove();});
})();
