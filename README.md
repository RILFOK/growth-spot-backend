# Growth Spot — Backend

A REST API for the standalone React/Vite iteration of Growth Spot. Built with Node.js, Express 5 and PostgreSQL. The current live website may use a different application iteration.

## Stack
Node.js · Express 5 · PostgreSQL (`pg`) · JWT · bcrypt/bcryptjs · OTPAuth · PM2.

## Implemented areas
- API for website forms and the administrative interface.
- Lead management with antispam checks.
- Users, roles and access control.
- JWT authentication and two-factor authentication.
- Site settings, IP allowlist/blocklist and health check.

## Local development
Requirements: Node.js, npm and a running PostgreSQL instance.

```bash
npm ci
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET and other required values
node index.js
```

The setup documentation describes the development configuration and health endpoint. Do not commit real credentials or production data.

## Documentation
- [Overview](docs/backend/overview.md)
- [Local setup](docs/backend/setup.md)
- [Architecture](docs/backend/architecture.md)
- [API](docs/backend/api.md)
- [Authentication and roles](docs/backend/auth-and-roles.md)
- [Leads and antispam](docs/backend/leads-and-antispam.md)
- [Database](docs/backend/database.md)
- [IP security](docs/backend/ip-security.md)
- [Deployment](docs/backend/deployment.md)

## Related project
[Growth Spot — Frontend](https://github.com/RILFOK/growth-spot-frontend) — React, TypeScript, Vite and Tailwind CSS.

> This repository documents and demonstrates an application implementation. It does not include production secrets or a live administrative account.
