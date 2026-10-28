import {readFile,writeFile} from 'node:fs/promises';
const permissions=JSON.parse(await readFile(new URL('../config/permissions.json',import.meta.url),'utf8'));
const migration=new URL('../supabase/migrations/0005_workspaces.sql',import.meta.url);
const values=Object.entries(permissions).map(([role,actions])=>`('${role}','${JSON.stringify(actions).replaceAll("'","''")}'::jsonb)`).join(',\n');
const sql=await readFile(migration,'utf8');
const generated=`-- GENERATED_PERMISSIONS_START\ninsert into public.role_permissions(role,permissions) values\n${values}\non conflict(role) do update set permissions=excluded.permissions;\n-- GENERATED_PERMISSIONS_END`;
await writeFile(migration,sql.replace(/-- GENERATED_PERMISSIONS_START[\s\S]*?-- GENERATED_PERMISSIONS_END/,generated));
console.log('Матрица синхронизирована. Для уже выпущенной базы изменения оформляйте новой миграцией.');
