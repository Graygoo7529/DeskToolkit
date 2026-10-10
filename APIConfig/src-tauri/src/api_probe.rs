//! API account protocols, model discovery and quota adapters.
//! Credentials stay in the data layer; this module only returns masked-safe probe results.
use crate::{data, inspection};
use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    #[default]
    Openai,
    OpenaiResponses,
    Anthropic,
    Genai,
    Vertexai,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEndpoint {
    pub protocol: Protocol,
    pub url: String,
    #[serde(default)]
    pub auth: inspection::Auth,
}
impl ApiEndpoint {
    pub fn new(protocol: Protocol, url: &str) -> Self {
        Self {
            protocol,
            url: url.trim().into(),
            auth: if protocol == Protocol::Anthropic {
                inspection::Auth::XApiKey
            } else if matches!(protocol, Protocol::Genai | Protocol::Vertexai) {
                inspection::Auth::XApiKey
            } else {
                inspection::Auth::Bearer
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuotaAdapter {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "quota_kimi", alias = "kimi")]
    Kimi,
    #[serde(rename = "balance_deepseek", alias = "deepseek")]
    Deepseek,
    #[serde(rename = "balance_moonshot", alias = "moonshot")]
    Moonshot,
    #[serde(rename = "balance_zhizz", alias = "zhizz")]
    Zhizz,
    #[serde(rename = "quota_sub2api", alias = "sub2api")]
    Sub2api,
    #[serde(rename = "quota_minimax", alias = "minimax")]
    Minimax,
    #[serde(rename = "balance_custom", alias = "custom")]
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ApiQuotaSettings {
    #[serde(default)]
    pub profile: String,
    #[serde(default, skip_serializing)]
    pub adapter: QuotaAdapter,
    #[serde(skip_serializing)]
    pub path: String,
    #[serde(skip_serializing)]
    pub auth: inspection::Auth,
    #[serde(skip_serializing)]
    pub balance_pointer: String,
    #[serde(skip_serializing)]
    pub used_pointer: String,
    #[serde(skip_serializing)]
    pub limit_pointer: String,
    #[serde(skip_serializing)]
    pub remaining_pointer: String,
    #[serde(skip_serializing)]
    pub reset_pointer: String,
    #[serde(skip_serializing)]
    pub unit: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProtocolModels {
    pub protocol: Protocol,
    pub result: inspection::ProbeResult,
}

static HTTP: std::sync::LazyLock<Client> = std::sync::LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("APIConfig/0.2")
        .build()
        .expect("APIConfig HTTP client")
});

pub fn protocol_name(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Openai => "openai",
        Protocol::OpenaiResponses => "openai_responses",
        Protocol::Anthropic => "anthropic",
        Protocol::Genai => "genai",
        Protocol::Vertexai => "vertexai",
    }
}
pub fn parse_protocol(value: &str) -> Option<Protocol> {
    match value {
        "openai" => Some(Protocol::Openai),
        "openai_responses" => Some(Protocol::OpenaiResponses),
        "anthropic" => Some(Protocol::Anthropic),
        "genai" => Some(Protocol::Genai),
        "vertexai" => Some(Protocol::Vertexai),
        _ => None,
    }
}

pub fn validate_account(account: &data::ApiAccount) -> Result<(), String> {
    if account.name.trim().is_empty() || account.key.trim().is_empty() {
        return Err("API 配置中有空名称或 API Key".into());
    }
    if account.endpoints.is_empty() {
        return Err("API 至少需要配置一个接口协议".into());
    }
    for endpoint in &account.endpoints {
        let url = Url::parse(endpoint.url.trim()).map_err(|_| "API 接口地址无效")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("API 接口地址需为不含查询参数的 HTTP(S) 地址".into());
        }
    }
    Ok(())
}

fn result(
    status: &str,
    message: impl Into<String>,
    status_code: Option<u16>,
    start: Instant,
) -> inspection::ProbeResult {
    inspection::ProbeResult {
        status: status.into(),
        message: message.into(),
        checked_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        latency_ms: start.elapsed().as_millis() as u64,
        http_status: status_code,
        models: vec![],
        quota: None,
    }
}
fn endpoint(base: &str, leaf: &str) -> Result<Url, String> {
    inspection::endpoint(base, "", leaf)
}

async fn get_json(
    url: Url,
    key: &str,
    auth: inspection::Auth,
    api_key_header: Option<&str>,
) -> Result<(Value, u16), String> {
    let mut request = HTTP.get(url);
    request = if let Some(header) = api_key_header {
        request.header(header, key)
    } else {
        match auth {
            inspection::Auth::Bearer => request.bearer_auth(key),
            inspection::Auth::XApiKey => request.header("x-api-key", key),
            inspection::Auth::None => request,
        }
    };
    let response = request
        .send()
        .await
        .map_err(|_| "请求失败，请检查网络、地址和认证设置")?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {status} · {}",
            if matches!(status, 401 | 403) {
                "认证失败或无权限"
            } else if status == 404 {
                "接口路径不存在"
            } else if status == 429 {
                "请求限流"
            } else {
                "请求被拒绝"
            }
        ));
    }
    let body = response
        .json::<Value>()
        .await
        .map_err(|_| "接口未返回合法 JSON")?;
    Ok((body, status))
}

fn with_auth(mut request: RequestBuilder, key: &str, auth: inspection::Auth) -> RequestBuilder {
    request = match auth {
        inspection::Auth::Bearer => request.bearer_auth(key),
        inspection::Auth::XApiKey => request.header("x-api-key", key),
        inspection::Auth::None => request,
    };
    request
}

fn generic_models(body: &Value) -> Vec<inspection::Model> {
    let array = body
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| body.get("models").and_then(Value::as_array))
        .or_else(|| body.get("publisherModels").and_then(Value::as_array));
    array
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let raw = item
                .get("id")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)?
                .trim();
            if raw.is_empty() {
                return None;
            }
            Some(inspection::Model {
                id: raw.strip_prefix("models/").unwrap_or(raw).to_string(),
                name: item
                    .get("display_name")
                    .or_else(|| item.get("displayName"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

pub async fn discover(endpoint_config: &ApiEndpoint, key: &str) -> inspection::ProbeResult {
    let start = Instant::now();
    match endpoint_config.protocol {
        Protocol::Openai | Protocol::OpenaiResponses => {
            let mut settings = inspection::InspectionSettings::default();
            settings.models_auth = endpoint_config.auth;
            let provider = data::Provider {
                name: "probe".into(),
                url: endpoint_config.url.clone(),
                key: key.into(),
                color: String::new(),
                inspection: settings,
            };
            inspection::inspect(provider, false, inspection::Task::Models).await
        }
        Protocol::Anthropic => {
            let mut settings = inspection::InspectionSettings::default();
            settings.models_auth = endpoint_config.auth;
            let provider = data::Provider {
                name: "probe".into(),
                url: endpoint_config.url.clone(),
                key: key.into(),
                color: String::new(),
                inspection: settings,
            };
            inspection::inspect(provider, true, inspection::Task::Models).await
        }
        Protocol::Genai | Protocol::Vertexai => match direct_leaf(&endpoint_config.url, "models") {
            Ok(url) => {
                let header = (endpoint_config.protocol == Protocol::Genai
                    || endpoint_config.protocol == Protocol::Vertexai)
                    .then_some("x-goog-api-key")
                    .filter(|_| endpoint_config.auth == inspection::Auth::XApiKey);
                match get_json(url, key, endpoint_config.auth, header).await {
                    Ok((body, status)) => {
                        let models = generic_models(&body);
                        let partial = models.is_empty()
                            && (body.get("models").is_some()
                                || body.get("publisherModels").is_some());
                        let mut r = result(
                            if partial { "partial" } else { "ok" },
                            if models.is_empty() {
                                "接口返回了模型结构，但没有可展示的模型"
                            } else {
                                "已获取模型列表"
                            },
                            Some(status),
                            start,
                        );
                        r.models = models;
                        r
                    }
                    Err(error) => result("error", error, None, start),
                }
            }
            Err(error) => result("error", error, None, start),
        },
    }
}

fn direct_leaf(base: &str, leaf: &str) -> Result<Url, String> {
    let mut url = Url::parse(base).map_err(|_| "接口地址无效")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("接口地址无效".into());
    }
    url.set_path(&format!("{}/{}", url.path().trim_end_matches('/'), leaf));
    Ok(url)
}

fn json_number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(|v| v.as_f64().or_else(|| v.as_str()?.parse().ok()))
        .filter(|v: &f64| v.is_finite())
}

fn json_text(value: Option<&Value>) -> Option<String> {
    value.and_then(|v| {
        v.as_str()
            .map(str::to_string)
            .or_else(|| v.as_i64().map(|n| n.to_string()))
            .or_else(|| v.as_u64().map(|n| n.to_string()))
            .or_else(|| v.as_f64().map(|n| n.to_string()))
    })
}

fn pointer<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.trim().is_empty() {
        Some(value)
    } else {
        value.pointer(path)
    }
}

fn query_url(base: &str, path: &str) -> Result<Url, String> {
    let base =
        Url::parse(&format!("{}/", base.trim_end_matches('/'))).map_err(|_| "额度查询地址无效")?;
    if !matches!(base.scheme(), "http" | "https")
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("额度查询地址无效".into());
    }
    if path.trim().is_empty() {
        return Err("额度查询路径不能为空".into());
    }
    if path.contains("://") || path.starts_with("//") || path.contains('\\') {
        return Err("额度查询路径必须与账号地址同源".into());
    }
    let url = base.join(path).map_err(|_| "额度查询路径无效")?;
    if url.origin() != base.origin() || url.fragment().is_some() {
        return Err("额度查询路径必须与账号地址同源".into());
    }
    Ok(url)
}

async fn request_json(
    url: Url,
    key: &str,
    method: &str,
    auth: inspection::Auth,
) -> Result<(Value, u16), String> {
    let request = match method.to_ascii_uppercase().as_str() {
        "POST" => HTTP
            .post(url)
            .header("content-type", "application/json")
            .json(&serde_json::json!({})),
        _ => HTTP.get(url),
    };
    let response = with_auth(request, key, auth)
        .send()
        .await
        .map_err(|_| "请求失败，请检查网络、地址和认证设置")?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {status} · {}",
            if matches!(status, 401 | 403) {
                "认证失败或无权限"
            } else if status == 404 {
                "接口路径不存在"
            } else if status == 429 {
                "请求限流"
            } else {
                "请求被拒绝"
            }
        ));
    }
    let bytes = response.bytes().await.map_err(|_| "无法读取接口响应")?;
    let body = parse_json_payload(&bytes)?;
    Ok((body, status))
}

fn parse_json_payload(bytes: &[u8]) -> Result<Value, String> {
    let text = String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string();
    if let Ok(value) = serde_json::from_str::<Value>(&text) {
        return Ok(value);
    }
    if text.starts_with('<') {
        return Err("额度接口返回了网页，请检查查询路径".into());
    }
    Err("额度接口未返回合法 JSON，请检查查询路径".into())
}

fn matches_definition(value: &Value, path: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return true;
    }
    let actual = json_text(pointer(value, path));
    actual.as_deref() == Some(expected)
}

fn definition_number(value: &Value, path: &str) -> Option<f64> {
    json_number(pointer(value, path))
}

fn parse_definition(
    body: &Value,
    definition: &crate::api_definitions::AdapterDefinition,
) -> (inspection::Quota, bool) {
    let read_number = |value: &Value, path: &str| {
        if path.is_empty() {
            None
        } else {
            definition_number(value, path)
        }
    };
    let read_text = |value: &Value, path: &str| {
        if path.is_empty() {
            None
        } else {
            json_text(pointer(value, path))
        }
    };
    let selected = if definition.array_pointer.is_empty() {
        Some(body)
    } else {
        pointer(body, &definition.array_pointer)
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    matches_definition(item, &definition.match_pointer, &definition.match_value)
                })
            })
    };
    let mut quota = inspection::Quota {
        balance: read_number(body, &definition.balance_pointer)
            .or_else(|| read_number(body, &definition.fallback_balance_pointer)),
        unit: read_text(body, &definition.unit_pointer)
            .unwrap_or_else(|| definition.default_unit.clone()),
        membership: read_text(body, &definition.membership_pointer),
        ..Default::default()
    };
    let mut partial = !definition.balance_pointer.is_empty() && quota.balance.is_none();
    // One declared mapping produces one stable output slot. Missing response
    // data never adds, removes, renames or changes a presentation component.
    for window in &definition.windows {
        let source = if window.array_pointer.is_empty() {
            selected
        } else {
            pointer(body, &window.array_pointer)
                .and_then(Value::as_array)
                .and_then(|items| {
                    items.iter().find(|item| {
                        matches_definition(item, &window.match_pointer, &window.match_value)
                    })
                })
        };
        let item = source
            .and_then(|value| pointer(value, &window.scope_pointer))
            .and_then(|value| pointer(value, &window.item_pointer));
        let read = |path: &str| item.and_then(|value| read_number(value, path));
        let mut used = read(&window.used_pointer);
        let mut limit = read(&window.limit_pointer).or(window.limit_value);
        let mut remaining = read(&window.remaining_pointer);
        if limit.is_none() {
            limit = used
                .zip(remaining)
                .map(|(used, remaining)| used + remaining);
        }
        if remaining.is_none() {
            remaining = limit.zip(used).map(|(limit, used)| limit - used);
        }
        if used.is_none() {
            used = limit
                .zip(remaining)
                .map(|(limit, remaining)| limit - remaining);
        }
        if window.required && (used.is_none() || limit.is_none() || remaining.is_none()) {
            partial = true;
        }
        quota.windows.push(inspection::QuotaWindow {
            id: window.id.clone(),
            name: window.label.clone(),
            used,
            limit,
            remaining,
            reset_at: item.and_then(|value| read_text(value, &window.reset_pointer)),
        });
    }
    let has_values = quota.balance.is_some()
        || quota
            .windows
            .iter()
            .any(|window| window.used.is_some() || window.remaining.is_some());
    (quota, partial || !has_values)
}

pub async fn quota(
    account: &data::ApiAccount,
    registry: &crate::api_definitions::Registry,
) -> inspection::ProbeResult {
    let start = Instant::now();
    let Some(ep) = account.endpoints.first() else {
        return result("skipped", "未配置查询接口", None, start);
    };
    let q = &account.quota;
    let profile = q.profile.trim();
    if profile.is_empty() || profile == "none" {
        return result("skipped", "未配置额度查询适配器", None, start);
    }
    let Some(definition) = registry.adapter(profile) else {
        return result("error", "额度适配器定义不存在", None, start);
    };
    let path = definition.request_path.clone();
    let auth = crate::api_definitions::auth(&definition.request_auth);
    let url = match query_url(&ep.url, &path) {
        Ok(url) => url,
        Err(error) => return result("error", error, None, start),
    };
    match request_json(url, &account.key, &definition.request_method, auth).await {
        Ok((body, status)) => {
            let (quota, partial) = parse_definition(&body, &definition);
            let mut r = result(
                if partial { "partial" } else { "ok" },
                if partial {
                    "部分额度字段缺失，未返回的字段显示为 —"
                } else {
                    "额度已更新"
                },
                Some(status),
                start,
            );
            r.quota = Some(quota);
            r
        }
        Err(error) => result("error", error, None, start),
    }
}

pub async fn check(
    endpoint_config: &ApiEndpoint,
    key: &str,
    model: &str,
) -> inspection::ProbeResult {
    match endpoint_config.protocol {
        Protocol::Openai => inspection::probe_openai_model(&endpoint_config.url, key, model).await,
        Protocol::Anthropic => inspection::probe_anthropic(&endpoint_config.url, key, model).await,
        Protocol::OpenaiResponses => check_responses(endpoint_config, key, model).await,
        Protocol::Genai | Protocol::Vertexai => check_genai(endpoint_config, key, model).await,
    }
}
async fn check_responses(ep: &ApiEndpoint, key: &str, model: &str) -> inspection::ProbeResult {
    let start = Instant::now();
    let Ok(url) = endpoint(&ep.url, "responses") else {
        return result("error", "Responses 地址无效", None, start);
    };
    let response = HTTP
        .post(url)
        .bearer_auth(key)
        .json(
            &serde_json::json!({"model":model,"input":"ping","max_output_tokens":1,"store":false}),
        )
        .send()
        .await;
    match response {
        Ok(r) => {
            let s = r.status().as_u16();
            result(
                if r.status().is_success() {
                    "ok"
                } else {
                    "error"
                },
                format!("HTTP {s} · OpenAI Responses"),
                Some(s),
                start,
            )
        }
        Err(_) => result("error", "请求失败，请检查网络和接口地址", None, start),
    }
}
async fn check_genai(ep: &ApiEndpoint, key: &str, model: &str) -> inspection::ProbeResult {
    let start = Instant::now();
    let Ok(mut url) = Url::parse(ep.url.trim_end_matches('/')) else {
        return result("error", "GenAI 地址无效", None, start);
    };
    let path = format!(
        "{}/models/{}:generateContent",
        url.path().trim_end_matches('/'),
        model.trim_start_matches("models/")
    );
    url.set_path(&path);
    let mut request = HTTP.post(url);
    request = match ep.auth {
        inspection::Auth::Bearer => request.bearer_auth(key),
        inspection::Auth::XApiKey => request.header("x-goog-api-key", key),
        inspection::Auth::None => request,
    };
    let response = request
        .json(&serde_json::json!({"contents":[{"parts":[{"text":"ping"}]}],"generationConfig":{"maxOutputTokens":1}}))
        .send()
        .await;
    match response {
        Ok(r) => {
            let s = r.status().as_u16();
            result(
                if r.status().is_success() {
                    "ok"
                } else {
                    "error"
                },
                format!("HTTP {s} · {:?}", ep.protocol),
                Some(s),
                start,
            )
        }
        Err(_) => result("error", "请求失败，请检查网络和接口地址", None, start),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn subscription_definition_ignores_balance_and_undeclared_periods() {
        let body = json!({
            "planName": "Claude Lite",
            "unit": "USD",
            "remaining": 49.9,
            "balance": 999,
            "mode": "unrestricted",
            "subscription": {
                "daily_usage_usd": 0.1,
                "daily_limit_usd": 50,
                "weekly_limit_usd": 0,
                "weekly_usage_usd": 26.9,
                "monthly_limit_usd": 0,
                "monthly_usage_usd": 239.7
            }
        });
        let definition = crate::api_definitions::source_registry_for_tests()
            .adapter("quota_sub2api")
            .unwrap();
        let (quota, partial) = parse_definition(&body, &definition);
        assert!(!partial);
        assert_eq!(quota.membership.as_deref(), Some("Claude Lite"));
        assert_eq!(quota.windows[0].remaining, Some(49.9));
        assert_eq!(quota.windows[0].id, "daily");
        assert_eq!(quota.balance, None);
        assert_eq!(quota.windows.len(), 1);
        assert_eq!(quota.windows[0].reset_at, None);
    }

    #[test]
    fn toml_minimax_definition_selects_general_model() {
        let body = json!({
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 72,
                "current_weekly_remaining_percent": 58,
                "end_time": "2026-10-10T00:00:00Z",
                "weekly_end_time": "2026-10-12T00:00:00Z"
            }]
        });
        let definition = crate::api_definitions::source_registry_for_tests()
            .adapter("quota_minimax")
            .unwrap();
        let (quota, _) = parse_definition(&body, &definition);
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[0].remaining, Some(72.0));
    }

    #[test]
    fn toml_kimi_definition_marks_missing_required_window_partial() {
        let body = json!({
            "usage": { "used": 2, "limit": 10, "remaining": 8 }
        });
        let definition = crate::api_definitions::source_registry_for_tests()
            .adapter("quota_kimi")
            .unwrap();
        let (quota, partial) = parse_definition(&body, &definition);
        assert!(partial);
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[1].remaining, None);
    }

    #[test]
    fn quota_json_accepts_bom_and_reports_webpage() {
        assert_eq!(
            parse_json_payload("\u{feff}{\"balance\":12}".as_bytes()).unwrap()["balance"],
            12
        );
        assert!(parse_json_payload(b"<html>login</html>")
            .unwrap_err()
            .contains("网页"));
    }

    #[test]
    fn sub2api_path_is_rooted_at_v1() {
        assert_eq!(
            query_url("https://relay.example/anthropic", "/v1/usage")
                .unwrap()
                .as_str(),
            "https://relay.example/v1/usage"
        );
        assert!(query_url("https://relay.example/v1", "//other.example/usage").is_err());
        assert!(query_url("https://relay.example/v1", "https://other.example/usage").is_err());
        assert_eq!(
            query_url("https://relay.example/v1", "usage")
                .unwrap()
                .as_str(),
            "https://relay.example/v1/usage"
        );
    }
}
