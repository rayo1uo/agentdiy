# Annota MVP Backend (Go + MySQL)

## Run

```bash
go run ./cmd/api
```

Default address: `:8080`

## Env

Copy `.env.example` and set values in your shell.

- `HTTP_ADDR`
- `MYSQL_DSN`
- `ALLOWED_ORIGINS`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`
- `STORAGE_BACKEND` (`memory` or `mysql`)

## Current endpoints

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/annotations?url=...` (requires `Authorization: Bearer <access_token>`)
- `POST /api/v1/annotations` (requires bearer token)
- `PATCH /api/v1/annotations/{id}` (requires bearer token)
- `DELETE /api/v1/annotations/{id}?url=...` (requires bearer token)
- `POST /api/v1/sync/push` (stub, requires bearer token)
- `GET /api/v1/sync/pull` (stub, requires bearer token)

## Database

Use `migrations/0001_init.sql` and `migrations/0002_auth_refresh_tokens.sql` to initialize MySQL tables.

When `STORAGE_BACKEND=mysql` is enabled, the service will try to connect with `MYSQL_DSN`. If MySQL is unavailable, it falls back to in-memory storage.
