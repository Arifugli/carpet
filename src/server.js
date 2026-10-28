import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { db } from './supabase.js';
import { createApp } from './app.js';

// Отдельный Auth-клиент, без сохранения сессии в клиенте запросов к БД.
const authClient=createClient(config.supabaseUrl,config.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const app=createApp({db,authClient,config});
app.listen(config.port,()=>console.log(JSON.stringify({event:'listening',port:config.port})));
