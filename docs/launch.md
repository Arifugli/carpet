# Запуск 0.5.2 через Render Blueprint

Основной render.yaml сохраняет один бесплатный web kover-crm-api во Frankfurt на Node 24. Регион совпадает с существующей службой; worker автоматически не создаётся. База — Supabase carpet (biajflaqndrngpeffhrx), Seoul. Для другой базы замените SUPABASE_URL и примените миграции 0001–0010.

## Текущий запуск

29.10.2026 [kover-crm-api.onrender.com](https://kover-crm-api.onrender.com) имеет статус Live. Страница, /health и /ready отвечают 200, создан активный администратор, пользователь подтвердил вход. Временные bootstrap-значения после входа очищены. Исправлены неправильный SUPABASE_URL и устаревший NODE_VERSION; остальные секреты сохранены.

Выбран бесплатный web. Отдельный worker не запущен, поэтому автоматические SLA-задачи, напоминания и отправка outbox не выполняются. render.worker.example.yaml — необязательный платный ресурс для будущего подключения после выбора тарифа.

На [бесплатном плане Render](https://render.com/docs/free#spinning-down-on-idle) сервис засыпает после 15 минут без входящих запросов; пробуждение занимает около минуты. Данные CRM и фотографии хранятся в Supabase, а не на временном диске Render.

## Новая установка

1. Откройте [Render Blueprint](https://dashboard.render.com/blueprint/new?repo=https://github.com/Arifugli/carpet), выберите рабочее пространство, репозиторий Arifugli/carpet, ветку main и render.yaml.
2. Введите три поля ниже непосредственно в Render. Ключ и пароль не нужно отправлять в чат или добавлять в GitHub.
3. Проверьте единственную службу kover-crm-api с планом Free и нажмите Apply. Для существующего Blueprint используйте Sync вместо создания дубликата.

| Поле | Значение |
| --- | --- |
| SUPABASE_SERVICE_ROLE_KEY | Серверный Secret API key из [Supabase carpet](https://supabase.com/dashboard/project/biajflaqndrngpeffhrx/settings/api-keys) либо legacy service_role key; не publishable/anon |
| BOOTSTRAP_ADMIN_EMAIL | Почта первого администратора |
| BOOTSTRAP_ADMIN_PASSWORD | Новый пароль 16–128 символов |

При обновлении существующей службы sync:false не добавляет новые секреты. Для первого администратора добавьте обе bootstrap-переменные через Environment и выберите Save, rebuild, and deploy. Уже работающий ключ Supabase повторно вводить не требуется.

OTP_SECRET и NOTIFICATION_ENCRYPTION_KEY Render генерирует автоматически, если переменные ещё не существуют. Сохраняйте ключ шифрования при переносе/восстановлении: его замена делает прежний outbox нечитаемым. PUBLIC_BASE_URL определяется по RENDER_EXTERNAL_URL; для своего домена задайте его явно.

## Проверка

1. Дождитесь Live. /health и /ready должны ответить 200, /ready — {"ok":true}; успешный build сам по себе этого не подтверждает.
2. Войдите выбранными почтой/паролем. Повторный деплой не меняет пароль. При INITIAL_ADMIN_SETUP_FAILED проверьте bootstrap-поля и применение 0009; не публикуйте секреты/полные ответы Auth в логах.
3. После первого входа удалите обе BOOTSTRAP_ADMIN_* из Environment либо очистите их значения и сохраните с деплоем. Пароль пользователя CRM при этом сохраняется.
4. Настройте тарифы, филиал, сотрудников и роли. Проверьте создание заказа, отказ, корзину, восстановление, аудит, фото и печать с телефона по stage4.md.

Payme/Click, SMS, Telegram и webhooks требуют аккаунтов и проверки провайдеров перед включением. Отправка worker включается WORKER_SEND_ENABLED=true после настройки отдельного процесса; основной web его не заменяет. Резервные копии и пробное восстановление — [operations.md](operations.md).

Оба YAML проверены по официальной JSON Schema. Render CLI для проверки с учётом рабочего пространства требует отдельной авторизации; фактический web проверен через статус деплоя, HTTP и подтверждённый вход.

Справочники: [Blueprints](https://render.com/docs/blueprint-spec), [переменные окружения](https://render.com/docs/configure-environment-variables), [ключи Supabase](https://supabase.com/docs/guides/getting-started/api-keys).
