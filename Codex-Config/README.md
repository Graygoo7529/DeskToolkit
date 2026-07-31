# Codex-Config

Codex-Config 是一个用于管理 Codex Home 和 API Provider 的 Tauri 桌面小工具。

## 功能

- 维护多个 Codex Home：每个 Home 记录一个显示名和一个 `.codex` 目录路径。
- 维护多个 API Provider：每个 Provider 记录显示名、`base_url` 和 API Key。
- 一键把选中的 Provider 应用到指定 Home：写入目标 `.codex/config.toml` 的 `[model_providers.OpenAI]` `base_url`，并写入 `.codex/auth.json` 的 `OPENAI_API_KEY`。
- 读取并展示每个 Home 的当前状态：`config.toml` 是否存在、`auth.json` 是否存在、当前 `base_url`、脱敏后的 API Key，以及是否匹配已保存 Provider。
- 支持新增、编辑、删除 Home 和 Provider；删除 Home 只删除面板记录，不删除实际 `.codex` 目录。
- 支持打开应用数据目录，数据以 `homes.toml` 和 `providers.toml` 保存在应用配置目录中。
- Provider 的 API Key 在界面状态中只返回脱敏值；编辑 Provider 时留空 Key 会保留原有 Key。

这是一个通过 vibe coding 完成的小型个人产出，不具有严谨性、通用性和使用安全性，仅供我个人使用和参考。
