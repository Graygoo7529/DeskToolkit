# DeskTodo

本地桌面便签与待办工具，属于 DeskToolkit。左侧管理 note 夹，上方用轻量标签切换便签，正文是可直接编辑的 Markdown 文档。界面延续 APIConfig / DeskFinger 的深蓝底色、细边框和淡蓝色选中态。

## 使用

- 首次打开选择数据目录，仅创建一个「收件箱」和一张简短示例。检测到旧版 WebView 便签时，会先迁入旧数据。
- 标题、粗体、列表、引用、代码、表格等在同一个编辑区域显示和编辑。输入 `# `、`**文字**` 等 Markdown 语法即可排版；工具栏的 `</>` 可切换源码。
- 在正文空行输入 `/`，光标下方出现插入菜单。上下键选择，Enter / Tab 插入；继续输入、点击其他位置、滚动或 Escape 关闭。
- 待办纸支持直接改字、勾选、删除单行、添加新行及清除当前块内的已完成项。Enter 插入下一行，空行 Backspace 删除，上下键移动；支持撤销重做。
- 工具栏「复制便签内容」复制完整 Markdown 到剪切板。
- `Ctrl+Shift+N` 新建便签，`Ctrl+Z` 撤销，`Ctrl+Shift+Z` 重做，`Ctrl+S` 重新保存。链接可用 Ctrl+点击打开。

## 待办纸与公式

待办纸使用 Markdown 围栏代码块扩展，便于复制和迁移：

````markdown
```todo
- [ ] 要做的事
- [x] 已完成的事
```

```math
\frac{a}{b} + E = mc^2
```
````

公式由 KaTeX 本地渲染。兼容旧版独占行 `$$` 包裹的公式。普通 `- [ ]` 列表仍支持勾选，完整待办纸交互使用 `todo` 块。其他语言的代码块保留为普通代码，不会被当成待办。

## 数据目录

左下角「数据目录」可查看、打开或切换目录。行为与其他 DeskToolkit 工具保持一致：

- 选择空目录：复制当前工作区过去，原目录保留。
- 选择已有 `workspace.json` 的目录：载入该目录的数据。
- 保存：通过同目录临时文件原子替换，并在 `workspace.json.bak` 留下上一份有效快照。
- 写入失败：界面保留修改，显示原因和重试入口；不会显示「已保存」。读取失败不会用示例覆盖原文件。
- 切换前等待写入队列结束。关闭窗口时，尚有保存任务则等待其完成；失败时保持窗口打开。

目录中保存 `workspace.json` 和 `workspace.json.bak`。应用配置目录中的 `desktodo-config.json` 只记录所选目录；Windows 默认位置为 `%APPDATA%\com.desktoolkit.desktodo`。旧版 `desktodo-workspace-v1` 本地缓存迁入后保留。

恢复备份时先关闭应用，另存当前文件，再把 `workspace.json.bak` 复制为 `workspace.json`。备份保留上一份快照，不是完整版本历史。编辑器撤销历史在当前便签编辑会话中有效；切换便签或源码后重新开始。

`pnpm dev` 的浏览器预览使用浏览器本地存储；本地文件目录功能在桌面应用中使用。

## 开发和构建

需要 Node.js、pnpm、Rust、Windows C++ 构建工具和 WebView2。

```powershell
pnpm install
pnpm tauri dev
pnpm tauri build
```

开发端口固定为 **1442**，不占用 1420、1427、APIConfig 的 1430 或 DeskFinger 的 1431。Windows 构建产物：

- `src-tauri/target/release/desktodo.exe`
- `src-tauri/target/release/bundle/nsis/DeskTodo_0.2.0_x64-setup.exe`

```powershell
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
powershell -ExecutionPolicy Bypass -File scripts/native-smoke.ps1
```

Playwright 使用本机 Edge，覆盖编辑/撤销/输入法组合事件、slash 菜单、待办纸、复制、迁移、保存失败和目录切换。Rust 测试使用临时目录验证读写、备份及损坏文件保护。原生 smoke 脚本读取打包程序的可访问性树，使用独立 WebView 缓存，不改便签或目录配置。

图标源文件为 `public/app-icon.svg`，执行 `pnpm icons` 生成各平台图标。编辑器扩展说明和调研来源见 [设计说明](docs/design.md)。
