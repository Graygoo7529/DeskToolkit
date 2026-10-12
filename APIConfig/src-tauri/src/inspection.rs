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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct InspectionSettings {
    /// 空值自动补齐版本前缀；以 / 开头则相对于域名，否则相对于 Base URL。
    pub models_path: String,
    pub models_auth: Auth,
    pub quota: crate::quota::Settings,
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
    pub id: String,
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
    Ok(())
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

async fn post_json(url: Url, key: &str, body: Value) -> Result<(Value, u16), RequestError> {
    let mut response = HTTP
        .post(url)
        .bearer_auth(key)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| RequestError {
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

pub async fn probe_openai_model(url: &str, key: &str, model: &str) -> ProbeResult {
    let _slot = SLOTS.acquire().await.expect("inspection semaphore");
    let start = Instant::now();
    let mut result = ProbeResult::new();
    let endpoint = match endpoint(url, "", "chat/completions") {
        Ok(value) => value,
        Err(error) => {
            result.status = "error".into();
            result.message = error;
            return result;
        }
    };
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}]
    });
    let response = HTTP
        .post(endpoint)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status().as_u16();
            result.http_status = Some(status);
            if response.status().is_success() {
                result.status = "ok".into();
                result.message = format!("OpenAI 兼容接口可用 · {model}");
            } else {
                result.status = "error".into();
                result.message = format!(
                    "HTTP {status} · {}",
                    match status {
                        401 | 403 => "认证失败或无权限",
                        404 | 405 => "模型或接口不存在",
                        429 => "请求限流，请稍后重试",
                        500..=599 => "服务端错误",
                        _ => "请求被拒绝",
                    }
                );
            }
        }
        Err(error) => {
            result.status = "error".into();
            result.message = if error.is_timeout() {
                "请求超时（12 秒）"
            } else if error.is_connect() {
                "无法连接，请检查网络、域名和 TLS"
            } else {
                "请求失败，请检查地址和认证设置"
            }
            .into();
        }
    }
    result.latency_ms = start.elapsed().as_millis() as u64;
    result
}

/// Anthropic 兼容接口通常没有 GET /models，使用最多 1 个输出 token 做可用性探测。
pub async fn probe_anthropic(url: &str, key: &str, model: &str) -> ProbeResult {
    let _slot = SLOTS.acquire().await.expect("inspection semaphore");
    let start = Instant::now();
    let mut result = ProbeResult::new();
    let endpoint = match endpoint(url, "", "messages") {
        Ok(value) => value,
        Err(error) => {
            result.status = "error".into();
            result.message = error;
            return result;
        }
    };
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}]
    });
    match post_json(endpoint, key, body).await {
        Ok((_body, status)) => {
            result.http_status = Some(status);
            result.status = "ok".into();
            result.message = format!("Anthropic 消息通道可用 · {model}");
        }
        Err(error) => {
            result.status = "error".into();
            result.message = error.message;
            result.http_status = error.status;
        }
    }
    result.latency_ms = start.elapsed().as_millis() as u64;
    result
}

pub async fn inspect_models(
    provider: crate::data::Provider,
    anthropic: bool,
    connection_only: bool,
) -> ProbeResult {
    let _slot = SLOTS.acquire().await.expect("inspection semaphore");
    let start = Instant::now();
    let mut result = ProbeResult::new();
    let settings = &provider.inspection;
    let (path, leaf, auth) = (&settings.models_path, "models", settings.models_auth);
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
        let (body, status) = match get_json(url.clone(), &provider.key, auth, anthropic).await {
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
        match parse_models(&body) {
            Ok((models, partial)) => {
                if partial {
                    result.status = "partial".into();
                }
                if !connection_only {
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
        if connection_only {
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
            color: String::new(),
            name: "fixture".into(),
            url,
            key: "fixture-token".into(),
            inspection: Default::default(),
        }
    }

    #[tokio::test]
    async fn http_connection_uses_get_and_correct_auth_without_generation() {
        let (url, server) = mock_server(vec![(200, r#"{"data":[]}"#.into(), String::new())]);
        let result = inspect_models(provider(url), false, true).await;
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
        let result = inspect_models(p, true, false).await;
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
            let result = inspect_models(provider(url), false, true).await;
            assert_eq!(result.status, "error");
            assert_eq!(result.http_status, Some(status));
            assert!(!result.message.contains("fixture-token"));
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }
}
