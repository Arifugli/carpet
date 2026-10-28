import {readFileSync} from 'node:fs';
// Один источник; SQL-копия и документация проверяются на совпадение тестом.
export const PERMISSIONS=Object.freeze(JSON.parse(readFileSync(new URL('../config/permissions.json',import.meta.url),'utf8')));
export const can = (user, action) => PERMISSIONS[user?.role]?.includes(action) ?? false;
export const allow = (action) => (req, res, next) => can(req.user, action)
  ? next() : res.status(403).json({ error: 'Недостаточно прав', code: 'FORBIDDEN' });
export const WORKSHOP_STATUSES = ['received','washing','drying','ready'];
export const canReadOrder = (user, order) => can(user,'read') && !order.deleted_at
  && (['admin','manager'].includes(user.role)||!user.branch_id||user.branch_id===order.branch_id)
  && (user.role !== 'driver' || order.driver_id === user.id)
  && (user.role !== 'workshop' || WORKSHOP_STATUSES.includes(order.status));
export const maskPhone = (phone) => phone ? `${String(phone).slice(0,4)} ** *** ** ${String(phone).replace(/\D/g,'').slice(-2)}` : null;
