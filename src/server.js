import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { db } from './supabase.js';
import { createApp } from './app.js';
import {bootstrapAdmin} from './bootstrap.js';

// Отдельный Auth-клиент, без сохранения сессии в клиенте запросов к БД.
const authClient=createClient(config.supabaseUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
try{await bootstrapAdmin(db,config);}catch{console.error(JSON.stringify({event:'bootstrap_failed',code:'INITIAL_ADMIN_SETUP_FAILED'}));process.exit(1);}
const app=createApp({db,authClient,config});
const server=app.listen(config.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'listening',port:config.port})));
const shutdown=()=>{server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>{server.closeAllConnections();process.exit(0);},25000).unref();};
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
