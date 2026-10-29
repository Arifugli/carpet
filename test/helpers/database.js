import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

export const ids={admin:'10000000-0000-4000-8000-000000000001',manager:'10000000-0000-4000-8000-000000000002',operator:'10000000-0000-4000-8000-000000000003',driver:'10000000-0000-4000-8000-000000000004',workshop:'10000000-0000-4000-8000-000000000005',inactive:'10000000-0000-4000-8000-000000000006',dispatcher:'10000000-0000-4000-8000-000000000007'};
export const input={name:'Дилноза',phone:'+998901234567',address:'Ташкент, Навои 14',pickup_date:'2026-10-30',items:[{length_m:3,width_m:2,tariff:'wool'}]};
export async function database({beforeLifecycle,stage=99,legacyGrants=true}={}) {
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email text,raw_app_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql as $$select null::uuid$$;
  create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
  grant usage on schema public,auth to service_role;`);
 const initial=await readFile(new URL('../../supabase/migrations/0001_init.sql',import.meta.url),'utf8');
 await db.exec(initial);
 if(legacyGrants)await db.exec(`grant all on all tables in schema public to service_role;
  grant usage,select on all sequences in schema public to service_role;
  grant select on all tables in schema public to authenticated;`);
 if(beforeLifecycle) await beforeLifecycle(db);
 for (const name of ['0002_manager_role.sql','0003_order_lifecycle.sql',...(stage>=2?['0004_dispatcher_role.sql']:[])]) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
 for (const [role,id] of Object.entries(ids)) {
  if(stage<2&&role==='dispatcher')continue;
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('update profiles set role=$1,active=$2,full_name=$3 where id=$4',[role==='inactive'?'operator':role,role!=='inactive',role,id]);
 }
 const remaining=(await readdir(new URL('../../supabase/migrations/',import.meta.url))).filter(n=>/^\d+_.*\.sql$/.test(n)&&n>'0004_dispatcher_role.sql'&&(stage>2||n<'0006')).sort();
 if(stage>=2)for(const name of remaining) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 return db;
}
export async function call(db,name,args) {
 const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
 const {rows}=await db.query(`select to_jsonb(public.${name}(${placeholders})) as result`,args);
 return rows[0].result;
}
export const create=(db,overrides={})=>call(db,'create_order_audited',[JSON.stringify({...input,...overrides}),ids.operator,'127.0.0.1']);
