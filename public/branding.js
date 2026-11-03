import {t} from './i18n.js';
import {BRAND_DEFAULTS,BRAND_PRESETS,brandHex,brandPalette,brandColorErrors} from './theme.js';
(()=>{
 const modules=window.crmModules,ui=()=>window.crmUI,$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const asset=id=>/^[0-9a-f-]{36}$/i.test(id||'')?'/api/branding/assets/'+id:null;
 let saved={...BRAND_DEFAULTS,revision:0},draft=null,editing=false,saving=false;
 const files=new Map(),previews=new Map();
 function clean(input){
  const c={...BRAND_DEFAULTS,revision:input?.revision};for(const key of Object.keys(BRAND_DEFAULTS))if(input?.[key]!==undefined)c[key]=input[key];
  c.mode=c.mode==='dark'?'dark':'light';
  for(const key of ['accent_color','background_color','sidebar_color'])if(!brandHex(c[key]))c[key]=BRAND_PRESETS[c.mode][key];
  if(brandColorErrors(c).length)Object.assign(c,BRAND_PRESETS[c.mode]);
  c.organization_name=typeof c.organization_name==='string'?c.organization_name.slice(0,80):null;
  c.subtitle=typeof c.subtitle==='string'?c.subtitle.slice(0,120):null;
  c.logo_id=asset(c.logo_id)?c.logo_id:null;c.background_id=asset(c.background_id)?c.background_id:null;
  c.background_opacity=Number.isFinite(Number(c.background_opacity))?Math.max(0,Math.min(0.2,Number(c.background_opacity))):0.12;
  c.revision=Number.isInteger(c.revision)&&c.revision>=0?c.revision:0;return c;
 }
 function identity(c=editing&&draft?draft:saved){return {name:c.organization_name||t('title'),subtitle:c.subtitle===null?t('subtitle'):c.subtitle,logo:previews.get('logo')||asset(c.logo_id)};}
 function paint(c){
  const palette=brandPalette(previews.has('background')?{...c,background_id:'preview'}:c);for(const [key,value]of Object.entries(palette))document.documentElement.style.setProperty(key,value);
  document.documentElement.dataset.theme=c.mode;document.documentElement.style.colorScheme=c.mode;
  const background=previews.get('background')||asset(c.background_id);
  document.documentElement.style.setProperty('--page-image',background?'url("'+background+'")':'none');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',c.accent_color);
  const info=identity(c),name=$('[data-brand-name]'),subtitle=$('[data-brand-subtitle]'),logo=$('[data-brand-logo]');
  document.title=info.name;if(name)name.textContent=info.name;if(subtitle){subtitle.textContent=info.subtitle||'';subtitle.hidden=!info.subtitle;}
  if(logo){logo.hidden=!info.logo;if(info.logo)logo.src=info.logo;else logo.removeAttribute('src');}
  const icon=document.querySelector('link[rel=icon]');if(icon)icon.href=asset(c.logo_id)||'/icon.svg';
  const preview=$('[data-brand-preview]');if(preview)preview.innerHTML='<div class="brand-preview-identity">'+(info.logo?'<img src="'+esc(info.logo)+'" alt="">':'')+'<strong>'+esc(info.name)+'</strong><small>'+esc(info.subtitle||'')+'</small></div><div class="box"><strong>'+esc(t('themeSampleCard'))+'</strong><p class="muted">'+esc(t('themeSampleText'))+'</p><span class="button primary">'+esc(t('themeSampleButton'))+'</span></div>';
 }
 function clearFiles(){for(const url of previews.values())URL.revokeObjectURL(url);files.clear();previews.clear();}
 function apply(data){saved=clean(data);try{localStorage.setItem('crm_branding',JSON.stringify(saved));}catch{}paint(saved);}
 async function load(){
  if(editing)return;
  try{const cached=localStorage.getItem('crm_branding');if(cached)saved=clean(JSON.parse(cached));}catch{}
  paint(saved);try{apply(await ui().api('/branding'));}catch{paint(saved);}
 }
 function read(form){return {...draft,organization_name:form.elements.organization_name.value.trim()||null,subtitle:form.elements.subtitle.value.trim(),mode:form.elements.mode.value,accent_color:form.elements.accent_color.value,background_color:form.elements.background_color.value,sidebar_color:form.elements.sidebar_color.value,background_opacity:Number(form.elements.background_opacity.value)/100};}
 function preview(form){
  draft=read(form);const error=form.querySelector('[data-brand-error]');if(brandColorErrors(files.has('background')?{...draft,background_id:'preview'}:draft).length){error.textContent=t('themeLowContrast');return;}
  error.textContent='';paint(draft);
 }
 function imageField(kind,label){return '<div class="theme-image-field"><label for="branding-'+kind+'">'+esc(t(label))+'</label><input id="branding-'+kind+'" data-brand-file="'+kind+'" type="file" accept="image/png,image/jpeg,image/webp"><small data-brand-filename="'+kind+'">'+esc(files.get(kind)?.name||t(draft[kind+'_id']?'themeImageSaved':'themeImageHint'))+'</small><button type="button" class="text-button" data-brand="remove" data-kind="'+kind+'">'+esc(t('themeRemoveImage'))+'</button></div>';}
 async function render(main){
  if(!editing){draft={...saved};editing=true;}
  const info=identity(draft);
  main.innerHTML='<div class="heading"><div><h1>'+esc(t('themeSettings'))+'</h1><p class="module-help">'+esc(t('themeSharedHint'))+'</p></div></div><div class="theme-editor"><form data-brand-form><div class="theme-presets" role="group" aria-label="'+esc(t('themePreset'))+'">'+Object.keys(BRAND_PRESETS).map(key=>'<button type="button" data-brand="preset" data-preset="'+key+'">'+esc(t('themePreset_'+key))+'</button>').join('')+'</div><section class="box theme-section"><h2>'+esc(t('themeIdentity'))+'</h2><label>'+esc(t('themeOrganization'))+'<input name="organization_name" value="'+esc(info.name)+'" required maxlength="80"></label><label>'+esc(t('themeSubtitle'))+'<input name="subtitle" value="'+esc(info.subtitle||'')+'" maxlength="120"></label>'+imageField('logo','themeLogo')+'<p class="muted">'+esc(t('themePublicImageHint'))+'</p></section><section class="box theme-section"><h2>'+esc(t('themeColors'))+'</h2><label>'+esc(t('themeMode'))+'<select name="mode"><option value="light" '+(draft.mode==='light'?'selected':'')+'>'+esc(t('themePreset_light'))+'</option><option value="dark" '+(draft.mode==='dark'?'selected':'')+'>'+esc(t('themePreset_dark'))+'</option></select></label><div class="theme-color-grid">'+['accent_color','background_color','sidebar_color'].map(key=>'<label>'+esc(t('theme_'+key))+'<input type="color" name="'+key+'" value="'+draft[key]+'"></label>').join('')+'</div>'+imageField('background','themeBackgroundImage')+'<label>'+esc(t('themeBackgroundStrength'))+'<input type="range" name="background_opacity" min="0" max="20" step="1" value="'+Math.round(draft.background_opacity*100)+'"></label><button type="button" class="text-button" data-brand="defaults">'+esc(t('themeReset'))+'</button></section><p class="error" role="alert" data-brand-error></p><div class="actions theme-save-actions"><button class="primary" type="submit">'+esc(t('save'))+'</button><button type="button" data-brand="cancel">'+esc(t('themeDiscard'))+'</button></div></form><aside class="theme-preview"><h2>'+esc(t('themePreview'))+'</h2><div data-brand-preview></div></aside></div>';
  paint(draft);
 }
 window.CRMBranding={load,identity,apply};
 modules.addFeature({key:'appearance',permission:'staff',roles:['admin'],render});
 document.addEventListener('input',e=>{const form=e.target.closest('[data-brand-form]');if(form&&e.target.type!=='file'&&e.target.name!=='mode')preview(form);});
 document.addEventListener('change',async e=>{
  if(e.target.name==='mode'&&e.target.closest('[data-brand-form]')){Object.assign(draft,BRAND_PRESETS[e.target.value]);await render($('#main'));return;}
  const kind=e.target.dataset?.brandFile;if(!kind)return;const file=e.target.files?.[0];if(!file)return;
  const error=$('[data-brand-error]');if(file.size>2097152||!['image/png','image/jpeg','image/webp'].includes(file.type)){error.textContent=t('themeImageFormat');e.target.value='';return;}
  if(previews.has(kind))URL.revokeObjectURL(previews.get(kind));files.set(kind,file);previews.set(kind,URL.createObjectURL(file));$('[data-brand-filename="'+kind+'"]').textContent=file.name;preview(e.target.closest('form'));
 });
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-brand]');if(!b||saving)return;const form=$('[data-brand-form]');if(!form)return;
  if(b.dataset.brand==='cancel'){clearFiles();draft={...saved};await render($('#main'));return;}
  if(b.dataset.brand==='preset'){Object.assign(draft,BRAND_PRESETS[b.dataset.preset]);await render($('#main'));return;}
  if(b.dataset.brand==='defaults'){Object.assign(draft,BRAND_PRESETS.light,{background_id:null,background_opacity:BRAND_DEFAULTS.background_opacity});files.delete('background');if(previews.has('background'))URL.revokeObjectURL(previews.get('background'));previews.delete('background');await render($('#main'));return;}
  if(b.dataset.brand==='remove'){const kind=b.dataset.kind;draft[kind+'_id']=null;files.delete(kind);if(previews.has(kind))URL.revokeObjectURL(previews.get(kind));previews.delete(kind);form.querySelector('[data-brand-file="'+kind+'"]').value='';$('[data-brand-filename="'+kind+'"]').textContent=t('themeImageHint');preview(form);}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target;if(!form.matches('[data-brand-form]'))return;e.preventDefault();if(saving||!form.reportValidity())return;
  draft=read(form);const error=form.querySelector('[data-brand-error]');if(!draft.organization_name){error.textContent=t('themeNameRequired');return;}if(brandColorErrors(files.has('background')?{...draft,background_id:'preview'}:draft).length){error.textContent=t('themeLowContrast');return;}
  saving=true;const header=$('#header'),previousInert=header.inert;header.inert=true;form.setAttribute('aria-busy','true');form.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
  try{
   for(const [kind,file]of files){const uploaded=await ui().api('/branding/assets?kind='+kind,{method:'POST',file});draft[kind+'_id']=uploaded.id;files.delete(kind);}
   const {revision,...data}=draft,result=await ui().api('/branding',{method:'POST',body:{...data,expected_revision:saved.revision}});
   clearFiles();apply(result);draft={...saved};await render($('#main'));ui().toast(t('themeSaved'));
  }catch(err){if(error.isConnected)error.textContent=err.message;}
  finally{saving=false;header.inert=previousInert;if(form.isConnected){form.removeAttribute('aria-busy');form.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}}
 });
 const originalRender=modules.render;modules.render=async view=>{if(view!=='appearance'&&editing){clearFiles();editing=false;draft=null;paint(saved);}return originalRender(view);};
 const originalLogout=modules.logout;modules.logout=()=>{clearFiles();editing=false;draft=null;paint(saved);originalLogout();};
})();
