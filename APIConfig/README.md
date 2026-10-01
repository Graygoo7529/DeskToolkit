# APIConfig

管理 Codex Home、Claude Code 配置目录与各自的 API Provider。保留“上方选择 Provider、下方应用到 Home”的操作布局，并在 Provider 内展示手动查询结果。

## 使用

1. 进入 Codex 或 Claude 分页，添加 Provider 和配置目录。
2. 点击 Provider 卡片选择待应用项，在目标 Home 上点击“应用”。
3. 查询前按需打开卡片的“查询设置”，选择认证方式与额度适配器。
4. 勾选 Provider 后，使用工具栏的“连接测试”“模型发现”“额度查询”或“检查三项”；也可展开卡片子项单独查询。
5. 拖动 Provider / Home 名称旁的 ⠿ 排序。聚焦手柄后，也可按 ↑ / ↓ 移动；顺序自动保存。

勾选只用于查询，不改变待应用 Provider。查询失败、缺少模型接口或未配置额度，都不会阻止 Provider 应用到 Home。

## 查询能力

- 连接：以 GET 读取模型接口，显示 HTTP 状态和耗时；不执行模型生成，因此不代表模型调用验证。
- 模型：兼容 OpenAI / Anthropic 的 `data[].id`，支持名称搜索；Claude 分页支持 `has_more` / `last_id`，最多读取 5 页，后续页失败保留已获取模型。
- 额度：支持 Kimi Code 周额度、5 小时窗口、会员等级和重置时间；自定义适配器可映射余额、已用、总量、剩余和重置时间。
- 允许缺损：缺字段显示 `—`，未配置额度跳过；每项查询独立失败或成功。再次查询失败时，保留并标明上次可用结果及其时间。
- 全部手动触发，无后台轮询；最多同时请求 3 项，单次 HTTP 超时 12 秒。“停止待执行项”只停止队列，已发出的请求正常结束。
- 查询结果保留在本次应用会话，切换分页不丢失；修改 Provider 或查询设置后清除该 Provider 的旧结果。

## 查询设置

默认模型地址：Base URL 补齐 `/v1/models`；已有 `/v1` 不重复添加。Kimi 默认额度地址同理补齐 `/v1/usages`，例如 `https://api.kimi.com/coding/v1/usages`。

自定义路径以 `/` 开头时相对于域名根目录，否则相对于 Base URL。查询只支持同源 HTTP(S) GET，不跟随重定向。认证可选 Bearer、x-api-key 或不认证，前两者复用此 Provider 的现有密钥；Claude 模型查询还会带上 Anthropic 版本头。

自定义额度字段使用 JSON Pointer：响应如 `{"data":{"balance":"12.5"}}`，余额字段填写 `/data/balance`。至少填写一个数值字段，支持数字或数字字符串；单位自行填写，应用不换算金额或推测缺失值。需要其他管理凭据、跨域额度接口或 POST 的供应商暂不适用此适配器。

## 配置与兼容

- Codex 应用操作更新 `.codex/config.toml` 中 `[model_providers.OpenAI]` 的 `base_url` 和 `auth.json` 的 `OPENAI_API_KEY`。
- Claude 应用操作只更新 `settings.json` 中的 `env.ANTHROPIC_BASE_URL` 与 `env.ANTHROPIC_AUTH_TOKEN`，保留其他设置。
- 数据在 `%APPDATA%/com.codexconfig.panel/`：`homes.toml`、`providers.toml`、`claude_homes.toml`、`claude_providers.toml`。改名保留原应用 identifier，继续使用原数据。
- 查询设置保存在各 Provider 的 `inspection` 字段，排序保存为 TOML 数组顺序。旧记录会自动使用默认查询设置。
- Key 仍保存在本机 TOML，界面仅返回掩码；编辑 Key 留空保留原值。移除 Home 只移除面板记录，不删除真实配置目录。

## 开发与验证

```sh
pnpm install
pnpm tauri dev
pnpm build
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

调试端口为 **1430**。浏览器交互测试使用独立端口 **1431** 和本机 Microsoft Edge，以模拟数据替代 Tauri IPC，不读取实际用户配置或密钥。Rust HTTP 测试仅访问本地临时服务。

具体交互与边界见 [实现设计](docs/APIConfig-roadmap.md)。
