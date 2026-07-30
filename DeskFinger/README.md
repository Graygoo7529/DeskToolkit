# DeskFinger

DeskFinger 是一个 Tauri 桌面项目启动器，提供项目分组、快捷启动、一键命令和 Markdown 文档管理。

## Development

```powershell
npm ci
npm run tauri dev
```

## Checks

```powershell
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

## Runtime Directory

DeskFinger 会在用户选择的运行目录中创建：

```text
projects/
  <project-id>/
    project.json
    docs/
      看板.md
```

项目 ID 和文档名会在 Rust 后端校验，文件操作只能落在对应项目目录内。运行目录中的命令会以当前用户权限执行，因此只能使用可信数据。
