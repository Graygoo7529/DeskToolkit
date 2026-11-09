# DeskToolkit

几个让桌面日常更顺手的小工具。

DeskToolkit 是我围绕日常学习、开发和账户管理，逐步做出来的一组 Windows 桌面工具。它们各自独立，却都在解决同一类小问题：临时想到的事情没有地方记，开始项目时要反复打开一堆东西，API 地址和配置容易散落，账户和验证码也很难整理。

这些工具的出发点很简单：把反复寻找、复制和切换的操作，变成桌面上随手可用的入口。它们不试图替代大型软件，更像是几个安静、直接、只做一件事的小工具。

如果想了解这组工具为什么这样设计，以及它们在日常使用中如何配合，可以阅读[项目介绍文章](README-supplyment.md)。

## DeskTodo：随手记录，也能认真整理

临时想到一件事时，需要的是打开就能写；记录逐渐变多后，又希望能按主题整理。DeskTodo 把便签、Markdown 和待办清单放在一起，适合随手记、学习摘录和日常任务安排。

正文可以直接编辑和排版，标题、列表、引用、代码、表格和数学公式会随着输入即时显示。待办内容可以插入一张独立的“待办纸”，直接勾选、改字、添加或删除某一行，也可以一次清理已经完成的事项。便签通过 note 夹和标签页组织，每张便签都保存为独立的本地 Markdown 文件，必要时可以用其他编辑器继续打开。

[查看 DeskTodo 使用与构建说明](DeskTodo/README.md)

## DeskFinger：把一个项目需要的东西放在一起

开始一个项目，往往要先打开文件夹、编辑器、参考网页和终端，再输入几条命令。DeskFinger 用项目卡片把这些入口集中起来，让“进入工作状态”少一些重复操作。

每个项目都可以添加文件夹、程序、文档、网页和终端命令，也可以直接拖入资源。常用动作可以组合成一键启动流程，例如先打开项目目录，再打开编辑器、终端和参考文档。项目内还带有 Markdown 文档区，可以记录启动步骤、常用命令和项目说明。它只保存外部资源的路径，不会搬动原有文件。

[查看 DeskFinger 使用说明](DeskFinger/README.md)

## APIConfig：集中管理 API 来源与开发工具配置

使用 Codex、Claude Code 或多个 API 服务时，地址、密钥和配置目录很容易散落在不同文件里。APIConfig 将服务来源与目标配置目录放在一起，选好 Provider 后，就能应用到相应的 Codex 或 Claude 配置中。

除了配置切换，它还支持连接检查、模型发现和额度查询。额度信息取决于服务提供的接口，应用会把“未接入”和“查询失败”明确区分开来。独立的 API Probe 页面还可以集中检查不同协议的 API、查看模型并按需进行最小调用探测，不必先把它们配置进开发工具。

[查看 APIConfig 使用与构建说明](APIConfig/README.md)

## DeskAuth：整理账户，也理清账户之间的联系

一个平台可能有多个账户，一个邮箱或手机号又可能关联多个平台。DeskAuth 将平台、用户名、密码、联系方式、备注和 TOTP 认证器整理在同一份账户资料中，方便查找和复制。

它支持搜索、分组、收藏，也可以按邮箱或手机号反查关联账户，帮助梳理“这个联系方式用在哪些地方”。账户按独立的 JSON 文件保存在本地，支持目录切换、备份和修改前记录。

[查看 DeskAuth 使用与构建说明](DeskAuth/README.md)

## 2FAuth：专注动态验证码的小工具

如果想把双因素认证集中管理，2FAuth 提供了一个直接的入口。它支持手动输入密钥、导入认证链接或二维码图片，在本机生成标准 TOTP 动态验证码，并显示倒计时和复制入口。

账户可以分组和收藏，也能保存平台提供的恢复码并标记使用状态。工具无需注册，不提供云端同步；可选的联网校时用于修正验证码计算时间，默认关闭，也不会修改系统时间。

[查看 2FAuth 使用与构建说明](2FAuth/README.md)

## 这些工具有什么共同点

它们都围绕本地文件工作。每个项目都有自己的数据目录，用户可以选择目录、备份目录，也可以用其他程序查看其中的 Markdown、JSON 或配置文件。工具之间不会共享一份隐藏的总数据库，某个项目的数据也不会因为删除另一个项目而受到影响。

它们也都尽量把重要操作放在眼前：数据目录可以查看和切换，列表可以搜索和排序，编辑内容可以直接保存，外部文件发生变化时会提供重新载入或恢复入口。界面风格保持深色、克制和轻量，希望工具能融入桌面，而不是增加新的管理负担。

## 本地数据和安全提醒

这些工具默认不把数据上传到云端，但“保存在本地”不等于“已经加密”。DeskAuth 和 2FAuth 当前使用明文 JSON，没有主密码或磁盘加密；APIConfig 的 API 密钥也会保存在本地配置文件中。数据目录、备份和导出的文件应放在可信位置，界面中的密码遮挡只是在屏幕上隐藏文字，并不提供加密保护。

## 开发和构建

项目使用 Tauri、React、TypeScript 和 Rust 开发。Windows 开发和发布需要 Node.js、pnpm 或 npm、Rust stable MSVC 工具链、Visual Studio C++ 构建工具以及 WebView2 Runtime。每个项目都有独立的依赖、数据目录和构建流程。

| 项目 | 开发端口 | 安装依赖 |
| --- | ---: | --- |
| APIConfig | 1430 | `pnpm install --frozen-lockfile` |
| DeskFinger | 1431 | `npm ci` |
| 2FAuth | 1432 | `pnpm install --frozen-lockfile` |
| DeskAuth | 1433 | `pnpm install --frozen-lockfile` |
| DeskTodo | 1442 | `pnpm install --frozen-lockfile` |

以 DeskTodo 为例：

```powershell
cd DeskTodo
pnpm install --frozen-lockfile
pnpm tauri dev
```

构建 Windows 程序和安装包时，在对应项目目录执行：

```powershell
pnpm tauri build
```

DeskFinger 使用 npm 安装依赖时，可用 `npm run tauri -- build` 构建。PowerShell 如果限制 `pnpm.ps1`，可以将命令写成 `pnpm.cmd`。构建产物位于项目的 `src-tauri/target/release/` 和 `bundle/` 目录；`target` 中的依赖缓存可以清理，发布用的 `.exe` 和安装包应保留。

各项目的 GitHub Actions 会按项目执行前端构建、交互测试、Rust 格式检查和 Rust 测试，具体组合见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。APIConfig 的 Rust 查询测试只访问本地模拟服务，不会连接真实 Provider；Windows 下的 socket 兼容处理说明见 [APIConfig README](APIConfig/README.md)。

## 关于 DeskToolkit

这些工具是我通过持续的个人实践和 vibe coding 做出来的产出，主要服务于自己的学习、开发和日常管理，也希望能给遇到相似问题的人一些参考。它们不承诺生产级的可靠性、通用性或安全性，请根据自己的需求和风险判断是否使用。

项目地址：[GitHub · DeskToolkit](https://github.com/Graygoo7529/DeskToolkit)
