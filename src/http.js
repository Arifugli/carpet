import { z } from 'zod';
export class HttpError extends Error {
  constructor(status,message,code='REQUEST_FAILED') { super(message); this.status=status; this.code=code; }
}
export const checked = ({data,error}) => {
  if (error) {
    const status=({'42501':403,P0002:404,'55000':409,'23514':400,'23503':400,'22003':400})[error.code];
    if (!status) { console.error(JSON.stringify({event:'database_error',code:error.code})); throw new HttpError(500,'Ошибка сервера','DATABASE_ERROR'); }
    throw new HttpError(status,error.message,error.code);
  }
  return data;
};
export const orderRef=z.string().regex(/^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|K-[1-9]\d{0,14})$/i,'Укажите UUID или код K-1041');
export const byRef=(q,v)=>v.toLowerCase().startsWith('k-') ? q.eq('number',v.slice(2)) : q.eq('id',v);
export const withCode=o=>({...o,code:`K-${o.number}`});
export const parseCursor=raw=>{
  if (!raw) return null;
  try { return z.object({at:z.string().datetime({offset:true}),id:z.string().uuid()}).parse(JSON.parse(Buffer.from(raw,'base64url').toString('utf8'))); }
  catch { throw new HttpError(400,'Неверный курсор страницы','INVALID_CURSOR'); }
};
export const page=(rows,limit,column)=>{
  const data=rows.slice(0,limit),last=data.at(-1);
  return {data,next_cursor:rows.length>limit ? Buffer.from(JSON.stringify({at:last[column],id:last.id})).toString('base64url') : null};
};
export const applyCursor=(q,c,column)=>c ? q.or(`${column}.lt.${c.at},and(${column}.eq.${c.at},id.lt.${c.id})`) : q;
