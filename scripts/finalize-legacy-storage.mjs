import {randomUUID} from 'node:crypto';
import {cleanupStorage} from './cleanup-storage.mjs';
const marker='legacy_storage_cleanup_0016';
const checked=r=>{if(r.error)throw Error('Legacy Storage maintenance failed');return r.data;};
export async function finalizeLegacyStorage(db,config={}){
 if(!config.legacyStorageCleanupConfirm)return {skipped:true};
 if(config.legacyStorageCleanupConfirm!=='delete-legacy-order-photos-0016')throw Error('Explicit legacy Storage confirmation required');
 if(checked(await db.from('system_jobs').select('id').eq('key',marker).maybeSingle()))return {already_completed:true};
 const run=checked(await db.from('maintenance_cleanup_runs').select('storage_manifest').eq('key','workflow_v2_reset').single());
 if(!run?.storage_manifest)throw Error('Legacy database cleanup must complete first');
 const live=checked(await db.from('order_photos').select('storage_path'));
 const result=await cleanupStorage({manifest:run.storage_manifest,dryRun:false,storage:db.storage.from(config.bucket||'carpet-photos'),livePaths:live.map(p=>p.storage_path)});
 checked(await db.from('audit_log').insert({role:'maintenance',entity:'maintenance',entity_id:randomUUID(),action:'legacy_storage_cleared',after:{files:result.files,source:'workflow_v2_reset',confirmed:true}}));
 checked(await db.from('system_jobs').upsert({key:marker},{onConflict:'key',ignoreDuplicates:true}));
 console.log(JSON.stringify({event:'legacy_storage_cleanup_completed',files:result.files}));return {completed:true,files:result.files};
}
