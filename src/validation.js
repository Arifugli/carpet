import {z} from 'zod';
export const phone=z.string().max(32).transform(value=>{
 const compact=value.trim().replace(/[\s()-]/g,'');
 return /^\d{9}$/.test(compact)?'+998'+compact:/^998\d{9}$/.test(compact)?'+'+compact:compact;
}).pipe(z.string().regex(/^\+998\d{9}$/,'Введите 9 цифр номера или полный номер +998XXXXXXXXX'));

const labels={phone:'Телефон',code:'Код',name:'Название',name_ru:'Название по-русски',full_name:'Имя сотрудника',address:'Адрес',email:'Почта',password:'Пароль',branch_id:'Филиал',workshop_capacity_m2:'Мощность цеха',sla_hours:'Срок выполнения',price_per_m2:'Цена за м²',effective_at:'Дата начала действия',length_m:'Длина ковра',width_m:'Ширина ковра',pickup_date:'Дата забора',role:'Роль',body:'Текст шаблона'};
export function validationResponse(error){
 const field_errors=error.issues.map(issue=>{
  const key=issue.path.at(-1),label=labels[key]||issue.path.join('.')||'Данные';
  const message=/[А-Яа-яЁё]/.test(issue.message)?issue.message:issue.code==='too_small'?`Минимальное значение: ${issue.minimum}`:issue.code==='too_big'?`Максимальное значение: ${issue.maximum}`:'Проверьте формат и заполнение поля';
  return {field:issue.path.join('.'),message:`${label}: ${message}`};
 });
 return {error:field_errors.map(i=>i.message).join('\n'),code:'VALIDATION_ERROR',fields:field_errors.map(i=>i.field),field_errors};
}
