export const createAuth=db=>async(req,res,next)=>{
  const h=req.headers.authorization||'',token=h.startsWith('Bearer ')?h.slice(7):null;
  if (!token) return res.status(401).json({error:'Требуется вход',code:'UNAUTHENTICATED'});
  const {data,error}=await db.auth.getUser(token);
  if (error||!data.user) return res.status(401).json({error:'Недействительный токен',code:'UNAUTHENTICATED'});
  const {data:p,error:profileError}=await db.from('profiles').select('id,full_name,role,active,branch_id').eq('id',data.user.id).single();
  if (profileError||!p?.active) return res.status(403).json({error:'Аккаунт не активирован администратором',code:'INACTIVE_ACCOUNT'});
  if(!['admin','manager'].includes(p.role)&&!p.branch_id) return res.status(403).json({error:'Администратор должен назначить сотруднику филиал',code:'BRANCH_REQUIRED'});
  req.user=p; next();
};
