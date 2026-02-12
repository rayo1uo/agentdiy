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

## 当前状态
- 插件端当前数据存储为 `chrome.storage.local`，用于 MVP 本地链路。
- 后端注释接口当前使用内存仓库，MySQL 仓储实现待下一阶段接入。
- 同步接口 `sync/push` 与 `sync/pull` 已预留为 stub。

## 下一步
- T10 鉴权 API（注册/登录/刷新/登出）。
- T11 注释 CRUD 接入 MySQL 仓储。
- T14/T15 增量同步 push/pull 实现。
