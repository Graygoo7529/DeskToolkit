# DeskTodo

DeskTodo 是 DeskToolkit 中的本地优先桌面便签工具：左侧 note 夹管理、横向便签切换、Markdown 即时预览，以及可交互的待办块。

## 开发

```powershell
pnpm install
pnpm dev
```

开发端口为 `1442`，避开 APIConfig（1430）和 DeskFinger（1431）。

## 构建

```powershell
pnpm tauri build
```

便签数据默认保存在 WebView 的本地存储中；Tauri 后端同时提供了 `load_workspace` / `save_workspace` 命令，为后续迁移到可导出文件或插件存储保留接口。

## 交互

- `Ctrl / ⌘ + K` 打开快捷插入菜单；在编辑器新行输入 `/` 也会唤起菜单。
- `Ctrl / ⌘ + Shift + N` 新建 note。
- Markdown 中的 `- [ ]` / `- [x]` 会渲染为可点击待办，悬停行尾可移除。
- `$$` 包围的内容会显示为公式块占位，便于后续接入公式转换插件。
