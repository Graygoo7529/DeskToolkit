//! 额度查询：Kimi Code HTTP API。契约见 docs/architecture.md §10。

use std::sync::LazyLock;
use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

static HTTP: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .user_agent("DeskBot/0.1")
        .timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build reqwest client")
});

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub used: f64,
    pub limit: f64,
    pub remaining: f64,
    pub reset_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuotaInfo {
    pub weekly: Option<QuotaWindow>,
    pub five_hour: Option<QuotaWindow>,
    pub membership_level: Option<String>,
    pub fetched_at: String,
}

impl QuotaInfo {
    fn empty() -> Self {
        Self {
            weekly: None,
            five_hour: None,
            membership_level: None,
            fetched_at: now_iso(),
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 数值字段在 API 里是字符串，兼容数字类型。
fn num(v: &Value) -> Option<f64> {
    if let Some(s) = v.as_str() {
        s.trim().parse::<f64>().ok()
    } else {
        v.as_f64()
    }
}

fn parse_window(v: &Value) -> Option<QuotaWindow> {
    Some(QuotaWindow {
        used: num(v.get("used")?)?,
        limit: num(v.get("limit")?)?,
        remaining: num(v.get("remaining")?)?,
        reset_at: v.get("resetTime").and_then(|t| t.as_str()).map(String::from),
    })
}

fn parse_usages(body: &Value) -> QuotaInfo {
    let weekly = body.get("usage").and_then(parse_window);
    let five_hour = body
        .get("limits")
        .and_then(|l| l.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|item| {
                    let w = item.get("window");
                    let dur = w.and_then(|w| w.get("duration")).and_then(num).unwrap_or_default();
                    let unit = w
                        .and_then(|w| w.get("timeUnit"))
                        .and_then(|u| u.as_str())
                        .unwrap_or_default();
                    dur == 300.0 && unit.contains("MINUTE")
                })
                .and_then(|item| item.get("detail"))
                .and_then(parse_window)
        });
    let membership_level = body
        .pointer("/user/membership/level")
        .and_then(|l| l.as_str())
        .map(String::from);
    QuotaInfo {
        weekly,
        five_hour,
        membership_level,
        fetched_at: now_iso(),
    }
}

pub async fn fetch(app: &AppHandle) -> Result<QuotaInfo, String> {
    let cfg = app.state::<AppState>().config.get();
    // apiKey 读取顺序：env KIMI_API_KEY → deskbot.local.json。绝不打印。
    let key = std::env::var("KIMI_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .or(cfg.api_key);
    let Some(key) = key else {
        eprintln!("[deskbot][quota] 未配置 apiKey，返回空额度");
        return Ok(QuotaInfo::empty());
    };
    let url = format!("{}/usages", cfg.base_url.trim_end_matches('/'));
    let resp = HTTP
        .get(&url)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("响应不是合法 JSON: {e}"))?;
    Ok(parse_usages(&body))
}

/// 拉取 → 缓存进 AppState → 广播 `quota://updated`。
pub async fn refresh(app: &AppHandle) -> Result<QuotaInfo, String> {
    let info = fetch(app).await?;
    app.state::<AppState>().set_quota(info.clone());
    let _ = app.emit("quota://updated", &info);
    Ok(info)
}

/// 5 分钟定时轮询（首次 tick 立即执行一次）。
pub fn start_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(300));
        loop {
            timer.tick().await;
            if let Err(e) = refresh(&app).await {
                eprintln!("[deskbot][quota] 轮询失败: {e}");
            }
        }
    });
}
