# Annota MVP

[English](./README.md) | 中文

Chrome 划词高亮与评论插件（MV3）+ Go 后端 + MySQL 的最小可用实现，支持登录、手动/定时同步、跨设备合并与冲突处理。

- 仓库地址：[https://github.com/rayo1uo/agentdiy](https://github.com/rayo1uo/agentdiy)
- Go 模块：`github.com/rayo1uo/agentdiy/server`

## 功能概览

- 网页文本高亮（多颜色）与评论编辑
- Side Panel 查看当前页面高亮列表并定位到原文
- 用户注册、登录、刷新 Token、登出
- 同步机制：本地队列 + `/sync/push` + `/sync/pull`
- 支持冲突记录与重试
- 隐私接口：删除当前用户数据（软删除注释 + 吊销 refresh token + 清理同步事件）

## 技术栈

- 前端扩展：TypeScript + React + Vite + CRXJS（Manifest V3）
- 后端：Go（标准库 HTTP）
- 存储：MySQL 8.4（可回退到内存存储）
- 部署：Docker Compose

## 目录结构

```text
.
├── extension/              # Chrome 扩展
│   ├── src/background      # 同步、存储、消息分发
│   ├── src/content         # 页面高亮渲染与交互
│   ├── src/sidepanel       # 侧边栏 UI
│   ├── src/options         # 配置页
│   └── src/popup           # 弹窗页
├── server/                 # Go API 服务
│   ├── cmd/api             # API 入口
│   ├── cmd/migrate         # 迁移入口
│   ├── internal/http       # 路由与 handler
│   ├── internal/storage    # memory/mysql 仓储实现
│   └── migrations          # SQL 迁移
├── docs/                   # 设计、部署、回归测试文档
├── docker-compose.yml
└── Makefile
```

## 快速开始（推荐：Docker）

### 1) 准备环境

- Docker + Docker Compose
- Node.js 18+（用于构建扩展）

### 2) 启动 MySQL + API

```bash
cp .env.docker.example .env
make docker-up
make docker-logs
```

默认端口：

- API: `http://127.0.0.1:8080`
- MySQL: `127.0.0.1:3306`

### 3) 构建并加载扩展

```bash
make extension-install
make extension-build
```

然后在 Chrome 打开 `chrome://extensions`：

1. 开启“开发者模式”
2. 点击“加载已解压的扩展程序”
3. 选择目录：`extension/dist`

### 4) 配置后端地址

在扩展的 Options 页面设置 API Base URL，例如：

`http://127.0.0.1:8080`

同时确认后端 `ALLOWED_ORIGINS` 包含你的扩展 ID，例如：

`chrome-extension://<你的扩展ID>`

## 本地开发（不使用 Docker）

### 扩展

```bash
make extension-install
cd extension && npm run build
```

### 后端

```bash
cp server/.env.example server/.env
make server-migrate   # 仅 MySQL 模式需要
make server-run
```

可用命令：

```bash
make server-test
make release-check
```

## 核心接口

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/annotations?url=...`（Bearer）
- `POST /api/v1/annotations`（Bearer）
- `PATCH /api/v1/annotations/{id}`（Bearer）
- `DELETE /api/v1/annotations/{id}?url=...`（Bearer）
- `POST /api/v1/sync/push`（Bearer）
- `GET /api/v1/sync/pull?cursor=0&limit=50`（Bearer）
- `DELETE /api/v1/me/data`（Bearer）

详细说明可见：`server/README.md`

## 环境变量

主要变量（服务端）：

- `HTTP_ADDR`（默认 `:8080`）
- `MYSQL_DSN`
- `STORAGE_BACKEND`（`memory` 或 `mysql`）
- `ALLOWED_ORIGINS`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_SECONDS`

示例文件：

- `server/.env.example`
- `.env.docker.example`

## 常见问题

- `go mod download` 超时：可在 Docker 构建参数里设置 `GOPROXY`/`GOSUMDB`（项目已在 `Dockerfile` 与 `.env.docker.example` 给出默认值）。
- 扩展请求被 CORS 拒绝：检查 `ALLOWED_ORIGINS` 是否包含真实 `chrome-extension://<id>`。
- 登录后无高亮：确认扩展 API Base URL 指向正确后端，并点击“立即同步”或刷新页面验证。

## 相关文档

- 部署文档：`docs/chrome-annotation-aliyun-ecs-docker-deploy.md`
- 技术方案：`docs/chrome-annotation-mvp-technical-plan.md`
- 回归结果：`docs/chrome-annotation-t20-manual-regression-results.md`
