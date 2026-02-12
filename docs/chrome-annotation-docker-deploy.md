# Chrome Annotation 后端 Docker 傻瓜式部署文档

## 1. 部署目标
- 使用 Docker 一键启动：
  - 后端 API（Go）
  - MySQL 8.4
- 自动完成数据库迁移（容器启动时执行）。

## 2. 前置要求
- 已安装 Docker Desktop（或 Docker Engine + Docker Compose）。
- 本机可执行命令：
  - `docker --version`
  - `docker compose version`

## 3. 一键启动（最短路径）
在项目根目录执行：

```bash
cp .env.docker.example .env
docker compose up -d --build
```

也可以直接用 Make 命令：

```bash
make docker-up
```

## 4. 启动后检查
1. 查看容器状态：

```bash
docker compose ps
```

你应看到两个服务：
- `annota-mysql`（healthy）
- `annota-api`（running）

2. 查看 API 健康检查：

```bash
curl http://localhost:8080/api/v1/health
```

期望返回 HTTP 200。

3. 查看后端日志（可确认迁移是否执行）：

```bash
docker compose logs -f api
```

如果看到 `migration finished` 和 `api server started`，表示启动成功。

## 5. 文件说明
- `docker-compose.yml`
  - 编排 MySQL 和 API。
  - API 依赖 MySQL 健康检查后启动。
- `server/Dockerfile`
  - 多阶段构建后端镜像。
  - 打包 `api` 和 `migrate` 二进制。
- `server/docker/entrypoint.sh`
  - 当 `STORAGE_BACKEND=mysql` 时，先执行迁移，再启动 API。
- `.env.docker.example`
  - Docker 部署用环境变量模板。

## 6. 常用运维命令
- 停止服务：

```bash
docker compose down
```

或：

```bash
make docker-down
```

- 停止并删除数据卷（会清空 MySQL 数据）：

```bash
docker compose down -v
```

- 仅重建并重启 API：

```bash
docker compose up -d --build api
```

- 查看 MySQL 日志：

```bash
docker compose logs -f mysql
```

同时查看 API + MySQL 日志：

```bash
make docker-logs
```

## 7. 插件联调配置
- Extension `API Base URL` 填：
  - `http://localhost:8080`
- `ALLOWED_ORIGINS` 需要包含：
  - 你的插件 ID：`chrome-extension://<YOUR_EXTENSION_ID>`

## 8. 生产环境最小建议
- 修改 `.env` 中默认密码和 `JWT_SECRET`。
- 不对公网暴露 MySQL 端口（删除 `MYSQL_PORT` 映射）。
- API 前加 HTTPS 反向代理（Nginx/Caddy/Traefik）。
- 将 `ALLOWED_ORIGINS` 设置为明确白名单，不使用 `*`。

## 9. 常见问题
- 问题：API 启动后立刻退出
  - 处理：`docker compose logs api`，检查 `JWT_SECRET`、`MYSQL_DSN`、迁移失败信息。
- 问题：MySQL healthy 一直不通过
  - 处理：`docker compose logs mysql`，确认密码与端口未冲突。
- 问题：插件请求被 CORS 拒绝
  - 处理：把插件真实 ID 加到 `ALLOWED_ORIGINS`，然后 `docker compose up -d api`。
