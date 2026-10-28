import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {z} from 'zod';
import {orderInput} from './routes/orders.js';
import {HttpError} from './http.js';
const invalid=message=>new HttpError(400,message,'IMPORT_INVALID');
export function parseCsv(input){
 const text=input.replace(/^\uFEFF/,''),rows=[];let row=[],value='',quoted=false,closed=false;
 for(let i=0;i<=text.length;i++){
  const ch=text[i];if(quoted){if(ch===undefined)throw invalid('Незакрытая кавычка CSV');if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
  if(ch==='"'){if(value||closed)throw invalid('Неверные кавычки CSV');quoted=true;continue;}
  if(ch===','||ch==='\n'||ch==='\r'||ch===undefined){row.push(value);value='';closed=false;if(ch!==','){if(ch==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}}else{if(closed)throw invalid('Лишний текст после кавычки CSV');value+=ch;}
  if(value.length>30000||rows.length>101)throw invalid('Допустимо до 100 строк и 30000 символов в ячейке');
 }return rows;
}
function parseXlsx(bytes){
 let total=0,count=0,zip;try{zip=unzipSync(bytes,{filter:file=>{total+=file.originalSize;count++;if(total>10000000||count>100||file.originalSize>5000000)throw invalid('Файл Excel слишком велик после распаковки');return true;}});}catch(e){if(e instanceof HttpError)throw e;throw invalid('Повреждённый XLSX');}
 if(Object.keys(zip).some(k=>/externalLinks|vbaProject/i.test(k)))throw invalid('Внешние ссылки и макросы не поддерживаются');
 const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,processEntities:true,removeNSPrefix:true});
 const read=path=>{if(!zip[path])return null;const text=strFromU8(zip[path]);if(/<!DOCTYPE|<!ENTITY/i.test(text))throw invalid('Объявления XML-сущностей запрещены');return parser.parse(text);};
 const arr=v=>v==null?[]:Array.isArray(v)?v:[v],plain=v=>v==null?'':typeof v==='object'?v['#text']??'':String(v);
 const rich=v=>v?.t!=null?plain(v.t):arr(v?.r).map(x=>plain(x.t)).join('');
 const strings=arr(read('xl/sharedStrings.xml')?.sst?.si).map(rich),sheet=read('xl/worksheets/sheet1.xml')?.worksheet;
 const styles=read('xl/styles.xml')?.styleSheet,formats=new Map(arr(styles?.numFmts?.numFmt).map(f=>[Number(f['@numFmtId']),f['@formatCode']])),xfs=arr(styles?.cellXfs?.xf),date1904=['1','true'].includes(String(read('xl/workbook.xml')?.workbook?.workbookPr?.['@date1904']));
 if(!sheet)throw invalid('В XLSX отсутствует первый лист');const rows=[];
 for(const r of arr(sheet.sheetData?.row)){
  if(rows.length>100)throw invalid('Допустимо до 100 строк');const row=[];
  for(const c of arr(r.c)){
   if(c.f!=null)throw invalid('Формулы в импортируемых ячейках не поддерживаются');
   const ref=/^([A-Z]{1,2})\d+$/.exec(c['@r']||'');if(!ref)throw invalid('Неверный адрес ячейки');const col=[...ref[1]].reduce((a,v)=>a*26+v.charCodeAt(0)-64,0)-1;if(col>40)throw invalid('Не более 41 колонки');
   let v=c['@t']==='s'?strings[Number(c.v)]:c['@t']==='inlineStr'?rich(c.is):plain(c.v);if(typeof v!=='string')v=String(v??'');
   const fmt=Number(xfs[Number(c['@s']||0)]?.['@numFmtId']),custom=String(formats.get(fmt)||'').replace(/"[^"]*"|\[[^\]]*\]/g,'');
   if((!c['@t']||c['@t']==='n')&&((fmt>=14&&fmt<=22)||(/[yd]/i.test(custom)&&/m/i.test(custom)))&&/^\d+(?:\.0+)?$/.test(v)){
    const serial=Number(v);if(serial<1||serial>100000)throw invalid('Дата Excel вне диапазона');v=new Date((serial-(date1904?24107:25569))*86400000).toISOString().slice(0,10);
   }
   if(v.length>30000)throw invalid('Слишком длинная ячейка');row[col]=v;
  }if(row.some(v=>v!=null&&v!==''))rows.push(row);
 }return rows;
}
export function importRows({format,data,kind,branch_id}){
 let bytes;try{bytes=Buffer.from(data,'base64');}catch{throw invalid('Неверный base64');}if(bytes.length>2000000)throw invalid('Файл должен быть меньше 2 МБ');
 const table=format==='csv'?parseCsv(bytes.toString('utf8')):parseXlsx(new Uint8Array(bytes));if(table.length<2)throw invalid('Нужны заголовок и хотя бы одна строка');
 const [header,...rows]=table;if(new Set(header).size!==header.length)throw invalid('Повторяющиеся имена колонок');
 const allowed=kind==='clients'?['name','phone','address']:['name','phone','address','pickup_date','pickup_slot','source','comment','urgent','stains','pensioner','items','length_m','width_m','tariff'];
 if(header.some(h=>!allowed.includes(h)))throw invalid('Неизвестные колонки. Скачайте образец импорта');
 const client=z.object({name:z.string().max(120),phone:z.string().regex(/^\+998\d{9}$/),address:z.string().min(3).max(300)}).strict();
 return rows.map((row,index)=>{
  if(row.length>header.length)throw invalid(`Строка ${index+2}: больше значений, чем заголовков`);const value=Object.fromEntries(header.map((key,i)=>[key,row[i]??'']));
  try{
   if(kind==='clients')return client.parse(value);
   const items=value.items?JSON.parse(value.items):[{length_m:Number(value.length_m),width_m:Number(value.width_m),tariff:value.tariff}];
   for(const k of ['items','length_m','width_m','tariff'])delete value[k];for(const k of ['urgent','stains','pensioner']){if(value[k]!=null&&!['','0','1','true','false'].includes(value[k]))throw Error();value[k]=['1','true'].includes(value[k]);}
   for(const k of ['source','pickup_slot','comment'])if(value[k]==='')delete value[k];return orderInput.parse({...value,branch_id,items});
  }catch{throw invalid(`Строка ${index+2}: проверьте телефон +998, дату YYYY-MM-DD, размеры, тариф и обязательные поля`);}
 });
}
export const csvCell=v=>{const raw=String(v??''),safe=/^[\s]*[=+\-@]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';};
export const exportCsv=(rows,columns)=>'\uFEFF'+[columns,...rows.map(r=>columns.map(c=>typeof r[c]==='object'?JSON.stringify(r[c]):r[c]))].map(r=>r.map(csvCell).join(',')).join('\r\n');
