# Скрипт деплоя

В проекте используется единый bash-скрипт деплоя, который обновляет frontend и backend за один запуск.

## Назначение
Скрипт автоматизирует публикацию новой версии проекта в production и выполняет базовые проверки после обновления.

## Основные переменные
Скрипт использует следующие директории и параметры:
- `PROJECT_ROOT="$HOME/project1"`
- `FRONTEND_SRC="$PROJECT_ROOT/frontend"`
- `BACKEND_SRC="$PROJECT_ROOT/backend"`
- `FRONTEND_PROD="/var/www/project1/frontend"`
- `BACKEND_PROD="/var/www/project1/backend"`
- `PM2_NAME="project1-backend"`

## Что делает скрипт

### 1. Обновляет frontend
В директории frontend:
- выполняет `npm ci`, если есть `package-lock.json`;
- иначе выполняет `npm install`;
- запускает `npm run build`.

### 2. Публикует frontend
Содержимое `dist/` синхронизируется в production-директорию:

`/var/www/project1/frontend`

Для публикации используется `rsync --delete`, чтобы production-копия соответствовала текущей сборке.

### 3. Обновляет backend
Код backend синхронизируется в production-директорию:

`/var/www/project1/backend`

При синхронизации исключаются:
- `node_modules`
- `.git`
- `*.bak.*`

### 4. Устанавливает production-зависимости backend
В production-директории backend:
- выполняет `npm ci --omit=dev`, если есть `package-lock.json`;
- иначе выполняет `npm install --omit=dev`.

### 5. Перезапускает backend через PM2
Если процесс `project1-backend` уже существует, выполняется:

`pm2 restart project1-backend`

Если процесс ещё не создан, выполняется запуск через:

`pm2 start /var/www/project1/backend/index.js --name project1-backend --cwd /var/www/project1/backend`

После этого вызывается:

`pm2 save`

### 6. Проверяет nginx
Скрипт проверяет корректность конфигурации nginx:

`sudo nginx -t`

Если конфигурация корректна, выполняется reload:

`sudo systemctl reload nginx`

### 7. Проверяет запуск backend
После короткого ожидания:

`sleep 2`

выполняется health-check:

`curl -fsS http://127.0.0.1:3001/api/health`

### 8. Проверяет frontend
После обновления выполняется проверка доступности сайта:

`curl -I https://growth-spot.ru || true`

## Результат
После успешного выполнения скрипта:
- frontend доступен по адресу `https://growth-spot.ru`
- административная панель доступна по адресу `https://growth-spot.ru/admin/login`
- backend работает локально и обслуживается через nginx

## Скрипт который нужно вводить в папку frontend для публикации


#!/usr/bin/env bash
set -e

PROJECT_ROOT="$HOME/project1"
FRONTEND_SRC="$PROJECT_ROOT/frontend"
BACKEND_SRC="$PROJECT_ROOT/backend"

FRONTEND_PROD="/var/www/project1/frontend"
BACKEND_PROD="/var/www/project1/backend"

PM2_NAME="project1-backend"

echo "===> 1. Обновляем frontend"
cd "$FRONTEND_SRC"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build

echo "===> 2. Заливаем frontend в production"
mkdir -p "$FRONTEND_PROD"
rsync -av --delete "$FRONTEND_SRC/dist"/ "$FRONTEND_PROD"/

echo "===> 3. Обновляем backend"
mkdir -p "$BACKEND_PROD"
rsync -av --delete \
  --exclude=node_modules \
  --exclude=.git \
  --exclude='*.bak.*' \
  "$BACKEND_SRC"/ "$BACKEND_PROD"/

cd "$BACKEND_PROD"

if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "===> 4. Перезапускаем backend через PM2"
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 restart "$PM2_NAME"
else
  pm2 start "$BACKEND_PROD/index.js" --name "$PM2_NAME" --cwd "$BACKEND_PROD"
fi

pm2 save

echo "===> 5. Проверяем nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "===> 6. Ждём запуск backend"
sleep 2

echo "===> 7. Проверяем backend health"
curl -fsS http://127.0.0.1:3001/api/health
echo

echo "===> 8. Проверяем frontend"
curl -I https://growth-spot.ru || true

echo "===> Готово"
echo "Frontend: https://growth-spot.ru"
echo "Admin:    https://growth-spot.ru/admin/login"
