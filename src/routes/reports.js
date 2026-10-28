import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {allow} from '../permissions.js';
import {checked,HttpError} from '../http.js';
import {REPORTS,decorateReport} from '../reports.js';

const query=z.object({from:z.string().date().optional(),to:z.string().date().optional(),branch_id:z.string().uuid().optional(),operator_id:z.string().uuid().optional(),driver_id:z.string().uuid().optional(),source:z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),dormant_days:z.coerce.number().int().min(1).max(3660).optional(),limit:z.coerce.number().int().min(1).max(500).default(100),cursor:z.string().max(600).optional(),snapshot_id:z.string().uuid().optional()}).strict();
let exporting=0;
function workerExport(report){
 if(exporting>=2)throw new HttpError(429,'Экспорт занят. Повторите через несколько секунд.','EXPORT_BUSY');
 exporting++;
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('../workers/report-export.js',import.meta.url),{workerData:report});let settled=false;
  const done=(error,data)=>{if(settled)return;settled=true;exporting--;clearTimeout(timer);error?reject(error):resolve(data);};
  const timer=setTimeout(()=>{worker.terminate();done(new HttpError(503,'Экспорт занял слишком много времени. Уточните фильтры.','EXPORT_TIMEOUT'));},120000);
  worker.once('message',r=>done(r.error?new HttpError(422,'Не удалось сформировать отчёт. Проверьте диапазон и числовые значения.','EXPORT_FAILED'):null,r.data&&Buffer.from(r.data)));
  worker.once('error',e=>done(e));worker.once('exit',code=>{if(code&&!settled)done(new HttpError(500,'Ошибка формирования отчёта','EXPORT_FAILED'));});
 });
}
export function createReports(db){
 const router=Router(),snapshots=new Map();
 const cleanup=()=>{for(const [id,s]of snapshots)if(Date.now()-s.at>300000)snapshots.delete(id);let total=Array.from(snapshots.values()).reduce((n,s)=>n+s.report.rows.length,0);while(snapshots.size>5||(snapshots.size>1&&total>50000)){const key=snapshots.keys().next().value;total-=snapshots.get(key).report.rows.length;snapshots.delete(key);}};
 const load=async(req,name,b)=>{
  cleanup();
  if(b.snapshot_id){const s=snapshots.get(b.snapshot_id);if(!s||s.user!==req.user.id||s.report.name!==name)throw new HttpError(409,'Отчёт устарел. Сформируйте его заново.','REPORT_EXPIRED');return {id:b.snapshot_id,report:s.report};}
  const {limit,cursor,snapshot_id,...filters}=b;
  const raw=checked(await db.rpc('crm_report',{p_name:name,p_filters:filters,p_user:req.user.id}));
  const report=decorateReport(raw),id=randomUUID();
  const label=async(table,value,field)=>value?(checked(await db.from(table).select(field).eq('id',value).maybeSingle())?.[field]||value):'Все';
  report.filter_labels={Филиал:await label('branches',filters.branch_id,'name'),Оператор:await label('profiles',filters.operator_id,'full_name'),Водитель:await label('profiles',filters.driver_id,'full_name'),Источник:filters.source||'Все'};
  snapshots.set(id,{user:req.user.id,at:Date.now(),report});cleanup();return {id,report};
 };
 router.get('/reports',allow('reports'),(req,res)=>{z.object({}).strict().parse(req.query);res.json(Object.entries(REPORTS).map(([name,d])=>({name,title:d.title,note:d.note})));});
 router.get('/reports/:name/export',allow('exports'),async(req,res)=>{
  const name=z.enum(Object.keys(REPORTS)).parse(req.params.name),b=query.parse(req.query),{report}=await load(req,name,b);
  const data=await workerExport(report);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition',`attachment; filename="carpet-${name}-${report.filters.from}-${report.filters.to}.xlsx"`).send(data);
 });
 router.get('/reports/:name',allow('reports'),async(req,res)=>{
  const name=z.enum(Object.keys(REPORTS)).parse(req.params.name),b=query.parse(req.query);let index=0;
  if(b.cursor){let c;try{c=z.object({snapshot_id:z.string().uuid(),index:z.number().int().min(0)}).parse(JSON.parse(Buffer.from(b.cursor,'base64url').toString()));}catch{throw new HttpError(400,'Неверный курсор отчёта','INVALID_CURSOR');}b.snapshot_id=c.snapshot_id;index=c.index;}
  const {id,report}=await load(req,name,b),rows=report.rows.slice(index,index+b.limit),next=index+b.limit;
  res.json({...report,rows,snapshot_id:id,next_cursor:next<report.rows.length?Buffer.from(JSON.stringify({snapshot_id:id,index:next})).toString('base64url'):null});
 });
 return router;
}
