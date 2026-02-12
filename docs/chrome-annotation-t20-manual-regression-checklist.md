# T20 手工回归清单（发布前）

## 1. 账号与鉴权
- [ ] 注册新账号成功（`options` 页面）。
- [ ] 登录成功并自动写入 access/refresh token。
- [ ] access token 失效后可自动 refresh。
- [ ] 登出后 token 清空，受保护接口不可访问。

## 2. 高亮与评论
- [ ] 网页划词后可创建高亮。
- [ ] 创建带评论的高亮成功。
- [ ] Side Panel 可定位到对应高亮。
- [ ] 评论编辑后页面与侧边栏同步更新。
- [ ] 删除后页面与侧边栏均消失。

## 3. 同步与跨端
- [ ] Windows 端创建高亮，macOS 端同步可见。
- [ ] macOS 端更新评论，Windows 端同步可见。
- [ ] Windows 端删除，macOS 端同步删除。
- [ ] 弱网下操作进入队列，恢复网络后自动收敛。

## 4. 冲突与重试
- [ ] 触发冲突后 Side Panel 显示冲突标签。
- [ ] 冲突详情面板可查看 `op_id` 与 message。
- [ ] 支持逐条重试冲突。
- [ ] 支持按错误类型批量“重试同类/忽略同类”。
- [ ] 忽略后冲突列表正确减少。

## 5. 安全与隐私
- [ ] `DELETE /api/v1/me/data` 调用后注释被软删、refresh token 被撤销。
- [ ] 未授权请求受保护接口返回 401。
- [ ] CORS 只允许白名单 Origin。
- [ ] 安全响应头已返回（`X-Frame-Options`、`CSP` 等）。

## 6. 发布前检查
- [ ] extension 构建通过：`npm --prefix extension run build`
- [ ] 后端测试通过：`go test ./...`
- [ ] 商店文案与截图已准备
- [ ] 隐私声明页面可访问
