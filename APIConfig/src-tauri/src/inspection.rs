//! Provider 手动检查。只发 GET，不执行生成；错误不携带响应正文或密钥。
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

static SLOTS: Semaphore = Semaphore::const_new(3);
static HTTP: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .user_agent("APIConfig/0.1")
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("HTTP client")
});

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Auth {
    #[default]
    Bearer,
    XApiKey,
    None,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Adapter {
    #[default]
    None,
    Kimi,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InspectionSettings {
    /// 空值自动补齐版本前缀；以 / 开头则相对于域名，否则相对于 Base URL。
    pub models_path: String,
    pub models_auth: Auth,
    pub quota: QuotaSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct QuotaSettings {
    pub adapter: Adapter,
    pub path: String,
    pub auth: Auth,
    pub balance_pointer: String,
    pub used_pointer: String,
    pub limit_pointer: String,
    pub remaining_pointer: String,
    pub reset_pointer: String,
    pub unit: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Task {
    Connection,
    Models,
    Quota,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct QuotaWindow {
    pub name: String,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub reset_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Quota {
    pub balance: Option<f64>,
    pub unit: String,
    pub membership: Option<String>,
    pub windows: Vec<QuotaWindow>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Model {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub status: String,
    pub message: String,
    pub checked_at: u64,
    pub latency_ms: u64,
    pub http_status: Option<u16>,
    pub models: Vec<Model>,
    pub quota: Option<Quota>,
}

impl ProbeResult {
    fn new() -> Self {
        Self {
            status: "ok".into(),
            message: String::new(),
            checked_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            latency_ms: 0,
            http_status: None,
            models: vec![],
            quota: None,
        }
    }
}

pub fn endpoint(base: &str, path: &str, default_leaf: &str) -> Result<Url, String> {
    let mut base = Url::parse(base).map_err(|_| "Base URL 无效")?;
    if !matches!(base.scheme(), "http" | "https")
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("Base URL 需为不含账号、查询参数和片段的 HTTP(S) 地址".into());
    }
    let path = path.trim();
    let url = if path.is_empty() {
        let prefix = base.path().trim_end_matches('/');
        let prefix = if prefix.ends_with("/v1") {
            prefix.to_string()
        } else {
            format!("{prefix}/v1")
        };
        base.set_path(&format!("{prefix}/{default_leaf}"));
        base.clone()
    } else {
        base.set_path(&format!("{}/", base.path().trim_end_matches('/')));
        base.join(path).map_err(|_| "查询路径无效")?
    };
    if url.origin() != base.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("查询地址必须与 Base URL 同源；不支持携带账号或片段".into());
    }
    Ok(url)
}

pub fn validate(base: &str, settings: &InspectionSettings) -> Result<(), String> {
    endpoint(base, &settings.models_path, "models")?;
    let q = &settings.quota;
    if q.adapter != Adapter::None {
        endpoint(base, &q.path, "usages")?;
    }
    if q.adapter == Adapter::Custom {
        if q.path.trim().is_empty() {
            return Err("自定义额度需要查询路径".into());
        }
        let fields = [
            &q.balance_pointer,
            &q.used_pointer,
            &q.limit_pointer,
            &q.remaining_pointer,
        ];
        if fields.iter().all(|s| s.trim().is_empty()) {
            return Err("至少配置一个数值字段映射".into());
        }
        for p in fields.into_iter().chain([&q.reset_pointer]) {
            if !p.is_empty() && !p.starts_with('/') {
                return Err("字段路径需使用 JSON Pointer，例如 /data/balance".into());
            }
        }
    }
    Ok(())
}

fn number(value: Option<&Value>) -> Option<f64> {
    let v = value?;
    v.as_f64()
        .or_else(|| v.as_str()?.trim().parse().ok())
        .filter(|n| n.is_finite())
}

fn window(v: &Value, name: &str) -> Option<QuotaWindow> {
    let result = QuotaWindow {
        name: name.into(),
        used: number(v.get("used")),
        limit: number(v.get("limit")),
        remaining: number(v.get("remaining")),
        reset_at: v
            .get("resetTime")
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    (result.used.is_some() || result.limit.is_some() || result.remaining.is_some())
        .then_some(result)
}

pub fn parse_quota(body: &Value, config: &QuotaSettings) -> Result<(Quota, bool), String> {
    let mut quota = Quota {
        unit: config.unit.clone(),
        ..Quota::default()
    };
    let mut partial = false;
    match config.adapter {
        Adapter::None => return Err("未配置额度适配器".into()),
        Adapter::Kimi => {
            if let Some(w) = body.get("usage").and_then(|v| window(v, "周额度")) {
                quota.windows.push(w);
            }
            if let Some(limits) = body.get("limits").and_then(Value::as_array) {
                for item in limits {
                    let duration = number(item.pointer("/window/duration"));
                    let unit = item
                        .pointer("/window/timeUnit")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    if duration == Some(300.0) && unit.contains("MINUTE") {
                        if let Some(w) = item.get("detail").and_then(|v| window(v, "5 小时窗口"))
                        {
                            quota.windows.push(w);
                        }
                        break;
                    }
                }
            }
            quota.membership = body
                .pointer("/user/membership/level")
                .and_then(Value::as_str)
                .map(str::to_string);
            partial = quota.windows.len() < 2
                || quota
                    .windows
                    .iter()
                    .any(|w| w.used.is_none() || w.limit.is_none() || w.remaining.is_none());
        }
        Adapter::Custom => {
            let read = |path: &str| {
                if path.is_empty() {
                    None
                } else {
                    number(body.pointer(path))
                }
            };
            quota.balance = read(&config.balance_pointer);
            let w = QuotaWindow {
                name: "额度".into(),
                used: read(&config.used_pointer),
                limit: read(&config.limit_pointer),
                remaining: read(&config.remaining_pointer),
                reset_at: if config.reset_pointer.is_empty() {
                    None
                } else {
                    body.pointer(&config.reset_pointer)
                        .and_then(Value::as_str)
                        .map(str::to_string)
                },
            };
            for (p, v) in [
                (&config.balance_pointer, quota.balance),
                (&config.used_pointer, w.used),
                (&config.limit_pointer, w.limit),
                (&config.remaining_pointer, w.remaining),
            ] {
                if !p.is_empty() && v.is_none() {
                    partial = true;
                }
            }
            if !config.reset_pointer.is_empty() && w.reset_at.is_none() {
                partial = true;
            }
            if w.used.is_some() || w.limit.is_some() || w.remaining.is_some() {
                quota.windows.push(w);
            }
        }
    }
    if quota.balance.is_none() && quota.windows.is_empty() {
        return Err("响应中没有可识别的额度数值，请检查适配器或字段路径".into());
    }
    Ok((quota, partial))
}

fn parse_models(body: &Value) -> Result<(Vec<Model>, bool), String> {
    let data = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("响应缺少 data 模型数组")?;
    let models: Vec<Model> = data
        .iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            Some(Model {
                id: id.into(),
                name: v
                    .get("display_name")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect();
    let partial = models.len() < data.len();
    Ok((models, partial))
}

struct RequestError {
    message: String,
    status: Option<u16>,
}

async fn get_json(
    url: Url,
    key: &str,
    auth: Auth,
    anthropic: bool,
) -> Result<(Value, u16), RequestError> {
    let mut request = HTTP.get(url);
    request = match auth {
        Auth::Bearer => request.bearer_auth(key),
        Auth::XApiKey => request.header("x-api-key", key),
        Auth::None => request,
    };
    if anthropic {
        request = request.header("anthropic-version", "2023-06-01");
    }
    let mut response = request.send().await.map_err(|e| RequestError {
        message: if e.is_timeout() {
            "请求超时（12 秒）"
        } else if e.is_connect() {
            "无法连接，请检查网络、域名和 TLS"
        } else {
            "请求失败，请检查地址和认证设置"
        }
        .into(),
        status: None,
    })?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        let reason = match status {
            401 | 403 => "认证失败或无权限",
            404 | 405 => "接口不支持或路径不存在",
            429 => "请求限流，请稍后重试",
            300..=399 => "接口返回重定向，请直接填写最终地址",
            500..=599 => "服务端错误",
            _ => "请求被拒绝",
        };
        return Err(RequestError {
            message: format!("HTTP {status} · {reason}"),
            status: Some(status),
        });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| RequestError {
        message: "读取响应失败或超时".into(),
        status: Some(status),
    })? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(RequestError {
                message: "响应超过 2 MB，请缩小查询范围".into(),
                status: Some(status),
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes).map_err(|_| RequestError {
        message: "接口未返回合法 JSON".into(),
        status: Some(status),
    })?;
    Ok((body, status))
}

pub async fn inspect(provider: crate::data::Provider, anthropic: bool, task: Task) -> ProbeResult {
    let _slot = SLOTS.acquire().await.expect("inspection semaphore");
    let start = Instant::now();
    let mut result = ProbeResult::new();
    if task == Task::Quota && provider.inspection.quota.adapter == Adapter::None {
        result.status = "skipped".into();
        result.message = "未配置额度查询，已跳过".into();
        return result;
    }
    let settings = &provider.inspection;
    let (path, leaf, auth) = if task == Task::Quota {
        (&settings.quota.path, "usages", settings.quota.auth)
    } else {
        (&settings.models_path, "models", settings.models_auth)
    };
    let mut url = match endpoint(&provider.url, path, leaf) {
        Ok(url) => url,
        Err(e) => {
            result.status = "error".into();
            result.message = e;
            return result;
        }
    };
    let mut seen_ids = HashSet::new();
    let mut cursors = HashSet::new();
    // Anthropic 用 after_id 分页；其他兼容接口不猜测分页协议。
    for page in 0..5 {
        let (body, status) = match get_json(
            url.clone(),
            &provider.key,
            auth,
            anthropic && task != Task::Quota,
        )
        .await
        {
            Ok(value) => value,
            Err(e) => {
                result.status = if result.models.is_empty() {
                    "error"
                } else {
                    "partial"
                }
                .into();
                result.message = e.message;
                result.http_status = e.status;
                break;
            }
        };
        result.http_status = Some(status);
        if task == Task::Quota {
            match parse_quota(&body, &settings.quota) {
                Ok((quota, partial)) => {
                    result.quota = Some(quota);
                    result.status = if partial { "partial" } else { "ok" }.into();
                    result.message = if partial {
                        "部分额度字段缺失，已展示可用数据"
                    } else {
                        "额度已更新"
                    }
                    .into();
                }
                Err(e) => {
                    result.status = "error".into();
                    result.message = e;
                }
            }
            break;
        }
        match parse_models(&body) {
            Ok((models, partial)) => {
                if partial {
                    result.status = "partial".into();
                }
                if task == Task::Models {
                    for model in models {
                        if seen_ids.insert(model.id.clone()) {
                            result.models.push(model);
                        }
                    }
                }
            }
            Err(e) => {
                result.status = if result.models.is_empty() {
                    "error"
                } else {
                    "partial"
                }
                .into();
                result.message = e;
                break;
            }
        }
        if task == Task::Connection {
            result.message = "模型接口可达并返回 JSON；尚未验证模型生成能力".into();
            break;
        }
        result.message = if result.status == "partial" {
            "已获取模型，部分条目缺少 ID"
        } else {
            "已获取模型列表；列表不保证每个模型都能调用"
        }
        .into();
        if body.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
        if !anthropic || page == 4 {
            result.status = "partial".into();
            result.message = "已保留当前模型；接口仍有更多分页".into();
            break;
        }
        let cursor = body
            .get("last_id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        let Some(cursor) = cursor else {
            result.status = "partial".into();
            result.message = "分页游标缺失，已保留当前模型".into();
            break;
        };
        if !cursors.insert(cursor.to_string()) {
            result.status = "partial".into();
            result.message = "分页游标重复，已保留当前模型".into();
            break;
        }
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(k, _)| k != "after_id")
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        url.set_query(None);
        url.query_pairs_mut()
            .extend_pairs(pairs)
            .append_pair("after_id", cursor);
    }
    result.latency_ms = start.elapsed().as_millis() as u64;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn urls_preserve_prefix_and_reject_cross_origin_credentials() {
        assert_eq!(
            endpoint("https://api.example/coding/v1", "", "models")
                .unwrap()
                .as_str(),
            "https://api.example/coding/v1/models"
        );
        assert_eq!(
            endpoint("https://api.example/coding/", "", "usages")
                .unwrap()
                .as_str(),
            "https://api.example/coding/v1/usages"
        );
        assert_eq!(
            endpoint("https://api.example/v1", "/account/usage", "usages")
                .unwrap()
                .as_str(),
            "https://api.example/account/usage"
        );
        assert!(endpoint("https://api.example", "//other.example/usage", "usages").is_err());
        assert!(endpoint("https://user:secret@api.example", "", "models").is_err());
    }

    #[test]
    fn kimi_missing_values_are_not_zero() {
        let config = QuotaSettings {
            adapter: Adapter::Kimi,
            ..Default::default()
        };
        let (q, partial) = parse_quota(&json!({"usage":{"remaining":"0","limit":"100"}, "limits":[{"window":{"duration":"300","timeUnit":"TIME_UNIT_MINUTE"},"detail":{"used":"2","limit":10,"remaining":8}}]}), &config).unwrap();
        assert!(partial);
        assert_eq!(q.windows[0].remaining, Some(0.0));
        assert_eq!(q.windows[0].used, None);
        assert_eq!(q.windows[1].remaining, Some(8.0));
        assert!(parse_quota(&json!({}), &config).is_err());
    }

    #[test]
    fn custom_quota_preserves_partial_fields_and_negative_balance() {
        let config = QuotaSettings {
            adapter: Adapter::Custom,
            balance_pointer: "/data/balance".into(),
            remaining_pointer: "/data/remaining".into(),
            ..Default::default()
        };
        let (q, partial) = parse_quota(&json!({"data":{"balance":"-1.25"}}), &config).unwrap();
        assert_eq!(q.balance, Some(-1.25));
        assert!(partial);
        assert!(parse_quota(&json!({"data":{"balance":"NaN"}}), &config).is_err());
    }

    #[test]
    fn models_accept_empty_but_reject_wrong_schema() {
        assert_eq!(parse_models(&json!({"data":[]})).unwrap(), (vec![], false));
        assert!(parse_models(&json!({"error":"bad key"})).is_err());
        let (m, partial) = parse_models(&json!({"data":[{"id":"m1"},{"name":"missing"}]})).unwrap();
        assert_eq!(m[0].id, "m1");
        assert!(partial);
    }

    fn mock_server(
        responses: Vec<(u16, String, String)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut requests = vec![];
            for (status, body, headers) in responses {
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((s, _)) => break s,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(10))
                        }
                        Err(e) => panic!("mock server: {e}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = vec![];
                let mut buffer = [0; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buffer).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..n]);
                }
                requests.push(String::from_utf8(request).unwrap());
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (url, handle)
    }

    fn provider(url: String) -> crate::data::Provider {
        crate::data::Provider {
            name: "fixture".into(),
            url,
            key: "fixture-token".into(),
            inspection: Default::default(),
        }
    }

    #[tokio::test]
    async fn http_connection_uses_get_and_correct_auth_without_generation() {
        let (url, server) = mock_server(vec![(200, r#"{"data":[]}"#.into(), String::new())]);
        let result = inspect(provider(url), false, Task::Connection).await;
        assert_eq!(result.status, "ok");
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /v1/models "));
        assert!(requests[0]
            .to_lowercase()
            .contains("authorization: bearer fixture-token"));
    }

    #[tokio::test]
    async fn anthropic_pagination_retains_partial_models_when_later_page_fails() {
        let (url, server) = mock_server(vec![
            (
                200,
                r#"{"data":[{"id":"model-1"}],"has_more":true,"last_id":"model-1"}"#.into(),
                String::new(),
            ),
            (429, r#"{"error":"fixture-token"}"#.into(), String::new()),
        ]);
        let mut p = provider(url);
        p.inspection.models_auth = Auth::XApiKey;
        let result = inspect(p, true, Task::Models).await;
        assert_eq!(result.status, "partial");
        assert_eq!(result.models[0].id, "model-1");
        assert!(!result.message.contains("fixture-token"));
        let requests = server.join().unwrap();
        assert!(requests[1].starts_with("GET /v1/models?after_id=model-1 "));
        assert!(requests[0]
            .to_lowercase()
            .contains("x-api-key: fixture-token"));
        assert!(requests[0]
            .to_lowercase()
            .contains("anthropic-version: 2023-06-01"));
    }

    #[tokio::test]
    async fn redirect_and_auth_errors_are_sanitized() {
        for (status, headers) in [
            (401, String::new()),
            (302, "Location: http://127.0.0.1:1/stolen\r\n".into()),
        ] {
            let (url, server) = mock_server(vec![(
                status,
                r#"{"error":"fixture-token"}"#.into(),
                headers,
            )]);
            let result = inspect(provider(url), false, Task::Connection).await;
            assert_eq!(result.status, "error");
            assert_eq!(result.http_status, Some(status));
            assert!(!result.message.contains("fixture-token"));
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn quota_can_be_skipped_or_partially_returned_independently() {
        let result = inspect(provider("http://127.0.0.1:1".into()), false, Task::Quota).await;
        assert_eq!(result.status, "skipped");
        let (url, server) = mock_server(vec![(
            200,
            r#"{"usage":{"remaining":"30"}}"#.into(),
            String::new(),
        )]);
        let mut p = provider(format!("{url}/coding"));
        p.inspection.quota.adapter = Adapter::Kimi;
        let result = inspect(p, true, Task::Quota).await;
        assert_eq!(result.status, "partial");
        assert_eq!(result.quota.unwrap().windows[0].remaining, Some(30.0));
        assert!(server.join().unwrap()[0].starts_with("GET /coding/v1/usages "));
    }
}
