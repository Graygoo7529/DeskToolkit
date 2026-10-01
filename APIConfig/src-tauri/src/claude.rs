//! 对 Claude Code settings.json 的最小化修改。
//!
//! 中转站列表和 Claude 配置目录由 data 模块分别保存。应用中转站时只更新
//! settings.json 的 env.ANTHROPIC_BASE_URL 和 env.ANTHROPIC_AUTH_TOKEN，保留
//! 其他设置（例如 model、modelSettings 和额外环境变量）。

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const SETTINGS_FILE: &str = "settings.json";
const BASE_URL_ENV: &str = "ANTHROPIC_BASE_URL";
const AUTH_TOKEN_ENV: &str = "ANTHROPIC_AUTH_TOKEN";

#[derive(Debug, Clone, Default, Serialize)]
pub struct ClaudeStatus {
    pub settings_exists: bool,
    pub base_url: Option<String>,
    pub auth_token_masked: Option<String>,
    /// 原始 token 仅用于匹配 provider，不序列化到前端。
    #[serde(skip)]
    pub auth_token: Option<String>,
    pub matched_provider: Option<String>,
}

/// 接受配置目录，也兼容直接传入 settings.json 的完整路径。
pub fn settings_path(location: &str) -> PathBuf {
    let path = Path::new(location.trim().trim_matches('"'));
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    {
        path.to_path_buf()
    } else {
        path.join(SETTINGS_FILE)
    }
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取 {} 失败：{error}", path.display())),
    }
}

fn env_values(settings: &Value) -> (Option<String>, Option<String>) {
    let env = settings.get("env").and_then(Value::as_object);
    let read = |key: &str| {
        env.and_then(|values| values.get(key))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    };
    (read(BASE_URL_ENV), read(AUTH_TOKEN_ENV))
}

/// 将中转站 URL 和 token 写入指定配置目录下的 settings.json。
pub fn apply_provider(location: &str, url: &str, token: &str) -> Result<(), String> {
    let path = settings_path(location);
    let mut settings = match read_optional(&path)? {
        Some(content) => serde_json::from_str::<Value>(&content)
            .map_err(|error| format!("解析 {} 失败：{error}", path.display()))?,
        None => json!({
            "$schema": "https://json.schemastore.org/claude-code-settings.json",
            "env": {}
        }),
    };

    let root = settings
        .as_object_mut()
        .ok_or_else(|| format!("{} 的根节点必须是 JSON 对象", path.display()))?;
    let env = root.entry("env".to_string()).or_insert_with(|| json!({}));
    let env = env
        .as_object_mut()
        .ok_or_else(|| format!("{} 的 env 必须是 JSON 对象", path.display()))?;
    env.insert(BASE_URL_ENV.to_string(), Value::String(url.to_string()));
    env.insert(AUTH_TOKEN_ENV.to_string(), Value::String(token.to_string()));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 {} 失败：{error}", parent.display()))?;
    }
    let mut output = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("生成 {} 失败：{error}", path.display()))?;
    output.push('\n');
    fs::write(&path, output).map_err(|error| format!("写入 {} 失败：{error}", path.display()))
}

pub fn read_status(location: &str) -> ClaudeStatus {
    let path = settings_path(location);
    let mut status = ClaudeStatus {
        settings_exists: path.is_file(),
        ..Default::default()
    };

    let Ok(Some(content)) = read_optional(&path) else {
        return status;
    };
    let Ok(settings) = serde_json::from_str::<Value>(&content) else {
        return status;
    };
    let (base_url, auth_token) = env_values(&settings);
    status.base_url = base_url;
    if let Some(token) = auth_token {
        status.auth_token_masked = Some(crate::codex::mask_key(&token));
        status.auth_token = Some(token);
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn 更新_env_时保留其他设置() {
        let dir = tempdir().unwrap();
        let settings = dir.path().join(SETTINGS_FILE);
        fs::write(
            &settings,
            r#"{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "model": "opus",
  "env": {
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "ANTHROPIC_BASE_URL": "https://old.example"
  }
}
"#,
        )
        .unwrap();

        apply_provider(
            settings.to_str().unwrap(),
            "https://new.example",
            "token-new",
        )
        .unwrap();

        let value: Value = serde_json::from_str(&fs::read_to_string(settings).unwrap()).unwrap();
        assert_eq!(value["model"], "opus");
        assert_eq!(
            value["env"]["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
            "1"
        );
        assert_eq!(value["env"][BASE_URL_ENV], "https://new.example");
        assert_eq!(value["env"][AUTH_TOKEN_ENV], "token-new");
    }

    #[test]
    fn 空目录会创建_settings_json() {
        let dir = tempdir().unwrap();
        apply_provider(dir.path().to_str().unwrap(), "https://example", "token").unwrap();
        let path = dir.path().join(SETTINGS_FILE);
        assert!(path.is_file());
        let status = read_status(dir.path().to_str().unwrap());
        assert_eq!(status.base_url.as_deref(), Some("https://example"));
        assert_eq!(status.auth_token.as_deref(), Some("token"));
    }
}
