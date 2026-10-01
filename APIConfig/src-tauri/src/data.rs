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
    #[serde(default)]
    pub inspection: crate::inspection::InspectionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeHome {
    pub name: String,
    /// Claude 配置目录，目录下的 settings.json 会被面板更新。
    pub location: String,
}

pub type ClaudeProvider = Provider;

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

#[derive(Debug, Serialize, Deserialize, Default)]
struct ClaudeHomesFile {
    #[serde(default)]
    homes: Vec<ClaudeHome>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ClaudeProvidersFile {
    #[serde(default)]
    providers: Vec<ClaudeProvider>,
}

const HOMES_FILE: &str = "homes.toml";
const PROVIDERS_FILE: &str = "providers.toml";
const CLAUDE_HOMES_FILE: &str = "claude_homes.toml";
const CLAUDE_PROVIDERS_FILE: &str = "claude_providers.toml";

const SEED_HOMES: &str = r#"# Codex Home 列表：name = 显示名，location = .codex 目录路径
"#;

const SEED_PROVIDERS: &str = r#"# Codex Provider 列表：name = 显示名，url = base_url，key = API Key
"#;

const SEED_CLAUDE_HOMES: &str = r#"# Claude 配置列表：name = 显示名，location = 配置目录（目录下为 settings.json）
"#;

const SEED_CLAUDE_PROVIDERS: &str = r#"# Claude 中转站列表：name = 显示名，url = ANTHROPIC_BASE_URL，key = ANTHROPIC_AUTH_TOKEN
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

pub fn load_claude_homes(app: &AppHandle) -> Result<Vec<ClaudeHome>, String> {
    let path = data_dir(app)?.join(CLAUDE_HOMES_FILE);
    let text = read_or_seed(&path, SEED_CLAUDE_HOMES)?;
    let parsed: ClaudeHomesFile =
        toml::from_str(&text).map_err(|e| format!("解析 {} 失败：{e}", path.display()))?;
    Ok(parsed.homes)
}

pub fn load_claude_providers(app: &AppHandle) -> Result<Vec<ClaudeProvider>, String> {
    let path = data_dir(app)?.join(CLAUDE_PROVIDERS_FILE);
    let text = read_or_seed(&path, SEED_CLAUDE_PROVIDERS)?;
    let parsed: ClaudeProvidersFile =
        toml::from_str(&text).map_err(|e| format!("解析 {} 失败：{e}", path.display()))?;
    Ok(parsed.providers)
}

pub fn save_claude_homes(app: &AppHandle, homes: &[ClaudeHome]) -> Result<(), String> {
    let path = data_dir(app)?.join(CLAUDE_HOMES_FILE);
    let file = ClaudeHomesFile {
        homes: homes.to_vec(),
    };
    let text = "# Claude 配置列表：name = 显示名，location = 配置目录（目录下为 settings.json）\n"
        .to_string()
        + &toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

pub fn save_claude_providers(app: &AppHandle, providers: &[ClaudeProvider]) -> Result<(), String> {
    let path = data_dir(app)?.join(CLAUDE_PROVIDERS_FILE);
    let file = ClaudeProvidersFile {
        providers: providers.to_vec(),
    };
    let text =
        "# Claude 中转站列表：name = 显示名，url = ANTHROPIC_BASE_URL，key = ANTHROPIC_AUTH_TOKEN\n"
            .to_string() + &toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}
