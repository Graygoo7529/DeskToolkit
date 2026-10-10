# API Probe 定义

运行时只读取所选数据目录的 `definitions/`。所有文件使用相同的加载、校验和下拉菜单注册规则，没有内置覆盖层。

```text
数据目录/
  apis.toml                  # 账号、协议地址、Key、quota.profile
  definitions/
    layouts/*.toml           # 显示什么、标题、顺序、绑定 ID
    adapters/*.toml          # 请求路径、认证、响应字段映射
    README.md
```

首次启动仅在 definitions 目录不存在时，从安装资源复制一套初始文件。已有文件从不被默认资源覆盖；删除或修改配置不会在启动时被悄悄恢复。复制数据目录会复制整个 definitions 文件夹。便携版第一次运行需要 exe 旁的 definitions 文件夹，安装版已携带这些资源。

## 先声明界面，再适配数据

例如，只显示日额度的 `layouts/my_daily.toml`：

```toml
id = "my_daily"
label = "额度"

[[blocks]]
component = "quota_card"
source = "windows.daily"
title = "日额度"
```

再创建 `adapters/my_service.toml`：

```toml
id = "my_service"
label = "额度 · 我的服务"
description = "每日额度"
kind = "subscription"
layout_id = "my_daily"
request_method = "GET"
request_path = "/v1/usage"
request_auth = "bearer"
default_unit = "USD"

[[windows]]
id = "daily"
label = "日额度"
required = true
scope_pointer = "/subscription"
used_pointer = "/daily_usage_usd"
limit_pointer = "/daily_limit_usd"
remaining_pointer = "/daily_remaining_usd"
reset_pointer = "/daily_reset_at"
```

界面始终只有这张日额度卡片。即使响应另有 balance、周/月累计用量，也不会自动增加卡片。查询前、查询失败或字段缺失时保留声明的卡片，数值显示 `—`。没有重置时间仍是额度卡片；窗口起始时间不当作重置时间。

## 可复用组件与映射

| component | source | 用途 |
| --- | --- | --- |
| balance_card | balance | 账户余额与单位 |
| quota_card | windows.窗口ID | 已用、总量、剩余、进度、重置时间 |
| membership | membership | 套餐信息；缺少文本时隐藏 |

blocks 的顺序就是卡片的顺序。一个布局可声明任意多个额度窗口，也可组合余额和额度；每个 source 必须能在适配器中找到对应窗口 ID。卡片标题取自布局，响应不能更改标题。

余额映射使用 `balance_pointer`，可选 `fallback_balance_pointer` 用于同一数值的另一个字段。单位使用 `unit_pointer` / `default_unit`，套餐文字使用 `membership_pointer`。窗口映射可使用 `scope_pointer` 进入对象，或 `array_pointer` + `match_pointer` + `match_value` 精确选择数组项，再用 `item_pointer` 读取子对象。路径采用 RFC 6901 JSON Pointer。

数值支持数字与数字字符串，拒绝 NaN/Infinity。已用、总量、剩余中已知两个时可计算第三个；不把缺失值当作零。`limit_value = 100` 可声明固定百分比总量。`required = true` 的窗口缺少数值时报告部分数据缺失。金额不换算。

kind 为 balance / subscription 时分别出现在直连 / 订阅的选择范围。Sub2API 钱包、日额度、日周月额度是三个明确的方案，复用同一个 `/v1/usage` 接口，并由各自布局决定显示内容。

## 新建与修改

在账号编辑器选择“新建查询方案…”可以先选择余额或周期额度组件，再填查询路径与字段；保存后分别生成 adapters 和 layouts 文件，账号仅保存方案 ID。生成的文件与其他文件完全相同，可继续用 TOML 增加更多窗口。

也可直接在两个文件夹中新增 TOML。刷新账号或重新进入 API Probe 后重新读取定义，无需编译。ID 只允许字母、数字、下划线和连字符，不能重复；格式错误、未知组件、错误的布局引用都会明确报告。

请求继承账号第一个协议的 Base URL 和该账号的 API Key，不在定义中再保存 Key。路径以 `/` 开头时相对于域名根目录，否则相对于 Base URL。只支持同源 GET / POST（POST 发送空 JSON），认证为 bearer / x_api_key / none，不跟随重定向。接口返回网页时报告路径错误，不猜测或自动切换请求地址。

