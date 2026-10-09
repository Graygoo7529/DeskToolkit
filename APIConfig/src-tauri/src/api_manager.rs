//! 独立 API 账号管理。只用于可用性与模型发现，不参与 Codex / Claude 应用。
use crate::{codex, data, inspection};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize, Clone)]
pub struct ApiAccountView {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub anthropic_url: String,
    pub key_masked: String,
    pub color: String,
    pub configured: bool,
}

#[derive(Serialize)]
pub struct ApiProbeResult {
    pub models: inspection::ProbeResult,
    pub quota: Option<inspection::ProbeResult>,
}

fn view(account: &data::ApiAccount) -> ApiAccountView {
    ApiAccountView {
        id: format!("api:{}", account.name),
        kind: "api".into(),
        name: account.name.clone(),
        url: account.url.clone(),
        anthropic_url: account.anthropic_url.clone(),
        key_masked: codex::mask_key(&account.key),
        color: account.color.clone(),
        configured: !account.key.trim().is_empty(),
    }
}

fn views(app: &AppHandle) -> Result<Vec<ApiAccountView>, String> {
    let mut accounts: Vec<_> = data::load_api_accounts(app)?.iter().map(view).collect();
    let kimi = data::load_kimi(app)?;
    accounts.push(ApiAccountView {
        id: "kimi".into(),
        kind: "kimi".into(),
        name: kimi.name,
        url: kimi.url,
        anthropic_url: String::new(),
        key_masked: codex::mask_key(&kimi.key),
        color: "#9CA9FF".into(),
        configured: !kimi.key.trim().is_empty(),
    });
    Ok(accounts)
}

#[tauri::command]
pub fn get_api_accounts(app: AppHandle) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    views(&app)
}

#[tauri::command]
pub fn save_api_account(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    url: String,
    anthropic_url: String,
    key: String,
) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    let mut accounts = data::load_api_accounts(&app)?;
    let name = name.trim().to_string();
    let url = url.trim().to_string();
    let anthropic_url = anthropic_url.trim().to_string();
    if name.is_empty() || url.is_empty() {
        return Err("名称和兼容接口地址不能为空".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("兼容接口地址需以 http:// 或 https:// 开头".into());
    }
    if !anthropic_url.is_empty() && !anthropic_url.starts_with("http") {
        return Err("Anthropic 地址需以 http:// 或 https:// 开头".into());
    }
    if original_name.is_none() && key.trim().is_empty() {
        return Err("API Key 不能为空".into());
    }
    if accounts.iter().any(|account| {
        account.name == name && Some(account.name.as_str()) != original_name.as_deref()
    }) {
        return Err(format!("已存在同名 API：{name}"));
    }
    match original_name.as_deref() {
        Some(original) => {
            let account = accounts
                .iter_mut()
                .find(|account| account.name == original)
                .ok_or("原 API 不存在，请刷新后重试")?;
            account.name = name;
            account.url = url;
            account.anthropic_url = anthropic_url;
            if !key.trim().is_empty() {
                account.key = key.trim().to_string();
            }
        }
        None => accounts.push(data::ApiAccount {
            name,
            url,
            anthropic_url,
            key: key.trim().to_string(),
            color: String::new(),
        }),
    }
    data::save_api_accounts(&app, &accounts)?;
    views(&app)
}

#[tauri::command]
pub fn delete_api_account(app: AppHandle, name: String) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    let mut accounts = data::load_api_accounts(&app)?;
    accounts.retain(|account| account.name != name);
    data::save_api_accounts(&app, &accounts)?;
    views(&app)
}

#[tauri::command]
pub async fn probe_api_account(app: AppHandle, id: String) -> Result<ApiProbeResult, String> {
    let (provider, is_kimi) = {
        let _guard = data::lock()?;
        if id == "kimi" {
            let account = data::load_kimi(&app)?;
            let mut settings = inspection::InspectionSettings::default();
            settings.quota.adapter = inspection::Adapter::Kimi;
            (
                data::Provider {
                    name: account.name,
                    url: account.url,
                    key: account.key,
                    color: "#9CA9FF".into(),
                    inspection: settings,
                },
                true,
            )
        } else {
            let name = id.strip_prefix("api:").ok_or("API 不存在，请刷新后重试")?;
            let account = data::load_api_accounts(&app)?
                .into_iter()
                .find(|account| account.name == name)
                .ok_or("API 不存在，请刷新后重试")?;
            (
                data::Provider {
                    name: account.name,
                    url: account.url,
                    key: account.key,
                    color: account.color,
                    inspection: inspection::InspectionSettings::default(),
                },
                false,
            )
        }
    };
    let (models, quota) = if is_kimi {
        let quota_provider = provider.clone();
        let (models, quota) = tokio::join!(
            inspection::inspect(provider, false, inspection::Task::Models),
            inspection::inspect(quota_provider, false, inspection::Task::Quota),
        );
        (models, Some(quota))
    } else {
        (
            inspection::inspect(provider, false, inspection::Task::Models).await,
            None,
        )
    };
    Ok(ApiProbeResult { models, quota })
}

#[tauri::command]
pub async fn check_api_model(
    app: AppHandle,
    id: String,
    model: String,
    protocol: String,
) -> Result<inspection::ProbeResult, String> {
    let (url, anthropic_url, key) = {
        let _guard = data::lock()?;
        if id == "kimi" {
            let account = data::load_kimi(&app)?;
            (account.url, String::new(), account.key)
        } else {
            let name = id.strip_prefix("api:").ok_or("API 不存在，请刷新后重试")?;
            let account = data::load_api_accounts(&app)?
                .into_iter()
                .find(|account| account.name == name)
                .ok_or("API 不存在，请刷新后重试")?;
            (account.url, account.anthropic_url, account.key)
        }
    };
    match protocol.as_str() {
        "openai" => Ok(inspection::probe_openai_model(&url, &key, &model).await),
        "anthropic" if !anthropic_url.trim().is_empty() => {
            Ok(inspection::probe_anthropic(&anthropic_url, &key, &model).await)
        }
        "anthropic" => Err("此账号未配置 Anthropic 接口".into()),
        _ => Err("未知接口协议".into()),
    }
}
