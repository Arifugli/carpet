import {performance} from 'node:perf_hooks';
import {database,create} from '../test/helpers/database.js';
// Только новая локальная PGlite. Не принимает URL или ключи рабочего проекта.
const db=await database();try{
 const id=await create(db);await db.exec('reset role; alter table orders disable trigger user;');
 await db.query(`insert into orders(client_id,address,pickup_date,source,subtotal,adjustment,delivery_fee,total,created_by,branch_id,created_at)
 select client_id,address,pickup_date,source,subtotal,adjustment,delivery_fee,total,created_by,branch_id,now()-n*interval '1 minute' from orders cross join generate_series(1,50000)n where id=$1`,[id]);
 await db.exec("insert into order_items(order_id,seq,length_m,width_m,tariff_code,price) select o.id,1,3,2,'wool',180000 from orders o where not exists(select 1 from order_items i where i.order_id=o.id);");
 await db.exec('alter table orders enable trigger user; analyze orders; set role service_role;');
 const sql=`select o.id,o.number,o.status,o.total,o.created_at,c.name,c.phone,(select coalesce(jsonb_agg(jsonb_build_object('id',i.id)),'[]') from order_items i where i.order_id=o.id) items from orders o join clients c on c.id=o.client_id where o.deleted_at is null and o.branch_id=$1 and (o.created_at,o.id)<($2::timestamptz,$3::uuid) order by o.created_at desc,o.id desc limit 51`;
 const args=['01000000-0000-4000-8000-000000000001',new Date().toISOString(),'ffffffff-ffff-4fff-bfff-ffffffffffff'],times=[];
 for(let i=0;i<25;i++){const start=performance.now();const result=await db.query(sql,args);if(result.rows.length!==51)throw Error('Неверная страница');times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);const p95=times[Math.ceil(times.length*.95)-1];const plan=(await db.query('explain (analyze,buffers,format json) '+sql,args)).rows[0]['QUERY PLAN'];
 console.log(JSON.stringify({environment:'local PGlite, database query only',orders:50001,samples:times.length,p50_ms:Math.round(times[12]*100)/100,p95_ms:Math.round(p95*100)/100,target_ms:300,passed:p95<300,plan},null,2));if(p95>=300)process.exitCode=1;
}finally{await db.close();}
