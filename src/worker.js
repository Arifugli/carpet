import {config} from './config.js';
import {db} from './supabase.js';
import {createSender} from './outbound.js';
import {createOutboxWorker} from './outbox-worker.js';
const channels=config.workerSend?[...(config.smsToken?['sms']:[]),...(config.telegramToken?['telegram']:[]),...(config.webhookHosts?['webhook']:[])]:[];
const worker=createOutboxWorker({db,channels,send:createSender({config,db})});let stopping=false,timer;
const loop=async()=>{try{await worker.once();}catch(error){console.error(JSON.stringify({event:'worker_error',code:error.code||'WORKER_FAILED'}));}if(!stopping)timer=setTimeout(loop,5000);};
const stop=()=>{stopping=true;clearTimeout(timer);worker.stop();console.log(JSON.stringify({event:'worker_stopping'}));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);console.log(JSON.stringify({event:'worker_started',channels}));await loop();
