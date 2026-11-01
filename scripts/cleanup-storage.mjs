import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
export function parseManifest(value){
 const rows=Array.isArray(value)?value:value.storage_manifest;
 if(!Array.isArray(rows))throw Error('Manifest must be an array or contain storage_manifest');
 const paths=[...new Set(rows.map(x=>typeof x==='string'?x:x.path))];
 if(paths.some(p=>typeof p!=='string'||!/^([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\.jpg$/.test(p)))throw Error('Invalid legacy photo path; nothing deleted');
 return paths;
}
export async function cleanupStorage({manifest,dryRun=true,storage,livePaths=[]}){
 const paths=parseManifest(manifest);
 if(paths.some(p=>livePaths.includes(p)))throw Error('A manifest photo is still referenced by the database; nothing deleted');
 if(!dryRun)for(let offset=0;offset<paths.length;offset+=100){const {error}=await storage.remove(paths.slice(offset,offset+100));if(error)throw Error('Storage removal failed; retry with the same manifest');}
 return {dry_run:dryRun,files:paths.length,paths};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),manifestArg=args.find(x=>x.startsWith('--manifest='));
 if(args.includes('--dry-run')&&args.includes('--confirm=delete-legacy-order-photos'))throw Error('Choose dry-run or confirmation, not both');
 if(!manifestArg||args.some(x=>!x.startsWith('--manifest=')&&!['--dry-run','--confirm=delete-legacy-order-photos'].includes(x)))throw Error('Usage: node scripts/cleanup-storage.mjs --manifest=backup/manifest.json [--dry-run | --confirm=delete-legacy-order-photos]');
 const manifest=JSON.parse(await readFile(manifestArg.slice(11),'utf8')),dryRun=!args.includes('--confirm=delete-legacy-order-photos');
 if(dryRun){console.log(JSON.stringify(await cleanupStorage({manifest}),null,2));}
 else{
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Set server Supabase environment variables outside the command history');
  const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:run,error}=await db.from('maintenance_cleanup_runs').select('storage_manifest').eq('key','workflow_v2_reset').single();
  if(error||!run)throw Error('Migration 0016 must complete before deleting Storage objects');
  const approved=parseManifest(run.storage_manifest),paths=parseManifest(manifest);if(paths.some(x=>!approved.includes(x)))throw Error('Manifest is not from the committed cleanup');
  const {data:live,error:liveError}=await db.from('order_photos').select('storage_path');if(liveError)throw Error('Cannot verify current photo references');
  console.log(JSON.stringify(await cleanupStorage({manifest,dryRun:false,storage:db.storage.from('carpet-photos'),livePaths:live.map(x=>x.storage_path)}),null,2));
 }
}
