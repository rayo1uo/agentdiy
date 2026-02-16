# Annota MVP

English | [中文](./README.zh.md)

A Chrome text highlight/comment extension (Manifest V3) with a Go backend and MySQL storage, designed as an MVP with login, manual/timed sync, and cross-device convergence.

- Repository: [https://github.com/rayo1uo/annota](https://github.com/rayo1uo/annota)
- Go module: `github.com/rayo1uo/annota/server`

## Features

- Highlight selected text on web pages with multiple colors
- Add/edit comments for highlights
- Side Panel to browse highlights on current page and jump to source text
- Auth flow: register, login, refresh token, logout
- Sync pipeline: local queue + `/sync/push` + `/sync/pull`
- Conflict tracking and retry
- Privacy endpoint to delete user data

## Tech Stack

- Extension: TypeScript + React + Vite + CRXJS (MV3)
- Backend: Go (net/http)
- Storage: MySQL 8.4 (with in-memory fallback)
- Deployment: Docker Compose

## Project Structure

```text
.
├── extension/              # Chrome extension codebase
│   ├── src/background      # sync/storage/message handling
│   ├── src/content         # highlight rendering and interaction
│   ├── src/sidepanel       # side panel UI
│   ├── src/options         # options page
│   └── src/popup           # popup page
├── server/                 # Go API service
│   ├── cmd/api             # API entrypoint
│   ├── cmd/migrate         # migration entrypoint
│   ├── internal/http       # router and handlers
│   ├── internal/storage    # memory/mysql repositories
│   └── migrations          # SQL migrations
├── docs/                   # design/deployment/regression docs
├── docker-compose.yml
└── Makefile
```

## Quick Start (Recommended: Docker)

### 1) Prerequisites

- Docker + Docker Compose
- Node.js 18+ (for extension build)

### 2) Start MySQL + API

```bash
cp .env.docker.example .env
make docker-up
make docker-logs
```

Default ports:

- API: `http://127.0.0.1:8080`
- MySQL: `127.0.0.1:3306`

### 3) Build and Load Extension

```bash
make extension-install
make extension-build
```

In Chrome, open `chrome://extensions`:

1. Enable Developer mode
2. Click "Load unpacked"
3. Select directory: `extension/dist`

### 4) Configure Backend URL

In the extension Options page, set API Base URL, for example:

`http://127.0.0.1:8080`

Also ensure backend `ALLOWED_ORIGINS` includes your extension ID origin:

`chrome-extension://<your-extension-id>`

## Local Development (Without Docker)

### Extension

```bash
make extension-install
cd extension && npm run build
```

### Backend

```bash
cp server/.env.example server/.env
make server-migrate   # required for MySQL mode
make server-run
```

Useful commands:

```bash
make server-test
make release-check
```

## Core APIs

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/annotations?url=...` (Bearer token required)
- `POST /api/v1/annotations` (Bearer token required)
- `PATCH /api/v1/annotations/{id}` (Bearer token required)
- `DELETE /api/v1/annotations/{id}?url=...` (Bearer token required)
- `POST /api/v1/sync/push` (Bearer token required)
- `GET /api/v1/sync/pull?cursor=0&limit=50` (Bearer token required)
- `DELETE /api/v1/me/data` (Bearer token required)

For backend details, see: `server/README.md`

## Environment Variables

Main backend env vars:

- `HTTP_ADDR` (default `:8080`)
- `MYSQL_DSN`
- `STORAGE_BACKEND` (`memory` or `mysql`)
- `ALLOWED_ORIGINS`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`

Example files:

- `server/.env.example`
- `.env.docker.example`

## Troubleshooting

- `go mod download` timeout:
  set `GOPROXY`/`GOSUMDB` in Docker build args (defaults are already provided in `Dockerfile` and `.env.docker.example`).
- CORS blocked from extension:
  ensure `ALLOWED_ORIGINS` includes `chrome-extension://<id>`.
- No highlights after login:
  verify API Base URL is correct, then trigger sync or refresh the page.

## Related Docs

- Deployment guide: `docs/chrome-annotation-aliyun-ecs-docker-deploy.md`
- Technical plan: `docs/chrome-annotation-mvp-technical-plan.md`
- Regression results: `docs/chrome-annotation-t20-manual-regression-results.md`

