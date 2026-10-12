//! Shared quota profile references and editor input for every scene.
use crate::{api_definitions, inspection};
use reqwest::{Client, RequestBuilder, Url};
use serde_json::Value;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(3);
static HTTP: std::sync::LazyLock<Client> = std::sync::LazyLock::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("APIConfig/0.2")
        .build()
        .expect("quota HTTP client")
});
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub profile: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            profile: "none".into(),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Input {
    pub profile: String,
    pub presentation: String,
    pub path: String,
    pub auth: String,
    pub balance_pointer: String,
    pub used_pointer: String,
    pub limit_pointer: String,
    pub remaining_pointer: String,
    pub reset_pointer: String,
    pub unit: String,
}

impl Input {
    /// Call after validating the account, under the storage lock.
    pub fn save(
        &self,
        dir: &Path,
        identity: &str,
        label: &str,
        base: &str,
    ) -> Result<Settings, String> {
        let registry = api_definitions::Registry::load(dir)?;
        let profile = self.profile.trim();
        let definition = registry
            .adapter(profile)
            .ok_or("额度方案不存在，请刷新后重试")?;
        if definition.kind != "custom" {
            if definition.kind != "none" {
                query_url(base, &definition.request_path)?;
            }
            return Ok(Settings {
                profile: profile.into(),
            });
        }
        let id = api_definitions::custom_profile_id(identity);
        if registry.adapter(&id).is_some() {
            return Err("此账号已有同名自定义方案，请选择现有方案，或在数据目录编辑该方案".into());
        }
        if !matches!(self.presentation.as_str(), "balance" | "quota") {
            return Err("请选择余额或周期额度组件".into());
        }
        if self.presentation == "balance" && self.balance_pointer.trim().is_empty() {
            return Err("余额组件需要余额字段路径".into());
        }
        if self.presentation == "quota"
            && [
                &self.used_pointer,
                &self.limit_pointer,
                &self.remaining_pointer,
            ]
            .iter()
            .all(|p| p.trim().is_empty())
        {
            return Err("周期额度至少需要已用、总量或剩余字段".into());
        }
        if self.path.trim().is_empty() {
            return Err("自定义额度需要查询路径".into());
        }
        query_url(base, &self.path)?;
        api_definitions::write_custom_adapter(
            dir,
            &id,
            label,
            &self.presentation,
            &self.path,
            &self.auth,
            &self.balance_pointer,
            &self.used_pointer,
            &self.limit_pointer,
            &self.remaining_pointer,
            &self.reset_pointer,
            &self.unit,
        )?;
        Ok(Settings { profile: id })
    }
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
fn with_auth(mut request: RequestBuilder, key: &str, auth: inspection::Auth) -> RequestBuilder {
    request = match auth {
        inspection::Auth::Bearer => request.bearer_auth(key),
        inspection::Auth::XApiKey => request.header("x-api-key", key),
        inspection::Auth::None => request,
    };
    request
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

pub(crate) fn query_url(base: &str, path: &str) -> Result<Url, String> {
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

pub async fn query(
    base: &str,
    key: &str,
    profile: &str,
    registry: &crate::api_definitions::Registry,
) -> inspection::ProbeResult {
    let _slot = SLOTS.acquire().await.expect("quota semaphore");
    let start = Instant::now();
    let profile = profile.trim();
    if profile.is_empty() || profile == "none" {
        return result("skipped", "未配置额度查询适配器", None, start);
    }
    let Some(definition) = registry.adapter(profile) else {
        return result("error", "额度适配器定义不存在", None, start);
    };
    let path = definition.request_path.clone();
    let auth = crate::api_definitions::auth(&definition.request_auth);
    let url = match query_url(base, &path) {
        Ok(url) => url,
        Err(error) => return result("error", error, None, start),
    };
    match request_json(url, key, &definition.request_method, auth).await {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn custom_editor_creates_shared_profile_and_rejects_cross_origin() {
        let dir = tempfile::tempdir().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions");
        for sub in ["adapters", "layouts"] {
            std::fs::create_dir_all(dir.path().join(sub)).unwrap();
            for file in std::fs::read_dir(root.join(sub)).unwrap() {
                let file = file.unwrap();
                std::fs::copy(file.path(), dir.path().join(sub).join(file.file_name())).unwrap();
            }
        }
        let mut input = Input {
            profile: "balance_custom".into(),
            presentation: "balance".into(),
            path: "https://other.test/usage".into(),
            auth: "x_api_key".into(),
            balance_pointer: "/balance".into(),
            ..Default::default()
        };
        assert!(input
            .save(dir.path(), "codex:Relay", "Relay", "https://api.test/v1")
            .is_err());
        input.path = "/account/usage".into();
        let saved = input
            .save(dir.path(), "codex:Relay", "Relay", "https://api.test/v1")
            .unwrap();
        let reused = Input {
            profile: saved.profile.clone(),
            ..Default::default()
        }
        .save(dir.path(), "claude:Other", "Other", "https://api.test/v1")
        .unwrap();
        assert_eq!(saved.profile, reused.profile);
        assert!(input
            .save(dir.path(), "codex:Relay", "Relay", "https://api.test/v1")
            .is_err());
        let other = input
            .save(dir.path(), "claude:Relay", "Relay", "https://api.test/v1")
            .unwrap();
        assert_ne!(saved.profile, other.profile);
    }

    #[tokio::test]
    async fn shared_query_uses_profile_method_path_and_account_key() {
        use std::io::{Read, Write};
        let registry = crate::api_definitions::source_registry_for_tests();
        assert_eq!(
            query("http://127.0.0.1:1", "fixture-key", "none", &registry)
                .await
                .status,
            "skipped"
        );
        for (profile, method, path, body) in [
            (
                "balance_zhizz",
                "POST",
                "/v1/dashboard/billing/credit_grants",
                r#"{"grants":{"available_amount":0}}"#,
            ),
            (
                "quota_kimi",
                "GET",
                "/v1/usages",
                r#"{"usage":{"remaining":30}}"#,
            ),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = format!("http://{}/v1", listener.local_addr().unwrap());
            let handle = std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(10))
                        }
                        Err(e) => panic!("{e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&chunk[..n]);
                }
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                String::from_utf8(request).unwrap()
            });
            let result = query(&base, "fixture-key", profile, &registry).await;
            let request = handle.join().unwrap().to_lowercase();
            assert!(request.starts_with(&format!("{method} {path} ").to_lowercase()));
            assert!(request.contains("authorization: bearer fixture-key"));
            assert!(!request.contains("anthropic-version"));
            if profile == "balance_zhizz" {
                assert_eq!(result.status, "ok");
                assert_eq!(result.quota.unwrap().balance, Some(0.0));
            } else {
                assert_eq!(result.status, "partial");
                assert_eq!(result.quota.as_ref().unwrap().windows.len(), 2);
                assert_eq!(result.quota.unwrap().windows[0].remaining, Some(30.0));
            }
        }
    }

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
