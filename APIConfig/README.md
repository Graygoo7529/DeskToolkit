# APIConfig

管理 Codex Home、Claude Code 配置目录与各自的 API Provider。双栏布局让左侧来源与右侧目标同时可见，额外查询和管理收纳进详情抽屉。API Probe 统一管理直连 API、订阅 API 与 Kimi 等服务，不参与 Agent 应用。

## 使用

1. 进入 Codex 或 Claude 分页，添加 Provider 和配置目录。
2. 点击左侧 Provider，右侧显示待应用来源；在目标上点击“应用”。成功后显示“已生效”。来源与已使用它的目标共享固定的淡色，选中来源时，对应目标出现轻微流动光泽。
3. 点击卡片右侧 `···` 打开详情。连接、模型、额度与查询设置，以及编辑、删除操作均在详情内。
4. 点击 Provider 列表上方“全选”展开批量查询，再点击“连接测试”“模型发现”“额度查询”或“全部检查”。
5. 直接拖动 Provider / 目标卡片排序；也可聚焦卡片后按 `Alt + ↑ / ↓`。搜索过滤期间暂停排序，清空搜索恢复。

全选只用于查询，不改变待应用 Provider。左右列表独立滚动，查询详情不会撑高主界面。查询失败或未配置额度都不会阻止应用。

## 查询能力

- 连接：以 GET 读取模型接口，显示 HTTP 状态和耗时；不执行模型生成，因此不代表模型调用验证。
- 模型：兼容 OpenAI / Anthropic 的 `data[].id`，支持名称搜索；Claude 分页支持 `has_more` / `last_id`，最多读取 5 页，后续页失败保留已获取模型。
- 额度：支持 Kimi Code 周额度、5 小时窗口、会员等级和重置时间；自定义适配器可映射余额、已用、总量、剩余和重置时间。
- 允许缺损：缺字段显示 `—`，未配置额度跳过；每项查询独立失败或成功。再次查询失败时，保留并标明上次可用结果及其时间。
- 启动时对 Codex / Claude 的 Provider 各检查一次连接，不自动查询模型和额度，不轮询。检查期间可以选择、应用、编辑和排序。
- 状态以小圆点和微弱边缘光晕显示：绿为连接可用，红为异常，黄为部分可用；详情可查看状态文本和错误原因。
- 手动查询最多同时请求 3 项，单次 HTTP 超时 12 秒。“停止”只停止队列，已发出的请求正常结束。
- 查询结果保留在本次应用会话，切换分页不丢失；修改 Provider 或查询设置后清除该 Provider 的旧结果。

## API 管理

API Probe 用一个账号模型保存直连或订阅类型、多个协议地址、额度适配器和控制台地址，不会把账号应用到 Codex、Claude 或其他 Agent。支持 OpenAI 兼容、OpenAI Responses、Anthropic、GenAI 和 VertexAI；刷新时按协议分别发现模型，详情中的协议胶囊切换模型集，单击模型才发起最小可用性探测。列表中的 Key 显示掩码，编辑时可点击显示并修改当前 Key。

账号列表的小圆点表示最近一次刷新状态；控制台地址以外链图标显示，点击后交给系统浏览器打开。可拖动账号排序，列表上方的刷新会并发刷新所有已配置账号。

当前 Token Plan 地址的实测结果：OpenAI 兼容接口返回模型列表；Anthropic 地址支持消息调用，但不提供标准 `/models` 列表，因此刷新时保留其它协议返回的模型集。余额和剩余额度没有在该专属域名上发现可用的公开接口，因此页面明确显示“额度 / 限额：未接入”，不把调用成功率或模型数量冒充余额。

## 查询设置

默认模型地址：Base URL 补齐 `/v1/models`；已有 `/v1` 不重复添加。Kimi 默认额度地址同理补齐 `/v1/usages`，例如 `https://api.kimi.com/coding/v1/usages`。

自定义路径以 `/` 开头时相对于域名根目录，否则相对于 Base URL。查询只支持同源 HTTP(S) GET，不跟随重定向。认证可选 Bearer、x-api-key 或不认证，前两者复用此 Provider 的现有密钥；Claude 模型查询还会带上 Anthropic 版本头。

自定义额度字段使用 JSON Pointer：响应如 `{"data":{"balance":"12.5"}}`，余额字段填写 `/data/balance`。至少填写一个数值字段，支持数字或数字字符串；单位自行填写，应用不换算金额或推测缺失值。需要其他管理凭据、跨域额度接口或 POST 的供应商暂不适用此适配器。

## 配置与兼容

- Codex 应用操作更新 `.codex/config.toml` 中 `[model_providers.OpenAI]` 的 `base_url` 和 `auth.json` 的 `OPENAI_API_KEY`。
- Claude 应用操作只更新 `settings.json` 中的 `env.ANTHROPIC_BASE_URL` 与 `env.ANTHROPIC_AUTH_TOKEN`，保留其他设置。
- 默认数据目录为 `%APPDATA%/com.codexconfig.panel/`，右上角“数据目录”可打开或更换本地目录。支持复制当前数据到新目录，或使用已有配置；目标已含配置时禁止复制覆盖。切换立即生效，重启继续沿用。
- 文件按分页统一：`codex.toml` 和 `claude.toml` 各自保存 `[[homes]]`、`[[providers]]` 以及 Provider 查询设置；`apis.toml` 保存所有 API Probe 账号、协议地址、额度适配器和控制台地址；`definitions/` 保存额度适配器与展示布局 TOML。
- `definitions/` 是数据目录中的唯一运行时定义来源。安装包只负责首次初始化空目录，用户新增的自定义定义与现有定义使用相同的目录结构和加载规则。
- `apis.toml` 中的账号只提供检查与模型管理，不加入 Provider → Home 应用流程。Kimi 与其它 API 使用同一账号编辑器和同一配置文件。
- 程序目录选择记录在默认目录的 `storage.json`，仅包含数据目录路径。切换目录复制这三个场景文件和完整的 definitions 目录，不移动真实的 Codex / Claude Home。
- 旧版数据文件首次读取时自动迁移，原文件归档到同目录 `legacy-backup/`。先验证全部数据，再写入新结构；保留密钥、查询设置和列表顺序。迁移完成后不再注册独立 Kimi IPC 或独立编辑流程。
- 查询设置保存在各 Provider 的 `inspection` 字段，排序保存为 TOML 数组顺序。旧记录会自动使用默认查询设置。Provider 的 `color` 保存固定身份色，改名和排序不改变颜色；连接状态仍由小圆点和详情文本单独表示。
- Provider 和 API Key 均保存在所选目录的 TOML；界面仅返回掩码。移除 Home 只移除面板记录，不删除真实配置目录。

## 开发与验证

```sh
pnpm install
pnpm tauri dev
pnpm build
pnpm release
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

正式版使用 `pnpm tauri build` 构建（`pnpm release` 是同一命令的别名）。它会先生成前端资源，再由 Tauri 将资源嵌入原生程序并生成安装包；不要使用单独的 `cargo build --release` 作为发布构建。exe 位于 `src-tauri/target/release/apiconfig.exe`，安装包位于 `src-tauri/target/release/bundle/`。首次使用便携版时保留 exe 旁的 `definitions/` 文件夹；初始化后仅从所选数据目录加载定义。

调试端口为 **1430**。浏览器交互测试使用独立端口 **1431** 和本机 Microsoft Edge，以模拟数据替代 Tauri IPC，不读取实际用户配置或密钥。Rust HTTP 测试仅访问本地临时服务。

具体交互与边界见 [实现设计](docs/APIConfig-roadmap.md)。
