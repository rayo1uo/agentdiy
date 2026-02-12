# Chrome 划词高亮 + 评论插件（MVP）落地技术方案

## 1. 目标与边界（MVP）

### 1.1 业务目标
- 支持网页划词高亮（句子级/词组级）。
- 支持对高亮片段添加评论（annotation comment）。
- 支持同一账号在 Windows 和 macOS 端 Chrome 浏览器实时/准实时同步。
- 提供基础管理能力：查看、编辑、删除高亮与评论。

### 1.2 本期不做（避免范围失控）
- 暂不做 AI 总结/问答。
- 暂不做团队协作空间、审批流。
- 暂不做复杂富文本评论（先纯文本）。
- 暂不做多浏览器内核适配（先 Chrome MV3）。

---

## 2. 技术选型

### 2.1 前端（插件端，主流方案）
- `Manifest V3`
- `TypeScript + React + Vite`
- 状态管理：`Zustand`（轻量，适合插件场景）
- 样式：`Tailwind CSS`（快速迭代）
- 通信：`chrome.runtime.sendMessage` + `chrome.tabs.sendMessage`

说明：
- Chrome 官方已明确 MV3 生态，插件 UI 与后台能力（如 `sidePanel`）可满足此类产品形态。

### 2.2 后端（你熟悉的 Golang）
- 语言：`Go 1.23+`
- Web 框架：`Gin`（或 Echo，二选一即可）
- 数据库：`MySQL 8.0+`（结构化 + 索引能力强，生态成熟）
- 缓存/会话：`Redis`（可选，MVP 可先不用）
- 鉴权：`JWT + Refresh Token`
- 部署：`Docker + K8s/轻量云主机`（MVP 优先单体服务）

---

## 3. 总体架构

```text
[Content Script] <-> [Background Service Worker] <-> [Go API]
        |                      |                      |
        |                      |                      +-> MySQL
        |                      +-> chrome.storage.local (轻量缓存/队列)
        |
        +-> [Side Panel React UI] (列表、评论编辑、登录态、冲突提示)
```

核心原则：
- 插件端负责“交互与渲染”；
- 后端负责“持久化、账号体系、跨端同步”；
- `chrome.storage.sync` 仅用于少量设置项，不用于主数据。

---

## 4. 插件端设计（MV3）

### 4.1 模块拆分
- `content-script`
  - 监听选区变化，展示浮动操作条（高亮/评论）。
  - 将选区转换为可持久化锚点（selector）。
  - 在页面内渲染/恢复高亮。
- `background service worker`
  - 统一处理 API 请求、重试、离线队列、增量同步调度。
  - 管理登录令牌刷新。
- `side panel (React)`
  - 展示当前页面全部高亮与评论。
  - 支持编辑、删除、跳转定位。
- `popup/options`
  - 登录、基础设置（快捷键、颜色偏好、同步开关）。

### 4.2 高亮锚点模型（抗页面变更）
每条高亮保存三类信息：
- 位置：`start/end`（TextPositionSelector）
- 文本：`exact/prefix/suffix`（TextQuoteSelector）
- 页面：`url + canonical_url + title`

恢复策略：
1. 先按位置匹配；
2. 失败后按 `exact + prefix/suffix` 模糊重定位；
3. 再失败则标记为“待人工修复”。

这套模型可显著提升在网页微调后的命中率。

### 4.3 页面渲染策略
- 使用 `span[data-anno-id]` 包裹高亮文本，避免污染原 DOM 结构。
- 评论入口以小气泡或边栏联动展示。
- 对同一区域多条高亮：支持颜色叠层规则（MVP 可限制单层，避免复杂冲突）。

### 4.4 离线与重试
- 本地维护 `op_queue`（create/update/delete）。
- 网络失败时指数退避重试。
- 页面先乐观更新（Optimistic UI），失败后回滚并提示。

---

## 5. 后端设计（Go）

### 5.1 服务分层
- `api`：HTTP 路由与参数校验
- `service`：业务逻辑（权限、冲突合并、同步游标）
- `repo`：数据库读写
- `model`：领域模型
- `middleware`：鉴权、限流、审计日志

### 5.2 关键数据表（建议）

### `users`
- `id (uuid)` / `email` / `password_hash` / `created_at`

### `devices`
- `id (uuid)` / `user_id` / `device_name` / `platform` / `last_seen_at`

### `documents`
- `id (uuid)` / `user_id` / `url` / `canonical_url` / `title` / `created_at`

### `annotations`
- `id (uuid)` / `user_id` / `document_id`
- `quote_text` / `prefix_text` / `suffix_text`
- `start_offset` / `end_offset`
- `color`
- `comment_text`
- `status` (`active|deleted`)
- `version`（乐观锁）
- `updated_at` / `created_at`

### `sync_events`
- `id (bigint unsigned auto_increment)` / `user_id` / `device_id` / `annotation_id`
- `op_type` / `payload_json` / `created_at`

### 5.3 索引建议
- `annotations(user_id, document_id, updated_at desc)`
- `annotations(user_id, status, updated_at desc)`
- `sync_events(user_id, id)`（增量拉取）

---

## 6. API 设计（MVP）

### 6.1 鉴权
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`

### 6.2 注释数据
- `GET /api/v1/documents/by-url?url=...`（取页面元信息与注释摘要）
- `GET /api/v1/annotations?url=...`
- `POST /api/v1/annotations`
- `PATCH /api/v1/annotations/{id}`
- `DELETE /api/v1/annotations/{id}`（软删）

### 6.3 同步接口
- `POST /api/v1/sync/push`（批量上传本地操作）
- `GET /api/v1/sync/pull?cursor=<event_id>`（增量拉取）

返回字段统一包含：
- `server_time`
- `next_cursor`
- `conflicts[]`（若有）

---

## 7. Windows/macOS 多端同步方案

### 7.1 为什么不能只靠 chrome.storage.sync
- `storage.sync` 总配额约 `100KB`，单项约 `8KB`，且写频率受限，不适合注释主数据。
- 因此：主数据必须走后端数据库，`storage.sync` 仅保留轻量偏好配置。

### 7.2 同步机制
- 每次本地变更生成 `op_id`（`device_id + local_seq`）。
- `push`：上传未同步操作（幂等）。
- `pull`：按游标拉取别人设备变更。
- 冲突策略（MVP）：`LWW + version`（最后写入优先，保留冲突日志）。
- 触发时机：
  - 页面激活时
  - 本地有写入后
  - 定时（如 60~120 秒）

### 7.3 结果预期
- 同账号在 Windows 与 macOS 打开同一页面时，高亮与评论可在 1~2 分钟内收敛一致。

---

## 8. 安全与隐私（MVP 必备）

- 传输全程 HTTPS。
- 评论内容默认私有（仅当前账号可见）。
- Token 最小权限 + 过期刷新。
- 最小化权限申请（仅声明必须的 `permissions` 与 `host_permissions`）。
- 支持用户删除数据（软删 + 定期物理清理）。

---

## 9. 研发计划（4 周 MVP）

### 第 1 周
- 插件脚手架（MV3 + TS + React）
- 划词、浮动按钮、高亮渲染
- Go 服务基础框架 + 鉴权

### 第 2 周
- 评论创建/编辑/删除
- 注释数据模型与 CRUD API
- Side Panel 列表与定位跳转

### 第 3 周
- 增量同步（push/pull + cursor）
- 离线队列、重试、冲突策略
- Win/mac 多设备联调

### 第 4 周
- 稳定性测试（页面刷新、DOM 轻微变化、弱网）
- 性能与权限收敛
- 发布准备（图标、隐私说明、商店材料）

---

## 10. 市场同类插件调研（用于后续规划）

### 10.1 竞品功能摘要

| 产品 | 已提供能力（公开资料） | 对我们启发 |
|---|---|---|
| Hypothesis | 网页/PDF 协作标注、标签、公开/私有与群组可见性 | “可见性模型”与“协作层级”值得在 V2 引入 |
| Diigo | 多色高亮、网页便签、标签/列表/群组 | 分类组织能力（标签、收藏夹）是刚需 |
| Weava | 高亮+注释、文件夹组织、团队协作、自动引用、跨设备访问 | 研究型用户看重“结构化整理 + 引用导出” |
| LINER | 网页划词、评论、保存页面、刷新后保留；并叠加 AI 摘要 | MVP 要先把“高亮稳定保留 + 评论”做到极致 |
| Glasp | Web/PDF 高亮与笔记、标签与导出、私有/公开切换、跨设备 | 知识沉淀与导出生态（Notion/Obsidian）有吸引力 |

### 10.2 后续功能提升规划（MVP 之后）

### P1（MVP+1，优先）
- 文件夹/标签体系
- 全文检索（按 URL、标签、评论关键词）
- 导出 Markdown/CSV

### P2
- 共享链接与只读协作
- 私有组/团队空间（权限：owner/editor/viewer）
- 基础审计日志（谁在何时改了哪条注释）

### P3
- PDF 深度支持（本地 PDF 与在线 PDF 一致体验）
- 引用格式导出（APA/MLA）
- AI 能力（基于个人高亮的总结与问答）

---

## 11. 关键实现建议（避免常见坑）

- 不直接依赖 DOM XPath 作为唯一锚点，网页改版后极易失效。
- 不把主数据放 `chrome.storage.sync`，容量和速率都不够。
- service worker 有生命周期限制，同步任务要事件驱动 + 定时兜底。
- content script 在隔离环境运行，需通过消息机制与后台/侧边栏通信。

---

## 12. 参考资料（调研来源）

- Chrome Storage API（配额与 sync 限制）：https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome Side Panel API（MV3）：https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome Content Scripts（Isolated World）：https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome Identity API：https://developer.chrome.com/docs/extensions/reference/api/identity
- Extension Service Worker 生命周期：https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- W3C Web Annotation Data Model：https://www.w3.org/TR/annotation-model/
- Hypothesis（Chrome Web Store）：https://chromewebstore.google.com/detail/hypothesis-web-pdf-annota/bjfhmglciegochdpefhhlphglcehbmek
- Hypothesis 可见性/群组说明：https://web.hypothes.is/help/who-can-see-my-annotations-in-the-web-app/
- Diigo Chrome Extension 介绍：https://www.diigo.com/tools/chrome_extension
- Weava 官网功能页：https://web.weavatools.com/
- Weava 高亮说明：https://web.weavatools.com/highlight-with-weava/
- LINER 高亮与评论说明：https://support.liner.com/hc/en-us/articles/4408827436825-Make-Edit-Highlights
- LINER Chrome Web Store：https://chromewebstore.google.com/detail/liner-chatgpt-ai-copilot/bmhcbmnbenmcecpmpepghooflbehcack
- Glasp 功能页：https://glasp.co/web-highlighter/
- Glasp 私有高亮与导出：https://glasp.co/features/private-highlight
