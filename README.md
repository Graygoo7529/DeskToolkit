# DeskToolkit

DeskToolkit 是一组相互独立的 Windows Tauri 桌面小工具。每个项目都有自己的前端、Rust 后端、数据目录和构建流程，可以单独开发、测试和发布。

## 项目

| 项目 | 用途 | 开发端口 | 文档 |
| --- | --- | ---: | --- |
| [DeskTodo](DeskTodo/README.md) | 深色桌面便签与待办，支持 Markdown 即时渲染、交互式待办纸、note 夹和本地 Markdown 文件存储 | 1442 | [README](DeskTodo/README.md) |
| [APIConfig](APIConfig/README.md) | Codex / Claude API 配置、Provider 管理、模型发现、连接检查和额度查询 | 1430 | [README](APIConfig/README.md) |
| [DeskFinger](DeskFinger/README.md) | 桌面项目启动器，管理项目卡片、快速启动项、一键启动流程和 Markdown 文档 | 1431 | [README](DeskFinger/README.md) |
| [DeskAuth](DeskAuth/README.md) | 本地认证信息管理工具，支持账户、密码、联系方式、备份和目录迁移 | 1433 | [README](DeskAuth/README.md) |
| [2FAuth](2FAuth/README.md) | 本地 TOTP 双因素认证器，支持二维码导入、分组、收藏、恢复码和本地备份 | 1432 | [README](2FAuth/README.md) |

这些项目是面向个人使用的小型产出，不承诺严谨性、通用性或安全性，请不要把它们视为生产软件、通用解决方案或安全工具。

## 开发环境

Windows 开发和发布需要 Node.js、pnpm 或 npm、Rust stable MSVC 工具链、Visual Studio C++ 构建工具以及 WebView2 Runtime。项目之间不共享根目录依赖，进入对应目录后再安装依赖。

常用开发命令如下：

```powershell
# 以 DeskTodo 为例，其它项目使用对应目录和 package manager
cd DeskTodo
pnpm install --frozen-lockfile
pnpm tauri dev
```

DeskFinger 使用 `npm ci`；其它项目使用各自 README 中列出的 `pnpm install` 命令。PowerShell 如果限制 `pnpm.ps1`，可将命令写成 `pnpm.cmd`。

## 构建与验证

发布构建在对应项目目录执行：

```powershell
pnpm tauri build
```

构建会先编译前端，再由 Tauri 生成 Windows 可执行文件和安装包；产物位于项目的 `src-tauri/target/release/` 及 `bundle/` 目录。发布时应使用 Tauri 构建命令，而不是只执行 `cargo build --release`。

各项目的 CI 检查包括前端构建、Playwright 交互测试、Rust 格式检查和 Rust 测试，具体组合以 [.github/workflows/ci.yml](.github/workflows/ci.yml) 为准。APIConfig 的 Rust HTTP 检查只访问进程内本地 mock，不连接真实 Provider；Windows 下的 socket 兼容处理和测试说明见 [APIConfig README](APIConfig/README.md)。

## 目录约定

- 每个项目的 `src/` 保存前端界面和交互逻辑，`src-tauri/` 保存 Rust 命令、文件存储和原生窗口配置。
- `src-tauri/target/` 是构建缓存和产物目录，可在需要释放空间时清理；保留 `target/release/*.exe` 和 `target/release/bundle/` 中的发布产物即可。
- 用户数据目录由各项目单独选择和管理，不应把真实用户数据提交到 Git。
