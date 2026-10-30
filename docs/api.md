# API — этапы 1–4

Этап 2: защищённые `GET /api/workspaces/:view` и `POST /api/actions/:command`, описанные ниже, расширяют API без изменения контрактов этапа 1.

## Рабочие места этапа 2

`GET /api/workspaces/:view`: `bootstrap`, `client`, `leads`, `calls`, `tasks`, `dispatch`, `driver`, `workshop`, `scan`, `payments`, `admin`. Параметры проверяются zod: `branch_id`, `date`, `limit`, `cursor`, `phone`, `client_id`, `order_id`, `driver_id`, `stage`, `status`, `label`. Для `client` используйте phone/client_id; для `scan` — метку K-1041-1; для payments — order_id. Доступ к разделам и строкам проверяется в SQL. Списки возвращают `{data,next_cursor}`, максимальная страница 100; bootstrap/admin возвращают именованные справочники.

`POST /api/actions/:command` требует активного сотрудника, соответствующего права и `Idempotency-Key: UUID`. Тело содержит только данные конкретного действия. Все операции транзакционны и пишут аудит.

| Команда | Данные | Право |
|---|---|---|
| lead.save | phone, name?, source?, outcome, reason_code?, comment?, callback_at? | leads |
| lead.convert | lead_id, order_id | leads |
| client.address | client_id, label?, address, zone_code?, latitude?, longitude? | clients |
| call.log | phone, direction, outcome, source?, recording_url?, order_id? | calls |
| task.save | title, due_at, assigned_to?, order_id?, client_id?, note? | tasks |
| task.complete | task_id | tasks + исполнитель/диспетчер/admin |
| visit.schedule | order_id, kind, scheduled_date, slot_code, zone_code?, driver_id?, position?, note? | dispatch |
| visit.event | visit_id, event, expected_state, failure_reason?, note?, latitude?, longitude? | status + свой водитель/диспетчер/admin |
| workshop.advance | order_id, expected_stage, note? | workshop |
| workshop.defect | order_id, item_id?, defect_code, note, photo_id? | workshop |
| payment.record | order_id, amount, method, note? | payments + область заказа |
| payment.confirm | payment_id, confirm | admin/dispatcher |
| tariff.schedule | branch_id?, code, name, price_per_m2, effective_at, active? | tariffs |
| setting.schedule | branch_id?, key, value, effective_at | tariffs |
| catalog.save | branch_id?, kind, code, name_ru, name_uz?, active?, position?, config? | catalogs |
| template.save | branch_id?, code, channel, locale?, body, active? | catalogs |
| branch.save | code, name, address?, phone?, active?, workshop_capacity_m2?, sla_hours? | branches |
| staff.update | user_id, full_name, role, active, branch_id?, phone? | staff |
| photo.register | item_id, path, kind | photos + область заказа |

В действиях обращений/звонков/задач также можно передать branch_id; по умолчанию используется филиал сотрудника. Допустимые поля — источник `src/commands.js`; неизвестные поля отклоняются. Время передаётся с часовым поясом; деньги — целые сумы. `visit.event`: departed/completed/failed, expected_state planned/en_route. `workshop.advance` использует текущий production_stage: received/washing/drying/quality_check/packing. Перенос задания требует note. Окна и справочники берутся из bootstrap; слот config содержит start/end/capacity.

`POST /api/staff/create`: admin, `{email,password,full_name,role,branch_id,active?}`, пароль минимум 12 символов, Idempotency-Key обязателен. Создаёт Auth-пользователя без отправки письма, затем профиль. При сбое настройки возвращается PROFILE_SETUP_REQUIRED с user_id: учётная запись остаётся неактивной для восстановления администратором.

`POST /api/staff/:id/access-link`: admin, `{}` → `{action_link}`. Одноразовая ссылка восстановления доступа выдаётся администратору и не записывается в аудит/логи. Событие генерации пишется в журнал. Сообщение сотруднику автоматически не отправляется.

Фото: `photo-upload` дополнительно принимает `{upload_id?: UUID}` для стабильного пути повторной загрузки. `photos` с Idempotency-Key регистрирует одно фото ровно один раз. PWA сначала сохраняет JPEG в IndexedDB, затем получает подписанную ссылку, загружает PUT image/jpeg и регистрирует путь; сетевой повтор использует прежний ключ.

Создание заказа дополнительно принимает branch_id/zone_code/latitude/longitude/promised_at. Список `/orders` поддерживает branch_id для admin/manager; другим ролям всегда применяется их собственный филиал. Цена/состав снимка созданного заказа не изменяются после ввода новых тарифов.

Все защищённые запросы: `Authorization: Bearer <access_token>`. `id` заказа — UUID или код `K-1041`. Неизвестные поля новых JSON-запросов отклоняются. Суммы целые, 0…999999999999 сум. Причины и комментарии обрезаются по краям и не могут быть пустыми. Переданный клиентом `p_user`, роль или IP не принимаются.

| Метод | Путь | Право / назначение |
|---|---|---|
| GET | `/health` | Без входа, `{ok:true}`; проверяет HTTP-процесс |
| POST | `/api/public/login` | Без входа, `{email,password}` → `{access_token,expires_at}` |
| GET | `/api/public/track/:token` | Без входа, публичная информация без персональных данных |
| GET | `/api/me` | Активный сотрудник, профиль и список `permissions` |
| GET | `/api/clients/lookup?phone=` | `create`: admin/operator; клиент и до 5 последних неудалённых заказов |
| GET | `/api/drivers` | `assign`: admin/operator; активные водители |
| GET | `/api/staff` | `trash`: admin/manager; сотрудники для фильтра и имён аудита |
| GET | `/api/tariffs` | Активный сотрудник; тарифы и параметры |
| PUT | `/api/tariffs/:code` | admin; `{name,price_per_m2,active?}`, изменение с аудитом |
| POST | `/api/quote` | admin/operator/manager; расчёт через `quote_order` |
| POST | `/api/orders` | admin/operator; атомарное создание и аудит, обязателен `Idempotency-Key` |
| GET | `/api/orders` | `read`, с ограничением водителя/цеха; корзина исключена |
| GET | `/api/orders/:id` | `read`, те же ограничения; неудалённый заказ, состав, история, подписанные фото |
| PATCH | `/api/orders/:id/driver` | admin/operator; `{driver_id: UUID|null}`, транзакционно с аудитом |
| POST | `/api/orders/:id/status` | `status`: admin/operator/driver/workshop по SQL; `{status,note?}` |
| GET | `/api/cancel-reasons` | Активный сотрудник; `{code,name_ru,name_uz}[]`, только действующие |
| POST | `/api/orders/:id/cancel` | admin/manager; operator только new; причина, комментарий, суммы |
| POST | `/api/orders/:id/deletion-request` | Только operator и только new, `{reason}`, ответ 201 |
| DELETE | `/api/orders/:id` | admin/manager, `{reason}`, **только soft delete** |
| GET | `/api/trash` | admin/manager; корзина с неизменным снимком данных |
| GET | `/api/trash/:id` | admin/manager; полная карточка удалённого заказа и `delete_snapshot` |
| POST | `/api/orders/:id/restore` | admin/manager; `{}`, восстановление прежнего статуса |
| GET | `/api/audit-log` | admin/manager; журнал, только чтение |
| POST | `/api/items/:itemId/photo-upload` | `photos`, область видимости заказа; `{}` → `{path,signedUrl,token}` |
| POST | `/api/items/:itemId/photos` | `photos`, область видимости; `{path,kind?}`, регистрация с аудитом |

Причины `cancel_reasons`: `expensive`, `changed_mind`, `unreachable`, `competitor`, `timing`, `condition`, `other`. `kind` фото: `intake` / `ready`. Путь фото должен совпадать с выданным `order_id/item_id/UUID.jpg`. Нельзя зарегистрировать фото удалённого/чужого заказа, в том числе при удалении между запросами.

## Создание и превью

```json
{
  "name":"Дилноза", "phone":"+998901234567", "address":"Ташкент, Навои 14",
  "pickup_date":"2026-10-30", "pickup_slot":"10:00–13:00", "source":"call_in",
  "urgent":false, "stains":false, "pensioner":false,
  "items":[{"length_m":3,"width_m":2,"tariff":"wool","note":"Пятно от чая"}]
}
```

Для POST `/orders` добавьте `Idempotency-Key: <UUID>`; один ключ относится к одному сотруднику и одному payload. Первичный и повторный успешный запрос возвращают 201 и тот же заказ. Изменённый payload с прежним ключом или повтор после удаления — 409. Для исправленного payload используйте новый ключ; при сетевой неопределённости сначала повторите прежний запрос с прежним ключом.

Для `/quote` телефон, адрес и дата необязательны. Размеры 0.3…20 м, 1…30 ковров, source: `call_in/call_out/instagram/telegram`. Телефон нормализуется от пробелов/скобок/дефисов и требует `+998` + 9 цифр. Дату проверяет zod как календарную дату. Цена в JS не вычисляется.

## Отказ

```json
{
  "reason_code":"condition",
  "comment":"Не принимаем ковёр в таком состоянии",
  "completed_work_amount":20000,
  "payment_amount":0
}
```

Комментарий обязателен, до 1000 символов. Если ковёр уже когда-либо был в цехе, обе суммы обязательны. `payment_amount` — дополнительно принятая сейчас оплата, она прибавляется к прежней `paid_amount`. Для отказа до приёмки суммы можно не передавать, тогда используются нули. `total` не пересчитывается, чтобы сохранить исходную стоимость заявки. Отказ возвращает карточку с `status=cancelled`, `cancel_reason_code`, `cancelled_from_status`, автором и временем.

Отмена `delivered` или повторная отмена — 409. `/status` со значением `cancelled` — 400; старый SQL RPC также запрещает обход обязательной причины. Отмена удалённого заказа — 404.

## Списки и курсор

`/orders`, `/trash`, `/audit-log` возвращают:

```json
{"data":[],"next_cursor":null}
```

`limit`: 1…100, по умолчанию 50. Следующая страница: передать неизменный `next_cursor` как query `cursor`, сохранив прежние фильтры. Конец — `null`. Сортировка: timestamp DESC, id DESC. UUID используется для заказов; bigint ID аудита передаётся строкой в курсоре.

Фильтры `/orders`:

- `status`: один из `new/pickup_assigned/received/washing/drying/ready/delivering/delivered/cancelled`;
- `q`: код, имя или телефон, до 120 символов;
- `date`: дата забора `YYYY-MM-DD`;
- `deletion_requested=true`: очередь заявок, только admin/manager.

Фильтры `/trash`:

- `deleted_by`: UUID сотрудника;
- `from`, `to`: ISO 8601 с часовым поясом, включительно. Например, сутки Ташкента: `2026-10-28T00:00:00+05:00` … `2026-10-28T23:59:59.999+05:00`. В URL кодировать `+` как `%2B`;
- `reason`: буквальный фрагмент причины до 500 символов; `%`/`_` не расширяют поиск.

Фильтры `/audit-log`: `entity_id` UUID, `action` из `created/cancelled/deletion_requested/deleted/restored/status_changed/driver_assigned/updated`. `entity_id` может обозначать заказ, клиента, ковёр или фото; для тарифа используется стабильный UUID `md5('tariff:'||code)::uuid`, сам code есть в before/after.

## Корзина и аудит

Удаление не меняет status. `deleted_at/deleted_by/delete_reason/deleted_status/delete_snapshot` фиксируют событие; `delete_snapshot` содержит клиента, адрес, состав, цены, фото, историю и имя/роль удалившего. Данные связей физически не удаляются. Для отображения исторической карточки используйте снимок, поскольку карточка общего клиента может позже измениться.

Восстановление очищает текущие `deleted_at/deleted_by/delete_reason`, записывает `restored_at/restored_by`, оставляет `delete_snapshot/deleted_status` как след. Полная история циклов — в `audit_log`; `restored_*` отражает последнее восстановление. Не создаётся фиктивная смена статуса. Заявка оператора автоматически снимается при выходе из new или удалении.

Журнал: `id, at, user_id, role, entity, entity_id, action, before, after, ip`. Токен публичного статуса в аудит заказа не включается. API записи/правки/удаления аудита отсутствуют; аудит создаётся триггерами в транзакции действия.

## Ошибки и ограничения

Формат: `{error: "Сообщение на русском", code: "...", fields?: ["поле"]}`. 400 — входные данные; 401 — требуется вход; 403 — права/неактивный профиль; 404 — отсутствующий или скрытый заказ; 409 — закрытый заказ/запрет удаления/конфликт идемпотентности; 429 — лимит запросов; 500 — ошибка сервера. Повтор удаления/восстановления через HTTP обычно даёт 404, поскольку заказ уже отсутствует в соответствующем списке; SQL дополнительно защищает повтор конфликтом 409.

Публичный статус удалённого/неизвестного/неверного токена: одинаковые 404 и `TRACK_UNAVAILABLE`, без кода, причин и клиентских данных. Вход — до 10 попыток/мин/IP, отслеживание — до 30/мин/IP, защищённый API — до 240/мин/IP. При развёртывании нескольких инстансов потребуется общий store rate limiter; текущий ограничитель хранится в памяти процесса.

## Этап 3

Эндпоинты отчётов, параметры и ограничения снимков: [stage3.md](stage3.md). GET /reports, GET /reports/:name, GET /reports/:name/export; POST /actions/visit.arrived. Все защищены Auth и проверкой разрешения, снимки изолированы по пользователю.

## Этап 4: операции и интеграции

| Метод | Маршрут | Контракт |
|---|---|---|
| GET | /health, /ready | Liveness и проверка БД/схемы |
| GET | /api/ops/:view | cash,stock,quality,rewash,loyalty,payroll,integrations,planning,documents,alerts; date/from/to,branch_id,zone_code,order_id,cursor |
| POST | /api/actions/:command | Схемы src/operations.js, обязательный Idempotency-Key UUID |
| POST | /api/intake/:id/challenge | Пустое тело, Idempotency-Key; SMS-код в ответ не включается |
| GET | /api/payment-intents/:id/link | Ссылка провайдера для открытого счёта |
| GET | /api/orders/:id/print/:kind | labels,receipt,act; HTML печати по Auth, токен не помещается в URL |
| POST | /api/imports/:kind | clients/orders; format csv/xlsx, data base64,branch_id,dry_run; обязательный ключ |
| GET | /api/imports/:kind/template | Образец CSV |
| GET | /api/exports/clients | format csv/xlsx,branch_id,cursor_id; до 1000 строк, продолжение X-Next-Cursor |
| GET | /api/public/intake/:token | Клиентский снимок с временными ссылками фото |
| POST | /api/public/intake/:token/confirm | code — 6 цифр; 5 минут/5 попыток |
| POST | /api/public/feedback/:token | score 0–10,comment; только выданный заказ, первый ответ сохраняется |
| POST | /api/providers/payme | Basic Paycom:key, JSON-RPC; без Auth сотрудника |
| POST | /api/providers/click | Подписанные Prepare/Complete, form-urlencoded; без Auth сотрудника |
| POST | /api/integrations/orders | Подписанная форма заказа, отдельный actor интеграции и ключ запроса |
| POST | /api/integrations/telephony | Подписанный нормализованный webhook АТС |

Новые команды: call.link; discount.rule/apply; payment.refund/intent; cash.close; client.preferences; intake.create; complaint.create/resolve; compensation.paid; rewash.advance; material.save; stock.adjust; piece_rate.save; slot_limit.save; webhook.save; outbox.retry. Точный JSON, лимиты полей и permission — src/operations.js; дополнительно проверяются роль, филиал и состояние в SQL.

## Управление справочниками 0.5.2

POST /api/actions/admin.update, admin.archive, admin.restore доступны только admin и требуют Idempotency-Key UUID. Схемы src/admin-management.js, SQL RPC crm_admin_command. target: entity=branch/staff/catalog/template + id; entity=reason + code; entity=tariff + code,branch_id. Архивирование не удаляет связанные строки, повтор того же ключа возвращает прежний результат.

admin.update принимает entity=branch/catalog/reason/template и поля соответствующей формы. Филиал и шаблон меняются по id. Вид/код/филиал записи справочника и филиал шаблона не переносятся. Сотрудники редактируются прежней staff.update, тарифы — новой версией tariff.schedule. Архив тарифов имеет приоритет над будущими версиями выбранного филиала. Восстановление сотрудника оставляет active=false.

GET /api/workspaces/admin дополнительно возвращает branches,catalogs,reasons,tariffs со статусом архива. bootstrap использует название и доступность действующей версии тарифа. Удалённые записи включены в административный ответ для фильтра «Показать удалённые». Для рабочих форм active=false исключает их из выбора; история заказов сохраняется. /ready проверяет схему 10.

В 0.5.3 телефоны в ручных командах, редактировании филиала и создании/расчёте заказа нормализуются на сервере: 901234567 / 998901234567 / +998 (90) 123-45-67 → +998901234567. Буквы, другая страна и неверная длина отклоняются. Контракты импорта и телефонии по-прежнему требуют полный +998.

Ошибки Zod сохраняют code=VALIDATION_ERROR и fields; добавлен field_errors=[{field,message}]. error содержит сообщения с названиями конкретных полей, без отражения их введённых значений. При ошибке телефон выделяется в административной форме; другие поля не очищаются.

Публичные маршруты и callbacks используют отдельные ограничители. Остальные /api требуют проверенный Bearer и активный профиль. HMAC-контракты, единицы сумм и настройка: [stage4.md](stage4.md). Тела импорта ограничены 3 МБ JSON / 2 МБ исходного файла, обычные поля имеют собственные ограничения Zod. Ошибки валидации — 400, прав — 403, конфликта — 409; провайдерские ошибки возвращаются в формате протокола.


## Контракт заказа 0.6.0 (заменяет прежний ввод размеров при создании)

`POST /api/orders`, заголовок `Idempotency-Key: UUID`:

```json
{"name":"Тестовый клиент","phone":"901234567","pickup_date":"2026-10-30","region_code":"fergana","district_code":"fergana_city","street":"Тестовая","house":"10","apartment":"5","items":[{"tariff":"carpet","quantity":2},{"tariff":"blanket","quantity":1}]}
```

`landmark` необязателен. `private_house: true` разрешает отсутствие квартиры. `branch_id` выбирает филиал. Коды регионов/районов и единицы тарифов возвращаются в `/api/workspaces/bootstrap`. Для Ферганской области район обязателен; для остальных пока можно без района. Широта/долгота и размеры в новых заказах не принимаются. Старый измеренный формат оставлен для административного импорта прежних типов изделий.

`POST /api/quote` для ковров без замера возвращает `pending_measurements: true, total: null`. В сохранённом заказе: `measurement_mode: verified`, `pricing_state: awaiting_measurements`; внутренний нулевой total не является окончательной ценой. В интерфейсе и трекинге показывается ожидание замера. Поштучные изделия считаются по количеству.

`GET /api/orders/:id/measurements` возвращает изделия с историей замеров. Область видимости соответствует доступу к заказу. `POST /api/actions/item.measure` требует `Idempotency-Key`; тело `{"item_id":"UUID","length_m":3,"width_m":2,"expected_id":null}`. Автор/роль берутся из сессии, разрешены только водитель и цех. Для исправления передаётся последняя `expected_id` и причина `reason`. Для поштучного изделия достаточно `item_id`: это подтверждение 1 физической штуки. Размеры от 0,3 до 20 м, не более двух знаков после запятой. `reason` обязателен при исправлении и расхождении площади цеха с водителем >0,01 м².

`tariff.schedule` принимает `unit: m2|piece`; carpet всегда m2, blanket/tushak — piece. Цена будущих заказов берётся из версии тарифа, текущие ставки заказа не переписываются. Новая схема — 11, оболочка — carpet-shell-v7.


## Действующий протокол 0.7.0: цена у водителя, передача, фотографии

Ниже уточнения, заменяющие формирование цены цехом из контракта 0.6. Форма заказа оператора и регион/адрес сохраняются. `order.measure` принимает `order_id` и массив `items` со всеми физическими изделиями заказа. Элемент: `item_id`, `expected_id` (последний замер своей роли или null), длина/ширина для m2, необязательная причина исправления. Для piece — подтверждение одной физической штуки без размеров. Пакет атомарен; автор/роль берутся из сессии.

Водитель получает `pricing_state: priced` и `total` после своих замеров. `price_basis: driver` сохраняется в снимке цены ковров. Замер цеха не переписывает total/price. Все команды требуют `Idempotency-Key: UUID`:

- `pickup.collect`: `{order_id, expected_state: pending}` — только назначенный водитель, после замеров всех изделий и загруженных intake-фото каждого. `pickup_state: picked_up`, статус ещё не означает приём цехом.
- `pickup.handover`: `{order_id, expected_state: picked_up}` — водитель физически передал изделия. `pickup_state: handed_over`.
- `workshop.accept`: `{order_id, expected_state: handed_over}` — цех (либо admin) подтвердил приём. `pickup_state: accepted`, `status: received`.
- Затем `order.measure` сотрудником цеха и прежний `workshop.advance`. Переход в стирку требует подтверждения всех изделий.

`GET /api/orders/:id/photos` — фото заказа; `GET /api/clients/:id/photos?branch_id=UUID` — все фотографии клиента в филиале. Для любой активной роли с read, с проверкой филиала. Для администратора/руководителя branch_id необязателен. `limit` 1–100, `cursor` из `next_cursor`. Поля фото: id, code заказа, seq изделия, kind, created_at, url. Storage path не возвращается; ссылки действуют 300 секунд. В обычной карточке заказа ссылок/картинок нет: галерея загружается только при раскрытии. Удалённые заказы исключаются.

Регистрация фото проверяет наличие объекта Storage. При отсутствии — 409 PHOTO_NOT_UPLOADED. Галерея не требует права на загрузку фотографий. Схема: 12; оболочка: carpet-shell-v8. Для восстановленных задач 0.6 driver_measurement_closed_at=null позволяет закончить отсутствующие замеры до передачи цеху.


## Карточка цеха — 0.7.1

У GET /api/orders/:id для verified-заказов и ролей workshop/admin есть workshop_intake: can_measure, can_accept, can_recover, can_advance, blocked_reason, recovery_pricing. Возможности проверяются сервером по фактическому состоянию и филиалу. UI показывает поля прямо в карточке и разрешает сохранение после приёма.

Новая команда workshop.recover `{order_id, expected_state: picked_up}` с Idempotency-Key предназначена исключительно для прежних received-заказов, где новая передача не была отмечена. Она записывает подтверждение сотрудником, не создавая передачу или замеры водителя. Неопределённая цена такого заказа получает источник workshop_recovery и рассчитывается по новым фактическим замерам цеха с сохранёнными ставками. Уже определённая цена не меняется. Обычные заказы продолжают использовать workshop.accept после pickup.handover.

Применить 0013_workshop_intake.sql после 0012. Схема 13, версия 0.7.1, оболочка carpet-shell-v9.
