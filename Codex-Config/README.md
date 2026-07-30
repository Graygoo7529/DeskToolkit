# Codex Config

Codex Config 是一个 Tauri 桌面应用，用于管理 Codex Home 和 API Provider。应用只修改目标 Home 中的：

- `config.toml` 的 `[model_providers.OpenAI]` / `base_url`
- `auth.json` 的 `OPENAI_API_KEY`

其他配置会尽量保持不变。

## Development

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

## Checks

```powershell
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## Data and Keys

首次启动生成空的 `homes.toml` 和 `providers.toml`。仓库和应用二进制不携带示例 Key。

Provider Key 明文保存在 Tauri 应用配置目录的 `providers.toml` 中，完整 Key 只在 Rust 后端处理；WebView 获取的是掩码。编辑已有 Provider 时，Key 留空会保留当前值。
