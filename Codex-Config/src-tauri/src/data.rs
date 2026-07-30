//! 面板数据（homes.toml / providers.toml）的读写。
//!
//! 数据文件存放于应用配置目录（Windows 上为
//! `%APPDATA%/com.codexconfig.panel/`）。首次运行时写入空配置，用户通过界面添加数据。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Home {
    pub name: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub url: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct HomesFile {
    #[serde(default)]
    homes: Vec<Home>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ProvidersFile {
    #[serde(default)]
    providers: Vec<Provider>,
}

const HOMES_FILE: &str = "homes.toml";
const PROVIDERS_FILE: &str = "providers.toml";

const SEED_HOMES: &str = r#"# Codex Home 列表：name = 显示名，location = .codex 目录路径
"#;

const SEED_PROVIDERS: &str = r#"# Codex Provider 列表：name = 显示名，url = base_url，key = API Key
"#;

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取应用配置目录：{e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(dir)
}

fn read_or_seed(path: &PathBuf, seed: &str) -> Result<String, String> {
    if path.exists() {
        fs::read_to_string(path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))
    } else {
        fs::write(path, seed).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
        Ok(seed.to_string())
    }
}

pub fn load_homes(app: &AppHandle) -> Result<Vec<Home>, String> {
    let path = data_dir(app)?.join(HOMES_FILE);
    let text = read_or_seed(&path, SEED_HOMES)?;
    let parsed: HomesFile =
        toml::from_str(&text).map_err(|e| format!("解析 {} 失败：{e}", path.display()))?;
    Ok(parsed.homes)
}

pub fn load_providers(app: &AppHandle) -> Result<Vec<Provider>, String> {
    let path = data_dir(app)?.join(PROVIDERS_FILE);
    let text = read_or_seed(&path, SEED_PROVIDERS)?;
    let parsed: ProvidersFile =
        toml::from_str(&text).map_err(|e| format!("解析 {} 失败：{e}", path.display()))?;
    Ok(parsed.providers)
}

pub fn save_homes(app: &AppHandle, homes: &[Home]) -> Result<(), String> {
    let path = data_dir(app)?.join(HOMES_FILE);
    let file = HomesFile {
        homes: homes.to_vec(),
    };
    let text = "# Codex Home 列表：name = 显示名，location = .codex 目录路径\n".to_string()
        + &toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

pub fn save_providers(app: &AppHandle, providers: &[Provider]) -> Result<(), String> {
    let path = data_dir(app)?.join(PROVIDERS_FILE);
    let file = ProvidersFile {
        providers: providers.to_vec(),
    };
    let text = "# Codex Provider 列表：name = 显示名，url = base_url，key = API Key\n".to_string()
        + &toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}
