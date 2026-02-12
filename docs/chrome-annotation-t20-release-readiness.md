# T20 发布就绪报告（MVP）

## 1. 结论
- 当前版本已具备提交 Chrome Web Store 审核的核心能力。
- 后端自动化测试通过，跨端同步与冲突处理链路已具备可演示与可验证性。
- 仍有一个发布前阻塞项：本地环境未完成 extension 依赖安装，尚未执行前端 `typecheck/build` 实测。

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
- 跨端关键测试：通过
  - 用例：`TestSyncMultiDeviceConvergence`
  - 路径：`/Users/luoyu15/Documents/work/agentdiy/server/internal/http/handler/sync_test.go`

## 4. 发布阻塞项
- Blocker-1：
  - 描述：未执行 extension 实际构建与类型检查（依赖安装未完成）
  - 影响：无法给出前端构建产物通过证明
  - 解决：在可联网环境执行 `npm --prefix extension install && npm --prefix extension run build`

## 5. 发布前建议动作（顺序）
1. 完成 extension 依赖安装并执行 `build/typecheck`。
2. 按手工回归清单完成一轮全流程检查。
3. 准备商店素材（图标、截图、描述、隐私政策链接）。
4. 在 Chrome Web Store Developer Dashboard 提交审核。
