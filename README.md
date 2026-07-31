# DeskToolkit

DeskToolkit 包含三个相互独立的桌面小工具，当前代码中的功能如下。

## 项目

- `Codex-Config`：Codex 配置面板，用于维护多个 Codex Home 路径和多个 API Provider，并把选中的 Provider 应用到指定 Home。应用时会修改目标 `.codex/config.toml` 中 OpenAI Provider 的 `base_url`，以及 `.codex/auth.json` 中的 `OPENAI_API_KEY`。
- `DeskFinger`：个人桌面项目启动器，用于维护项目卡片、快速启动项、一键启动流程和项目 Markdown 文档。支持文件/文件夹/应用/网页/终端命令启动项，支持拖入路径、排序、分组、卡片/列表视图，以及每个项目独立的文档编辑和预览。
- `DeskBot`：像素风桌面机器人，用透明舞台显示可拖动宠物和悬浮球；带对话/额度面板、系统托盘、Kimi Code CLI ACP 对话桥接，以及 Kimi Code 周额度和 5 小时窗口额度查询。

这些项目都是通过 vibe coding 完成的小型个人产出，不具有严谨性、通用性和使用安全性，仅供我个人使用和参考。请勿将它们视为生产软件、通用解决方案或安全工具。
