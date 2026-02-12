# Chrome 划词高亮插件 MVP 任务拆解（Task List）

## 1. 说明
- 对应方案文档：`/Users/luoyu15/Documents/work/agentdiy/docs/chrome-annotation-mvp-technical-plan.md`
- 后端技术栈：`Go + MySQL 8.0+`
- 目标：4 周完成可发布的 MVP（高亮、评论、Win/mac 同步）

---

## 2. 里程碑
- `M1`：本地可用（无后端）高亮 + 评论交互跑通
- `M2`：账号体系 + 注释 CRUD API 可用
- `M3`：跨端增量同步可用（Windows/macOS）
- `M4`：稳定性达标并具备发布条件

---

## 3. 子任务清单（MVP）

| Task ID | 任务 | 主要内容 | 产出物 | 依赖 | 验收标准 |
|---|---|---|---|---|---|
| T01 | 插件工程初始化 | 搭建 MV3 + TS + React + Vite，配置构建与热更新 | 插件基础工程 | 无 | 可在 Chrome 成功加载并打开 popup/side panel |
| T02 | 基础权限与 Manifest | 配置 `manifest.json`、最小权限、host 权限白名单策略 | manifest 初版 | T01 | 权限最小可运行，控制台无权限错误 |
| T03 | 划词监听与浮动操作条 | content script 监听选区并展示“高亮/评论”操作按钮 | 划词交互模块 | T01 | 任意页面可触发划词操作 |
| T04 | 高亮渲染引擎 | 页面注入高亮节点、样式、移除逻辑 | 高亮渲染模块 | T03 | 刷新前后同页高亮可恢复（本地） |
| T05 | 锚点模型实现 | TextPosition + TextQuote（exact/prefix/suffix）持久化与恢复 | 锚点序列化模块 | T04 | 页面轻微改动后高亮恢复成功率可接受 |
| T06 | 评论能力（本地） | 新增/编辑/删除评论，关联高亮 ID | 评论本地模块 | T04 | 评论 CRUD UI 可用 |
| T07 | Side Panel 列表页 | 展示当前页高亮与评论，支持点击定位 | Side Panel 页面 | T06 | 列表与页面高亮联动准确 |
| T08 | 后端工程初始化（Go） | 路由、配置、日志、中间件、分层目录 | Go 服务骨架 | 无 | 服务可启动，健康检查可用 |
| T09 | MySQL 建模与迁移 | `users/devices/documents/annotations/sync_events` 表结构与索引 | SQL migration 文件 | T08 | 本地 MySQL 可一键建表 |
| T10 | 鉴权 API | 注册、登录、刷新、登出，JWT + Refresh Token | auth API | T08,T09 | Postman/集成测试通过 |
| T11 | 注释 CRUD API | 按 URL 查询、创建、更新、删除（软删） | annotation API | T09,T10 | 插件端可完成增删改查 |
| T12 | 文档聚合查询 API | `documents/by-url` 与页面注释摘要能力 | document API | T09,T10 | 单页打开时可返回完整数据 |
| T13 | 插件登录态接入 | popup/options 登录，token 存储与续期 | 前端鉴权接入 | T10 | 登录后接口可自动鉴权 |
| T14 | 同步 Push API | 上传本地操作队列，保证幂等 | `sync/push` API | T11 | 重复提交不产生脏数据 |
| T15 | 同步 Pull API | 按 cursor 增量拉取远端变更 | `sync/pull` API | T14 | 可稳定返回增量事件与 next_cursor |
| T16 | 插件离线队列与重试 | 本地 `op_queue`、指数退避、失败回滚提示 | 同步客户端模块 | T11,T14,T15 | 弱网下操作最终可收敛 |
| T17 | 冲突处理策略 | `LWW + version` 实现与冲突日志返回 | 冲突处理模块 | T14,T15 | 双端并发编辑后数据一致 |
| T18 | 跨端联调（Win/mac） | 同账号多端创建/编辑/删除互相可见 | 联调报告 | T16,T17 | 1~2 分钟内完成双端收敛 |
| T19 | 安全与隐私补齐 | HTTPS、权限收敛、删除策略、审计最小日志 | 安全检查清单 | 全部核心任务 | 通过发布前安全检查 |
| T20 | 测试与发布准备 | E2E/回归测试、商店素材、隐私说明文档 | 发布包与测试报告 | T18,T19 | 可提交 Chrome Web Store 审核 |

---

## 4. 建议执行顺序（按周）

### Week 1
- T01, T02, T03, T04, T05, T08

### Week 2
- T06, T07, T09, T10, T11, T12, T13

### Week 3
- T14, T15, T16, T17, T18

### Week 4
- T19, T20

---

## 5. 非 MVP 后续任务（来自竞品对标）

| Task ID | 后续特性 | 来源竞品能力 | 优先级 |
|---|---|---|---|
| N01 | 标签/文件夹组织 | Diigo / Weava / Glasp | P1 |
| N02 | 全文检索（URL/标签/评论） | Diigo / Glasp | P1 |
| N03 | Markdown/CSV 导出 | Glasp / Weava | P1 |
| N04 | 分享链接与只读协作 | Hypothesis | P2 |
| N05 | 团队空间与权限模型 | Hypothesis / Weava | P2 |
| N06 | PDF 深度标注统一体验 | Hypothesis / Glasp | P3 |
| N07 | 引用格式导出（APA/MLA） | Weava | P3 |
| N08 | AI 总结与问答 | LINER | P3 |

---

## 6. 完成定义（Definition of Done）
- 核心功能：高亮 + 评论 + 跨端同步可用。
- 稳定性：刷新、弱网、重复提交、并发编辑场景无阻断问题。
- 数据一致性：同账号 Win/mac 双端最终一致。
- 安全与发布：满足 Chrome 商店基础审核与隐私声明要求。

