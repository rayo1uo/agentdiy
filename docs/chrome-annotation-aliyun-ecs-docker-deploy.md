# Chrome Annotation 后端阿里云 ECS 部署文档（Docker + MySQL 持久化）

## 1. 目标与架构

目标：在同一台阿里云 ECS 上，用 Docker 容器部署：

- `annota-api`（Go 后端）
- `annota-mysql`（MySQL 8.4）

并满足：

- MySQL 数据持久化（容器重建后数据保留）
- 服务可长期运行（重启自动拉起）
- 具备基本运维能力（日志、备份、恢复、升级）

当前仓库已内置：

- `docker-compose.yml`
- `server/Dockerfile`
- `server/docker/entrypoint.sh`（启动 API 前自动迁移）

## 2. 前置准备

## 2.1 阿里云资源建议

- ECS：2C4G 起步（测试可 2C2G）
- 系统：Ubuntu 22.04 LTS（本文以 Ubuntu 为例）
- 磁盘：系统盘 + 数据盘（可选，建议把项目放到数据盘）
- 公网：EIP 或公网带宽

## 2.2 安全组建议

至少放行：

- `22/tcp`（SSH，仅你的办公 IP）
- `8080/tcp`（如果你直接暴露 API）

不要放行：

- `3306/tcp`（MySQL 不对公网开放）

如果后续接 Nginx/HTTPS，再放行 `80/tcp`、`443/tcp`。

## 2.3 本地准备

先拿到仓库代码（你可以在服务器上 `git clone`，或者本地打包上传）。

---

## 3. 在 ECS 安装 Docker 与 Compose

SSH 登录 ECS 后执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

重新登录一次 SSH，让 `docker` 免 sudo 生效。

验证：

```bash
docker --version
docker compose version
```

---

## 4. 部署目录与环境变量

## 4.1 上传项目

示例目录：

```bash
sudo mkdir -p /opt/agentdiy
sudo chown -R $USER:$USER /opt/agentdiy
cd /opt/agentdiy
```

将项目放到 `/opt/agentdiy` 后，进入项目根目录（包含 `docker-compose.yml` 的目录）。

## 4.2 生成生产环境 `.env`

```bash
cp .env.docker.example .env
```

编辑 `.env`：

```dotenv
# MySQL
MYSQL_ROOT_PASSWORD=请改成高强度密码
MYSQL_DATABASE=annota
MYSQL_USER=annota
MYSQL_PASSWORD=请改成高强度密码

# 建议仅绑定宿主机回环地址，避免对公网暴露 MySQL
# 会映射为 docker 的 127.0.0.1:3306:3306
MYSQL_PORT=127.0.0.1:3306

# API
API_PORT=8080
JWT_SECRET=请改成高强度随机串
ALLOWED_ORIGINS=chrome-extension://你的扩展ID
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000

MIGRATE_MAX_RETRIES=30
MIGRATE_RETRY_INTERVAL_SECONDS=2

# Docker 构建阶段 Go 模块下载镜像（阿里云国内地域建议保留）
GOPROXY=https://goproxy.cn,direct
GOSUMDB=sum.golang.google.cn
```

生成 JWT 随机串示例：

```bash
openssl rand -hex 32
```

保护配置文件：

```bash
chmod 600 .env
```

---

## 5. 启动服务

在项目根目录执行：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

预期：

- `annota-mysql`：`healthy`
- `annota-api`：`running`

查看日志（重点看迁移）：

```bash
docker compose logs -f api
```

看到类似 `migration finished` 和 API 启动日志即正常。

---

## 6. 验证部署

## 6.1 服务器本机验证

```bash
curl http://127.0.0.1:8080/api/v1/health
```

返回 `200` 即正常。

## 6.2 公网验证（如开放 8080）

```bash
curl http://<你的ECS公网IP>:8080/api/v1/health
```

如果失败，检查：

- ECS 安全组是否开放 `8080`
- ECS 本机防火墙（`ufw`/`firewalld`）
- 容器日志是否报错

---

## 7. 插件侧配置

插件中设置：

- `API Base URL`：`http://<你的ECS公网IP>:8080`（或你的域名）
- `ALLOWED_ORIGINS` 必须包含：
  - `chrome-extension://<你的扩展ID>`

如果后续换域名/HTTPS，同步更新 `API Base URL` 和服务端 `ALLOWED_ORIGINS`。

---

## 8. 持久化说明（MySQL）

`docker-compose.yml` 已把 MySQL 数据挂载到命名卷：

- `mysql_data:/var/lib/mysql`

因此：

- `docker compose down` 后再 `up`，数据仍在
- 只有执行 `docker compose down -v` 才会删除卷和数据

查看卷：

```bash
docker volume ls | grep mysql_data
```

---

## 9. 备份与恢复

## 9.1 逻辑备份（推荐每日）

```bash
mkdir -p /opt/agentdiy/backups
docker exec annota-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases annota --single-transaction --quick --lock-tables=false' \
  > /opt/agentdiy/backups/annota_$(date +%F_%H%M%S).sql
```

建议再把备份上传到 OSS/NAS。

## 9.2 恢复

```bash
cat /opt/agentdiy/backups/annota_xxx.sql | \
docker exec -i annota-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

恢复前建议先在测试环境演练。

---

## 10. 升级流程

```bash
cd /opt/agentdiy
git pull
docker compose up -d --build
docker compose ps
docker compose logs --tail=200 api
```

说明：

- API 容器启动时会自动执行迁移（`server/docker/entrypoint.sh`）
- `restart: unless-stopped` 可保障宿主机重启后容器自动拉起

---

## 11. 生产环境建议（强烈建议）

1. 不直接公网暴露 8080，前置 Nginx/Caddy 做 HTTPS 终止。  
2. 不开放 3306 到公网（仅容器网络内部访问）。  
3. 定期轮换 `JWT_SECRET`、数据库密码。  
4. 开启日志轮转，避免磁盘被日志占满。  
5. 最少每天一次数据库备份，并做恢复演练。  
6. `ALLOWED_ORIGINS` 使用精确白名单，不要使用 `*`。  

---

## 12. 常见问题排查

## 12.1 API 起不来

```bash
docker compose logs api
```

重点看：

- `JWT_SECRET` 是否为空
- MySQL 连接串是否正确
- 迁移是否连续失败

## 12.2 MySQL unhealthy

```bash
docker compose logs mysql
```

重点看：

- 初始化密码是否冲突
- 磁盘空间是否不足

## 12.3 插件请求报 CORS

- 检查 `.env` 的 `ALLOWED_ORIGINS` 是否包含真实扩展 ID
- 修改后重启 API：

```bash
docker compose up -d api
```

## 12.4 `go mod download` 超时（你当前遇到的问题）

症状示例：

- `Get "https://proxy.golang.org/...": dial tcp ... i/o timeout`

处理顺序：

1. 确认 `.env` 存在并包含：

```dotenv
GOPROXY=https://goproxy.cn,direct
GOSUMDB=sum.golang.google.cn
```

2. 重新构建：

```bash
docker compose build --no-cache api
docker compose up -d
```

3. 若仍失败，检查 ECS 出网：

- 是否可访问外网（NAT/EIP）
- 安全组/ACL 是否限制 443 出站

4. 临时绕过校验（仅临时排障，不建议长期）：

```dotenv
GOSUMDB=off
```
