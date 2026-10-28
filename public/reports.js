import {t,money,date} from './i18n.js';
(()=>{
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={name:'sales',filters:{},report:null,rows:[],cursor:null,meta:null,api:null,request:0};
 const field=(label,name,type,value)=>`<label>${esc(t(label))}<input name="${name}" type="${type}" value="${esc(value||'')}" required></label>`;
 const select=(label,name,rows,value)=>`<label>${esc(t(label))}<select name="${name}"><option value="">${esc(t('all'))}</option>${rows.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
 const format=(value,type)=>value==null?t('noData'):type==='money'?money(value):type==='percent'?`${(Number(value)*100).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`:type==='date'?new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent'}).format(new Date(`${String(value).slice(0,10)}T00:00:00+05:00`)):['integer','decimal'].includes(type)?Number(value).toLocaleString('ru-RU',{maximumFractionDigits:type==='integer'?0:2}):String(value);
 function chart(){
  const report=state.report,metric=report.chart_key||report.columns.find(c=>['integer','money','decimal'].includes(c.format))?.key,items=state.rows.slice(0,20),maximum=Math.max(1,...items.map(r=>Number(r[metric]||0)));
  if(!items.length)return '';
  return `<div class="report-chart" role="img" aria-label="${esc(report.title)}">${items.map(row=>`<div class="report-bar"><span>${esc(format(row[report.columns[0].key],report.columns[0].format))}</span><meter min="0" max="${maximum}" value="${Math.max(0,Number(row[metric]||0))}"></meter><strong>${esc(format(row[metric],report.columns.find(c=>c.key===metric)?.format))}</strong></div>`).join('')}</div>`;
 }
 function draw(){
  const r=state.report;
  document.querySelector('#report-result').innerHTML=`<p class="muted">${esc(r.note)}</p>${r.coverage?.calls_with_unknown_result?`<p class="notice">${esc(t('callsMissingAttribution'))}: ${r.coverage.calls_with_unknown_result}</p>`:''}${r.coverage?.delivered_without_time?`<p class="notice">${esc(t('deliveryTimesMissing'))}: ${r.coverage.delivered_without_time}</p>`:''}
   <div class="report-kpis">${r.totals.map(item=>`<article class="box"><small>${esc(item.label)}</small><strong>${esc(format(item.value,item.format))}</strong></article>`).join('')}</div>
   <section class="box"><h2>${esc(r.title)}</h2>${chart()}<small>${esc(t('chartFirstRows'))}</small></section><div class="table-scroll box"><table><thead><tr>${r.columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${state.rows.map(row=>`<tr>${r.columns.map(c=>`<td>${esc(format(row[c.key],c.format))}</td>`).join('')}</tr>`).join('')}</tbody></table>${!state.rows.length?`<p class="muted">${esc(t('empty'))}</p>`:''}</div>
   <div class="row"><small>${esc(t('shownRows'))}: ${state.rows.length} / ${r.total_rows} · ${esc(date(r.generated_at))}</small>${state.cursor?`<button type="button" data-report-more>${esc(t('more'))}</button>`:''}</div>`;
  document.querySelector('[data-report-export]').disabled=false;
  if(r.coverage?.cancelled_work_unknown)document.querySelector('#report-result').insertAdjacentHTML('afterbegin',`<p class="notice">${esc(t('cancelledWorkUnknown'))}: ${r.coverage.cancelled_work_unknown}</p>`);
 }
 async function load(more=false){
  const request=++state.request;
  const params=new URLSearchParams(Object.entries(state.filters).filter(([,v])=>v!==''&&v!=null));if(more)params.set('cursor',state.cursor);
  const report=await state.api(`/reports/${state.name}?${params}`);if(request!==state.request||!document.querySelector('#report-result'))return;state.report=report;state.rows=more?[...state.rows,...report.rows]:report.rows;state.cursor=report.next_cursor;draw();
 }
 window.crmModules.addFeature({key:'reports',permission:'reports',render:async(main,{api,meta})=>{
  state.api=api;state.meta=meta;const choices=await api('/reports');
  const today=meta.date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
  state.filters={from:today.slice(0,8)+'01',to:today,...state.filters};
  main.innerHTML=`<div class="heading"><h1>${esc(t('reports'))}</h1><button type="button" data-report-export disabled>${esc(t('exportExcel'))}</button></div><form data-report-form class="filters"><label>${esc(t('report'))}<select name="report_name">${choices.map(r=>`<option value="${r.name}" ${state.name===r.name?'selected':''}>${esc(r.title)}</option>`).join('')}</select></label>
   ${field('periodFrom','from','date',state.filters.from)}${field('periodTo','to','date',state.filters.to)}${select('branch','branch_id',meta.branches.map(b=>[b.id,b.name]),state.filters.branch_id)}
   ${select('operator','operator_id',meta.staff.filter(p=>['operator','admin'].includes(p.role)).map(p=>[p.id,p.full_name]),state.filters.operator_id)}${select('driver','driver_id',meta.staff.filter(p=>p.role==='driver').map(p=>[p.id,p.full_name]),state.filters.driver_id)}
   ${select('source','source',[...new Map(meta.catalogs.filter(c=>c.kind==='source').map(c=>[c.code,[c.code,c.name_ru]])).values()],state.filters.source)}<button class="primary">${esc(t('filter'))}</button></form><div id="report-result" aria-live="polite">${esc(t('loading'))}</div>`;
  await load();
 }});
 document.addEventListener('submit',async event=>{
  if(!event.target.hasAttribute('data-report-form'))return;event.preventDefault();const data=Object.fromEntries(new FormData(event.target));state.name=data.report_name;delete data.report_name;state.filters=data;
  const button=event.target.querySelector('button');button.disabled=true;document.querySelector('[data-report-export]').disabled=true;
  try{await load();}catch(e){window.crmUI.toast(e.message);}finally{button.disabled=false;}
 });
 document.addEventListener('click',async event=>{
  const more=event.target.closest('[data-report-more]'),exportButton=event.target.closest('[data-report-export]');if(!more&&!exportButton)return;
  const button=more||exportButton;if(button.disabled)return;button.disabled=true;
  try{if(more)await load(true);else await window.crmUI.download(`/reports/${state.name}/export?snapshot_id=${state.report.snapshot_id}`,`carpet-${state.name}.xlsx`);}catch(e){window.crmUI.toast(e.message);}finally{if(button.isConnected)button.disabled=false;}
 });
})();
