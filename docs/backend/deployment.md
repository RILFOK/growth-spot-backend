# Backend — деплой

## Общая схема
Backend разворачивается отдельно от frontend и работает как локальный API-сервис за nginx.

Исходный код backend находится в директории:

`/home/developer/project1/backend`

Production-копия backend размещается в директории:

`/var/www/project1/backend`

Backend работает локально на `127.0.0.1:3001` и обслуживается через nginx как reverse proxy.

## Публикация кода
Во время деплоя код backend синхронизируется в production через `rsync`.

При синхронизации исключаются:
- `node_modules`
- `.git`
- `*.bak.*`

Используется команда вида:

`rsync -av --delete --exclude=node_modules --exclude=.git --exclude='*.bak.*' "$BACKEND_SRC"/ "$BACKEND_PROD"/`

## Установка production-зависимостей
После копирования кода в production-директории устанавливаются только production-зависимости.

Если есть `package-lock.json`, используется:

`npm ci --omit=dev`

Если lock-файла нет, используется:

`npm install --omit=dev`

## PM2
Для управления backend-процессом используется PM2.

Имя процесса:

`project1-backend`

Во время деплоя:
- если процесс уже существует, выполняется `pm2 restart`;
- если процесса нет, выполняется `pm2 start`.

После этого состояние PM2 сохраняется командой:

`pm2 save`

## Nginx
После обновления backend выполняется:
- проверка конфигурации nginx;
- reload nginx.

Используются команды:

`sudo nginx -t`

`sudo systemctl reload nginx`

## Health-check
После перезапуска backend выполняется ожидание запуска, затем health-check:

`sleep 2`

`curl -fsS http://127.0.0.1:3001/api/health`

## Проверка frontend после деплоя
В рамках общего deployment-сценария после backend также выполняется проверка frontend:

`curl -I https://growth-spot.ru || true`

## Итоговая production-схема
В production:
- frontend публикуется в `/var/www/project1/frontend`;
- backend публикуется в `/var/www/project1/backend`;
- backend работает через PM2;
- nginx раздаёт frontend и проксирует `/api` на backend.