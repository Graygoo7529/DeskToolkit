# DeskTodo

本地桌面便签与待办工具，属于 DeskToolkit。左侧管理 note 夹，上方用轻量标签切换便签，正文是可直接编辑的 Markdown 文档。图标与 APIConfig / DeskFinger / 2FAuth 统一采用圆角渐变底和白色符号；界面使用轻薄高光、半透明面板，界面文字以 12–13px 为主、正文 15px、待办内容 14px。

## 使用

- 首次打开选择数据目录，仅创建一个「收件箱」和一张简短示例。检测到旧版 WebView 便签时，会先迁入旧数据。
- 标题、粗体、列表、引用、代码、表格等在同一个编辑区域显示和编辑。输入 `# `、`**文字**` 等 Markdown 语法即可排版；工具栏的 `</>` 可切换源码。
- 在正文空行输入 `/`，光标下方出现插入菜单。上下键选择，Enter / Tab 插入；继续输入、点击其他位置、滚动或 Escape 关闭。
- 待办纸支持直接改字、勾选、删除单行、添加新行及清除当前块内的已完成项。Enter 插入下一行，空行 Backspace 删除，上下键移动；支持撤销重做。
- 工具栏「复制便签内容」复制完整 Markdown 到剪切板。
- note 夹和夹内便签可拖动排序，也支持聚焦排序项后按 `Alt+↑/↓`；搜索结果中暂不启用便签排序。夹右侧可删除，确认前会提示将永久删除其中的 Markdown 文件。
- 桌面版工具栏「打开 Markdown 文件」用默认应用打开当前便签；外部修改后，在「数据目录」中选择「重新载入文件」。
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
- 选择已有 DeskTodo 数据的目录：载入该目录的数据。旧版 `workspace.json` 自动迁移，原 JSON 和 `.bak` 保留不动。
- 保存：每张便签写入独立的 UTF-8 `.md`，使用临时文件原子替换、事务恢复日志和文件锁；修改内容时保留该笔记上一份版本，单独删除笔记时留下恢复副本。删除整个 note 夹会永久删除其 Markdown 文件，附件保留；至少保留一个夹。
- 写入失败：界面保留修改，显示原因和重试入口；不会显示「已保存」。读取失败不会用示例覆盖原文件。
- 切换前等待写入队列结束。关闭窗口时，尚有保存任务则等待其完成；失败时保持窗口打开。

目录结构示例：

```text
DeskTodo/
├─ 收件箱/
│  └─ 随手记.md
├─ 工作/
│  ├─ 本周安排.md
│  └─ 会议记录.md
└─ .desktodo/
   ├─ index.json       # 可修复缓存：ID、名称、颜色、排序与文件映射，不保存正文
   ├─ backup/          # 按笔记 ID 编码命名的上一份正文与上一份索引
   ├─ deleted/         # 已删除笔记的 Markdown 副本
   └─ drafts/          # 外部修改冲突时，主动保留的完整工作区副本
```

文件正文就是 Markdown，没有强制加入 frontmatter。中文夹名和标题保留；重名自动追加 `(2)` 等后缀，不合法的 Windows 文件名字符会替换。应用内重命名会同步文件路径；非 DeskTodo 管理的附件不会删除。

本地目录中的 Markdown 文件是事实来源。启动或「重新载入文件」时会扫描一级子目录及其中的 `.md`：缺失文件和夹会从列表移除，新增或外部重命名的 Markdown 会按文件名成为新便签。已有夹的顺序和颜色从缓存恢复，新发现且含 Markdown 的夹追加到末尾；空的未管理目录、附件目录和隐藏目录不会自动导入。索引缺失或损坏可由文件重建，排序等界面元数据可能重置。

保存仅检查和写入本次新增、修改、移动或删除的文件；其他文件在外部被修改或删除，不会阻塞当前便签的保存，也不会被旧内容覆盖或重新创建。外部变化可通过重新载入或重启应用显示。如果同一张便签同时在应用内外被修改，保存会停止并提示，点击「保留副本并重新载入」会把当前版本完整另存到 `.desktodo/drafts`，再载入磁盘内容。文件锁仅用于阻止并发写入；`write.lock` 文件留在目录中不会阻止下一次启动。

应用配置目录中的 `desktodo-config.json` 只记录所选目录；Windows 默认位置为 `%APPDATA%\com.desktoolkit.desktodo`。旧版 `desktodo-workspace-v1` 本地缓存迁入后保留。迁移完成后以实际目录和 `.md` 为准，旧 JSON 作为迁移前档案。

备份和删除副本都可用 Markdown 编辑器直接打开。副本文件名是笔记 ID 的 UTF-8 十六进制编码，可通过 `backup/index.json` 对应标题。恢复正文时先关闭应用，另存当前文件，再用对应备份内容替换当前 `.md`；已删除的笔记可新建便签后粘回正文。备份保留上一份正文，不是完整版本历史。`.desktodo/drafts` 中的每个副本也是可独立选择的数据目录。编辑器撤销历史在切换便签或源码后重新开始。

`pnpm dev` 的浏览器预览使用浏览器本地存储；本地文件目录功能在桌面应用中使用。

## 开发和构建

需要 Node.js、pnpm、Rust 1.89 或更新版本、Windows C++ 构建工具和 WebView2。

```powershell
pnpm install
pnpm tauri dev
pnpm tauri build
```

开发端口固定为 **1442**，不占用 1420、1427、APIConfig 的 1430 或 DeskFinger 的 1431。Windows 构建产物：

- `src-tauri/target/release/desktodo.exe`
- `src-tauri/target/release/bundle/nsis/DeskTodo_0.3.0_x64-setup.exe`

```powershell
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
powershell -ExecutionPolicy Bypass -File scripts/native-smoke.ps1
```

Playwright 使用本机 Edge，覆盖编辑/撤销/输入法组合事件、slash 菜单、待办纸、复制、迁移、保存失败、目录切换及外部编辑恢复。Rust 测试使用临时目录验证 Markdown 读写、迁移、重命名、备份、冲突和中断恢复。原生 smoke 脚本读取打包程序的可访问性树，使用独立 WebView 缓存，不执行界面编辑；正常启动可能触发已配置目录的旧数据迁移。

图标源文件为 `public/app-icon.svg`，执行 `pnpm icons` 生成各平台图标。编辑器扩展说明和调研来源见 [设计说明](docs/design.md)。
