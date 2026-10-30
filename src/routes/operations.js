import {Router} from 'express';
import {z} from 'zod';
import {randomInt} from 'node:crypto';
import QRCode from 'qrcode';
import {operationPermissions,operationFilters} from '../operations.js';
import {allow,can} from '../permissions.js';
import {checked,HttpError,parseCursor} from '../http.js';
import {otpHash,encrypt} from '../integration-security.js';
import {importRows,exportCsv} from '../import-data.js';
import {exportReport} from '../export-report.js';
import {t,money,date} from '../../public/i18n.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=z.string().uuid(),key=req=>uuid.parse(req.get('Idempotency-Key'));
export function createOperations(db,config={}){
 const r=Router();
 r.get('/payment-intents/:id/link',allow('read'),async(req,res)=>{
  if(req.user.role==='workshop')throw new HttpError(403,'Нет доступа к оплате','FORBIDDEN');
  const id=uuid.parse(req.params.id);z.object({}).strict().parse(req.query);const intent=checked(await db.from('payment_intents').select('id,order_id,provider,amount,state,expires_at').eq('id',id).maybeSingle());if(!intent)throw new HttpError(404,'Счёт не найден');
  checked(await db.rpc('crm_order',{p_order:intent.order_id,p_user:req.user.id}));if(![0,1].includes(intent.state)||Date.parse(intent.expires_at)<=Date.now())throw new HttpError(409,'Счёт закрыт или истёк');
  let url;if(intent.provider==='payme'&&config.paymeMerchantId)url='https://checkout.paycom.uz/'+Buffer.from(`m=${config.paymeMerchantId};ac.intent_id=${intent.id};a=${Number(intent.amount)*100};l=ru`).toString('base64');
  if(intent.provider==='click'&&config.clickMerchantId&&config.clickServiceId)url='https://my.click.uz/services/pay?'+new URLSearchParams({service_id:config.clickServiceId,merchant_id:config.clickMerchantId,amount:String(intent.amount),transaction_param:intent.id});
  if(!url)throw new HttpError(503,'Не задан идентификатор кассы провайдера','PROVIDER_DISABLED');res.json({url});
 });
 r.get('/ops/:view',async(req,res)=>{
  const view=z.enum(Object.keys(operationPermissions)).parse(req.params.view);if(!can(req.user,operationPermissions[view]))throw new HttpError(403,'Недостаточно прав','FORBIDDEN');
  const f=operationFilters.parse(req.query);if(f.cursor){const c=parseCursor(f.cursor);f.cursor_at=c.at;f.cursor_id=c.id;delete f.cursor;}
  const data=checked(await db.rpc('crm_operations',{view_name:view,f,u:req.user.id}));
  const list=({stock:'movements',quality:'complaints',integrations:'outbox'})[view];if(list&&data[list]?.length>100){data[list]=data[list].slice(0,100);const last=data[list].at(-1);data.next_cursor=Buffer.from(JSON.stringify({at:last.created_at,id:last.id})).toString('base64url');}
  res.json(data);
 });
 r.post('/intake/:id/challenge',allow('photos'),async(req,res)=>{
  const id=uuid.parse(req.params.id),request_key=key(req);z.object({}).strict().parse(req.body??{});
  if(!config.otpSecret||!config.smsToken)throw new HttpError(503,'SMS-подтверждение ещё не подключено','NOTIFICATIONS_DISABLED');
  const a=checked(await db.from('intake_acts').select('id,order_id,public_token').eq('id',id).maybeSingle());if(!a)throw new HttpError(404,'Акт не найден');
  checked(await db.rpc('crm_order',{p_order:a.order_id,p_user:req.user.id,p_permission:'photos'}));
  const code=String(randomInt(100000,1000000)),hash=otpHash(a.public_token,code,config.otpSecret),ciphertext=encrypt(`${t('intakeOtpPrefix')}: ${code}. ${t('intakeOtpValidity')}`,config.notificationKey);
  res.json(checked(await db.rpc('crm_intake_challenge',{act_id:id,u:req.user.id,ip:req.ip,request_key,hash,ciphertext})));
 });
 r.post('/imports/:kind',allow('integrations'),async(req,res)=>{
  const kind=z.enum(['clients','orders']).parse(req.params.kind),b=z.object({format:z.enum(['csv','xlsx']),data:z.string().min(1).max(2800000).regex(/^[A-Za-z0-9+/\r\n]*={0,2}$/),branch_id:uuid,dry_run:z.boolean().default(true)}).strict().parse(req.body),rows=importRows({...b,kind});
  const data=checked(await db.rpc('crm_import',{kind,rows_data:rows,u:req.user.id,ip:req.ip,key:key(req),dry_run:b.dry_run}));res.json({...data,...(b.dry_run?{preview:rows.slice(0,5)}:{})});
 });
 r.get('/imports/:kind/template',allow('integrations'),async(req,res)=>{
  const kind=z.enum(['clients','orders']).parse(req.params.kind);z.object({}).strict().parse(req.query);
  const columns=['name','phone','address',...(kind==='orders'?['pickup_date','length_m','width_m','tariff']:[])];
  const row={name:'Образец — удалите строку',phone:'+998901234567',address:'Ташкент, Навои 1',pickup_date:'2027-01-01',length_m:3,width_m:2,tariff:'wool'};
  // Телефон в образце оставлен строкой; обычная выгрузка защищает CSV от формул.
  res.type('text/csv').attachment(`template-${kind}.csv`).send(exportCsv([row],columns).replace("'+998901234567",'+998901234567'));
 });
 r.get('/exports/clients',allow('exports'),async(req,res)=>{
  const f=z.object({branch_id:uuid.optional(),cursor_id:uuid.optional(),format:z.enum(['csv','xlsx']).default('csv')}).strict().parse(req.query),rows=checked(await db.rpc('crm_export_clients',{f,u:req.user.id})),more=rows.length>1000,data=rows.slice(0,1000);
  if(more)res.set('X-Next-Cursor',data.at(-1).id);
  if(f.format==='csv')return res.type('text/csv').attachment('clients.csv').send(exportCsv(data,['id','name','phone','address','tags','blacklisted']));
  const definition={columns:[['name',t('client'),'text'],['count',t('entry'),'integer'],['phone',t('phone'),'text'],['address',t('address'),'text'],['tags',t('tags'),'text'],['blacklisted',t('blacklisted'),'integer']],chart:'count',totals:[['clients',t('clients'),'integer','sum:count']]};
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tashkent'}).format(new Date());
  const file=await exportReport({title:t('clients'),note:t('clientsExcelNote'),filters:{from:today,to:today},generated_at:new Date().toISOString(),rows:data.map(c=>({...c,count:1,tags:c.tags?.join(', '),blacklisted:c.blacklisted?1:0})),summary:{clients:data.length}},definition);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('clients.xlsx').send(file);
 });
 r.get('/orders/:id/print/:kind',async(req,res)=>{
  const id=uuid.parse(req.params.id),kind=z.enum(['labels','receipt','act']).parse(req.params.kind);z.object({}).strict().parse(req.query);
  const o=checked(await db.rpc('crm_order',{p_order:id,p_user:req.user.id,p_permission:'read'}));if(req.user.role==='workshop'&&kind!=='labels')throw new HttpError(403,'Нет доступа к финансовым документам','FORBIDDEN');
  if(kind!=='labels'&&o.pricing_state==='awaiting_measurements')throw new HttpError(409,'Стоимость и документы будут доступны после замера ковров в цехе','MEASUREMENTS_PENDING');
  const items=checked(await db.from('order_items').select('*').eq('order_id',id).order('seq'));
  let body;
  if(kind==='labels')body=(await Promise.all(items.map(async i=>{const label=`K-${o.number}-${i.seq}`,svg=await QRCode.toString(label,{type:'svg',errorCorrectionLevel:'M',margin:2,width:110});return `<section class="label">${svg}<strong>${escape(label)}</strong><span>${i.length_m!=null?`${escape(i.length_m)} × ${escape(i.width_m)} ${t('meter')}`:escape(t(i.unit==='piece'?'onePiece':'notMeasured'))}</span></section>`;}))).join('');
  else if(kind==='act'){
   const docs=checked(await db.rpc('crm_operations',{view_name:'documents',f:{order_id:id},u:req.user.id})),a=docs.acts[0];if(!a)throw new HttpError(404,'Сначала создайте акт приёма');
   const photos=[];for(const i of a.snapshot.items||[])for(const p of i.photos||[]){const signed=checked(await db.storage.from(config.bucket||'carpet-photos').createSignedUrl(p.path,300));photos.push(`<img class="act-photo" src="${escape(signed.signedUrl)}" alt="${escape(t('item')+' '+i.seq)}">`);}
   body=`<h1>${t('intakeAct')} ${escape(a.snapshot.code)}</h1><p>${escape(a.snapshot.address)}</p><p>${escape(a.snapshot.note)}</p>${(a.snapshot.items||[]).map(i=>`<p>${t('item')} ${i.seq}: ${i.length_m!=null?`${i.length_m} × ${i.width_m} ${t('meter')}`:escape(t(i.unit==='piece'?'onePiece':'notMeasured'))}</p>`).join('')}<h2>${t('defect')}</h2>${(a.snapshot.defects||[]).map(d=>`<p>${escape(d.defect_code)}: ${escape(d.note)}</p>`).join('')}${photos.join('')}<p>${t('createdAt')}: ${escape(date(a.created_at))}</p><p>${t('smsConfirmation')}: ${escape(a.confirmed_at?date(a.confirmed_at):t('pending'))}</p>`;
  }else{
   const payments=checked(await db.from('payments').select('amount,method,direction,state,created_at').eq('order_id',id).order('created_at'));
   body=`<h1>${t('receiptTitle')} K-${o.number}</h1><p>${t('receiptHint')}</p>${items.map(i=>`<p>${t('item')} ${i.seq}: ${i.length_m!=null?`${i.length_m} × ${i.width_m} ${t('meter')}`:escape(t(i.unit==='piece'?'onePiece':'notMeasured'))} — ${money(i.price)}</p>`).join('')}<p>${t('liableAmount')}: ${money(o.status==='cancelled'?o.completed_work_amount:o.total)}. ${t('receivedAmount')}: ${money(o.paid_amount)}.</p><table><thead><tr>${['date','method','paymentDirection','amount'].map(k=>`<th>${t(k)}</th>`).join('')}</tr></thead><tbody>${payments.map(p=>`<tr><td>${escape(date(p.created_at))}</td><td>${escape(t(p.method))}</td><td>${escape(t(p.direction==='refund'?'refund':'payment'))} (${escape(t(p.state))})</td><td>${money(p.amount)}</td></tr>`).join('')}</tbody></table>`;
  }
  res.type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>K-${o.number}</title><link rel="stylesheet" href="/print.css"></head><body>${body}</body></html>`);
 });return r;
}
