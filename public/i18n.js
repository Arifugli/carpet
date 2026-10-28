export const dictionaries={ru:{
 title:'Ковёр CRM',subtitle:'Заказы · Ташкент',loginTitle:'Вход для сотрудников',loginHint:'Используйте учётную запись Supabase, активированную администратором.',
 email:'Почта',password:'Пароль',login:'Войти',logout:'Выйти',orders:'Заказы',requests:'Заявки на удаление',trash:'Корзина',audit:'Журнал аудита',
 refresh:'Обновить',search:'Код, имя или телефон',allStatuses:'Все статусы',filter:'Показать',from:'Удалено с',to:'Удалено по',deletedBy:'Кто удалил',allStaff:'Все сотрудники',reason:'Причина удаления',
 loading:'Загрузка…',empty:'Здесь пока нет заказов',emptyAudit:'Событий не найдено',more:'Загрузить ещё',close:'Закрыть',sum:'Сумма',paid:'Оплачено',client:'Клиент',address:'Адрес',status:'Статус',
 cancel:'Отказ клиента',remove:'В корзину',requestDeletion:'Запросить удаление',restore:'Восстановить',cancelReason:'Причина отказа',comment:'Комментарий',workAmount:'Выполненные работы, сум',
 paymentAmount:'Принятая сейчас оплата, сум',moneyHint:'Если заказ был в цехе, укажите обе суммы. Если работ или оплаты не было — 0. Ранее принятая оплата сохраняется.',
 deleteHint:'Заказ и связанные данные останутся в базе. Заказы с оплатой или начатой стиркой можно только отменить.',requestHint:'Администратор или руководитель рассмотрит заявку. До удаления заказ остаётся в работе.',
 save:'Сохранить',saved:'Изменения сохранены',error:'Не удалось выполнить действие',networkError:'Нет связи с сервером. Повторите действие.',expired:'Сессия истекла. Войдите снова.',
 deletedAt:'Удалён',deletedStatus:'Статус при удалении',restoredAt:'Восстановлен',snapshot:'Сохранённый состав заказа',history:'История статусов',cancelledAt:'Отказ зарегистрирован',
 requestedAt:'Заявка на удаление',by:'Сотрудник',at:'Время',action:'Действие',entity:'Заказ',before:'Было',after:'Стало',details:'Подробнее',ip:'IP',
 newOrder:'Новый заказ',name:'Имя клиента',phone:'Телефон +998',pickupDate:'Дата забора',pickupSlot:'Временное окно',source:'Источник',length:'Длина, м',width:'Ширина, м',tariff:'Тариф',
 urgent:'Срочно',stains:'Пятна',pensioner:'Пенсионер',quote:'Рассчитать цену',create:'Создать заказ',addItem:'Добавить ковёр',item:'Ковёр',removeItem:'Убрать',quoteHint:'Стоимость рассчитывается сервером по действующим тарифам.',
 trackTitle:'Статус заказа',trackUnavailable:'Статус заказа недоступен. Уточните информацию у оператора.',trackHint:'Информация о вашем заказе',
 created:'Создание',cancelled:'Отказ клиента',deletion_requested:'Заявка на удаление',deleted:'Удаление в корзину',restored:'Восстановление',status_changed:'Смена статуса',driver_assigned:'Назначение водителя',updated:'Изменение',
 order:'Заказ',order_item:'Ковёр',order_photo:'Фото ковра',system:'Система',unitM:'м',
 new:'Заявка',pickup_assigned:'Забор назначен',received:'Принят в цех',washing:'Стирка',drying:'Сушка',ready:'Готов',delivering:'Доставка',delivered:'Выдан',
 admin:'Администратор',manager:'Руководитель',operator:'Оператор',driver:'Водитель',workshop:'Цех',
 call_in:'Входящий звонок',call_out:'Исходящий звонок',instagram:'Instagram',telegram:'Telegram',
 currency:'сум',noData:'—',pending:'Ожидает решения',snapshotHint:'Данные зафиксированы на момент удаления.',
 reasonRequired:'Укажите причину',chooseReason:'Выберите причину',auditHint:'Журнал сохраняет автора, время и состояние до и после изменения.',
 blockedDeletion:'Удаление запрещено: есть оплата или началась стирка.',
}};
export let locale='ru';
export const t=key=>dictionaries[locale]?.[key]??dictionaries.ru[key]??key;
export const money=value=>`${Number(value||0).toLocaleString('ru-RU')} ${t('currency')}`;
export const date=value=>value?new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):t('noData');
