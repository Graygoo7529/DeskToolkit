//! 对 home 所指 .codex 目录下 config.toml / auth.json 的最小化修改。
//!
//! config.toml 采用文本级手术式替换：只动 `[model_providers.OpenAI]` 段内的
//! `base_url` 一行（缺失则插入/追加），其余内容逐字节保留。
//! auth.json 仅替换 `"OPENAI_API_KEY"` 的字符串值，保留其余字段与格式。

use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

const PROVIDER_SECTION: &str = "[model_providers.OpenAI]";
const AUTH_FIELD: &str = "\"OPENAI_API_KEY\"";

#[derive(Debug, Clone, Default, Serialize)]
pub struct HomeStatus {
    pub config_exists: bool,
    pub auth_exists: bool,
    pub base_url: Option<String>,
    pub api_key_masked: Option<String>,
    /// 原始 key 仅用于匹配 provider，不序列化到前端。
    #[serde(skip)]
    pub api_key: Option<String>,
    pub matched_provider: Option<String>,
}

#[derive(Debug, Default)]
pub struct ApplyOutcome {
    pub created_config: bool,
    pub created_auth: bool,
}

pub fn mask_key(key: &str) -> String {
    let n = key.chars().count();
    if n <= 7 {
        return "••••••".to_string();
    }
    let head: String = key.chars().take(3).collect();
    let tail: String = key.chars().skip(n - 4).collect();
    format!("{head}•••{tail}")
}

fn detect_eol(s: &str) -> &'static str {
    if s.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn escape_toml_basic(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 去掉行内所有空白后比较，容忍 `[ model_providers.OpenAI ]` 之类的写法。
fn normalize_header(line: &str) -> String {
    line.chars().filter(|c| !c.is_whitespace()).collect()
}

/// 在 config.toml 文本中设置 `[model_providers.OpenAI]` 的 base_url。
pub fn patch_config_toml(content: &str, url: &str) -> String {
    let eol = detect_eol(content);
    let had_trailing_nl = content.ends_with('\n') || content.is_empty();
    let new_line = format!("base_url = \"{}\"", escape_toml_basic(url));
    let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    let mut header: Option<usize> = None;
    let mut base: Option<usize> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if header.is_some() {
                break; // 已离开目标段落
            }
            if normalize_header(trimmed) == PROVIDER_SECTION {
                header = Some(i);
            }
        } else if header.is_some() {
            if let Some(eq) = line.find('=') {
                if line[..eq].trim() == "base_url" {
                    base = Some(i);
                    break;
                }
            }
        }
    }

    match (header, base) {
        (Some(_), Some(bi)) => lines[bi] = new_line,
        (Some(hi), None) => lines.insert(hi + 1, new_line),
        (None, None) => {
            if lines.last().map(|l| !l.trim().is_empty()).unwrap_or(false) {
                lines.push(String::new());
            }
            lines.push(PROVIDER_SECTION.to_string());
            lines.push("name = \"OpenAI\"".to_string());
            lines.push(new_line);
        }
        (None, Some(_)) => unreachable!(),
    }

    let mut out = lines.join(eol);
    if had_trailing_nl {
        out.push_str(eol);
    }
    out
}

/// 从 config.toml 文本中提取 `[model_providers.OpenAI]` 的 base_url。
pub fn extract_base_url(content: &str) -> Option<String> {
    let mut in_section = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if in_section {
                return None;
            }
            in_section = normalize_header(trimmed) == PROVIDER_SECTION;
            continue;
        }
        if in_section {
            if let Some(eq) = line.find('=') {
                if line[..eq].trim() == "base_url" {
                    let value = line[eq + 1..].trim().trim_matches('"');
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// 在 auth.json 文本中设置 OPENAI_API_KEY，保留其余字段与排版。
pub fn patch_auth_json(content: &str, key: &str) -> String {
    let key_is_simple = !key.contains('"') && !key.contains('\\');
    if key_is_simple {
        if let Some(field_pos) = content.find(AUTH_FIELD) {
            let after_field = field_pos + AUTH_FIELD.len();
            let rest = &content[after_field..];
            if let Some(colon_rel) = rest.find(':') {
                let after_colon = &rest[colon_rel + 1..];
                if let Some(quote_rel) = after_colon.find('"') {
                    let val_start = after_field + colon_rel + 1 + quote_rel + 1;
                    if let Some(close_rel) = content[val_start..].find('"') {
                        let mut out = String::with_capacity(content.len() + key.len());
                        out.push_str(&content[..val_start]);
                        out.push_str(key);
                        out.push_str(&content[val_start + close_rel..]);
                        return out;
                    }
                }
            }
        }
    }
    // 兜底：解析为 JSON 后写入（保持键顺序，两空格缩进）。
    let mut value: serde_json::Value =
        serde_json::from_str(content).unwrap_or_else(|_| serde_json::json!({}));
    if !value.is_object() {
        value = serde_json::json!({});
    }
    value["OPENAI_API_KEY"] = serde_json::Value::String(key.to_string());
    let mut out = serde_json::to_string_pretty(&value)
        .unwrap_or_else(|_| format!("{{\n  \"OPENAI_API_KEY\": \"{key}\"\n}}"));
    out.push('\n');
    out
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(c) => Ok(Some(c)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取 {} 失败：{e}", path.display())),
    }
}

/// 将 provider 应用到指定 home：更新其 config.toml 的 base_url 与 auth.json 的 key。
pub fn apply_provider(home_location: &str, url: &str, key: &str) -> Result<ApplyOutcome, String> {
    let dir = Path::new(home_location);
    if !dir.is_dir() {
        return Err(format!("Home 目录不存在：{home_location}"));
    }
    let mut outcome = ApplyOutcome::default();

    let config_path = dir.join("config.toml");
    let config = read_optional(&config_path)?;
    outcome.created_config = config.is_none();
    let patched = patch_config_toml(config.as_deref().unwrap_or(""), url);
    fs::write(&config_path, patched).map_err(|e| format!("写入 config.toml 失败：{e}"))?;

    let auth_path = dir.join("auth.json");
    let auth = read_optional(&auth_path)?;
    outcome.created_auth = auth.is_none();
    let patched_auth = patch_auth_json(auth.as_deref().unwrap_or(""), key);
    fs::write(&auth_path, patched_auth).map_err(|e| format!("写入 auth.json 失败：{e}"))?;

    Ok(outcome)
}

/// 读取 home 当前状态（config/auth 是否存在、base_url、脱敏 key）。
pub fn read_status(home_location: &str) -> HomeStatus {
    let dir = Path::new(home_location);
    let mut status = HomeStatus::default();

    if let Ok(Some(config)) = read_optional(&dir.join("config.toml")) {
        status.config_exists = true;
        status.base_url = extract_base_url(&config);
    }
    if let Ok(Some(auth)) = read_optional(&dir.join("auth.json")) {
        status.auth_exists = true;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&auth) {
            if let Some(key) = value
                .get("OPENAI_API_KEY")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                status.api_key = Some(key.to_string());
                status.api_key_masked = Some(mask_key(key));
            }
        }
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CONFIG: &str = r#"model_provider = "OpenAI"
model = "gpt-5.5"
disable_response_storage = true

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://api.example.invalid"
wire_api = "responses"
requires_openai_auth = true

[features]
goals = true

[projects.'c:\users\example\.codex']
trust_level = "trusted"
"#;

    #[test]
    fn 替换已有_base_url_且其余逐字节保留() {
        let out = patch_config_toml(SAMPLE_CONFIG, "https://gateway.example.invalid");
        assert!(out.contains("base_url = \"https://gateway.example.invalid\""));
        assert!(!out.contains("api.example.invalid"));
        let old_lines: Vec<&str> = SAMPLE_CONFIG.lines().collect();
        let new_lines: Vec<&str> = out.lines().collect();
        assert_eq!(old_lines.len(), new_lines.len());
        for (a, b) in old_lines.iter().zip(new_lines.iter()) {
            if a.trim_start().starts_with("base_url") {
                continue;
            }
            assert_eq!(a, b);
        }
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn 段落存在但缺_base_url_时插入() {
        let input = "[model_providers.OpenAI]\nname = \"OpenAI\"\nwire_api = \"responses\"\n";
        let out = patch_config_toml(input, "https://x.com");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[1], "base_url = \"https://x.com\"");
        assert_eq!(lines[2], "name = \"OpenAI\"");
    }

    #[test]
    fn 段落缺失时在文件末尾追加() {
        let input = "model = \"gpt-5.5\"\n\n[features]\ngoals = true\n";
        let out = patch_config_toml(input, "https://x.com");
        assert!(out.starts_with(input));
        assert!(out.contains(
            "\n[model_providers.OpenAI]\nname = \"OpenAI\"\nbase_url = \"https://x.com\"\n"
        ));
    }

    #[test]
    fn 空文件创建段落() {
        let out = patch_config_toml("", "https://x.com");
        assert_eq!(
            out,
            "[model_providers.OpenAI]\nname = \"OpenAI\"\nbase_url = \"https://x.com\"\n"
        );
    }

    #[test]
    fn 保留_crlf_行尾() {
        let input = "[model_providers.OpenAI]\r\nbase_url = \"https://old.com\"\r\nwire_api = \"responses\"\r\n";
        let out = patch_config_toml(input, "https://new.com");
        assert!(out.contains("\r\n"));
        assert!(!out.contains("\nbase_url = \"https://new.com\"\n")); // 不应出现纯 LF
        assert!(out.contains("base_url = \"https://new.com\"\r\n"));
    }

    #[test]
    fn 不触碰注释里的_base_url() {
        let input = "[model_providers.OpenAI]\n# base_url = \"https://comment.com\"\nbase_url = \"https://old.com\"\n";
        let out = patch_config_toml(input, "https://new.com");
        assert!(out.contains("# base_url = \"https://comment.com\""));
        assert!(out.contains("\nbase_url = \"https://new.com\""));
    }

    #[test]
    fn 提取_base_url() {
        assert_eq!(
            extract_base_url(SAMPLE_CONFIG).as_deref(),
            Some("https://api.example.invalid")
        );
        assert_eq!(extract_base_url("[features]\ngoals = true\n"), None);
    }

    #[test]
    fn auth_替换保留格式() {
        let input = "{\n  \"OPENAI_API_KEY\": \"test-key-old\"\n}\n";
        let out = patch_auth_json(input, "test-key-new");
        assert_eq!(out, "{\n  \"OPENAI_API_KEY\": \"test-key-new\"\n}\n");
    }

    #[test]
    fn auth_保留其他字段() {
        let input = "{\n  \"OTHER\": 1,\n  \"OPENAI_API_KEY\": \"test-key-old\",\n  \"x\": true\n}";
        let out = patch_auth_json(input, "test-key-new");
        assert!(out.contains("\"OTHER\": 1"));
        assert!(out.contains("\"OPENAI_API_KEY\": \"test-key-new\""));
        assert!(out.contains("\"x\": true"));
    }

    #[test]
    fn auth_缺失或空文件时新建() {
        let out = patch_auth_json("", "test-key-new");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["OPENAI_API_KEY"], "test-key-new");
    }

    #[test]
    fn 掩码() {
        assert_eq!(mask_key("test-key-abcdef123456"), "tes•••3456");
        assert_eq!(mask_key("short"), "••••••");
    }

    #[test]
    fn 端到端_应用到临时目录() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join(".codex");
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("config.toml"), SAMPLE_CONFIG).unwrap();
        fs::write(
            home.join("auth.json"),
            "{\n  \"OPENAI_API_KEY\": \"test-key-old\"\n}\n",
        )
        .unwrap();

        let outcome = apply_provider(
            home.to_str().unwrap(),
            "https://gateway.example.invalid",
            "test-key-new-123",
        )
        .unwrap();
        assert!(!outcome.created_config && !outcome.created_auth);

        let config = fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(config.contains("base_url = \"https://gateway.example.invalid\""));
        assert!(config.contains("[projects.'c:\\users\\example\\.codex']"));
        let auth = fs::read_to_string(home.join("auth.json")).unwrap();
        assert_eq!(auth, "{\n  \"OPENAI_API_KEY\": \"test-key-new-123\"\n}\n");

        let status = read_status(home.to_str().unwrap());
        assert!(status.config_exists && status.auth_exists);
        assert_eq!(
            status.base_url.as_deref(),
            Some("https://gateway.example.invalid")
        );
        assert_eq!(status.api_key_masked.as_deref(), Some("tes•••-123"));
    }

    #[test]
    fn 端到端_目录不存在时报错() {
        let err = apply_provider("Z:/no/such/dir", "https://api.example.invalid", "test-key")
            .unwrap_err();
        assert!(err.contains("不存在"));
    }
}
