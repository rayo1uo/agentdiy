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

## Current endpoints

- `GET /api/v1/health`
- `GET /api/v1/annotations?url=...`
- `POST /api/v1/annotations`
- `PATCH /api/v1/annotations/{id}`
- `DELETE /api/v1/annotations/{id}?url=...`
- `POST /api/v1/sync/push` (stub)
- `GET /api/v1/sync/pull` (stub)

## Database

Use `migrations/0001_init.sql` to initialize MySQL tables.
