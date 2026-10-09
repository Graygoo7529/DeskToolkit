//! Kimi 专用额度账号。密钥仅保存在应用数据目录，IPC 仅返回掩码。
use crate::{codex, data, inspection};
use serde::Serialize;
use std::{fs, path::Path};
use tauri::AppHandle;

const DEFAULT_URL: &str = "https://api.kimi.com/coding/v1";

type Config = data::KimiAccount;

#[derive(Serialize)]
pub struct ConfigView {
    name: String,
    url: String,
    key_masked: String,
    configured: bool,
}

impl Config {
    fn view(&self) -> ConfigView {
        ConfigView {
            name: self.name.clone(),
            url: self.url.clone(),
            key_masked: codex::mask_key(&self.key),
            configured: !self.key.trim().is_empty(),
        }
    }
}

fn load(app: &AppHandle) -> Result<Config, String> {
    data::load_kimi(app)
}

fn save(app: &AppHandle, config: Config) -> Result<ConfigView, String> {
    inspection::endpoint(&config.url, "", "usages")?;
    let view = config.view();
    data::save_kimi(app, config)?;
    Ok(view)
}

fn parse_deskbot(path: &Path) -> Result<Config, String> {
    let text = fs::read_to_string(path).map_err(|_| "无法读取 DeskBot 配置文件")?;
    let json: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "DeskBot 配置不是合法 JSON")?;
    let key = json
        .get("apiKey")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim();
    if key.is_empty() {
        return Err("DeskBot 配置中没有 apiKey，请手动填写 Kimi Key".into());
    }
    let url = json
        .get("baseUrl")
        .and_then(serde_json::Value::as_str)
        .unwrap_or(DEFAULT_URL)
        .trim();
    inspection::endpoint(url, "", "usages")?;
    Ok(Config {
        name: "Kimi Code".into(),
        url: url.into(),
        key: key.into(),
    })
}

#[tauri::command]
pub fn get_kimi_config(app: AppHandle) -> Result<ConfigView, String> {
    let _guard = data::lock()?;
    Ok(load(&app)?.view())
}

#[tauri::command]
pub fn save_kimi_config(
    app: AppHandle,
    name: String,
    url: String,
    key: String,
) -> Result<ConfigView, String> {
    let _guard = data::lock()?;
    let old = load(&app)?;
    let name = name.trim().to_string();
    let key = if key.trim().is_empty() {
        old.key
    } else {
        key.trim().to_string()
    };
    if name.is_empty() || key.is_empty() {
        return Err("请填写账号名称和 API Key".into());
    }
    save(
        &app,
        Config {
            name,
            url: url.trim().into(),
            key,
        },
    )
}

#[tauri::command]
pub fn import_kimi_config(app: AppHandle, path: String) -> Result<ConfigView, String> {
    let _guard = data::lock()?;
    save(&app, parse_deskbot(Path::new(&path))?)
}

#[tauri::command]
pub async fn query_kimi_quota(app: AppHandle) -> Result<inspection::ProbeResult, String> {
    let config = {
        let _guard = data::lock()?;
        load(&app)?
    };
    if config.key.is_empty() {
        return Err("请先设置 Kimi 账号".into());
    }
    let mut settings = inspection::InspectionSettings::default();
    settings.quota.adapter = inspection::Adapter::Kimi;
    let provider = data::Provider {
        color: String::new(),
        name: config.name,
        url: config.url,
        key: config.key,
        inspection: settings,
    };
    Ok(inspection::inspect(provider, false, inspection::Task::Quota).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deskbot_import_only_exposes_masked_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deskbot.local.json");
        fs::write(&path, r#"{"apiKey":"fixture-secret-123456789","baseUrl":"https://api.kimi.com/coding/v1","workspaceDir":"ignored"}"#).unwrap();
        let config = parse_deskbot(&path).unwrap();
        assert_eq!(config.key, "fixture-secret-123456789");
        let view = serde_json::to_string(&config.view()).unwrap();
        assert!(!view.contains("fixture-secret-123456789"));
        assert!(!view.contains("workspaceDir"));
        assert!(config.view().configured);
    }
    #[test]
    fn malformed_imports_fail_without_echoing_secret() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        for body in [
            r#"{"apiKey":""}"#,
            r#"{"apiKey":"secret","baseUrl":"file:///secret"}"#,
            "secret invalid json",
        ] {
            fs::write(&path, body).unwrap();
            let error = parse_deskbot(&path).err().unwrap();
            assert!(!error.contains("secret"));
        }
    }
}
