# DeskBot

像素风桌面机器人（Tauri 2 + React 18 + TypeScript + Vite）。点击宠物弹出问候与悬浮球；对话球基于本机 Kimi Code CLI（`kimi acp`，ACP 协议）聊天；额度球展示 Kimi Code 周额度与 5 小时频限，并联动宠物外观光泽。

## 常用命令

```bash
npm install            # 安装前端依赖
npm run tauri dev      # 开发运行（启动 vite + tauri）
npm run build          # tsc --noEmit && vite build
cd src-tauri && cargo check   # 后端类型检查
node scripts/gen-icon.mjs     # 重新生成占位图标
```

## 约定

- 架构与 IPC 契约见 `docs/architecture.md`——改事件/命令/类型前先改它。
- 窗口代码两条铁律（见 `docs/architecture.md` §5）：**禁止** `set_ignore_cursor_events`（WS_EX_LAYERED 会让 WebView2 不渲染）；点击穿透用 `hotspot.rs` 的 WM_NCHITTEST 子类。`lib.rs` 启动时会设置 `--disable-accelerated-2d-canvas`（本机 GPU canvas 无法合成），勿移除。
- 机密（API Key 等）只放 `deskbot.local.json`（已 gitignore），绝不入库、绝不打印到日志。
- 聊天会话的工作区是 `workspace/`（kimi 的 cwd），其中 `AGENTS.md` 是机器人人格文件，需保留；其余内容为运行时产物，不入库。
- 前端两个入口：`index.html`（stage 宠物舞台）、`panel.html`（对话/额度面板）。
- Rust 源码在 `src-tauri/src/`，按模块拆分：config / windows / hotspot / acp / quota / tray。
