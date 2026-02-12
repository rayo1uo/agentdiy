# T20 发布就绪报告（MVP）

## 1. 结论
- 当前版本已具备提交 Chrome Web Store 审核的核心能力。
- 后端自动化测试通过，跨端同步与冲突处理链路已具备可演示与可验证性。
- 前端构建与后端测试均已在本地执行通过；当前剩余工作为按清单完成一轮 Chrome 实机手工回归。

## 2. 已完成验收项
- 功能链路：
  - 划词高亮、评论 CRUD、Side Panel 管理
  - 账号登录（register/login/refresh/logout）
  - 多端增量同步（push/pull + cursor）
  - 冲突队列与重试（逐条/同类/本页）
- 安全隐私：
  - 权限收敛
  - CORS 白名单
  - 安全响应头
  - 用户数据删除接口（`DELETE /api/v1/me/data`）
- 联调验证：
  - 自动化双端收敛测试（Windows/mac 模拟）
  - 手工联调报告文档

## 3. 测试执行结果（2026-02-12）
- 后端自动化测试：通过
  - 命令：`go test ./...`
  - 路径：`/Users/luoyu15/Documents/work/agentdiy/server`
- 前端构建与类型检查：通过
  - 命令：`npm --prefix extension run build`
  - 路径：`/Users/luoyu15/Documents/work/agentdiy`
  - 结果：`tsc --noEmit` 与 `vite build` 均成功，产物位于 `extension/dist/`
- 跨端关键测试：通过
  - 用例：`TestSyncMultiDeviceConvergence`
  - 路径：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/handler/sync_test.go`

## 4. 发布阻塞项
- Blocker-1：
  - 描述：尚未完成 Chrome 实机手工回归（账号、划词、跨端、冲突、隐私删除接口端到端验证）
  - 影响：无法形成发布前完整人工验收证据
  - 解决：加载 `extension/dist/`，按 `docs/chrome-annotation-t20-manual-regression-checklist.md` 执行并记录结果

## 5. 发布前建议动作（顺序）
1. 按手工回归清单完成一轮全流程检查，并在 `docs/chrome-annotation-t20-manual-regression-results.md` 记录结果。
2. 准备商店素材（图标、截图、描述、隐私政策链接）。
3. 在 Chrome Web Store Developer Dashboard 提交审核。

## 6. 一键回归命令
- 脚本：`/Users/luoyu15/Documents/work/agentdiy/scripts/release-check.sh`
- Make 命令：`make release-check`
- 覆盖项：
  - extension `typecheck + build`
  - backend `go test ./...`
