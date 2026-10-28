import {parentPort,workerData} from 'node:worker_threads';
import {exportReport} from '../export-report.js';
try{const data=await exportReport(workerData);parentPort.postMessage({data});}catch(error){parentPort.postMessage({error:error.message});}
