// Матрица API; условия статуса и оплаты проверяются атомарно в SQL.
export const PERMISSIONS = Object.freeze({
  admin: ['read','create','quote','assign','status','cancel','delete','restore','trash','audit','photos','tariffs'],
  manager: ['read','quote','cancel','delete','restore','trash','audit'],
  operator: ['read','create','quote','assign','status','cancel','requestDeletion','photos'],
  driver: ['read','status','photos'],
  workshop: ['read','status','photos'],
});
export const can = (user, action) => PERMISSIONS[user?.role]?.includes(action) ?? false;
export const allow = (action) => (req, res, next) => can(req.user, action)
  ? next() : res.status(403).json({ error: 'Недостаточно прав', code: 'FORBIDDEN' });
export const WORKSHOP_STATUSES = ['received','washing','drying','ready'];
export const canReadOrder = (user, order) => can(user,'read') && !order.deleted_at
  && (user.role !== 'driver' || order.driver_id === user.id)
  && (user.role !== 'workshop' || WORKSHOP_STATUSES.includes(order.status));
export const maskPhone = (phone) => phone ? `${String(phone).slice(0,4)} ** *** ** ${String(phone).replace(/\D/g,'').slice(-2)}` : null;
