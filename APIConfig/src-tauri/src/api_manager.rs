//! API Probe account management. These accounts are inspection-only and are never applied to an agent home.
use crate::{api_definitions, api_probe, codex, data};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Clone)]
pub struct ApiEndpointView {
    pub protocol: String,
    pub url: String,
    pub auth: String,
}

#[derive(Serialize, Clone)]
pub struct ApiAccountView {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub key_masked: String,
    pub color: String,
    pub configured: bool,
    pub endpoints: Vec<ApiEndpointView>,
    pub quota_adapter: String,
    pub quota: ApiQuotaView,
    pub console_url: String,
}

#[derive(Serialize, Clone)]
pub struct ApiQuotaView {
    pub profile: String,
    pub path: String,
    pub auth: crate::inspection::Auth,
    pub balance_pointer: String,
    pub used_pointer: String,
    pub limit_pointer: String,
    pub remaining_pointer: String,
    pub reset_pointer: String,
    pub unit: String,
}

#[derive(Serialize)]
pub struct ApiProbeResult {
    pub model_sets: Vec<api_probe::ProtocolModels>,
    pub quota: Option<crate::inspection::ProbeResult>,
}

#[derive(Deserialize)]
pub struct EndpointInput {
    pub protocol: String,
    pub url: String,
    #[serde(default)]
    pub auth: String,
}

#[derive(Deserialize, Default)]
pub struct QuotaInput {
    #[serde(default)]
    pub presentation: String,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub adapter: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub auth: String,
    #[serde(default)]
    pub balance_pointer: String,
    #[serde(default)]
    pub used_pointer: String,
    #[serde(default)]
    pub limit_pointer: String,
    #[serde(default)]
    pub remaining_pointer: String,
    #[serde(default)]
    pub reset_pointer: String,
    #[serde(default)]
    pub unit: String,
}

fn auth(value: &str, protocol: api_probe::Protocol) -> crate::inspection::Auth {
    match value {
        "x_api_key" => crate::inspection::Auth::XApiKey,
        "none" => crate::inspection::Auth::None,
        "bearer" => crate::inspection::Auth::Bearer,
        _ if protocol == api_probe::Protocol::Anthropic
            || matches!(
                protocol,
                api_probe::Protocol::Genai | api_probe::Protocol::Vertexai
            ) =>
        {
            crate::inspection::Auth::XApiKey
        }
        _ => crate::inspection::Auth::Bearer,
    }
}
fn auth_name(value: crate::inspection::Auth) -> String {
    match value {
        crate::inspection::Auth::Bearer => "bearer",
        crate::inspection::Auth::XApiKey => "x_api_key",
        crate::inspection::Auth::None => "none",
    }
    .into()
}
fn view(account: &data::ApiAccount) -> ApiAccountView {
    let first = account
        .endpoints
        .first()
        .map(|e| e.url.clone())
        .unwrap_or_default();
    ApiAccountView {
        id: format!("api:{}", account.name),
        kind: if account.kind == data::AccountKind::Subscription {
            "subscription"
        } else {
            "direct"
        }
        .into(),
        name: account.name.clone(),
        url: first,
        key_masked: codex::mask_key(&account.key),
        color: account.color.clone(),
        configured: !account.key.trim().is_empty(),
        endpoints: account
            .endpoints
            .iter()
            .map(|endpoint| ApiEndpointView {
                protocol: api_probe::protocol_name(endpoint.protocol).into(),
                url: endpoint.url.clone(),
                auth: auth_name(endpoint.auth),
            })
            .collect(),
        quota_adapter: account.quota.profile.clone(),
        quota: ApiQuotaView {
            profile: account.quota.profile.clone(),
            path: account.quota.path.clone(),
            auth: account.quota.auth,
            balance_pointer: account.quota.balance_pointer.clone(),
            used_pointer: account.quota.used_pointer.clone(),
            limit_pointer: account.quota.limit_pointer.clone(),
            remaining_pointer: account.quota.remaining_pointer.clone(),
            reset_pointer: account.quota.reset_pointer.clone(),
            unit: account.quota.unit.clone(),
        },
        console_url: account.console_url.clone(),
    }
}
fn views(app: &AppHandle) -> Result<Vec<ApiAccountView>, String> {
    Ok(data::load_api_accounts(app)?.iter().map(view).collect())
}

#[tauri::command]
pub fn get_api_accounts(app: AppHandle) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    views(&app)
}

#[tauri::command]
pub fn get_api_account_key(app: AppHandle, id: String) -> Result<String, String> {
    let _guard = data::lock()?;
    let name = id.strip_prefix("api:").ok_or("API 不存在，请刷新后重试")?;
    data::load_api_accounts(&app)?
        .into_iter()
        .find(|account| account.name == name)
        .map(|account| account.key)
        .ok_or_else(|| "API 不存在，请刷新后重试".into())
}

#[tauri::command]
pub fn save_api_account(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    kind: String,
    endpoints: Vec<EndpointInput>,
    quota: QuotaInput,
    key: String,
    console_url: String,
) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    let mut accounts = data::load_api_accounts(&app)?;
    let is_new = original_name.is_none();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("账号名称不能为空".into());
    }
    if endpoints.is_empty() {
        return Err("至少配置一个接口协议".into());
    }
    let profile = if quota.profile.trim().is_empty() {
        quota.adapter.trim().to_string()
    } else {
        quota.profile.trim().to_string()
    };
    let definitions_dir = data::data_dir(&app)?.join("definitions");
    let registry = api_definitions::Registry::load(&definitions_dir)?;
    let selected_definition = registry
        .adapter(&profile)
        .ok_or("额度适配器不存在，请刷新后重试")?;
    let create_definition = selected_definition.kind == "custom";
    let profile = if create_definition {
        api_definitions::custom_profile_id(&name)
    } else {
        profile
    };
    if create_definition {
        if registry.adapter(&profile).is_some() {
            return Err("此账号已有同名自定义方案，请选择现有方案，或在数据目录编辑该方案".into());
        }
        if !matches!(quota.presentation.as_str(), "balance" | "quota") {
            return Err("请选择余额或周期额度组件".into());
        }
        if quota.presentation == "balance" && quota.balance_pointer.trim().is_empty() {
            return Err("余额组件需要余额字段路径".into());
        }
        if quota.presentation == "quota"
            && [
                quota.used_pointer.trim(),
                quota.limit_pointer.trim(),
                quota.remaining_pointer.trim(),
            ]
            .iter()
            .all(|value| value.is_empty())
        {
            return Err("周期额度至少需要已用、总量或剩余字段".into());
        }
        if quota.path.trim().is_empty() {
            return Err("自定义额度需要查询路径".into());
        }
        let pointers = [
            quota.balance_pointer.trim(),
            quota.used_pointer.trim(),
            quota.limit_pointer.trim(),
            quota.remaining_pointer.trim(),
            quota.reset_pointer.trim(),
        ];
        if pointers[..4].iter().all(|pointer| pointer.is_empty()) {
            return Err("至少配置一个余额、已用、总量或剩余字段".into());
        }
        if pointers
            .iter()
            .any(|pointer| !pointer.is_empty() && !pointer.starts_with('/'))
        {
            return Err("字段路径需使用 JSON Pointer，例如 /data/balance".into());
        }
    }
    let converted: Vec<_> = endpoints
        .iter()
        .map(|input| {
            let protocol = api_probe::parse_protocol(&input.protocol)
                .ok_or_else(|| format!("不支持的接口协议：{}", input.protocol))?;
            if input.url.trim().is_empty() {
                return Err("接口地址不能为空".into());
            }
            Ok(api_probe::ApiEndpoint {
                protocol,
                url: input.url.trim().into(),
                auth: auth(&input.auth, protocol),
            })
        })
        .collect::<Result<_, String>>()?;
    let resolved_key = if key.trim().is_empty() {
        original_name
            .as_deref()
            .and_then(|original| {
                accounts
                    .iter()
                    .find(|a| a.name == original)
                    .map(|a| a.key.clone())
            })
            .unwrap_or_default()
    } else {
        key.trim().into()
    };
    if resolved_key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    if accounts.iter().any(|account| {
        account.name == name && Some(account.name.as_str()) != original_name.as_deref()
    }) {
        return Err(format!("已存在同名 API：{name}"));
    }
    let console_url = console_url.trim();
    if !console_url.is_empty() {
        let parsed = reqwest::Url::parse(console_url).map_err(|_| "控制台地址无效")?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err("控制台地址需为 HTTP(S) 地址".into());
        }
    }
    let mut account = data::ApiAccount {
        name: name.clone(),
        kind: if kind == "subscription" {
            data::AccountKind::Subscription
        } else {
            data::AccountKind::Direct
        },
        endpoints: converted,
        quota: api_probe::ApiQuotaSettings {
            profile: profile.clone(),
            ..Default::default()
        },
        console_url: console_url.into(),
        key: resolved_key,
        color: String::new(),
        url: String::new(),
        anthropic_url: String::new(),
        declared_models: vec![],
    };
    if is_new && account.console_url.is_empty() {
        if let Some(url) = data::default_console_url(&account) {
            account.console_url = url.into();
        }
    }
    if let Some(original) = original_name {
        let old = accounts
            .iter()
            .find(|a| a.name == original)
            .ok_or("原 API 不存在，请刷新后重试")?;
        account.color = old.color.clone();
        accounts.retain(|a| a.name != original);
    }
    api_probe::validate_account(&account)?;
    if create_definition {
        api_definitions::write_custom_adapter(
            &definitions_dir,
            &profile,
            &name,
            &quota.presentation,
            &quota.path,
            &quota.auth,
            &quota.balance_pointer,
            &quota.used_pointer,
            &quota.limit_pointer,
            &quota.remaining_pointer,
            &quota.reset_pointer,
            &quota.unit,
        )?;
    }
    accounts.push(account);
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
pub fn reorder_api_accounts(
    app: AppHandle,
    names: Vec<String>,
) -> Result<Vec<ApiAccountView>, String> {
    let _guard = data::lock()?;
    let mut accounts = data::load_api_accounts(&app)?;
    let mut ordered = Vec::with_capacity(accounts.len());
    for name in names {
        if let Some(index) = accounts.iter().position(|a| a.name == name) {
            ordered.push(accounts.remove(index));
        }
    }
    ordered.extend(accounts);
    data::save_api_accounts(&app, &ordered)?;
    views(&app)
}

#[tauri::command]
pub async fn probe_api_account(app: AppHandle, id: String) -> Result<ApiProbeResult, String> {
    let account = {
        let _guard = data::lock()?;
        let name = id.strip_prefix("api:").ok_or("API 不存在，请刷新后重试")?;
        data::load_api_accounts(&app)?
            .into_iter()
            .find(|a| a.name == name)
            .ok_or("API 不存在，请刷新后重试")?
    };
    let mut model_sets = Vec::new();
    for endpoint in &account.endpoints {
        model_sets.push(api_probe::ProtocolModels {
            protocol: endpoint.protocol,
            result: api_probe::discover(endpoint, &account.key).await,
        });
    }
    let quota = if account.quota.profile.trim().is_empty() || account.quota.profile == "none" {
        None
    } else {
        let registry = api_definitions::load_for_app(&app)?;
        Some(api_probe::quota(&account, &registry).await)
    };
    Ok(ApiProbeResult { model_sets, quota })
}

#[tauri::command]
pub async fn check_api_model(
    app: AppHandle,
    id: String,
    model: String,
    protocol: String,
) -> Result<crate::inspection::ProbeResult, String> {
    let account = {
        let _guard = data::lock()?;
        let name = id.strip_prefix("api:").ok_or("API 不存在，请刷新后重试")?;
        data::load_api_accounts(&app)?
            .into_iter()
            .find(|a| a.name == name)
            .ok_or("API 不存在，请刷新后重试")?
    };
    let protocol = api_probe::parse_protocol(&protocol).ok_or("未知接口协议")?;
    let endpoint = account
        .endpoints
        .iter()
        .find(|e| e.protocol == protocol)
        .ok_or("此账号未配置该接口协议")?;
    Ok(api_probe::check(endpoint, &account.key, &model).await)
}
