import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {values}=parseArgs({options:{file:{type:'string'},kind:{type:'string'},branch:{type:'string'},url:{type:'string'},key:{type:'string'},commit:{type:'boolean',default:false}}});
if(!values.file||!['clients','orders'].includes(values.kind)||!values.branch||!values.url||!process.env.CRM_ACCESS_TOKEN)throw Error('Укажите --file --kind clients|orders --branch UUID --url https://CRM. Токен сотрудника — CRM_ACCESS_TOKEN. Без --commit выполняется только проверка.');
const url=new URL(values.url);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Для удалённого API нужен HTTPS');
const bytes=await readFile(values.file);if(bytes.length>2000000)throw Error('Файл больше 2 МБ');const key=values.key||randomUUID(),body={format:values.file.toLowerCase().endsWith('.xlsx')?'xlsx':'csv',data:bytes.toString('base64'),branch_id:values.branch,dry_run:!values.commit};
const response=await fetch(new URL(`/api/imports/${values.kind}`,url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.CRM_ACCESS_TOKEN,'Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)}),result=await response.json();
if(!response.ok)throw Error(result.error||'Импорт не выполнен');console.log(JSON.stringify({mode:body.dry_run?'preview':'commit',key,rows:result.rows,imported:result.imported}));
