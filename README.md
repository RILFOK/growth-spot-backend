# Backend

Node.js + Express + PostgreSQL backend для проекта growth-spot.ru.

## Стек
- Node.js
- Express
- PostgreSQL
- JWT
- PM2

## Основные возможности
- авторизация и 2FA
- работа с заявками
- защита от спама
- блокировка и whitelist IP
- управление пользователями
- настройки сайта

## Запуск локально
npm install
node index.js

## Переменные окружения
Создай .env файл:

DATABASE_URL=postgresql://user:password@localhost:5432/project1
JWT_SECRET=your_secret
PORT=3001

## Production
Backend в production разворачивается в:
`/var/www/project1/backend`

Запуск через PM2:
pm2 start index.js --name project1-backend

## Healthcheck
curl http://127.0.0.1:3001/api/health
