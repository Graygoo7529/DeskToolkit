# DeskBot 架构契约（v1）

DeskBot 是一个像素风桌面机器人：Tauri 2 + React 18 + TypeScript + Vite。
本文档是前后端实现的**唯一契约**，事件名、命令签名、类型定义以此为准。

## 1. 窗口模型

两个窗口，均在 Rust `setup()` 中用 `WebviewWindowBuilder` 运行时创建（`tauri.conf.json` 的 `windows` 为空数组）：

| label | 页面 | 尺寸(逻辑 px) | 标志 |
|---|---|---|---|
| `stage` | `index.html` | 420×420 | transparent, decorations:false, alwaysOnTop, skipTaskbar, resizable:false, shadow:false |
| `panel` | `panel.html` | 400×560（可放大到 760×720） | decorations:false, **不透明**, alwaysOnTop, resizable:true, 初始 visible:false |

- `stage`：透明舞台，渲染宠物（底部居中，128px）、悬浮球（56px）、问候气泡。透明区域必须点击穿透（见 §5）。
- `panel`：功能面板，两个 tab：`chat`（默认）、`quota`。圆角像素风边框 + 自定义标题栏（拖动区、tab 切换、放大/还原、关闭=隐藏）。调整大小用 `getCurrentWindow().startResizeDragging('SouthEast')` 在右下角把手实现。
- panel 每次打开时由 Rust 定位到 stage 左上方（保证不超出当前显示器工作区）。

## 2. 目录结构

```
DeskBot/
├─ index.html / panel.html / vite.config.ts / package.json / tsconfig.json
├─ deskbot.local.json        # 本地机密配置（gitignored，见 §3）
├─ docs/architecture.md      # 本文档
├─ workspace/                # 机器人的 kimi 工作区（session cwd），含人格 AGENTS.md
├─ scripts/gen-icon.mjs      # 占位图标生成
├─ src/
│  ├─ shared/types.ts        # 全部跨端类型（与 Rust 结构体一一对应）
│  ├─ shared/ipc.ts          # invoke 封装 + 事件订阅 hooks
│  ├─ stage/                 # main.tsx, StageApp.tsx, pet.ts(像素帧), balls.tsx, bubble.tsx, stage.css
│  └─ panel/                 # main.tsx, PanelApp.tsx, ChatTab.tsx, QuotaTab.tsx, markdown.ts, panel.css
└─ src-tauri/
   ├─ Cargo.toml / build.rs / tauri.conf.json / icons/
   └─ src/ main.rs, lib.rs, config.rs, windows.rs, hotspot.rs, acp.rs, quota.rs, tray.rs
```

## 3. 配置 `deskbot.local.json`（repo 根，gitignored）

```jsonc
{
  "apiKey": "sk-kimi-...",          // 仅用于额度查询，绝不用于对话
  "baseUrl": "https://api.kimi.com/coding/v1",
  "kimiPath": "kimi",               // kimi CLI 可执行文件
  "workspaceDir": "workspace",      // 相对 repo 根
  "sessionId": null,                // ACP 会话 id，首次 session/new 后写回
  "petPosition": null,              // {x, y} 物理像素，拖动防抖 800ms 写回
  "petVisible": true
}
```

Rust `config.rs` 负责读写（serde，容错解析，缺字段用默认）。**任何日志不得输出 apiKey。**

## 4. 宠物（stage 前端）

- **渲染**：canvas + 字符串像素图。`pet.ts` 定义 28×28 字符画帧（调色板字符→颜色），JS 以整数倍（×4）绘制，`image-rendering: pixelated`。后续可无缝换成 sprite sheet。
- **状态机**（StageApp 内）：`idle`(呼吸 2 帧+周期眨眼) / `hover` / `grab`(被拎起) / `land`(落地挤压回弹) / `happy`(打招呼) / `think`(对话中，2 帧) / `work`(执行工具，2 帧) / `sleepy`(闲置 60s，Z 粒子) / `alert`(额度低，汗滴) / `overheat`(5h 窗口过热，蒸汽)。12fps 帧切换；优先级：grab/land > think/work > alert/overheat > happy > sleepy > idle。
- **光泽联动**：由 `quota://updated` 推导——周额度剩余 >60% 金色高光+星星粒子；30–60% 常态；10–30% 明度-20%+汗滴；<10% 灰调+打瞌睡；5h 窗口用量 ≥90% 触发 overheat。档位切换用 CSS filter/opacity 300ms 过渡，不跳变。
- **拖拽**：mousedown 在宠物上 → 120ms 内 mouseup 视为点击；超时未松手 → 进入 `grab` 并调用 `getCurrentWindow().startDragging()`。Rust 监听 `WindowEvent::Moved`：防抖 300ms 无移动后向 stage 发 `pet://signal {signal:"landed"}` 并写回 petPosition。
- **单击宠物**：弹出问候气泡（打字机效果，时段/额度加权台词库，4s 自动收起）+ 展开悬浮球；再次单击或 8s 无交互收回。点击期间宠物 `happy` 1.5s。

## 5. 点击穿透（hotspot.rs + stage 前端）

**机制：WM_NCHITTEST 子类。** stage 用 `transparent(true)` 做视觉透明；点击穿透通过对 stage 顶层窗口及其全部后代窗口（WebView2 的 `Chrome_WidgetWin_*` 链）挂 `SetWindowSubclass` 实现：`WM_NCHITTEST` 命中热区 → 默认处理；否则返回 `HTTRANSPARENT`，点击穿透到下层窗口/桌面。WebView2 可能重建子窗口，Rust 每 2s 重新枚举补挂。

**两条用血泪换来的禁令（本机实测 + tao 0.35 源码佐证）：**

1. **禁止调用 `set_ignore_cursor_events`**——tao 会给窗口加 `WS_EX_LAYERED`，与 `transparent(true)` 的 `WS_EX_NOREDIRECTIONBITMAP` 冲突，且 WS_EX_LAYERED 会让 WebView2 内容完全不渲染（窗口空白）。
2. **禁止用 SetLayeredWindowAttributes 色键方案**——同样需要 WS_EX_LAYERED，同上。

**canvas 必须软件渲染**：本机 WebView2 的 GPU 2D canvas 加速无法合成（canvas 有像素但不上屏）。`lib.rs` 在创建任何 webview 前设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-accelerated-2d-canvas`（已被外部设置时尊重外部值）。

前端职责：每次布局变化后（球展开/收起、气泡显隐、动画结束）调用 `update_hot_regions(regions)`，`HotRegion = { id, x, y, w, h }`（相对 stage 窗口的逻辑 px，Rust 按 scale_factor 转物理）。宠物区域常驻；球只在展开时注册；气泡不注册（点击穿透到桌面）。

## 6. 悬浮球（stage 前端）

- 注册表式：`Ball = { id: 'chat'|'quota', 图标(字符画), tooltip, onActivate }`。v1 两个球：对话球、额度球。
- 展开：以宠物中心为圆心向左上扇形 stagger 弹入（回弹缓动，CSS transition），hover 放大 1.1 + tooltip。
- 对话球点击 → `open_panel("chat")`；额度球点击 → `quota_refresh()` + `open_panel("quota")`。

## 7. IPC 命令（前端 invoke → Rust）

```ts
update_hot_regions(regions: HotRegion[]): Promise<void>
open_panel(tab: 'chat' | 'quota'): Promise<void>   // 定位+显示+聚焦 panel，并向其发 panel://tab
close_panel(): Promise<void>
chat_send(text: string): Promise<void>             // ACP 未就绪时排队，就绪后自动发出
chat_cancel(): Promise<void>
chat_permission_response(requestId: string, optionId: string): Promise<void>
quota_refresh(): Promise<QuotaInfo>                // 触发实时拉取（同时缓存+广播）
get_quota_cached(): Promise<QuotaInfo | null>
get_bootstrap(): Promise<{ quota: QuotaInfo | null; sessionActive: boolean }>
```

## 8. IPC 事件（Rust emit → 前端）

```ts
// → stage 窗口
'pet://signal'   { signal: 'landed' | 'chat_active' | 'chat_idle' }
// → panel 窗口
'panel://tab'    { tab: 'chat' | 'quota' }
'chat://event'   ChatEvent（见下）
// → 全部窗口
'quota://updated' QuotaInfo
```

```ts
type ChatEvent =
  | { type: 'session'; status: 'connecting' | 'ready' | 'error'; sessionId?: string; message?: string }
  | { type: 'chunk'; text: string }                    // assistant 流式文本
  | { type: 'tool_call'; toolCallId: string; title: string; kind?: string; status: string }
  | { type: 'tool_call_update'; toolCallId: string; status: string; contentText?: string }
  | { type: 'permission'; requestId: string; title: string; options: { optionId: string; name: string; kind: string }[] }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

interface QuotaWindow { used: number; limit: number; remaining: number; resetAt: string | null }
interface QuotaInfo {
  weekly: QuotaWindow | null
  fiveHour: QuotaWindow | null
  membershipLevel: string | null   // 如 "LEVEL_INTERMEDIATE"
  fetchedAt: string                // ISO 时间
}
```

## 9. 对话：ACP 桥（acp.rs）

后台常驻 `kimi acp` 子进程（tokio spawn，piped stdio，**NDJSON**：每行一个完整 JSON-RPC 2.0 消息）。懒启动：首次 `chat_send` 或打开 chat tab 时拉起；崩溃后指数退避重启（1s→2s→…→30s 封顶），sessionId 保留复用。

协议流程（字段名严格按 ACP / kimi 0.28）：

1. → `initialize` `{ protocolVersion: 1, clientInfo: { name: 'deskbot', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } }`
2. ← 响应含 `agentCapabilities` / `authMethods`。若后续调用收到 `-32000 authRequired`，→ `authenticate { methodId: authMethods[0].id }` 后重试。
3. 会话：config 有 sessionId → `session/load`（失败则 `session/resume`，再失败 `session/new`）；无 → `session/new`。参数 `{ cwd: <repo>/workspace 绝对路径, mcpServers: [], sessionId? }`。`session/new` 响应含 `sessionId` → 写回 config。就绪后发 `chat://event {type:'session',status:'ready'}`。
4. 发消息 → `session/prompt { sessionId, prompt: [{ type: 'text', text }] }`，响应 `{ stopReason }` 时发 `done`。
5. 打断 → 通知 `session/cancel { sessionId }`（无 id）。

服务端通知 `session/update`（params: `{ sessionId, update }`），`update.sessionUpdate` 取值与映射：

| sessionUpdate | 关键字段 | 映射到 ChatEvent |
|---|---|---|
| `agent_message_chunk` | `content: {type:'text', text}` | `chunk` |
| `tool_call` | `toolCallId, title, kind, status` | `tool_call` |
| `tool_call_update` | `toolCallId, status, content[]` | `tool_call_update`（content 里 text 拼接为 contentText） |
| `plan` | `entries[]` | 忽略 |
| `agent_thought_chunk` / `available_commands_update` 等 | — | 忽略 |

解析必须**容错**：未知 variant 跳过，缺字段用默认，绝不 panic。

反向请求（服务端→我们，带 id 必须回复）：

- `session/request_permission`（params: `{ sessionId, toolCall: {...}, options: [{optionId, name, kind}] }`）→ 缓存 pending，发 `permission` 事件给 panel；前端 `chat_permission_response` 回来后回复 `{ outcome: { outcome: 'selected', optionId } }`。kind 优先选 `allow_once` / `reject_once`。5 分钟无响应则回拒绝项（kind 含 reject 的第一个，没有则第一个）。
- `fs/read_text_file`（params: `{ sessionId, path, line?, limit? }`）→ 读文件回 `{ content }`。
- `fs/write_text_file`（params: `{ sessionId, path, content }`）→ 写文件回 `null`。

并发：一次只允许一个 prompt 在途；在途时 `chat_send` 排队（前端也会禁用输入）。`chat_active`/`chat_idle` 信号发给 stage 联动 think/work/idle。

## 10. 额度（quota.rs）

- `GET {baseUrl}/usages`，headers：`Authorization: Bearer {apiKey}`，`User-Agent: DeskBot/0.1`。reqwest rustls，超时 10s。
- 实测响应样例（2026-07-31，真实结构）：

```json
{
  "user": { "membership": { "level": "LEVEL_INTERMEDIATE" } },
  "usage":    { "limit": "100", "used": "25", "remaining": "75", "resetTime": "2026-08-06T02:11:49Z" },
  "limits": [ { "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
                "detail": { "limit": "100", "used": "51", "remaining": "49", "resetTime": "..." } } ]
}
```

- 解析：`usage` → weekly；`limits[]` 中 `window.duration==300 && timeUnit` 含 `MINUTE` → fiveHour（取 `detail`）。数值字段是**字符串**，按 f64 解析。字段缺失容错为 null。
- 轮询：每 5 分钟 + 每次对话 done 后；结果缓存进 AppState 并广播 `quota://updated`。
- apiKey 读取顺序：环境变量 `KIMI_API_KEY` → `deskbot.local.json`。都没有 → QuotaInfo 全 null 并记录 warn。

## 11. 托盘（tray.rs）

图标 `include_bytes!("../icons/tray.png")` + `Image::from_bytes`。菜单：`显示/隐藏宠物`、`打开对话`、`退出`。隐藏/显示同步写 petVisible。

## 12. 前端视觉规范

- 调色板：底色 `#1a1b26`、面板 `#16161e`、主色青 `#5eead4`、深青 `#0d9488`、暖黄 `#fbbf24`、危险 `#fb7185`、文字 `#e5e7eb`、弱字 `#9ca3af`。
- 像素感来自：硬阴影（无模糊）、3px 描边、阶梯圆角、离散动画。v1 **不引入像素字体文件**，中文用系统字体。
- chat tab 模仿 kimi TUI：流式打字、工具调用行（暗淡可折叠，显示 status：⟳ 进行中 / ✓ 完成 / ✗ 失败）、权限请求条（按钮列出 options）、输入框 Enter 发送 Shift+Enter 换行、busy 时显示停止按钮。markdown 用自写极简渲染（``` 代码块、`inline`、**粗体**），不引依赖。
- quota tab：双环 SVG（外环周额度、内环 5h）、剩余百分比大数字、reset 时间、会员等级、刷新按钮与上次更新时间。

## 13. 构建与运行

```bash
npm install
npm run tauri dev     # 开发
npm run build         # 前端检查+构建
cd src-tauri && cargo check
```

v1 不做：开机自启、全局快捷键、音效、像素字体、打包发布（留到后续里程碑）。
