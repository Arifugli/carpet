import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
test('0001–0013 неизменны; нет запуска миграций/очистки в сервере или Blueprint',async()=>{
 const expected=JSON.parse(await readFile(new URL('./legacy-migrations.sha256.json',import.meta.url),'utf8'));assert.equal(Object.keys(expected).length,13);
 for(const [name,hash] of Object.entries(expected))assert.equal(createHash('sha256').update(await readFile(new URL('../supabase/migrations/'+name,import.meta.url))).digest('hex'),hash,name);
 for(const name of ['src/server.js','src/bootstrap.js','render.yaml'])assert.doesNotMatch(await readFile(new URL('../'+name,import.meta.url),'utf8'),/0016|clear_legacy|apply_migration|db push/);
});
