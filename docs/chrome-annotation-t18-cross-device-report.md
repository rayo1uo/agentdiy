# T18 跨端联调报告（Windows/macOS）

## 1. 目标
- 验证同账号在 Windows 与 macOS 两端的注释数据可增量同步。
- 验证 create / update_comment / delete 操作在双端可收敛。
- 验证重复提交与已删除重复操作的冲突行为符合预期。

## 2. 自动化验证（已落地）

新增测试文件：
- `/Users/luoyu15/Documents/work/agentdiy/server/internal/http/handler/sync_test.go`

核心用例：
- `TestSyncMultiDeviceConvergence`
  - `windows-device` 创建注释
  - `mac-device` 从 cursor=0 拉取创建事件
  - `mac-device` 更新评论
  - `windows-device` 从上次 cursor 拉取更新事件
  - `windows-device` 删除注释
  - `mac-device` 从上次 cursor 拉取删除事件
  - `mac-device` 再次删除，收到冲突（annotation not found）

结论：
- 事件 cursor 单调递增。
- 双端操作链路可按 cursor 正确传播。
- 数据最终收敛到删除状态，重复删除会被识别为冲突。

## 3. 手工联调步骤（真实双机）

前置：
- 两台机器分别安装同一插件版本。
- `API Base URL` 指向同一后端。
- 两端使用同一账号登录。

步骤：
1. Windows 端在同一 URL 创建高亮并加评论。
2. macOS 端点击“立即同步”并确认该高亮出现。
3. macOS 端编辑该高亮评论。
4. Windows 端点击“立即同步”，确认评论更新。
5. Windows 端删除该高亮。
6. macOS 端点击“立即同步”，确认条目删除。

验收标准：
- 每一步在另一端 1~2 分钟内可见（或手动同步后立即可见）。
- side panel 同步状态无持续错误。
- 如出现冲突，可在 side panel 冲突详情进行逐条/同类重试并恢复。

## 4. 风险与建议
- 当前插件端仍允许本地回退，弱网时可能先显示“待同步”。
- 建议上线前补一次真实 Windows + macOS 的弱网场景压测（高频编辑 + 刷新页面）。
