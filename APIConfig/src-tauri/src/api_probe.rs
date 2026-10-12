//! API account protocols, model discovery and quota adapters.
//! Credentials stay in the data layer; this module only returns masked-safe probe results.
use crate::{data, inspection};
use reqwest::{Client, Url};
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
            inspection::inspect_models(provider, false, false).await
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
            inspection::inspect_models(provider, true, false).await
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
