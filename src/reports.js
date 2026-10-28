import {readFileSync} from 'node:fs';
import {t} from '../public/i18n.js';
export const REPORTS=Object.freeze(JSON.parse(readFileSync(new URL('../config/reports.json',import.meta.url),'utf8')));
export function decorateReport(data){
 const definition=REPORTS[data.name];
 const rows=data.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,definition.columns.some(c=>c[0]===key&&c[2]==='status')?t(value):value])));
 return {...data,title:definition.title,note:definition.note,chart_key:definition.chart,columns:definition.columns.map(([key,label,format])=>({key,label,format})),rows,totals:definition.totals.map(([key,label,format])=>({key,label,format,value:data.summary[key]??null}))};
}
