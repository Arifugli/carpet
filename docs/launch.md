# Рабочий запуск 0.5.1 через Render Blueprint

Основной render.yaml создаёт web kover-crm-api и worker kover-crm-outbox во Frankfurt на Node 24. Регион совпадает с уже существующим web: Render не позволяет менять регион службы при синхронизации Blueprint. Оба используют минимальный платный план 0.5c-512mb. Render покажет итоговую стоимость перед Apply. База находится в Supabase carpet (biajflaqndrngpeffhrx), Seoul. Для новой установки на другой базе замените SUPABASE_URL в Blueprint и примените миграции 0001–0009.

## Уже созданная служба

При диагностике 29.10.2026 kover-crm-api работал на free во Frankfurt; worker ещё не был создан. Неправильный SUPABASE_URL приводил к ошибке Invalid supabaseUrl до открытия HTTP-порта. Адрес исправлен на https://biajflaqndrngpeffhrx.supabase.co, NODE_VERSION установлен в 24; после нового деплоя страница, /health и /ready ответили 200. Это изменение двух несекретных переменных соответствует значениям Blueprint, остальные переменные сохранены.

Для первоначального администратора существующей службы добавьте BOOTSTRAP_ADMIN_EMAIL и BOOTSTRAP_ADMIN_PASSWORD вручную через Environment, затем Save, rebuild, and deploy: sync:false не добавляет поля при обновлении. Уже работающий ключ Supabase повторно вводить не требуется. Вход проверяется отдельно после создания профиля.

Переход с free на два платных сервиса — отдельное применение Blueprint с подтверждением стоимости. Исправление региона подготовлено отдельно от main, чтобы его автоматическая синхронизация не создала платный worker до подтверждения. Не считайте один web запуском фонового обработчика.

## Создание

1. Откройте [Render Blueprint](https://dashboard.render.com/blueprint/new?repo=https://github.com/Arifugli/carpet), выберите нужное рабочее пространство и репозиторий Arifugli/carpet, ветку main и render.yaml.
2. Введите три поля ниже непосредственно в Render. Ключ и пароль не нужно отправлять в чат или добавлять в GitHub.
3. Проверьте два сервиса и стоимость, нажмите Apply. На существующем Blueprint используйте его Sync вместо создания дубликата; sync:false запрашивает секреты только при первоначальном создании, позднее они добавляются в Environment вручную.

| Поле | Значение |
| --- | --- |
| SUPABASE_SERVICE_ROLE_KEY | Серверный Secret API key из [настроек Supabase carpet](https://supabase.com/dashboard/project/biajflaqndrngpeffhrx/settings/api-keys), либо legacy service_role key; не publishable/anon |
| BOOTSTRAP_ADMIN_EMAIL | Почта первого администратора |
| BOOTSTRAP_ADMIN_PASSWORD | Новый пароль 16–128 символов для первого входа |

OTP_SECRET и NOTIFICATION_ENCRYPTION_KEY Render генерирует автоматически. Worker получает ключ БД и ключ шифрования от web через fromService. Сохраняйте ключ шифрования при переносе/восстановлении: его замена делает прежние сообщения outbox нечитаемыми. PUBLIC_BASE_URL определяется по RENDER_EXTERNAL_URL; при подключении своего домена задайте его явно web и worker.

## Проверка результата

1. Дождитесь Live у web и работающего процесса worker. /health должен вернуть HTTP 200, /ready — HTTP 200 и {"ok":true}. Один успешный build этого не подтверждает.
2. Откройте выданный Render HTTPS URL и войдите выбранными почтой/паролем. Администратор создаётся сервером при первом старте, повторный деплой не меняет пароль. При INITIAL_ADMIN_SETUP_FAILED проверьте три поля и применение 0009; не публикуйте полные секреты/ответы Auth в логах.
3. После успешного входа удалите BOOTSTRAP_ADMIN_PASSWORD из Environment web; BOOTSTRAP_ADMIN_EMAIL также можно удалить. Перезапуск с действующим admin не требует bootstrap-пароля.
4. Настройте тарифы, филиал, сотрудников и роли. Проверьте создание заказа, отказ, корзину, восстановление и аудит; затем выполните ручную приёмку с телефона из stage4.md, включая фото и печать. До приёмки не считайте выпуск полностью проверенным для сотрудников.

WORKER_SEND_ENABLED=false оставляет внешние рассылки выключенными, SLA и напоминания работают. Payme/Click, SMS, Telegram и исходящие webhooks требуют собственных аккаунтов и проверки провайдеров перед включением. Регламент резервных копий и пробного восстановления — [operations.md](operations.md).

Blueprint проверен по официальной JSON Schema. Проверка Render CLI, которая также сравнивает ресурсы рабочего пространства, требует его авторизации; итоговую проверку создания выполнит Dashboard при Apply. Реальный деплой и вход подтверждаются отдельно после появления URL.

Справочники: [Render Blueprints](https://render.com/docs/blueprint-spec), [переменные окружения](https://render.com/docs/configure-environment-variables), [ключи Supabase](https://supabase.com/docs/guides/getting-started/api-keys).
