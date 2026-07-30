# Contributing

## Development

请先阅读根目录 `README.md`，并只在需要修改的独立工具目录中安装依赖。

提交前运行：

```powershell
cd Codex-Config
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked

cd ..\DeskFinger
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## Pull Requests

- 一个 Pull Request 只处理一个清晰问题。
- 修改文件系统、命令执行或凭据处理代码时必须补充测试。
- Rust 后端必须校验所有来自 WebView 的路径和标识符。
- 不提交 `node_modules`、`dist`、`target`、安装包或本机运行数据。
- 测试域名使用 `example.invalid`，路径使用 `C:\Users\example`，Key 使用明显无效的 `test-key` 值。

## Secrets

提交前搜索凭据和个人数据。发现真实凭据时应立即停止提交、轮换凭据，并在进入 Git 历史之前删除相关内容。
