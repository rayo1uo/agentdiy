# T19 安全与隐私补齐报告

## 1. 本次目标
- 权限收敛（插件权限最小化）
- 后端跨域与响应安全头加固
- 用户数据删除能力（MVP 隐私合规基础）
- 最小审计日志（关键删除动作留痕）

## 2. 已完成项

### 2.1 插件权限收敛
- 文件：`/Users/luoyu15/Documents/work/agentdiy/extension/manifest.config.ts`
- 变更：移除未使用权限 `activeTab`、`scripting`
- 保留必要权限：`storage`、`tabs`、`sidePanel`、`alarms`

### 2.2 CORS 白名单与安全响应头
- 文件：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/cors.go`
- 文件：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/security_headers.go`
- 文件：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/router.go`
- 变更：
  - CORS 从固定 `*` 改为配置化 `ALLOWED_ORIGINS`
  - 增加安全头：
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: no-referrer`
    - `Permissions-Policy`
    - `Content-Security-Policy`

### 2.3 用户数据删除接口
- 文件：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/handler/privacy.go`
- 路由：`DELETE /api/v1/me/data`（需 Bearer Token）
- 动作：
  - 软删除该用户所有 annotation
  - 撤销该用户所有 refresh token
  - 清理该用户 sync events
- 返回：删除统计信息 + server_time

### 2.4 仓储层隐私清理能力
- `annotation repo` 增加 `SoftDeleteAllByUser`
- `auth repo` 增加 `RevokeAllRefreshTokensByUser`
- `sync repo` 增加 `DeleteAllByUser`
- 覆盖实现：memory + mysql

### 2.5 审计日志
- 在用户数据删除接口添加最小审计日志（user_id + 影响数据量）

## 3. 验证
- 新增测试：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/handler/privacy_test.go`
- 回归命令：`go test ./...`（目录 `server/`）
- 结果：通过

## 4. 仍需注意
- 生产环境务必使用 HTTPS 与强 `JWT_SECRET`
- `ALLOWED_ORIGINS` 需配置为明确白名单，不建议 `*`
- 数据“物理删除”可后续增加定时归档/清理任务（当前为注释软删）
