# DeskToolkit

DeskToolkit 是一组相互独立的桌面效率工具。每个工具拥有自己的前端依赖、Rust 后端和 Tauri 配置，可以单独开发与发布。

## 工具

| 目录 | 状态 | 用途 |
| --- | --- | --- |
| `Codex-Config` | 可用 | 管理多个 Codex Home 和 API Provider，并更新目标 Home 的 `config.toml` 与 `auth.json` |
| `DeskFinger` | 可用 | 管理桌面项目、快捷启动项、一键命令和 Markdown 项目文档 |
| `DeskBar` | 等待源码 | 目录目前只有状态说明，尚不包含可构建的工具源码 |

## 环境要求

- Windows 10/11
- Node.js 20 或更高版本
- Rust stable，使用 MSVC 工具链
- Microsoft WebView2 Runtime
- `Codex-Config` 使用 pnpm 10
- `DeskFinger` 使用 npm

Tauri 在 Windows 上的完整系统依赖请参考 Tauri 官方 prerequisites 文档。

## 验证

```powershell
cd Codex-Config
pnpm install --frozen-lockfile
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --locked

cd ..\DeskFinger
npm ci
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

构建桌面安装包：

```powershell
cd Codex-Config
pnpm tauri build

cd ..\DeskFinger
npm run tauri build
```

构建产物位于各工具的 `src-tauri/target/release/bundle`，不提交到 Git。发布 Release 前应从干净工作区重新构建，不要上传 debug 产物。

## 安全说明

- 仓库不包含任何预置 Home、Provider、API Key 或个人路径。
- Codex-Config 会在本机应用配置目录中明文保存 Provider Key，这是其修改 Codex `auth.json` 所需的数据。界面状态只接收掩码，不接收完整 Key。请保护本机账户和配置目录。
- DeskFinger 会执行用户配置的命令和程序。只使用自己创建或确认可信的运行目录及项目数据。
- 不要在 issue、日志、截图、测试夹具或提交记录中包含真实凭据。

漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 项目状态

Codex-Config 和 DeskFinger 已具备基础构建与测试流程。DeskBar 源码加入并通过同等检查之前，本仓库不应对外宣称三个工具均已发布。

## 许可证

[MIT](LICENSE)
