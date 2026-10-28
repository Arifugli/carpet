import {readFile} from 'node:fs/promises';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {REPORTS} from './reports.js';

// Верстка/стили/диаграмма созданы Artifact Tool. Runtime заполняет OOXML шаблона,
// не зависит от локального рабочего окружения автора и не вычисляет бизнес-агрегаты.
const escape=value=>String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const letter=index=>{let result='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
const numeric=value=>{const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw new Error('REPORT_NUMBER_OUT_OF_RANGE');return n;};
const excelDate=value=>Math.floor(Date.parse(`${String(value).slice(0,10)}T00:00:00Z`)/86400000)+25569;
function cell(reference,value,style,{formula,format}={}){
 const a=`r="${reference}" s="${style}"`;
 if(formula){const asText=['text','status'].includes(format);const cached=value==null?'':`<x:v>${asText?escape(value):numeric(value)}</x:v>`;return `<x:c ${a}${value==null||asText?' t="str"':' t="n"'}><x:f>${escape(formula)}</x:f>${cached}</x:c>`;}
 if(value==null)return `<x:c ${a}/>`;
 if(format==='date')return `<x:c ${a} t="n"><x:v>${numeric(excelDate(value))}</x:v></x:c>`;
 if(format&&!['text','status'].includes(format))return `<x:c ${a} t="n"><x:v>${numeric(value)}</x:v></x:c>`;
 return `<x:c ${a} t="inlineStr"><x:is><x:t xml:space="preserve">${escape(value)}</x:t></x:is></x:c>`;
}
function wrap(text,width=120){const lines=[];let line='';for(const word of String(text).split(/\s+/)){if(line.length+word.length>width&&line){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;}

export async function exportReport(report){
 const def=REPORTS[report.name],archive=unzipSync(new Uint8Array(await readFile(new URL('../assets/report-template.xlsx',import.meta.url))));
 let sheet=strFromU8(archive['xl/worksheets/sheet1.xml']);
 const getStyle=ref=>{const tag=sheet.match(new RegExp(`<x:c\\b[^>]*r="${ref}"[^>]*>`))?.[0];const s=tag?.match(/\bs="(\d+)"/)?.[1];if(s==null)throw new Error('INVALID_REPORT_TEMPLATE');return s;};
 const styles={title:getStyle('A2'),note:getStyle('A3'),label:getStyle('A5'),header:getStyle('A20'),text:getStyle('A21'),status:getStyle('A21'),integer:getStyle('B21'),money:getStyle('E21'),percent:getStyle('D21'),date:getStyle('F21'),decimal:getStyle('H21')};
 let styleXml=strFromU8(archive['xl/styles.xml']);const xfBlock=styleXml.match(/<x:cellXfs\b[^>]*>([\s\S]*?)<\/x:cellXfs>/),xfs=[...xfBlock[1].matchAll(/<x:xf\b[^>]*(?:\/>|>[\s\S]*?<\/x:xf>)/g)].map(m=>m[0]);
 let wrapped=xfs[Number(styles.text)];if(wrapped.includes('<x:alignment'))wrapped=wrapped.replace(/<x:alignment\b[^>]*\/>/,'<x:alignment wrapText="1" vertical="center"/>');else if(wrapped.endsWith('/>'))wrapped=wrapped.slice(0,-2)+'><x:alignment wrapText="1" vertical="center"/></x:xf>';else wrapped=wrapped.replace('</x:xf>','<x:alignment wrapText="1" vertical="center"/></x:xf>');
 styles.text=styles.status=String(xfs.length);styleXml=styleXml.replace(xfBlock[0],`<x:cellXfs count="${xfs.length+1}">${xfs.join('')}${wrapped}</x:cellXfs>`);archive['xl/styles.xml']=strToU8(styleXml);
 const summaryStyles={integer:getStyle('B5'),money:getStyle('B6'),percent:getStyle('B7'),decimal:getStyle('B8')};
 const filterText=Object.entries(report.filter_labels||{}).map(([k,v])=>`${k}: ${v}`).join('; ');
 const notes=[...wrap(filterText),...wrap(report.note)],headerRow=Math.max(20,18+notes.length),first=headerRow+1,last=first+Math.max(report.rows.length-1,0),chartLast=first+Math.max(Math.min(report.rows.length,20)-1,0);
 const col=key=>letter(def.columns.findIndex(c=>c[0]===key));
 const range=key=>report.rows.length?`${col(key)}${first}:${col(key)}${last}`:null;
 const sum=key=>range(key)?`SUM(${range(key)})`:'0';
 const summaryRef=key=>`$B$${5+def.totals.findIndex(t=>t[0]===key)}`;
 const formulaFor=(spec,row)=>{
  if(!spec)return null;const [kind,a,b,c]=spec.split(':'),ref=key=>`${col(key)}${row}`;
  const divide=(num,den)=>`IF(OR(${den}="",${den}=0,${num}=""),"",${num}/${den})`;
  if(kind==='ratio')return divide(ref(a),ref(b));
  if(kind==='denominator')return divide(ref(a),summaryRef(b));
  if(kind==='success')return `IF(${ref(a)}+${ref(b)}=0,"",${ref(a)}/(${ref(a)}+${ref(b)}))`;
  if(kind==='nps')return `IF(${ref(c)}=0,"",100*(${ref(a)}-${ref(b)})/${ref(c)})`;
  if(kind==='debt')return `MAX(0,${ref(a)}-${ref(b)})`;
  if(kind==='add')return `${ref(a)}+${ref(b)}`;
  if(kind==='repeat')return `IF(${ref(a)}>=2,1,0)`;
  if(kind==='sleeping')return `IF(${ref(a)}>=${summaryRef('dormant_days')},1,0)`;
  if(kind==='sum')return sum(a);
  if(kind==='knownSum')return range(a)?`IF(COUNT(${range(a)})=0,"",${sum(a)})`:'0';
  if(kind==='summaryRatio')return divide(summaryRef(a),summaryRef(b));
  if(kind==='sumRatio')return divide(sum(a),sum(b));
  if(kind==='count')return range(def.columns[0][0])?`COUNTA(${range(def.columns[0][0])})`:'0';
  if(kind==='row')return `${col(a)}${first+Number(b)}`;
  if(kind==='npsTotal')return `IF(${sum(c)}=0,"",100*(${sum(a)}-${sum(b)})/${sum(c)})`;
  throw new Error('UNKNOWN_REPORT_FORMULA');
 };
 const row=(n,cells,height=22)=>`<x:row r="${n}" ht="${height}" customHeight="1">${cells.join('')}</x:row>`;
 const rows=[row(2,[cell('A2',`${report.title}. Ковёр CRM`,styles.title)],28),row(3,[cell('A3',`${report.filters.from} — ${report.filters.to}. Asia/Tashkent`,styles.note)])];
 def.totals.forEach(([key,label,format,formula],i)=>{const n=5+i;const cached=report.summary[key]??(formula?.startsWith('sum:')?report.rows.length?null:0:null);rows.push(row(n,[cell(`A${n}`,label,styles.label),cell(`B${n}`,cached,summaryStyles[format]||styles[format]||styles.text,{formula:formulaFor(formula,n),format})]));});
 if(report.generated_at)rows.push(row(12,[cell('A12',`Сформирован: ${new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'}).format(new Date(report.generated_at))}`,styles.note)]));
 rows.push(row(16,[cell('A16','Источник: Ковёр CRM',styles.note)]));
 notes.forEach((line,i)=>rows.push(row(17+i,[cell(`A${17+i}`,line,styles.note)])));
 rows.push(row(headerRow,[...def.columns.map(([key,label],i)=>cell(`${letter(i)}${headerRow}`,label,styles.header)),cell(`K${headerRow}`,'Метки диаграммы',styles.header)],44));
 report.rows.forEach((data,index)=>{const n=first+index,cells=def.columns.map(([key,,format,formula],i)=>cell(`${letter(i)}${n}`,data[key],styles[format]||styles.text,{formula:formulaFor(formula,n),format}));
  if(index<20){const firstKey=def.columns[0][0],rawLabel=def.columns[0][2]==='date'?String(data[firstKey]).slice(0,10).split('-').reverse().join('.'):String(data[firstKey]??'');const label=rawLabel.length>28?rawLabel.slice(0,25)+'…':rawLabel;const formula=def.columns[0][2]==='date'?`RIGHT("0"&DAY(A${n}),2)&"."&RIGHT("0"&MONTH(A${n}),2)&"."&YEAR(A${n})`:`IF(LEN(A${n})>28,LEFT(A${n},25)&"…",A${n})`;cells.push(cell(`K${n}`,label,styles.text,{formula,format:'text'}));}
  const lines=Math.max(1,...def.columns.map(([key,,format],i)=>['text','status'].includes(format)?Math.ceil(String(data[key]??'').length/(i===0?28:i<3?20:18)):1));rows.push(row(n,cells,Math.max(22,Math.min(10,lines)*14+6)));
 });
 sheet=sheet.replace(/<x:sheetData>[\s\S]*?<\/x:sheetData>/,`<x:sheetData>${rows.join('')}</x:sheetData><x:autoFilter ref="A${headerRow}:${letter(def.columns.length-1)}${last}"/>`);
 sheet=sheet.replace(/ySplit="\d+" topLeftCell="[A-Z]+\d+"/,`ySplit="${headerRow}" topLeftCell="A${first}"`);
 sheet=sheet.replace('</x:cols>','<x:col min="11" max="11" width="28" customWidth="1"/></x:cols>');
 sheet=sheet.replace(/<x:conditionalFormatting\b[^>]*sqref="[^"]+"/,`<x:conditionalFormatting sqref="${col(def.chart)}${first}:${col(def.chart)}${last}"`);
 archive['xl/worksheets/sheet1.xml']=strToU8(sheet);
 if(archive['xl/sharedStrings.xml'])archive['xl/sharedStrings.xml']=strToU8('<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>');
 const part=Object.keys(archive).find(k=>/\/charts\/chart[^/]*\.xml$/.test(k));if(!part)throw new Error('MISSING_CHART');
 let chart=strFromU8(archive[part]),chartColumn=def.columns.find(c=>c[0]===def.chart),points=report.rows.slice(0,20);
 const categories=points.map((r,i)=>{let label=String(r[def.columns[0][0]]??'');if(def.columns[0][2]==='date')label=label.slice(0,10).split('-').reverse().join('.');if(label.length>28)label=label.slice(0,25)+'…';return `<c:pt idx="${i}"><c:v>${escape(label)}</c:v></c:pt>`;}).join('');
 const values=points.map((r,i)=>r[def.chart]==null?'':`<c:pt idx="${i}"><c:v>${numeric(r[def.chart])}</c:v></c:pt>`).join('');
 chart=chart.replace(/<c:cat>[\s\S]*?<\/c:cat>/,`<c:cat><c:strRef><c:f>'Отчёт'!$K$${first}:$K$${chartLast}</c:f><c:strCache><c:ptCount val="${points.length}"/>${categories}</c:strCache></c:strRef></c:cat>`);
 const axisFormat=chartColumn[2]==='percent'?'0.0%':chartColumn[2]==='decimal'?'#,##0.00':'#,##0';
 chart=chart.replace(/<c:val>[\s\S]*?<\/c:val>/,`<c:val><c:numRef><c:f>'Отчёт'!$${col(def.chart)}$${first}:$${col(def.chart)}$${chartLast}</c:f><c:numCache><c:formatCode>${axisFormat}</c:formatCode><c:ptCount val="${points.length}"/>${values}</c:numCache></c:numRef></c:val>`);
 chart=chart.replace(/(<c:valAx>[\s\S]*?<c:numFmt )[^>]*\/>/,`$1formatCode="${axisFormat}" sourceLinked="0"/>`);
 chart=chart.replace(/(<c:title>[\s\S]*?<a:t>)[\s\S]*?(<\/a:t>)/,`$1${escape(chartColumn[1]+(report.rows.length>20?' (первые 20 строк)':''))}$2`);
 chart=chart.replace(/<c:tx><c:v>[\s\S]*?<\/c:v><\/c:tx>/,`<c:tx><c:v>${escape(chartColumn[1])}</c:v></c:tx>`);
 archive[part]=strToU8(chart);
 let book=strFromU8(archive['xl/workbook.xml']);book=book.replace(/<x:calcPr\b[^>]*\/>/,'');book=book.replace('</x:workbook>','<x:calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></x:workbook>');archive['xl/workbook.xml']=strToU8(book);
 return Buffer.from(zipSync(archive,{level:6}));
}
