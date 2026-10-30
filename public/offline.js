// Сессии и ключи доступа не сохраняются в очереди. Каждая запись принадлежит сотруднику.
window.CRMOffline=(()=>{
 let database,running=false;
 const open=()=>database??=(new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(new Error('OFFLINE_STORAGE_UNAVAILABLE'));
  const r=indexedDB.open('carpet-crm-v2',1);
  r.onupgradeneeded=()=>{const actions=r.result.createObjectStore('actions',{keyPath:'sequence',autoIncrement:true});actions.createIndex('id','id',{unique:true});actions.createIndex('user_id','user_id');const snapshots=r.result.createObjectStore('snapshots',{keyPath:'id'});snapshots.createIndex('user_id','user_id');};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 }));
 async function transaction(store,mode,operation){
  const db=await open();return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,mode),request=operation(tx.objectStore(store));let result;
   if(request){request.onsuccess=()=>result=request.result;request.onerror=()=>reject(request.error);}
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 }
 const put=(store,value)=>transaction(store,'readwrite',s=>s.put(value));
 const get=id=>transaction('actions','readonly',s=>s.index('id').get(id));
 const remove=async id=>{const entry=await get(id);if(entry)await transaction('actions','readwrite',s=>s.delete(entry.sequence));};
 const list=user=>transaction('actions','readonly',s=>s.index('user_id').getAll(user));
 const snapshot=async(user,key,value)=>put('snapshots',{id:`${user}:${key}`,user_id:user,data:value,at:Date.now()});
 const read=async(user,key)=>(await transaction('snapshots','readonly',s=>s.get(`${user}:${key}`)))?.data;
 async function enqueue(user,command,data,{blob,item_id,kind,id}={}){
  const entry={id:id||crypto.randomUUID(),user_id:user,command,data,created_at:Date.now(),state:'queued',blob,item_id,kind};
  const existing=await get(entry.id);if(existing){if(existing.user_id!==user)throw new Error('QUEUE_OWNER_MISMATCH');return existing;}
  entry.sequence=await put('actions',entry);window.dispatchEvent(new Event('crm-queue'));return entry;
 }
 async function sync(user,api){
  if(running||!navigator.onLine)return;running=true;let changed=false;
  try{
   for(const entry of (await list(user)).sort((a,b)=>a.sequence-b.sequence)){
    if(window.crmUI&&window.crmUI.user()?.id!==user)break;
    if(window.crmUI&&window.crmUI.user()?.id!==user)break;
    if(entry.state==='review')break;
    try{
     if(entry.command==='photo'){
      const upload=await api(`/items/${entry.item_id}/photo-upload`,{method:'POST',body:{upload_id:entry.id}});
      let response;try{response=await fetch(upload.signedUrl,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:entry.blob});}catch(error){throw Object.assign(error,{network:true});}
      if(!response.ok)throw Object.assign(new Error('PHOTO_UPLOAD_FAILED'),{network:response.status>=500});
      await api(`/items/${entry.item_id}/photos`,{method:'POST',body:{path:upload.path,kind:entry.kind},idempotencyKey:entry.id});
     }else await api(`/actions/${entry.command}`,{method:'POST',body:entry.data,idempotencyKey:entry.id});
     await remove(entry.id);changed=true;
    }catch(error){
     if(error.network||!navigator.onLine)break;
     entry.state='review';entry.error=error.message;await put('actions',entry);changed=true;break;
    }
   }
  }finally{running=false;if(changed)window.dispatchEvent(new Event('crm-queue'));}
 }
 async function retry(id,user){const entry=await get(id);if(entry?.user_id===user){entry.state='queued';delete entry.error;await put('actions',entry);}}
 async function discard(id,user){const entry=await get(id);if(entry?.user_id===user)await remove(id);}
 async function purgeSnapshots(user){const all=await transaction('snapshots','readonly',s=>s.index('user_id').getAll(user));for(const row of all)await transaction('snapshots','readwrite',s=>s.delete(row.id));}
 return {enqueue,sync,list,snapshot,read,retry,discard,purgeSnapshots};
})();
