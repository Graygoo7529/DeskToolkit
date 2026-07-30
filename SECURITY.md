# Security Policy

## Supported Versions

安全修复仅面向默认分支的最新版本。发布 Release 后，维护者可以在此补充具体的受支持版本范围。

## Reporting a Vulnerability

请使用 GitHub 仓库的 Private vulnerability reporting 功能报告安全问题。不要为未修复漏洞创建公开 issue，也不要提交真实 API Key、访问令牌、用户文档或本机绝对路径。

报告应尽量包含：

- 受影响的工具和版本
- 可复现的最小步骤
- 预期影响
- 已做脱敏的日志或示例数据

维护者确认问题后应先修复并准备安全公告，再公开细节。

## Local Data

Codex-Config 的 Provider Key 保存在应用配置目录的 `providers.toml` 中，并会写入用户选择的 Codex Home `auth.json`。这些文件是敏感数据，不应加入仓库、同步到公开位置或附在问题报告中。

DeskFinger 的运行目录可能包含命令、路径和项目文档。应用将这些数据视为用户授权的本地输入；不要打开来源不可信的运行目录。
