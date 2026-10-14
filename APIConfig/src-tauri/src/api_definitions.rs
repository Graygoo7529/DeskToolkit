//! Runtime-loaded TOML definitions for quota adapters and presentation layouts.
//!
//! Definitions are copied into the selected data directory on first launch and
//! are then loaded from there. This keeps built-in and user-authored profiles
//! on the same path and lets users edit or add profiles without recompiling.
use crate::inspection;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct LayoutDefinition {
    pub id: String,
    pub label: String,
    pub blocks: Vec<LayoutBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct LayoutBlock {
    pub component: String,
    pub source: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct WindowDefinition {
    pub id: String,
    pub label: String,
    pub scope_pointer: String,
    pub array_pointer: String,
    pub item_pointer: String,
    pub match_pointer: String,
    pub match_value: String,
    pub used_pointer: String,
    pub limit_pointer: String,
    pub limit_value: Option<f64>,
    pub remaining_pointer: String,
    pub reset_pointer: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, deny_unknown_fields)]
pub struct AdapterDefinition {
    pub id: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    pub layout_id: String,
    pub request_method: String,
    pub request_path: String,
    pub request_auth: String,
    #[serde(default)]
    pub request_body: String,
    pub balance_pointer: String,
    pub fallback_balance_pointer: String,
    pub unit_pointer: String,
    pub default_unit: String,
    pub membership_pointer: String,
    pub array_pointer: String,
    pub match_pointer: String,
    pub match_value: String,
    pub windows: Vec<WindowDefinition>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdapterView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    pub layout_id: String,
    pub layout_label: String,
    pub blocks: Vec<LayoutBlock>,
    pub editable: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct CustomProfileInput {
    #[serde(default)]
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default)]
    pub layout_id: String,
    pub layout_label: String,
    pub request_method: String,
    pub request_path: String,
    pub request_auth: String,
    #[serde(default)]
    pub request_body: String,
    #[serde(default)]
    pub balance_pointer: String,
    #[serde(default)]
    pub fallback_balance_pointer: String,
    #[serde(default)]
    pub unit_pointer: String,
    #[serde(default)]
    pub default_unit: String,
    #[serde(default)]
    pub membership_pointer: String,
    #[serde(default)]
    pub blocks: Vec<LayoutBlock>,
    #[serde(default)]
    pub windows: Vec<WindowDefinition>,
}

#[derive(Debug, Clone, Default)]
pub struct Registry {
    adapters: Vec<AdapterDefinition>,
    layouts: Vec<LayoutDefinition>,
}

impl Registry {
    pub fn load(root: &Path) -> Result<Self, String> {
        let adapters = load_dir::<AdapterDefinition>(&root.join("adapters"), "adapters")?;
        let layouts = load_dir::<LayoutDefinition>(&root.join("layouts"), "layouts")?;
        if adapters.is_empty() {
            return Err("数据目录的 definitions/adapters 为空".into());
        }
        if layouts.is_empty() {
            return Err("数据目录的 definitions/layouts 为空".into());
        }
        let registry = Self { adapters, layouts };
        registry.validate()?;
        Ok(registry)
    }

    fn validate(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for layout in &self.layouts {
            if !valid_id(&layout.id) || !ids.insert(&layout.id) {
                return Err("布局 ID 为空或重复，请检查 definitions/layouts".into());
            }
            for block in &layout.blocks {
                let valid = match block.component.as_str() {
                    "balance_card" => block.source == "balance",
                    "quota_card" => block.source.starts_with("windows.") && block.source.len() > 8,
                    "membership" => block.source == "membership",
                    _ => false,
                };
                if !valid {
                    return Err(format!("布局 {} 的组件或数据绑定无效", layout.id));
                }
            }
        }
        ids.clear();
        for adapter in &self.adapters {
            if !valid_id(&adapter.id) || !ids.insert(&adapter.id) {
                return Err("适配器 ID 为空或重复，请检查 definitions/adapters".into());
            }
            let layout = self
                .layouts
                .iter()
                .find(|layout| layout.id == adapter.layout_id)
                .ok_or_else(|| format!("适配器 {} 引用的布局不存在", adapter.id))?;
            if adapter.kind == "none" {
                continue;
            }
            if !matches!(adapter.kind.as_str(), "balance" | "subscription") {
                return Err(format!(
                    "适配器 {} 的 kind 应为 balance 或 subscription",
                    adapter.id
                ));
            }
            if !matches!(adapter.request_method.as_str(), "GET" | "POST")
                || adapter.request_path.trim().is_empty()
            {
                return Err(format!("适配器 {} 的请求方法或路径无效", adapter.id));
            }
            if !matches!(
                adapter.request_auth.as_str(),
                "bearer" | "x_api_key" | "none"
            ) {
                return Err(format!("适配器 {} 的认证方式无效", adapter.id));
            }
            let mut window_ids = std::collections::HashSet::new();
            for window in &adapter.windows {
                if window.id.is_empty() || !window_ids.insert(&window.id) {
                    return Err(format!("适配器 {} 的窗口 ID 为空或重复", adapter.id));
                }
                for pointer in [
                    &window.scope_pointer,
                    &window.array_pointer,
                    &window.item_pointer,
                    &window.match_pointer,
                    &window.used_pointer,
                    &window.limit_pointer,
                    &window.remaining_pointer,
                    &window.reset_pointer,
                ] {
                    validate_pointer(pointer, &adapter.id)?;
                }
            }
            for pointer in [
                &adapter.balance_pointer,
                &adapter.fallback_balance_pointer,
                &adapter.unit_pointer,
                &adapter.membership_pointer,
                &adapter.array_pointer,
                &adapter.match_pointer,
            ] {
                validate_pointer(pointer, &adapter.id)?;
            }
            for block in &layout.blocks {
                if let Some(id) = block.source.strip_prefix("windows.") {
                    if !adapter.windows.iter().any(|window| window.id == id) {
                        return Err(format!("适配器 {} 缺少布局需要的窗口 {id}", adapter.id));
                    }
                }
            }
        }
        Ok(())
    }

    pub fn adapter(&self, id: &str) -> Option<AdapterDefinition> {
        self.adapters.iter().find(|item| item.id == id).cloned()
    }

    pub fn adapter_views(&self) -> Vec<AdapterView> {
        self.adapters
            .iter()
            .map(|adapter| {
                let layout = self
                    .layouts
                    .iter()
                    .find(|layout| layout.id == adapter.layout_id);
                AdapterView {
                    id: adapter.id.clone(),
                    label: adapter.label.clone(),
                    description: adapter.description.clone(),
                    kind: adapter.kind.clone(),
                    layout_id: adapter.layout_id.clone(),
                    layout_label: layout.map(|item| item.label.clone()).unwrap_or_default(),
                    blocks: layout.map(|item| item.blocks.clone()).unwrap_or_default(),
                    editable: adapter.id.starts_with("custom_") || adapter.id.starts_with("user_"),
                }
            })
            .collect()
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn validate_pointer(pointer: &str, id: &str) -> Result<(), String> {
    if !pointer.is_empty() && !pointer.starts_with('/') {
        return Err(format!("适配器 {id} 的字段路径需使用 JSON Pointer"));
    }
    Ok(())
}

fn load_dir<T: for<'de> Deserialize<'de>>(dir: &Path, label: &str) -> Result<Vec<T>, String> {
    let entries =
        fs::read_dir(dir).map_err(|_| format!("找不到数据目录中的 definitions/{label} 文件夹"))?;
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
        .collect::<Vec<_>>();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let text = fs::read_to_string(&path)
                .map_err(|_| format!("无法读取定义文件 {}", path.display()))?;
            toml::from_str(text.trim_start_matches('\u{feff}'))
                .map_err(|_| format!("定义文件 {} 格式无效，请检查 TOML", path.display()))
        })
        .collect()
}

pub fn load_for_app(app: &AppHandle) -> Result<Registry, String> {
    let _guard = crate::data::lock()?;
    let dir = crate::data::data_dir(app)?.join("definitions");
    Registry::load(&dir)
}

pub fn migrate_legacy_profiles(root: &Path) -> Result<(), String> {
    let dir = root.join("adapters");
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|_| "无法读取额度适配器目录")? {
        let path = entry.map_err(|_| "无法读取额度适配器目录")?.path();
        if path.extension().is_none_or(|ext| ext != "toml") {
            continue;
        }
        let text = fs::read_to_string(&path)
            .map_err(|_| format!("无法读取定义文件 {}", path.display()))?;
        let mut adapter: AdapterDefinition = toml::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|_| format!("定义文件 {} 格式无效，请检查 TOML", path.display()))?;
        if adapter.kind != "custom" {
            continue;
        }
        if adapter.request_path.trim().is_empty()
            || (adapter.windows.is_empty() && adapter.balance_pointer.trim().is_empty())
        {
            let backup_dir = root.join("legacy-backup");
            fs::create_dir_all(&backup_dir).map_err(|_| "无法备份旧额度方案")?;
            let name = path.file_name().ok_or("旧额度方案文件名无效")?;
            let mut backup = backup_dir.join(name);
            let mut suffix = 1;
            while backup.exists() {
                backup = backup_dir.join(format!("{}.{}.bak", name.to_string_lossy(), suffix));
                suffix += 1;
            }
            fs::rename(&path, backup).map_err(|_| "无法备份旧额度方案")?;
            continue;
        }
        adapter.kind = if adapter.windows.is_empty() {
            "balance".into()
        } else {
            "subscription".into()
        };
        if adapter.layout_id.trim().is_empty() {
            adapter.layout_id = if adapter.windows.is_empty() {
                "balance".into()
            } else {
                "subscription_daily".into()
            };
        }
        let normalized = toml::to_string_pretty(&adapter)
            .map_err(|_| format!("无法迁移定义文件 {}", path.display()))?;
        crate::data::atomic_write(&path, &normalized)?;
    }
    Ok(())
}

pub fn has_legacy_profiles(root: &Path) -> bool {
    let Ok(entries) = fs::read_dir(root.join("adapters")) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        let path = entry.path();
        path.extension().is_some_and(|ext| ext == "toml")
            && fs::read_to_string(&path)
                .ok()
                .and_then(|text| {
                    toml::from_str::<toml::Value>(text.trim_start_matches('\u{feff}')).ok()
                })
                .and_then(|value| {
                    value
                        .get("kind")
                        .and_then(toml::Value::as_str)
                        .map(|kind| kind == "custom")
                })
                .unwrap_or(false)
    })
}

/// Convert a legacy inline quota setting into the current file based schema.
/// This is used only while migrating old scene/API files; the runtime registry
/// accepts only `none`, `balance`, and `subscription` definitions.
pub fn write_migrated_profile(
    definitions_dir: &Path,
    id: &str,
    label: &str,
    presentation: &str,
    path: &str,
    auth: &str,
    balance: &str,
    used: &str,
    limit: &str,
    remaining: &str,
    reset: &str,
    unit: &str,
) -> Result<(), String> {
    let mut definition = AdapterDefinition {
        id: id.trim().into(),
        label: label.trim().into(),
        description: "使用此账号的接口地址与 Key 查询".into(),
        kind: if presentation == "balance" {
            "balance"
        } else {
            "subscription"
        }
        .into(),
        layout_id: format!("{id}_layout"),
        request_method: "GET".into(),
        request_path: path.trim().into(),
        request_auth: auth.trim().into(),
        balance_pointer: if presentation == "balance" || presentation == "balance_quota" {
            balance.trim()
        } else {
            ""
        }
        .into(),
        default_unit: unit.trim().into(),
        ..Default::default()
    };
    if presentation == "quota" || presentation == "balance_quota" {
        definition.windows.push(WindowDefinition {
            id: "custom".into(),
            required: true,
            label: "额度".into(),
            used_pointer: used.trim().into(),
            limit_pointer: limit.trim().into(),
            remaining_pointer: remaining.trim().into(),
            reset_pointer: reset.trim().into(),
            ..Default::default()
        });
    }
    let mut layout = LayoutDefinition {
        id: definition.layout_id.clone(),
        label: if presentation == "balance" {
            "余额"
        } else {
            "额度"
        }
        .into(),
        blocks: vec![LayoutBlock {
            component: if presentation == "balance" {
                "balance_card"
            } else {
                "quota_card"
            }
            .into(),
            source: if presentation == "balance" {
                "balance"
            } else {
                "windows.custom"
            }
            .into(),
            title: if presentation == "balance" {
                "账户余额"
            } else {
                "周期额度"
            }
            .into(),
        }],
    };
    if presentation == "balance_quota" {
        layout.blocks.insert(
            0,
            LayoutBlock {
                component: "balance_card".into(),
                source: "balance".into(),
                title: "账户余额".into(),
            },
        );
    }
    Registry {
        adapters: vec![definition.clone()],
        layouts: vec![layout.clone()],
    }
    .validate()?;
    let dir = definitions_dir.join("adapters");
    fs::create_dir_all(&dir).map_err(|_| "无法创建自定义额度适配器目录")?;
    let layout_dir = definitions_dir.join("layouts");
    fs::create_dir_all(&layout_dir).map_err(|_| "无法创建额度布局目录")?;
    let file = dir.join(format!("{}.toml", definition.id));
    let text = toml::to_string_pretty(&definition).map_err(|_| "无法生成自定义额度适配器")?;
    let layout_text = toml::to_string_pretty(&layout).map_err(|_| "无法生成额度布局")?;
    crate::data::atomic_write(
        &layout_dir.join(format!("{}.toml", layout.id)),
        &layout_text,
    )?;
    crate::data::atomic_write(&file, &text)
}

pub fn write_profile(definitions_dir: &Path, input: &CustomProfileInput) -> Result<(), String> {
    if !valid_id(&input.id) || !(input.id.starts_with("custom_") || input.id.starts_with("user_")) {
        return Err("自定义方案 ID 无效".into());
    }
    if input.label.trim().is_empty() || !matches!(input.kind.as_str(), "balance" | "subscription") {
        return Err("自定义方案名称或类型无效".into());
    }
    if !matches!(input.request_method.as_str(), "GET" | "POST")
        || input.request_path.trim().is_empty()
        || !matches!(input.request_auth.as_str(), "bearer" | "x_api_key" | "none")
    {
        return Err("查询方式、路径或认证方式无效".into());
    }
    if input.request_method == "GET" && !input.request_body.trim().is_empty() {
        return Err("GET 请求不能配置 Body".into());
    }
    if !input.request_body.trim().is_empty() {
        let body: serde_json::Value =
            serde_json::from_str(&input.request_body).map_err(|_| "POST Body 必须是合法 JSON")?;
        if !body.is_object() {
            return Err("POST Body 顶层必须是 JSON 对象".into());
        }
    }
    let layout = LayoutDefinition {
        id: input.layout_id.trim().to_string(),
        label: input.layout_label.trim().to_string(),
        blocks: input.blocks.clone(),
    };
    let definition = AdapterDefinition {
        id: input.id.trim().to_string(),
        label: input.label.trim().to_string(),
        description: "使用此账号的接口地址与 Key 查询".into(),
        kind: input.kind.trim().to_string(),
        layout_id: layout.id.clone(),
        request_method: input.request_method.trim().to_string(),
        request_path: input.request_path.trim().to_string(),
        request_auth: input.request_auth.trim().to_string(),
        request_body: input.request_body.trim().to_string(),
        balance_pointer: input.balance_pointer.trim().to_string(),
        fallback_balance_pointer: input.fallback_balance_pointer.trim().to_string(),
        unit_pointer: input.unit_pointer.trim().to_string(),
        default_unit: input.default_unit.trim().to_string(),
        membership_pointer: input.membership_pointer.trim().to_string(),
        windows: input.windows.clone(),
        ..Default::default()
    };
    if definition.kind == "balance" && definition.balance_pointer.is_empty() {
        return Err("余额方案需要余额字段路径".into());
    }
    if definition.kind == "subscription" && definition.windows.is_empty() {
        return Err("额度方案至少需要一个额度窗口".into());
    }
    let mut registry = Registry::load(definitions_dir)?;
    if registry.adapter(&definition.id).is_some() {
        return Err("此自定义方案 ID 已存在".into());
    }
    registry.adapters.push(definition.clone());
    registry.layouts.push(layout.clone());
    registry.validate()?;
    let adapters = definitions_dir.join("adapters");
    let layouts = definitions_dir.join("layouts");
    fs::create_dir_all(&adapters).map_err(|_| "无法创建自定义方案目录")?;
    fs::create_dir_all(&layouts).map_err(|_| "无法创建额度布局目录")?;
    let adapter_path = adapters.join(format!("{}.toml", definition.id));
    let layout_path = layouts.join(format!("{}.toml", layout.id));
    let adapter_text = toml::to_string_pretty(&definition).map_err(|_| "无法生成额度适配器")?;
    let layout_text = toml::to_string_pretty(&layout).map_err(|_| "无法生成额度布局")?;
    crate::data::atomic_write(&layout_path, &layout_text)?;
    if let Err(error) = crate::data::atomic_write(&adapter_path, &adapter_text) {
        let _ = fs::remove_file(&layout_path);
        return Err(error);
    }
    Ok(())
}

pub fn new_custom_profile_id(label: &str) -> String {
    custom_profile_id(&format!(
        "{}:{}",
        label,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

pub fn custom_profile_id(name: &str) -> String {
    let hash = name
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("custom_{hash:016x}")
}

pub fn auth(value: &str) -> inspection::Auth {
    match value.trim().to_ascii_lowercase().as_str() {
        "x_api_key" | "x-api-key" => inspection::Auth::XApiKey,
        "none" => inspection::Auth::None,
        _ => inspection::Auth::Bearer,
    }
}

#[tauri::command]
pub fn get_api_probe_profiles(app: AppHandle) -> Result<Vec<AdapterView>, String> {
    Ok(load_for_app(&app)?.adapter_views())
}

#[tauri::command]
pub fn create_quota_profile(
    app: AppHandle,
    mut input: CustomProfileInput,
) -> Result<AdapterView, String> {
    let _guard = crate::data::lock()?;
    let definitions = crate::data::data_dir(&app)?.join("definitions");
    if input.id.trim().is_empty() {
        input.id = new_custom_profile_id(&input.label);
    }
    if input.layout_id.trim().is_empty() {
        input.layout_id = format!("{}_layout", input.id);
    }
    write_profile(&definitions, &input)?;
    Registry::load(&definitions)?
        .adapter_views()
        .into_iter()
        .find(|profile| profile.id == input.id)
        .ok_or_else(|| "额度方案生成后无法读取".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_registry() -> Registry {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../definitions");
        Registry::load(&root).expect("source definitions should be valid")
    }

    #[test]
    fn definitions_are_valid_and_exposed() {
        let items = source_registry().adapter_views();
        assert!(items.iter().any(|item| item.id == "quota_sub2api"));
        assert!(items.iter().any(|item| item.id == "balance_deepseek"));
        assert!(items.iter().any(|item| item.id == "quota_kimi"));
        assert!(items.iter().any(|item| item.id == "none"));
    }

    #[test]
    fn custom_ids_are_stable() {
        assert_eq!(
            custom_profile_id("My Provider"),
            custom_profile_id("My Provider")
        );
        assert_ne!(custom_profile_id("账户一"), custom_profile_id("账户二"));
    }

    #[test]
    fn custom_files_are_loaded_and_edits_are_visible_without_recompile() {
        let dir = tempfile::tempdir().unwrap();
        write_migrated_profile(
            dir.path(),
            "sample",
            "示例",
            "quota",
            "/usage",
            "bearer",
            "",
            "/used",
            "/total",
            "/left",
            "",
            "USD",
        )
        .unwrap();
        let registry = Registry::load(dir.path()).unwrap();
        assert_eq!(
            registry.adapter_views()[0].blocks[0].component,
            "quota_card"
        );
        assert_eq!(
            registry.adapter_views()[0].blocks[0].source,
            "windows.custom"
        );
        assert_eq!(registry.adapter("sample").unwrap().kind, "subscription");
        let path = dir.path().join("layouts/sample_layout.toml");
        let text = fs::read_to_string(&path)
            .unwrap()
            .replace("周期额度", "每月额度");
        fs::write(path, text).unwrap();
        assert_eq!(
            Registry::load(dir.path()).unwrap().adapter_views()[0].blocks[0].title,
            "每月额度"
        );
        fs::copy(
            dir.path().join("adapters/sample.toml"),
            dir.path().join("adapters/duplicate.toml"),
        )
        .unwrap();
        assert!(Registry::load(dir.path()).unwrap_err().contains("重复"));
    }
}

#[cfg(test)]
pub fn source_registry_for_tests() -> Registry {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../definitions");
    Registry::load(&root).expect("source definitions should be valid")
}
