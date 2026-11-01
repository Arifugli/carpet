import {readFileSync} from 'node:fs';
import {PRODUCTION} from './workflow.js';
// Один источник; SQL-копия и документация проверяются на совпадение тестом.
export const PERMISSIONS=Object.freeze(JSON.parse(readFileSync(new URL('../config/permissions.json',import.meta.url),'utf8')));
export const can = (user, action) => PERMISSIONS[user?.role]?.includes(action) ?? false;
export const allow = (action) => (req, res, next) => can(req.user, action)
  ? next() : res.status(403).json({ error: 'Недостаточно прав', code: 'FORBIDDEN' });
export const canReadOrder = (user, order) => can(user,'read') && !order.deleted_at
  && (user.role==='admin'||(!!user.branch_id&&user.branch_id===order.branch_id))
  && (user.role!=='driver'||['new','ready_for_delivery'].includes(order.status)||(order.status==='pickup_planned'&&order.pickup_driver_id===user.id)||(['in_transit','delivered','postponed'].includes(order.status)&&order.delivery_driver_id===user.id))
  && (!PRODUCTION[user.role]||order.status===PRODUCTION[user.role]);
export const maskPhone = (phone) => phone ? `${String(phone).slice(0,4)} ** *** ** ${String(phone).replace(/\D/g,'').slice(-2)}` : null;
