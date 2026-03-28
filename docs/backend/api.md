# Backend — API

Ниже приведён список всех HTTP endpoint'ов, реализованных в backend.

## Health
- `GET /api/health`

## Auth
- `POST /api/auth/login`
- `POST /api/auth/verify-2fa`
- `POST /api/auth/enable-2fa`
- `POST /api/auth/disable-2fa`
- `GET /api/auth/me`

## Leads
- `POST /api/leads`
- `GET /api/leads`
- `PATCH /api/leads/:id`
- `DELETE /api/leads/:id`

## Security / IP
- `GET /api/blocked-ips`
- `POST /api/blocked-ips/:id/unblock`
- `GET /api/ip-info`
- `GET /api/ip-whitelist`
- `POST /api/ip-whitelist`
- `POST /api/ip-whitelist/:id/disable`

## Users
- `GET /api/users`
- `POST /api/users`
- `DELETE /api/users/:id`
- `PUT /api/users/:id/role`
- `PUT /api/users/me/password`
- `PUT /api/users/:id/password`

## Settings
- `GET /api/settings/public`
- `GET /api/settings`
- `PUT /api/settings`

## Примечания
- Большинство endpoint'ов, кроме `GET /api/health`, `POST /api/leads` и `GET /api/settings/public`, требуют Bearer-токен.
- Подробное описание прав доступа см. в [Авторизация и роли](./auth-and-roles.md).
- Подробное описание логики заявок и антиспама см. в [Заявки и антиспам](./leads-and-antispam.md).
- Подробное описание управления пользователями см. в [Пользователи](./users.md).
- Подробное описание настроек сайта см. в [Настройки](./settings.md).
- Подробное описание IP-безопасности см. в [IP-безопасность](./ip-security.md).