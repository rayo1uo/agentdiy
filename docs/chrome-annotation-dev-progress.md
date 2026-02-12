# Chrome Annotation MVP 开发进度

## 已完成
- T01 插件工程初始化：已创建 `extension/`，包含 MV3 + TS + React + Vite + CRX 构建配置。
- T02 Manifest 基础权限：已配置 storage/activeTab/tabs/sidePanel 等 MVP 所需权限。
- T03 划词监听与操作条：已实现 content script 划词后浮动按钮（高亮/评论）。
- T04 高亮渲染：已实现按 offset 恢复和渲染高亮。
- T06 评论能力（本地）：已支持创建时评论、侧边栏编辑评论。
- T07 Side Panel 列表：已支持列表展示、定位、编辑、删除。
- T08 后端工程初始化：已创建 `server/`，可运行 HTTP 服务。
- T09 MySQL 建模迁移：已提供 `server/migrations/0001_init.sql`。
- T09 MySQL 建模迁移：已提供 `server/migrations/*.sql` 与一键迁移命令 `go run ./cmd/migrate`。
- T10 鉴权 API：已实现 `register/login/refresh/logout`，采用 `JWT + Refresh Token`。
- 注释与同步接口已接入 Bearer JWT 鉴权中间件，按用户维度隔离数据。
- T11 注释仓储接入准备：已实现 MySQL 仓储代码与 `memory/mysql` 存储后端切换。
- T14/T15 增量同步：已实现 `sync/push` 与 `sync/pull`（cursor 拉取、操作幂等去重、冲突返回）。
- T16 客户端离线队列：extension background 已接入 `op_queue`、定时同步与手动触发同步入口。
- T17 冲突与重试：已接入冲突队列、指数退避重试、最大重试次数、冲突任务重试入口。
- T18 跨端联调：已补自动化双端收敛测试（win/mac 模拟）并产出联调报告文档。
- T19 安全与隐私：已完成权限收敛、CORS 白名单、安全响应头、用户数据删除接口与审计日志。
- T20 测试与发布准备：已完成发布就绪报告、手工回归清单、商店提交素材模板与隐私政策草案。

## 当前状态
- 插件端当前数据存储为 `chrome.storage.local`，用于 MVP 本地链路。
- 当前默认使用内存仓储；当 `STORAGE_BACKEND=mysql` 且数据库可用时将启用 MySQL 仓储。
- 已修复 MySQL 驱动注册，`STORAGE_BACKEND=mysql` 不再因 `unknown driver "mysql"` 静默回退到内存仓储。
- 同步接口不再是 stub，当前可处理 `create/update_comment/delete` 三类操作。
- 已新增 `server/migrations/0002_auth_refresh_tokens.sql` 用于 refresh token 持久化表结构。
- 已新增 `server/migrations/0003_sync_op_dedup.sql` 用于 sync op 去重索引。
- extension `options` 页面已支持配置 `API Base URL` 与 auth token，并保存后触发一次同步。
- extension `options` 页面新增同步状态与冲突列表查看、重试冲突任务按钮。
- extension `options` 页面已接入 auth API（注册/登录/登出）并自动写入 token。
- side panel 新增每条注释同步状态标记（已同步/待同步/冲突）与全局同步状态面板。
- side panel 支持“重试本页冲突”按钮，可按当前页面冲突 op 精细重试。
- side panel 支持“重试该条冲突”按钮，可按单条注释冲突重试。
- side panel 已支持冲突详情面板（逐条展示 op_id/message）以及逐条“重试/忽略”。
- side panel 冲突详情支持按错误类型分组，并可“重试同类/忽略同类”。
- 联调报告：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t18-cross-device-report.md`
- 安全隐私报告：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t19-security-privacy-report.md`
- 发布就绪报告：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t20-release-readiness.md`
- 手工回归清单：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t20-manual-regression-checklist.md`
- 手工回归结果模板：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t20-manual-regression-results.md`
- 商店提交模板：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-t20-webstore-submission-kit.md`
- 隐私政策草案：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-privacy-policy-draft.md`
- 已在 2026-02-12 完成 extension 依赖安装后的 `npm --prefix extension run build`，构建产物输出至 `extension/dist/`。
- 已新增发布前一键检查脚本：`/Users/luoyu15/Documents/work/agentdiy/scripts/release-check.sh`（执行 extension 构建 + backend 测试）。
- 已新增根目录 `Makefile`，统一 `extension-build/server-test/server-migrate/release-check` 等常用命令。

## 下一步
- 在 Chrome 加载 `extension/dist/` 执行 T20 手工回归清单并补齐实测记录。
