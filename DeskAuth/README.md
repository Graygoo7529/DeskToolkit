# DeskAuth

与 2FAuth、APIConfig 保持一致的本地账户资料管理工具，采用 React、TypeScript、Tauri 2 和 Rust。记录各个平台的用户名、密码，以及关联的多个手机号、邮箱；数据以可读的明文 JSON 保存。

![DeskAuth 主界面，全部为虚构演示资料](docs/preview.png)

## 使用

1. 启动应用，点击“选择数据目录”。可初始化空目录，或连接已有的 DeskAuth 目录。
2. 点击“添加账户”，填写平台、用户名，可补充网站地址、账户别名、密码、分组、标签和备注。
3. 按需添加多个手机号、邮箱，分别设置标签、登录 / 验证 / 找回 / 联系用途及备注。同类联系方式最多设置一个主要项。
4. 在账户列表右侧点击复制图标，或在详情页点击“复制密码”。复制直接读取本地记录，无需先显示密码；用户名、手机号和邮箱也可单独复制。

同一平台支持多个账户。平台、网站、用户名和别名全部相同的记录会被视为重复；可以通过别名区分同名的个人、工作账户。密码可暂时留空，登录标识可填写用户名、邮箱或手机号。

密码默认遮挡，点击眼睛图标查看；切换账户、更新记录或窗口失焦后收起。编辑时默认保留原密码，可以明确选择更换或清空；新密码按原文保存，包括首尾空格。剪贴板由系统管理，本版本不自动清空。

## 检索与关联查询

- “搜索账户”检索平台、用户名、别名、网站、联系方式、分组、标签和备注；多个空格分隔的关键词需同时匹配，不检索密码。`Ctrl+K` 聚焦此框。
- 下方独立的“检索平台”输入框可按平台名称或网站地址筛选，与关键词、分组和收藏组合使用。
- 顶部“关联查询”按手机号 / 邮箱查看关联账户，点击结果跳转并重置旧筛选。也可直接点击详情页联系方式旁的关联图标。
- 号码匹配忽略 `+`、空格、括号、连字符和点；不推测国家区号。邮箱匹配忽略大小写。联系方式按原文展示，各账户中的用途和备注独立管理。

![通过邮箱查询关联账户](docs/related-accounts.png)

## 本地数据管理

```text
<用户选择的数据目录>/
  accounts.json           # 账户、明文密码、手机号、邮箱及其他资料
  accounts.previous.json  # 每次成功保存前的上一版本
  .deskauth.lock          # 数据目录写入锁
```

应用配置目录的 `storage.json` 仅保存 `dataDir` 指针，Windows 通常位于 `%APPDATA%/com.desktoolkit.deskauth/`。密码不会存入浏览器 localStorage，账户列表 IPC 仅返回是否有密码，显式查看时才向界面提供密码。快速复制由 Rust 后端直接写入系统剪贴板。

数据管理沿用 2FAuth 的方式：打开目录、切换 / 重新连接目录、导出明文 JSON 备份、确认后合并导入。切换目录会读取目标账户库，不搬移当前文件；迁移时可先导出，再连接新的空目录并导入。

- 文件带有 `format: "DeskAuth"`、`version: 1` 标记，与 2FAuth 账户库独立，不互相导入。
- 使用同目录临时文件、同步到磁盘后原子替换；保存失败不更新内存账户。
- 每次保存前保留上一版本。删除、清空或更换密码后，旧版本与手动备份仍可能含有历史资料。
- 多个窗口不能同时写同一数据目录。检测到文件被外部修改时拒绝覆盖；用编辑器修改文件后，需在“数据管理”重新连接目录。
- 原目录丢失、数据损坏或版本不受支持时显示错误，不会自动初始化空库。
- 导入会先完整校验文件，再合并新账户。同 ID 或相同平台 / 网站 / 用户名 / 别名的账户跳过，已有资料和密码优先；重复导入不会重复创建账户。
- 导出使用独立的新文件名，不覆盖既有文件。恢复上一版本时，先保留原文件，再连接新空目录并导入旧目录的 `accounts.previous.json`。

按设计采用明文存储，无主密码或磁盘加密。最大文件 16 MB、最多 5000 个账户；每个账户最多 50 个手机号、50 个邮箱、20 个标签。网站仅支持 HTTP / HTTPS。应用不发起自动联网请求，点击“打开网站”时调用系统浏览器。

## 开发与构建

需要 Node.js、pnpm、Rust MSVC 工具链、Visual Studio C++ 构建工具和 WebView2 Runtime。

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm tauri build
```

PowerShell 如限制 `.ps1`，使用 `pnpm.cmd tauri build`，调用的是同一 pnpm 构建命令。`pnpm dev` 仅启动前端，本地文件和密码操作需要 Tauri 后端。

项目开发端口配置如下，DeskAuth 固定使用 **1433**，端口冲突时直接报错，不自动改用其他端口。

| 项目 | 端口 |
|---|---:|
| APIConfig | 1430 |
| DeskFinger | 1431 |
| 2FAuth | 1432 |
| DeskAuth | 1433 |
| DeskTodo | 1442 |

DeskAuth 不使用用户指定排除的 1427，也不使用 1420。

Windows 构建产物：

- `src-tauri/target/release/deskauth.exe`：直接运行的程序，需要 WebView2 Runtime。
- `src-tauri/target/release/bundle/nsis/DeskAuth_0.1.0_x64-setup.exe`：NSIS 安装包。

图标源文件为 `app-icon.svg`，可用 `pnpm tauri icon app-icon.svg` 重新生成平台资源。

## 验证

```sh
pnpm build
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --lib --tests -- -D warnings
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/native-smoke.ps1
```

Rust 测试使用真实临时目录，覆盖持久化、密码原文保存 / 保留 / 清空、多联系方式、输入校验、备份与重复合并、目录锁、外部修改、损坏数据、目录切换和写入失败。Playwright 通过 Edge 和模拟 Tauri IPC 验证界面交互，全部使用虚构账户与密码。原生冒烟脚本通过 UI Automation 检查实际 exe、打包前端、Rust 状态读取和数据管理面板，不创建账户库或修改剪贴板。

截图同样使用测试中的虚构资料；首次运行不会自动创建演示账户。
