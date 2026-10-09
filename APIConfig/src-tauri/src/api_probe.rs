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
    None,
    Kimi,
    Deepseek,
    Moonshot,
    Zhizz,
    Sub2api,
    Minimax,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ApiQuotaSettings {
    pub adapter: QuotaAdapter,
    pub path: String,
    pub auth: inspection::Auth,
    pub balance_pointer: String,
    pub used_pointer: String,
    pub limit_pointer: String,
    pub remaining_pointer: String,
    pub reset_pointer: String,
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

fn with_auth(
    mut request: RequestBuilder,
    key: &str,
    auth: inspection::Auth,
) -> RequestBuilder {
    request = match auth {
        inspection::Auth::Bearer => request.bearer_auth(key),
        inspection::Auth::XApiKey => request.header("x-api-key", key),
        inspection::Auth::None => request,
    };
    request
}

async fn post_json(
    url: Url,
    key: &str,
    auth: inspection::Auth,
) -> Result<(Value, u16), String> {
    let response = with_auth(HTTP.post(url), key, auth)
        .header("content-type", "application/json")
        .json(&serde_json::json!({}))
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

fn sub2api_window(
    quota: &mut inspection::Quota,
    name: &str,
    value: &Value,
    used_key: &str,
    limit_key: &str,
    remaining_key: &str,
    reset_key: &str,
) {
    let used = json_number(value.get(used_key));
    let limit = json_number(value.get(limit_key));
    let remaining = json_number(value.get(remaining_key)).or_else(|| match (used, limit) {
        (Some(used), Some(limit)) => Some(limit - used),
        _ => None,
    });
    if limit.is_some_and(|limit| limit <= 0.0) && remaining.is_some_and(|remaining| remaining <= 0.0) {
        return;
    }
    if used.is_none() && limit.is_none() && remaining.is_none() {
        return;
    }
    quota.windows.push(inspection::QuotaWindow {
        name: name.into(),
        used,
        limit,
        remaining,
        reset_at: json_text(value.get(reset_key)),
    });
}

fn parse_sub2api(body: &Value) -> Result<(inspection::Quota, bool), String> {
    let mut quota = inspection::Quota {
        unit: body
            .get("unit")
            .and_then(Value::as_str)
            .unwrap_or("USD")
            .into(),
        membership: body
            .get("planName")
            .and_then(Value::as_str)
            .map(str::to_string),
        ..Default::default()
    };
    if let Some(subscription) = body.get("subscription") {
        sub2api_window(
            &mut quota,
            "日额度",
            subscription,
            "daily_usage_usd",
            "daily_limit_usd",
            "daily_remaining_usd",
            "daily_window_start",
        );
        sub2api_window(
            &mut quota,
            "周额度",
            subscription,
            "weekly_usage_usd",
            "weekly_limit_usd",
            "weekly_remaining_usd",
            "weekly_window_start",
        );
        sub2api_window(
            &mut quota,
            "月额度",
            subscription,
            "monthly_usage_usd",
            "monthly_limit_usd",
            "monthly_remaining_usd",
            "monthly_window_start",
        );
        if let Some(window) = quota.windows.iter_mut().find(|w| w.reset_at.is_none()) {
            window.reset_at = json_text(subscription.get("expires_at"));
        }
    }
    if let Some(limited) = body.get("quota") {
        sub2api_window(
            &mut quota,
            "API Key 配额",
            limited,
            "used",
            "limit",
            "remaining",
            "reset_at",
        );
    }
    if let Some(rate_limits) = body.get("rate_limits").and_then(Value::as_array) {
        for item in rate_limits {
            let name = item
                .get("window")
                .and_then(Value::as_str)
                .unwrap_or("速率窗口");
            sub2api_window(
                &mut quota,
                name,
                item,
                "used",
                "limit",
                "remaining",
                "reset_at",
            );
        }
    }
    if quota.windows.is_empty() {
        quota.balance = json_number(body.get("remaining")).or_else(|| json_number(body.get("balance")));
    }
    let recognized = body.get("isValid").is_some()
        || body.get("mode").is_some()
        || body.get("subscription").is_some()
        || body.get("quota").is_some()
        || body.get("rate_limits").is_some();
    if !recognized || (quota.balance.is_none() && quota.windows.is_empty()) {
        return Err("响应中没有可识别的 Sub2API 额度数值".into());
    }
    Ok((quota, false))
}

fn parse_minimax(body: &Value) -> Result<inspection::Quota, String> {
    let base = body.get("base_resp").unwrap_or(body);
    if json_number(base.get("status_code")).is_some_and(|code| code != 0.0) {
        return Err(
            base.get("status_msg")
                .and_then(Value::as_str)
                .unwrap_or("MiniMax 额度接口返回错误")
                .into(),
        );
    }
    let remains = body
        .get("model_remains")
        .or_else(|| body.get("data").and_then(|v| v.get("model_remains")))
        .and_then(Value::as_array)
        .ok_or("响应中没有 MiniMax Token Plan 额度")?;
    let item = remains
        .iter()
        .find(|item| item.get("model_name").and_then(Value::as_str) == Some("general"))
        .or_else(|| {
            remains.iter().min_by(|left, right| {
                json_number(left.get("current_interval_remaining_percent"))
                    .unwrap_or(101.0)
                    .partial_cmp(
                        &json_number(right.get("current_interval_remaining_percent"))
                            .unwrap_or(101.0),
                    )
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .ok_or("响应中没有 MiniMax Token Plan 额度")?;
    let mut quota = inspection::Quota {
        unit: "%".into(),
        membership: item
            .get("model_name")
            .and_then(Value::as_str)
            .map(str::to_string),
        ..Default::default()
    };
    for (name, remaining_key, reset_key) in [
        ("5 小时窗口", "current_interval_remaining_percent", "end_time"),
        ("周额度", "current_weekly_remaining_percent", "weekly_end_time"),
    ] {
        if let Some(remaining) = json_number(item.get(remaining_key)) {
            quota.windows.push(inspection::QuotaWindow {
                name: name.into(),
                used: Some((100.0 - remaining).max(0.0)),
                limit: Some(100.0),
                remaining: Some(remaining),
                reset_at: json_text(item.get(reset_key)),
            });
        }
    }
    if quota.windows.is_empty() {
        return Err("响应中没有 MiniMax Token Plan 窗口".into());
    }
    Ok(quota)
}
pub async fn quota(account: &data::ApiAccount) -> inspection::ProbeResult {
    let start = Instant::now();
    let endpoint_config = account.endpoints.first();
    let Some(ep) = endpoint_config else {
        return result("skipped", "未配置查询接口", None, start);
    };
    let q = &account.quota;
    if q.adapter == QuotaAdapter::None {
        return result("skipped", "未配置额度查询适配器", None, start);
    }
    let path = if q.path.trim().is_empty() {
        match q.adapter {
            QuotaAdapter::Deepseek => "/user/balance",
            QuotaAdapter::Moonshot => "/users/me/balance",
            QuotaAdapter::Zhizz => "/dashboard/billing/credit_grants",
            QuotaAdapter::Sub2api => "/usage",
            QuotaAdapter::Minimax => "/token_plan/remains",
            _ => "usages",
        }
    } else {
        q.path.as_str()
    };
    let url = if matches!(q.adapter, QuotaAdapter::Zhizz | QuotaAdapter::Sub2api | QuotaAdapter::Minimax) {
        endpoint(&ep.url, path.trim_start_matches('/'))
    } else {
        let base = ep.url.trim_end_matches('/');
        Url::parse(&format!(
            "{base}{}",
            if path.starts_with('/') {
                path.to_string()
            } else {
                format!("/{path}")
            }
        ))
        .map_err(|_| "额度查询地址无效".into())
    };
    let Ok(url) = url else {
        return result("error", "额度查询地址无效", None, start);
    };
    let response = if q.adapter == QuotaAdapter::Zhizz {
        post_json(url, &account.key, q.auth).await
    } else {
        get_json(url, &account.key, q.auth, None).await
    };
    match response {
        Ok((body, status)) => {
            let mut quota = inspection::Quota {
                unit: q.unit.clone(),
                ..Default::default()
            };
            let mut partial = false;
            match q.adapter {
                QuotaAdapter::Deepseek => {
                    let item = body.pointer("/balance_infos/0");
                    quota.balance = json_number(item.and_then(|v| v.get("total_balance")));
                    quota.unit = item
                        .and_then(|v| v.get("currency"))
                        .and_then(Value::as_str)
                        .unwrap_or("CNY")
                        .into();
                }
                QuotaAdapter::Moonshot => {
                    quota.balance = json_number(body.pointer("/data/available_balance"));
                    quota.unit = "CNY".into();
                }
                QuotaAdapter::Zhizz => {
                    quota.balance = json_number(body.pointer("/grants/available_amount"));
                    quota.unit = "credits".into();
                }
                QuotaAdapter::Sub2api => match parse_sub2api(&body) {
                    Ok((parsed, p)) => {
                        quota = parsed;
                        partial = p;
                    }
                    Err(error) => {
                        return result("error", error, Some(status), start);
                    }
                },
                QuotaAdapter::Minimax => match parse_minimax(&body) {
                    Ok(parsed) => quota = parsed,
                    Err(error) => return result("error", error, Some(status), start),
                },
                QuotaAdapter::Kimi => {
                    if let Ok((parsed, p)) = inspection::parse_quota(
                        &body,
                        &inspection::QuotaSettings {
                            adapter: inspection::Adapter::Kimi,
                            ..Default::default()
                        },
                    ) {
                        quota = parsed;
                        partial = p;
                    } else {
                        return result(
                            "error",
                            "响应中没有可识别的 Kimi 额度",
                            Some(status),
                            start,
                        );
                    }
                }
                QuotaAdapter::Custom => {
                    quota.balance = json_number(body.pointer(&q.balance_pointer));
                    quota.unit = q.unit.clone();
                    if quota.balance.is_none() {
                        partial = true;
                    }
                }
                QuotaAdapter::None => unreachable!(),
            }
            let mut r = result(
                if partial {
                    "partial"
                } else if quota.balance.is_some() || !quota.windows.is_empty() {
                    "ok"
                } else {
                    "error"
                },
                if partial {
                    "部分额度字段缺失，已展示可用数据"
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
    fn sub2api_parses_subscription_windows_and_skips_unlimited_windows() {
        let body = json!({
            "mode": "unrestricted",
            "planName": "Claude Lite",
            "unit": "USD",
            "remaining": 49.9,
            "subscription": {
                "daily_usage_usd": 0.1,
                "daily_limit_usd": 50,
                "weekly_usage_usd": 1,
                "weekly_limit_usd": 0,
                "expires_at": "2026-12-31T00:00:00Z"
            }
        });
        let (quota, partial) = parse_sub2api(&body).expect("sub2api response should parse");
        assert!(!partial);
        assert_eq!(quota.membership.as_deref(), Some("Claude Lite"));
        assert_eq!(quota.windows.len(), 1);
        assert_eq!(quota.windows[0].remaining, Some(49.9));
    }

    #[test]
    fn minimax_parses_interval_and_weekly_percentages() {
        let body = json!({
            "base_resp": { "status_code": 0 },
            "model_remains": [{
                "model_name": "general",
                "current_interval_remaining_percent": 72,
                "current_weekly_remaining_percent": 58,
                "end_time": "2026-10-10T00:00:00Z",
                "weekly_end_time": "2026-10-12T00:00:00Z"
            }]
        });
        let quota = parse_minimax(&body).expect("minimax response should parse");
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[0].remaining, Some(72.0));
        assert_eq!(quota.windows[1].remaining, Some(58.0));
    }
}
