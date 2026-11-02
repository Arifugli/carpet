# API 0.8.0

Все `/api` кроме публичного входа/трекинга, подписанных входящих интеграций и callback-провайдеров требуют Bearer токен активного сотрудника. Права проверяются API и PostgreSQL. Новые действия требуют UUID `Idempotency-Key`; один ключ нельзя переиспользовать с другим телом.

## Заказы и канбан

- GET `/api/board`: колонки по роли, отдельные totals, data, next_offset. Query: from/to (YYYY-MM-DD, Ташкент), product, min_price/max_price, district_code, branch_id, driver_id, operator_id, q, limit/offset. `stage_filters` — JSON-объект частичных фильтров по ключу этапа. Итоги считают весь результат фильтра, data — страницу.
- GET `/api/order-metrics?from=...&to=...`: только admin, дополнительный дашборд; опционально branch_id. date_basis=order_created_at.
- POST `/api/orders`: ФИО, телефон, структурированный адрес/область/район, source, items=[{tariff:carpet|blanket|tushak,quantity}], прежние комментарий/признаки/пожелания по дате. Размеры и фото запрещены. Ответ — новый заказ с ценой awaiting_measurements.
- POST `/api/orders/:id/pickup-quote`: водитель, {items:[{item_id,length_m,width_m} или {item_id,quantity}]}; расчёт без записи.
- GET `/api/orders`, GET `/api/orders/:id`, GET `/api/orders/:id/measurements`: только доступные роли заказы. У склада/мойщика/упаковщика телефон маскируется.
- POST `/api/orders/:id/cancel`: operator/admin, reason_code+comment; старые финансовые поля completed_work_amount/payment_amount сохранены.
- POST `/api/orders/:id/deletion-request`, DELETE `/api/orders/:id` (мягкое), POST `/api/orders/:id/restore`, GET `/api/trash`, `/api/audit-log`: прежние правила и права.

## POST /api/actions/:command

Во всех шагах order_id обязателен.

| Команда | Дополнительные поля | Роль |
|---|---|---|
| pickup.claim | pickup_at ISO с часовым поясом | driver |
| pickup.collect | items с размерами/количеством; фото уже загружены | driver |
| pickup.handover | — | driver |
| warehouse.receive | — | warehouse |
| warehouse.measure | items; reason у каждого расхождения | warehouse |
| warehouse.to_wash | — | warehouse |
| wash.accept, wash.dry, wash.to_pack | — | washer |
| packing.accept, packing.complete | фото-чек обязателен перед complete | packer |
| packing.return | reason | packer |
| delivery.claim, delivery.complete | — | driver |
| delivery.postpone | reason | driver |
| delivery.resume | comment необязателен | driver |

Забрал сохраняет замеры/цену одной транзакцией. Все передачи блокируют строку заказа. Повтор подтверждённого ключа возвращает прежний результат. Ранее существовавшие общие endpoints `/orders/:id/status`, `/orders/:id/driver` и команды задания/цеха удалены или отвергаются.

Фото: POST `/items/:itemId/photo-upload` (подписанный upload), затем POST `/items/:itemId/photos` или action photo.register. Проверяются этап/роль, принадлежность пути и наличие объекта. intake — забор driver; ready — фото-чек packer после приёмки. Галереи GET `/orders/:id/photos`, `/clients/:id/photos`: приватные подписанные ссылки на 300 секунд, с пагинацией.

## Администрирование и сохранённые функции

POST `/staff/create`: email/password/full_name/role/active/branch_id; driver требует district_codes[] и допускает driver_color=#RRGGBB. Создание admin разрешено. action staff.update имеет те же поля профиля; последний активный admin защищён в БД. GET `/workspaces/bootstrap` и `/workspaces/admin` включают районы/цвет.

Прежние команды branch.save, tariff.schedule, setting.schedule, catalog.save, template.save и admin.update/archive/restore сохранены. Финансы payment.record/confirm/intent/refund, cash.close, discount.*, клиентские предпочтения/теги/согласия, акты/претензии, склад и начисления, телефония/webhook/outbox и импорт/экспорт сохраняют API, с правами из permissions.md. Планирование и ставки доступны admin.

GET `/health` — процесс; GET `/ready` — применённая схема и завершённая очистка, без автоматического DDL. Клиентский трекинг не раскрывает адрес, телефон или размеры.

## Состав изделий при заборе (0018)

POST /orders допускает отсутствие items или пустой массив: заявка без изделий, pricing_state=awaiting_measurements. Форма оператора передаёт телефон, ФИО, структурированный адрес и контекст филиала/источника.

POST /api/orders/:id/pickup-items, Idempotency-Key: UUID, тело {items:[{item_id?:UUID,tariff:carpet|blanket|tushak,quantity:integer,note?:string}],flags?:{urgent?:boolean,stains?:boolean,pensioner?:boolean}}. Только назначенный driver, pickup_planned/pending до оценки. Ковры — по одной строке, количество каждой 1; одеяла/тушаки — 1–1000, до 30 строк. Запись, удаление черновых позиций и журнал в одной транзакции с блокировкой заказа. Позиции с фото/замерами защищены. Ответ содержит постоянные IDs и ставки. Далее прежние pickup-quote → загрузка фото → pickup.collect. Пустой забор запрещён БД. /ready проверяет схему 18.

## Очереди и карточки (0019)

GET `/api/home` и `/api/order-table`: прежние boardFilter + status, client_id и focus=attention|pickup_today|ready. limit по умолчанию 50 (максимум 100), offset. RPC crm_queue проверяет активный профиль/видимость заказа; домашняя очередь исключает delivered/cancelled. Ответ data/count/totals/tiles/limit/offset/next_offset/previous_offset/generated_at. Итоги считают всю выборку, не одну страницу. Период относится к stage_entered_at, время «сегодня» — Asia/Tashkent.

GET `/api/client-list`: право clients, q/branch_id/limit/offset. RPC crm_clients возвращает контакты, число доступных заказов и постраничный список. GET `/api/client-card/:id?branch_id=UUID`: crm_client_card возвращает данные клиента, до 10 адресов (актуальный первым), до 10 последних видимых заказов и orders_count. Производственные роли/водитель доступа к этим endpoints не получают.

GET `/api/board`: по умолчанию 15 карточек этапа; прежние фильтры и счётчики сохранены. Карточки очереди/канбана содержат только необходимые поля, без track_token, delete_snapshot или pricing_snapshot; телефон производственных ролей маскируется. Новые RPC закрыты anon/authenticated, EXECUTE явно выдан service_role. /ready требует схему 19. Никакая миграция не выполняется при старте.
