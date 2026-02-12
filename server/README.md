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
- `POST /api/v1/sync/push` (requires bearer token)
- `GET /api/v1/sync/pull?cursor=0&limit=50` (requires bearer token)
- `DELETE /api/v1/me/data` (requires bearer token, soft-delete annotations + revoke refresh tokens + clear sync events)

## Database

Use `migrations/0001_init.sql` and `migrations/0002_auth_refresh_tokens.sql` to initialize MySQL tables.

When `STORAGE_BACKEND=mysql` is enabled, the service will try to connect with `MYSQL_DSN`. If MySQL is unavailable, it falls back to in-memory storage.

For sync idempotency, also apply `migrations/0003_sync_op_dedup.sql`.

`/api/v1/sync/push` request body fields:
- `device_id`, `device_name`, `platform`
- `operations[]` with `op_id`, `op_type(create|update_comment|delete)`, `url`, and annotation fields

## Security Notes

- Configure `ALLOWED_ORIGINS` to explicit trusted origins in production.
- The server now applies baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`, CSP, etc.).
- Use HTTPS in production environments.
