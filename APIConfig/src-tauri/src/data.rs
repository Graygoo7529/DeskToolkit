//! 按场景保存面板数据；storage.json 仅记录用户选择的数据目录。
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const FILES: [&str; 3] = ["codex.toml", "claude.toml", "apis.toml"];
const KIMI_LEGACY: &str = "kimi.toml";
const LEGACY: [&str; 5] = [
    "homes.toml",
    "providers.toml",
    "claude_homes.toml",
    "claude_providers.toml",
    "kimi.json",
];
const PALETTE: [&str; 8] = [
    "#A7B8EF", "#86CDB7", "#DDB18D", "#C7A4DE", "#86C6DC", "#DDA5B5", "#C4CC8C", "#A4BFDA",
];
fn version() -> u32 {
    1
}
fn api_version() -> u32 {
    6
}
// Serialize storage reads/writes, but release before any network await.
static STORAGE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub fn lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORAGE_LOCK
        .lock()
        .map_err(|_| "配置操作中断，请重启应用".into())
}
fn canonical(path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|_| "无法访问目录")?;
    #[cfg(windows)]
    if let Some(value) = path.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        return Ok(if let Some(unc) = value.strip_prefix(r"UNC\") {
            PathBuf::from(format!(r"\\{unc}"))
        } else {
            PathBuf::from(value)
        });
    }
    Ok(path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Home {
    pub name: String,
    pub location: String,
}
pub type ClaudeHome = Home;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub name: String,
    pub url: String,
    pub key: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub inspection: crate::inspection::InspectionSettings,
}
pub type ClaudeProvider = Provider;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    Subscription,
    #[default]
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiAccount {
    pub name: String,
    #[serde(default)]
    pub kind: AccountKind,
    #[serde(default)]
    pub endpoints: Vec<crate::api_probe::ApiEndpoint>,
    #[serde(default)]
    pub quota: crate::api_probe::ApiQuotaSettings,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub console_url: String,
    #[serde(default)]
    pub declared_models: Vec<String>,
    // Kept only so version 1 apis.toml files can be upgraded in place.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub anthropic_url: String,
    pub key: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Serialize, Deserialize)]
struct ApiFile {
    #[serde(default = "version")]
    version: u32,
    #[serde(default)]
    accounts: Vec<ApiAccount>,
    #[serde(default)]
    kimi_imported: bool,
}

impl Default for ApiFile {
    fn default() -> Self {
        Self {
            version: api_version(),
            accounts: vec![],
            kimi_imported: false,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct SceneFile {
    #[serde(default = "version")]
    version: u32,
    #[serde(default)]
    homes: Vec<Home>,
    #[serde(default)]
    providers: Vec<Provider>,
}
impl Default for SceneFile {
    fn default() -> Self {
        Self {
            version: 3,
            homes: vec![],
            providers: vec![],
        }
    }
}
#[derive(Serialize, Deserialize)]
struct KimiAccount {
    pub name: String,
    pub url: String,
    pub key: String,
}
impl Default for KimiAccount {
    fn default() -> Self {
        Self {
            name: "Kimi Code".into(),
            url: "https://api.kimi.com/coding/v1".into(),
            key: String::new(),
        }
    }
}
#[derive(Serialize, Deserialize)]
struct KimiFile {
    #[serde(default = "version")]
    version: u32,
    account: KimiAccount,
}
impl Default for KimiFile {
    fn default() -> Self {
        Self {
            version: 1,
            account: KimiAccount::default(),
        }
    }
}
#[derive(Serialize, Deserialize)]
struct StoragePreferences {
    data_dir: PathBuf,
}

pub fn atomic_write(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("配置路径无效")?;
    let mut temp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法写入配置目录，请检查目录权限")?;
    temp.write_all(text.as_bytes())
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "写入配置失败")?;
    temp.persist(path)
        .map_err(|_| "无法替换配置文件，请检查文件权限或占用")?;
    Ok(())
}
fn read<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path).map_err(|_| format!("无法读取 {}", path.display()))?;
    toml::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| format!("{} 格式无效，请检查配置文件", path.display()))
}
fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = toml::to_string_pretty(value).map_err(|_| "无法生成配置文件")?;
    atomic_write(
        path,
        &("# APIConfig · 本地配置，包含凭据，请妥善保存。\n".to_string() + &text),
    )
}
fn normalize_colors(providers: &mut [Provider]) -> bool {
    let mut changed = false;
    for index in 0..providers.len() {
        let color = &providers[index].color;
        if color.len() == 7
            && color.starts_with('#')
            && color[1..].bytes().all(|c| c.is_ascii_hexdigit())
        {
            continue;
        }
        let color = PALETTE
            .iter()
            .min_by_key(|color| {
                providers
                    .iter()
                    .filter(|p| p.color.eq_ignore_ascii_case(color))
                    .count()
            })
            .unwrap();
        providers[index].color = color.to_string();
        changed = true;
    }
    changed
}
fn validate_scene(value: &SceneFile) -> Result<(), String> {
    if value.version != 3 {
        return Err("配置版本不受支持，请备份后重新配置".into());
    }
    for names in [
        value.homes.iter().map(|h| &h.name).collect::<Vec<_>>(),
        value.providers.iter().map(|p| &p.name).collect(),
    ] {
        let mut seen = std::collections::HashSet::new();
        if names
            .iter()
            .any(|name| name.trim().is_empty() || !seen.insert(*name))
        {
            return Err("配置中有空名称或重名项目，请先修正".into());
        }
    }
    Ok(())
}

fn validate_api_file(value: &ApiFile) -> Result<(), String> {
    if value.version != api_version() {
        return Err("API 配置版本不受支持，请使用更新版本的 APIConfig".into());
    }
    let mut names = std::collections::HashSet::new();
    for account in &value.accounts {
        if !names.insert(account.name.as_str()) {
            return Err("API 配置中有重名账号".into());
        }
        crate::api_probe::validate_account(account)?;
    }
    Ok(())
}

pub fn default_console_url(account: &ApiAccount) -> Option<&'static str> {
    let address = account
        .endpoints
        .iter()
        .map(|endpoint| endpoint.url.as_str())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if address.contains("aliyuncs.com") || address.contains("token-plan.") {
        Some("https://bailian.console.aliyun.com/")
    } else if address.contains("deepseek.com") {
        Some("https://platform.deepseek.com/")
    } else if address.contains("bigmodel.cn") {
        Some("https://open.bigmodel.cn/usercenter/apikeys")
    } else if address.contains("moonshot.cn") {
        Some("https://platform.moonshot.cn/console/api-keys")
    } else if address.contains("minimaxi.com") || address.contains("minimax.cn") {
        Some("https://platform.minimaxi.com/")
    } else if address.contains("zhizengzeng.com") {
        Some("https://platform.zhizengzeng.com/")
    } else if address.contains("api.kimi.com") || address.contains("platform.kimi.com") {
        Some("https://platform.kimi.com/")
    } else if address.contains("orcarouter.ai") {
        Some("https://www.orcarouter.ai/console/keys")
    } else {
        None
    }
}

fn archive_legacy(dir: &Path, file: &str) -> Result<(), String> {
    let source = dir.join(file);
    if !source.exists() {
        return Ok(());
    }
    let backup = dir.join("legacy-backup");
    fs::create_dir_all(&backup).map_err(|_| "无法创建旧配置备份目录")?;
    let mut target = backup.join(file);
    let mut suffix = 1;
    while target.exists() {
        target = backup.join(format!("{file}.{suffix}.bak"));
        suffix += 1;
    }
    fs::rename(source, target).map_err(|_| "旧配置归档失败，请检查目录权限")?;
    Ok(())
}
/// One-time conversion; live provider settings only contain a profile reference.
fn read_scene_migrated(path: &Path, dir: &Path, scene: &str) -> Result<(SceneFile, bool), String> {
    use crate::{api_definitions as defs, inspection};
    let mut raw: toml::Value = read(path)?;
    let old_version = raw
        .get("version")
        .and_then(toml::Value::as_integer)
        .unwrap_or(1);
    if old_version == 2 {
        return Err("配置版本不受支持，请备份后重新配置".into());
    }
    if old_version != 1 {
        return Ok((raw.try_into().map_err(|_| "场景配置格式无效")?, false));
    }
    if let Some(providers) = raw.get_mut("providers").and_then(toml::Value::as_array_mut) {
        for provider in providers {
            let name = provider
                .get("name")
                .and_then(toml::Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let base = provider
                .get("url")
                .and_then(toml::Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let Some(q) = provider
                .get_mut("inspection")
                .and_then(|i| i.get_mut("quota"))
            else {
                continue;
            };
            if q.get("profile").is_some() {
                continue;
            }
            let text = |field: &str| {
                q.get(field)
                    .and_then(toml::Value::as_str)
                    .unwrap_or_default()
                    .to_owned()
            };
            let adapter = text("adapter");
            let definitions = dir.join("definitions");
            let id = defs::custom_profile_id(&format!("{scene}:{name}:migration"));
            let profile = match adapter.as_str() {
                "" | "none" => "none".to_string(),
                "kimi" => {
                    let registry = defs::Registry::load(&definitions)?;
                    let mut definition = registry
                        .adapter("quota_kimi")
                        .ok_or("迁移需要 Kimi 额度定义")?;
                    let resolved = inspection::endpoint(&base, &text("path"), "usages")?;
                    let default_url = crate::quota::query_url(&base, &definition.request_path)?;
                    if resolved == default_url
                        && matches!(text("auth").as_str(), "" | "bearer")
                        && text("unit").is_empty()
                    {
                        "quota_kimi".into()
                    } else {
                        definition.id = id.clone();
                        definition.label = format!("{name} · Kimi");
                        definition.request_path = match resolved.query() {
                            Some(query) => format!("{}?{query}", resolved.path()),
                            None => resolved.path().into(),
                        };
                        definition.request_auth_mode = if text("auth").is_empty() {
                            "auto".into()
                        } else if text("auth") == "none" {
                            "none".into()
                        } else {
                            "auto".into()
                        };
                        definition.default_unit = text("unit");
                        let file = definitions.join("adapters").join(format!("{id}.toml"));
                        if !file.exists() {
                            write(&file, &definition)?;
                        }
                        id
                    }
                }
                "custom" => {
                    // Preserve declared balance and window components, including mixed old settings.
                    let balance = text("balance_pointer");
                    let window = ["used_pointer", "limit_pointer", "remaining_pointer"]
                        .iter()
                        .any(|p| !text(p).is_empty());
                    let presentation = if balance.is_empty() {
                        "quota"
                    } else if window {
                        "balance_quota"
                    } else {
                        "balance"
                    };
                    let auth = text("auth");
                    if !definitions
                        .join("adapters")
                        .join(format!("{id}.toml"))
                        .exists()
                    {
                        defs::write_migrated_profile(
                            &definitions,
                            &id,
                            &name,
                            presentation,
                            &text("path"),
                            if auth == "none" { "none" } else { "auto" },
                            &balance,
                            &text("used_pointer"),
                            &text("limit_pointer"),
                            &text("remaining_pointer"),
                            &text("reset_pointer"),
                            &text("unit"),
                        )?;
                    }
                    id
                }
                _ => return Err("旧额度适配器无法识别，请检查配置".into()),
            };
            *q = toml::Value::try_from(crate::quota::Settings { profile })
                .map_err(|_| "无法迁移额度设置")?;
        }
    }
    raw.as_table_mut()
        .ok_or("场景配置格式无效")?
        .insert("version".into(), toml::Value::Integer(3));
    Ok((raw.try_into().map_err(|_| "场景配置格式无效")?, true))
}

/// 完整验证各场景后写入新布局，再把原文件移至 legacy-backup。
pub fn prepare_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "无法创建数据目录")?;
    let mut scenes = Vec::new();
    for (file, homes, providers) in [
        (FILES[0], LEGACY[0], LEGACY[1]),
        (FILES[1], LEGACY[2], LEGACY[3]),
    ] {
        let exists = dir.join(file).exists();
        let mut migrated = false;
        let mut scene = if exists {
            let (scene, changed) = read_scene_migrated(&dir.join(file), dir, file)?;
            migrated = changed;
            scene
        } else {
            SceneFile {
                homes: if dir.join(homes).exists() {
                    read_scene_migrated(&dir.join(homes), dir, file)?.0.homes
                } else {
                    vec![]
                },
                providers: if dir.join(providers).exists() {
                    read_scene_migrated(&dir.join(providers), dir, file)?
                        .0
                        .providers
                } else {
                    vec![]
                },
                ..Default::default()
            }
        };
        validate_scene(&scene)?;
        let colors_changed = normalize_colors(&mut scene.providers);
        scenes.push((file, scene, !exists || colors_changed || migrated, migrated));
    }
    let kimi_exists = dir.join(KIMI_LEGACY).exists();
    let kimi: KimiFile = if kimi_exists {
        read(&dir.join(KIMI_LEGACY))?
    } else if dir.join(LEGACY[4]).exists() {
        let text = fs::read_to_string(dir.join(LEGACY[4])).map_err(|_| "无法读取旧 Kimi 配置")?;
        KimiFile {
            version: 1,
            account: serde_json::from_str(text.trim_start_matches('\u{feff}'))
                .map_err(|_| "旧 Kimi 配置格式无效")?,
        }
    } else {
        KimiFile::default()
    };
    if kimi.version != 1 {
        return Err("Kimi 配置版本不受支持".into());
    }
    let api_path = dir.join(FILES[2]);
    let mut api: ApiFile = if api_path.exists() {
        read(&api_path)?
    } else {
        ApiFile::default()
    };
    let mut api_changed = false;
    if api.version == 1 {
        for account in &mut api.accounts {
            if account.endpoints.is_empty() {
                if !account.url.trim().is_empty() {
                    account.endpoints.push(crate::api_probe::ApiEndpoint::new(
                        crate::api_probe::Protocol::Openai,
                        &account.url,
                    ));
                }
                if !account.anthropic_url.trim().is_empty() {
                    account.endpoints.push(crate::api_probe::ApiEndpoint::new(
                        crate::api_probe::Protocol::Anthropic,
                        &account.anthropic_url,
                    ));
                }
            }
            if account.endpoints.iter().any(|endpoint| {
                endpoint.url.contains("token-plan.") || endpoint.url.contains("/coding")
            }) {
                account.kind = AccountKind::Subscription;
            }
            if account.quota.adapter == crate::api_probe::QuotaAdapter::None {
                let address = account
                    .endpoints
                    .iter()
                    .map(|endpoint| endpoint.url.as_str())
                    .collect::<Vec<_>>()
                    .join(" ");
                account.quota.adapter = if address.contains("api.kimi.com/coding") {
                    crate::api_probe::QuotaAdapter::Kimi
                } else if address.contains("deepseek.com") {
                    crate::api_probe::QuotaAdapter::Deepseek
                } else if address.contains("moonshot.cn") {
                    crate::api_probe::QuotaAdapter::Moonshot
                } else if address.contains("zhizengzeng.com") {
                    crate::api_probe::QuotaAdapter::Zhizz
                } else {
                    crate::api_probe::QuotaAdapter::None
                };
            }
            account.url.clear();
            account.anthropic_url.clear();
        }
        api.version = 2;
        api_changed = true;
    }
    if api.version < api_version() {
        for account in &mut api.accounts {
            if account.quota.profile.trim().is_empty() {
                account.quota.profile = match account.quota.adapter {
                    crate::api_probe::QuotaAdapter::Kimi => "quota_kimi",
                    crate::api_probe::QuotaAdapter::Deepseek => "balance_deepseek",
                    crate::api_probe::QuotaAdapter::Moonshot => "balance_moonshot",
                    crate::api_probe::QuotaAdapter::Zhizz => "balance_zhizz",
                    crate::api_probe::QuotaAdapter::Sub2api => "quota_sub2api",
                    crate::api_probe::QuotaAdapter::Minimax => "quota_minimax",
                    crate::api_probe::QuotaAdapter::LegacyCustom => "balance_custom",
                    crate::api_probe::QuotaAdapter::None => "none",
                }
                .into();
            }
            let address = account
                .endpoints
                .iter()
                .map(|endpoint| endpoint.url.to_ascii_lowercase())
                .collect::<Vec<_>>()
                .join(" ");
            if account.quota.adapter == crate::api_probe::QuotaAdapter::Minimax
                && (address.contains("minimaxi.com") || address.contains("minimax"))
            {
                account.quota.adapter = crate::api_probe::QuotaAdapter::None;
                account.quota.profile = "none".into();
            }
            if account.quota.profile == "quota_sub2api" && account.kind == AccountKind::Direct {
                account.quota.profile = "balance_sub2api".into();
            }
            if account.quota.profile == "balance_custom" {
                let q = &account.quota;
                let id = crate::api_definitions::custom_profile_id(&account.name);
                let auth_mode = match q.auth_mode {
                    crate::inspection::Auth::Auto => "auto",
                    crate::inspection::Auth::None => "none",
                };
                crate::api_definitions::write_migrated_profile(
                    &dir.join("definitions"),
                    &id,
                    &account.name,
                    if q.balance_pointer.is_empty() {
                        "quota"
                    } else {
                        "balance"
                    },
                    &q.path,
                    auth_mode,
                    &q.balance_pointer,
                    &q.used_pointer,
                    &q.limit_pointer,
                    &q.remaining_pointer,
                    &q.reset_pointer,
                    &q.unit,
                )?;
                account.quota.profile = id;
            }
        }
        api.version = api_version();
        api_changed = true;
    }
    if !api.kimi_imported && !kimi.account.key.trim().is_empty() {
        let already = api
            .accounts
            .iter()
            .any(|account| account.key == kimi.account.key);
        if !already {
            let mut name = kimi.account.name.clone();
            let mut suffix = 2;
            while api.accounts.iter().any(|account| account.name == name) {
                name = format!("{} ({suffix})", kimi.account.name);
                suffix += 1;
            }
            api.accounts.push(ApiAccount {
                name,
                kind: AccountKind::Subscription,
                endpoints: vec![crate::api_probe::ApiEndpoint::new(
                    crate::api_probe::Protocol::Openai,
                    &kimi.account.url,
                )],
                quota: crate::api_probe::ApiQuotaSettings {
                    profile: "quota_kimi".into(),
                    adapter: crate::api_probe::QuotaAdapter::Kimi,
                    ..Default::default()
                },
                console_url: "https://platform.kimi.com/".into(),
                key: kimi.account.key.clone(),
                color: "#9CA9FF".into(),
                url: String::new(),
                anthropic_url: String::new(),
                declared_models: vec![],
            });
        }
        api.kimi_imported = true;
        api_changed = true;
    }
    for (index, account) in api.accounts.iter_mut().enumerate() {
        if account.color.len() != 7 || !account.color.starts_with('#') {
            account.color = PALETTE[index % PALETTE.len()].into();
            api_changed = true;
        }
        if account.console_url.trim().is_empty() {
            if let Some(url) = default_console_url(account) {
                account.console_url = url.into();
                api_changed = true;
            }
        }
    }
    if let Ok(registry) = crate::api_definitions::Registry::load(&dir.join("definitions")) {
        for account in &mut api.accounts {
            if account.quota.profile == "balance_custom"
                && registry.adapter(&account.quota.profile).is_none()
            {
                account.quota.profile = "none".into();
                api_changed = true;
            }
        }
    }
    api.version = api_version();
    validate_api_file(&api)?;
    for (file, scene, changed, migrated) in &scenes {
        if *changed {
            if *migrated {
                let backup = dir.join("legacy-backup");
                fs::create_dir_all(&backup).map_err(|_| "无法创建旧查询设置备份")?;
                let mut target = backup.join(format!("{file}.quota-v1.bak"));
                let mut suffix = 1;
                while target.exists() {
                    target = backup.join(format!("{file}.quota-v1.{suffix}.bak"));
                    suffix += 1;
                }
                fs::copy(dir.join(file), target).map_err(|_| "无法备份旧查询设置")?;
            }
            write(&dir.join(file), scene)?;
        }
    }
    if api_changed || !api_path.exists() {
        write(&api_path, &api)?;
    }
    for file in LEGACY {
        archive_legacy(dir, file)?;
    }
    archive_legacy(dir, KIMI_LEGACY)?;
    Ok(())
}
fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| "无法获取应用配置目录".into())
}
fn resolve_dir(default: &Path) -> Result<PathBuf, String> {
    let settings = default.join("storage.json");
    if !settings.exists() {
        return Ok(default.into());
    }
    let prefs: StoragePreferences =
        serde_json::from_str(&fs::read_to_string(settings).map_err(|_| "无法读取数据目录设置")?)
            .map_err(|_| "storage.json 格式无效")?;
    if !prefs.data_dir.is_absolute() {
        return Err("数据目录必须为绝对路径".into());
    }
    if !prefs.data_dir.is_dir() {
        return Err("已设置的数据目录不存在，请恢复目录或通过数据目录设置重新选择".into());
    }
    Ok(prefs.data_dir)
}
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = resolve_dir(&default_dir(app)?)?;
    ensure_probe_definitions(app, &dir)?;
    crate::api_definitions::migrate_legacy_profiles(&dir.join("definitions"))?;
    prepare_dir(&dir)?;
    Ok(dir)
}

fn copy_missing_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|_| "无法创建 definitions 配置目录")?;
    for entry in fs::read_dir(source).map_err(|_| "无法读取 definitions 资源")? {
        let entry = entry.map_err(|_| "无法读取 definitions 资源")?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_missing_tree(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to).map_err(|_| format!("无法复制定义文件 {}", to.display()))?;
        }
    }
    Ok(())
}

const EMBEDDED_DEFINITIONS: &[(&str, &str)] = &[
    (
        "adapters/deepseek.toml",
        include_str!("../../definitions/adapters/deepseek.toml"),
    ),
    (
        "adapters/kimi.toml",
        include_str!("../../definitions/adapters/kimi.toml"),
    ),
    (
        "adapters/minimax.toml",
        include_str!("../../definitions/adapters/minimax.toml"),
    ),
    (
        "adapters/moonshot.toml",
        include_str!("../../definitions/adapters/moonshot.toml"),
    ),
    (
        "adapters/none.toml",
        include_str!("../../definitions/adapters/none.toml"),
    ),
    (
        "adapters/sub2api.toml",
        include_str!("../../definitions/adapters/sub2api.toml"),
    ),
    (
        "adapters/sub2api_balance.toml",
        include_str!("../../definitions/adapters/sub2api_balance.toml"),
    ),
    (
        "adapters/sub2api_periods.toml",
        include_str!("../../definitions/adapters/sub2api_periods.toml"),
    ),
    (
        "adapters/quota_opencode_go.toml",
        include_str!("../../definitions/adapters/quota_opencode_go.toml"),
    ),
    (
        "adapters/zhizz.toml",
        include_str!("../../definitions/adapters/zhizz.toml"),
    ),
    (
        "layouts/balance.toml",
        include_str!("../../definitions/layouts/balance.toml"),
    ),
    (
        "layouts/none.toml",
        include_str!("../../definitions/layouts/none.toml"),
    ),
    (
        "layouts/hourly.toml",
        include_str!("../../definitions/layouts/hourly.toml"),
    ),
    (
        "layouts/daily.toml",
        include_str!("../../definitions/layouts/daily.toml"),
    ),
    (
        "layouts/weekly.toml",
        include_str!("../../definitions/layouts/weekly.toml"),
    ),
    (
        "layouts/monthly.toml",
        include_str!("../../definitions/layouts/monthly.toml"),
    ),
];

fn write_embedded_definitions(target: &Path) -> Result<(), String> {
    for (relative, content) in EMBEDDED_DEFINITIONS {
        let path = target.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|_| "无法创建内置 definitions 目录")?;
        }
        fs::write(path, content).map_err(|_| "无法写入内置额度定义")?;
    }
    Ok(())
}

/// Seed the selected data directory from packaged resources once. Files are
/// never overwritten, so edits and custom definitions remain user-owned.
fn ensure_probe_definitions(app: &AppHandle, dir: &Path) -> Result<(), String> {
    let target = dir.join("definitions");
    if target.exists() {
        return Ok(());
    }
    let packaged = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("definitions"));
    let sibling = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("definitions")));
    let source = packaged
        .filter(|path| path.is_dir())
        .or_else(|| sibling.filter(|path| path.is_dir()));
    #[cfg(debug_assertions)]
    let source =
        source.or_else(|| Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions")));
    fs::create_dir_all(dir).map_err(|_| "无法创建数据目录")?;
    let staged = tempfile::tempdir_in(dir).map_err(|_| "无法初始化 definitions 目录")?;
    if let Some(source) = source {
        copy_missing_tree(&source, &staged.path().join("definitions"))?;
    } else {
        write_embedded_definitions(&staged.path().join("definitions"))?;
    }
    fs::rename(staged.path().join("definitions"), &target)
        .map_err(|_| "无法保存 definitions 目录".to_string())
}
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryStatus {
    Empty,
    Valid,
    Legacy,
    Invalid,
    Current,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectoryReport {
    pub status: DirectoryStatus,
    pub message: String,
    pub path: String,
    pub entries: Vec<String>,
    pub backup_path: Option<String>,
}

fn backup_name(target: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("APIConfig");
    let base = target
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{name}.apiconfig-backup-{stamp}"));
    if !base.exists() {
        return base;
    }
    for suffix in 1..1000 {
        let candidate = base.with_extension(format!("{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    base
}

fn directory_report(default: &Path, target: &Path) -> Result<DirectoryReport, String> {
    if !target.exists() {
        return Ok(DirectoryReport {
            status: DirectoryStatus::Empty,
            message: "目录不存在，将创建并初始化".into(),
            path: target.display().to_string(),
            entries: vec![],
            backup_path: None,
        });
    }
    if !target.is_dir() {
        return Err("请选择一个本地目录".into());
    }
    let mut entries = fs::read_dir(target)
        .map_err(|_| "无法读取所选目录，请检查权限")?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect::<Vec<_>>();
    entries.sort();
    let current = resolve_dir(default)
        .ok()
        .and_then(|path| canonical(&path).ok())
        .and_then(|path| canonical(target).ok().map(|target| path == target))
        .unwrap_or(false);
    if current {
        return Ok(DirectoryReport {
            status: DirectoryStatus::Current,
            message: "当前正在使用此目录".into(),
            path: target.display().to_string(),
            entries,
            backup_path: None,
        });
    }
    let known_current = FILES.iter().any(|file| target.join(file).exists());
    let known_legacy =
        LEGACY.iter().any(|file| target.join(file).exists()) || target.join(KIMI_LEGACY).exists();
    let mut parse_invalid = false;
    let mut legacy_version = false;
    for (file, expected) in [(FILES[0], 3_u32), (FILES[1], 3_u32)] {
        if target.join(file).exists() {
            match read::<SceneFile>(&target.join(file)) {
                Ok(value) if value.version == expected => {}
                Ok(_) => legacy_version = true,
                Err(_) => parse_invalid = true,
            }
        }
    }
    if target.join(FILES[2]).exists() {
        match read::<ApiFile>(&target.join(FILES[2])) {
            Ok(value) if value.version == api_version() => {}
            Ok(_) => legacy_version = true,
            Err(_) => parse_invalid = true,
        }
    }
    if target.join("definitions").exists() {
        if !target.join("definitions").is_dir() {
            parse_invalid = true;
        } else if crate::api_definitions::Registry::load(&target.join("definitions")).is_err()
            && !crate::api_definitions::has_legacy_profiles(&target.join("definitions"))
        {
            parse_invalid = true;
        } else if crate::api_definitions::has_legacy_profiles(&target.join("definitions")) {
            legacy_version = true;
        }
    }
    let status = if parse_invalid {
        DirectoryStatus::Invalid
    } else if known_legacy || legacy_version {
        DirectoryStatus::Legacy
    } else if known_current || target.join("definitions").is_dir() {
        DirectoryStatus::Valid
    } else if entries.is_empty() {
        DirectoryStatus::Empty
    } else {
        DirectoryStatus::Invalid
    };
    let message = match status {
        DirectoryStatus::Valid => "发现有效配置，将直接使用".into(),
        DirectoryStatus::Legacy => "发现旧版配置，将自动迁移并归档旧文件".into(),
        DirectoryStatus::Invalid => "目录包含无法识别的内容，需要备份后初始化".into(),
        DirectoryStatus::Empty => "空目录，将创建默认配置".into(),
        DirectoryStatus::Current => "当前正在使用此目录".into(),
    };
    let backup_path = if matches!(status, DirectoryStatus::Invalid) {
        Some(backup_name(target).display().to_string())
    } else {
        None
    };
    Ok(DirectoryReport {
        status,
        message,
        path: target.display().to_string(),
        entries,
        backup_path,
    })
}

fn switch_directory(default: &Path, target: &Path) -> Result<PathBuf, String> {
    if !target.is_absolute() {
        return Err("请选择本地目录的绝对路径".into());
    }
    fs::create_dir_all(target).map_err(|_| "无法创建目标目录")?;
    let target = canonical(target)?;
    prepare_dir(&target)?;
    // 验证目标可写，最后一步才更改启动时读取的目录指针。
    tempfile::NamedTempFile::new_in(&target).map_err(|_| "目标目录不可写")?;
    fs::create_dir_all(default).map_err(|_| "无法保存数据目录设置")?;
    let prefs = serde_json::to_string_pretty(&StoragePreferences {
        data_dir: target.clone(),
    })
    .map_err(|_| "无法生成目录设置")?;
    atomic_write(&default.join("storage.json"), &prefs)?;
    Ok(target)
}
pub fn inspect_dir(app: &AppHandle, path: &str) -> Result<DirectoryReport, String> {
    let target = Path::new(path.trim().trim_matches('"'));
    if !target.is_absolute() {
        return Err("请选择本地目录的绝对路径".into());
    }
    directory_report(&default_dir(app)?, target)
}
pub fn change_dir(app: &AppHandle, path: &str, confirm_backup: bool) -> Result<(), String> {
    let target = Path::new(path.trim().trim_matches('"'));
    if !target.is_absolute() {
        return Err("请选择本地目录的绝对路径".into());
    }
    fs::create_dir_all(target).map_err(|_| "无法创建目标目录")?;
    let default = default_dir(app)?;
    let report = directory_report(&default, target)?;
    let target = canonical(target)?;
    if matches!(report.status, DirectoryStatus::Invalid) {
        if !confirm_backup {
            return Err("DATA_DIR_CONFIRM_REQUIRED".into());
        }
        let backup = backup_name(&target);
        fs::rename(&target, &backup).map_err(|_| "无法备份原目录，请关闭占用文件后重试")?;
        fs::create_dir_all(&target).map_err(|_| "无法创建新的数据目录")?;
    }
    ensure_probe_definitions(app, &target)?;
    crate::api_definitions::migrate_legacy_profiles(&target.join("definitions"))?;
    switch_directory(&default, &target).map(|_| ())
}
fn load_scene(app: &AppHandle, file: &str) -> Result<SceneFile, String> {
    read(&data_dir(app)?.join(file))
}
fn update_scene(
    app: &AppHandle,
    file: &str,
    update: impl FnOnce(&mut SceneFile),
) -> Result<(), String> {
    let dir = data_dir(app)?;
    let mut scene: SceneFile = read(&dir.join(file))?;
    update(&mut scene);
    normalize_colors(&mut scene.providers);
    validate_scene(&scene)?;
    write(&dir.join(file), &scene)
}
pub fn load_homes(app: &AppHandle) -> Result<Vec<Home>, String> {
    Ok(load_scene(app, FILES[0])?.homes)
}
pub fn load_providers(app: &AppHandle) -> Result<Vec<Provider>, String> {
    Ok(load_scene(app, FILES[0])?.providers)
}
pub fn load_claude_homes(app: &AppHandle) -> Result<Vec<ClaudeHome>, String> {
    Ok(load_scene(app, FILES[1])?.homes)
}
pub fn load_claude_providers(app: &AppHandle) -> Result<Vec<ClaudeProvider>, String> {
    Ok(load_scene(app, FILES[1])?.providers)
}
pub fn save_homes(app: &AppHandle, values: &[Home]) -> Result<(), String> {
    update_scene(app, FILES[0], |s| s.homes = values.to_vec())
}
pub fn save_providers(app: &AppHandle, values: &[Provider]) -> Result<(), String> {
    update_scene(app, FILES[0], |s| s.providers = values.to_vec())
}
pub fn save_claude_homes(app: &AppHandle, values: &[ClaudeHome]) -> Result<(), String> {
    update_scene(app, FILES[1], |s| s.homes = values.to_vec())
}
pub fn save_claude_providers(app: &AppHandle, values: &[ClaudeProvider]) -> Result<(), String> {
    update_scene(app, FILES[1], |s| s.providers = values.to_vec())
}
pub fn load_api_accounts(app: &AppHandle) -> Result<Vec<ApiAccount>, String> {
    let file: ApiFile = read(&data_dir(app)?.join(FILES[2]))?;
    validate_api_file(&file)?;
    Ok(file.accounts)
}

pub fn save_api_accounts(app: &AppHandle, accounts: &[ApiAccount]) -> Result<(), String> {
    let mut file = ApiFile {
        version: api_version(),
        accounts: accounts.to_vec(),
        kimi_imported: true,
    };
    for (index, account) in file.accounts.iter_mut().enumerate() {
        if account.color.len() != 7 || !account.color.starts_with('#') {
            account.color = PALETTE[index % PALETTE.len()].to_string();
        }
    }
    validate_api_file(&file)?;
    write(&data_dir(app)?.join(FILES[2]), &file)
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn embedded_definitions_form_a_valid_registry() {
        let dir = tempfile::tempdir().unwrap();
        write_embedded_definitions(&dir.path().join("definitions")).unwrap();
        assert!(crate::api_definitions::Registry::load(&dir.path().join("definitions")).is_ok());
    }

    #[test]
    fn legacy_custom_definition_is_migrated() {
        let dir = tempfile::tempdir().unwrap();
        let definitions = dir.path().join("definitions");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions");
        for sub in ["adapters", "layouts"] {
            fs::create_dir_all(definitions.join(sub)).unwrap();
            for file in fs::read_dir(source.join(sub)).unwrap() {
                let file = file.unwrap();
                fs::copy(file.path(), definitions.join(sub).join(file.file_name())).unwrap();
            }
        }
        fs::write(
            definitions.join("adapters/old_custom.toml"),
            "id = \"old_custom\"\nlabel = \"旧方案\"\ndescription = \"\"\nkind = \"custom\"\nlayout_ids = [\"balance\"]\nrequest_method = \"GET\"\nrequest_path = \"/usage\"\nrequest_auth_mode = \"auto\"\nbalance_pointer = \"/balance\"\n",
        )
        .unwrap();
        crate::api_definitions::migrate_legacy_profiles(&definitions).unwrap();
        assert_eq!(
            crate::api_definitions::Registry::load(&definitions)
                .unwrap()
                .adapter("old_custom")
                .unwrap()
                .kind,
            "balance"
        );
    }

    fn legacy(dir: &Path) {
        fs::write(dir.join("homes.toml"), "[[homes]]\nname='Work'\nlocation='D:\\Home'\n[[homes]]\nname='Personal'\nlocation='D:\\Personal'\n").unwrap();
        fs::write(dir.join("providers.toml"), "[[providers]]\nname='Relay'\nurl='https://example.com/v1'\nkey='fixture-secret'\n[providers.inspection]\nmodels_path='/custom/models'\n[[providers]]\nname='Backup'\nurl='https://backup.example'\nkey='fixture-second'\n").unwrap();
        fs::write(
            dir.join("claude_homes.toml"),
            "[[homes]]\nname='Claude'\nlocation='D:\\ClaudeData'\n",
        )
        .unwrap();
        fs::write(dir.join("claude_providers.toml"), "[[providers]]\nname='Claude provider'\nurl='https://claude.example'\nkey='fixture-claude'\n").unwrap();
        fs::write(dir.join("kimi.json"), "\u{feff}{\"name\":\"Kimi\",\"url\":\"https://api.kimi.com/coding/v1\",\"key\":\"fixture-kimi\"}").unwrap();
    }
    #[test]
    fn scene_quota_migration_preserves_declared_components_credentials_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let definitions = dir.path().join("definitions");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions");
        for sub in ["adapters", "layouts"] {
            fs::create_dir_all(definitions.join(sub)).unwrap();
            for file in fs::read_dir(source.join(sub)).unwrap() {
                let file = file.unwrap();
                fs::copy(file.path(), definitions.join(sub).join(file.file_name())).unwrap();
            }
        }
        let original = r#"version = 1
[[homes]]
name = "home"
location = "D:/home"
[[providers]]
name = "Relay"
url = "https://example.test/v1"
key = "fixture-secret"
[providers.inspection]
models_path = "/my/models"
[providers.inspection.quota]
adapter = "custom"
path = "/account/usage"
auth = "x_api_key"
balance_pointer = "/balance"
remaining_pointer = "/left"
unit = "USD"
[[providers]]
name = "Kimi"
url = "https://api.kimi.com/coding"
key = "fixture-kimi"
[providers.inspection.quota]
adapter = "kimi"
"#;
        fs::write(dir.path().join(FILES[0]), original).unwrap();
        prepare_dir(dir.path()).unwrap();
        let scene: SceneFile = read(&dir.path().join(FILES[0])).unwrap();
        assert_eq!(scene.version, 3);
        assert_eq!(scene.providers[0].key, "fixture-secret");
        assert_eq!(scene.providers[0].inspection.models_path, "/my/models");
        assert_eq!(scene.homes[0].location, "D:/home");
        let registry = crate::api_definitions::Registry::load(&definitions).unwrap();
        let profile = &scene.providers[0].inspection.quota.profile;
        let definition = registry.adapter(profile).unwrap();
        assert_eq!(definition.balance_pointer, "/balance");
        assert_eq!(definition.windows[0].remaining_pointer, "/left");
        assert_eq!(definition.request_auth_mode, "auto");
        let views = registry.adapter_views();
        let view = views.iter().find(|v| &v.id == profile).unwrap();
        assert_eq!(
            view.blocks
                .iter()
                .map(|b| b.component.as_str())
                .collect::<Vec<_>>(),
            ["balance_card", "quota_card"]
        );
        let kimi = registry
            .adapter(&scene.providers[1].inspection.quota.profile)
            .unwrap();
        assert_eq!(kimi.request_path, "/coding/v1/usages");
        let saved = fs::read(dir.path().join(FILES[0])).unwrap();
        assert!(!String::from_utf8_lossy(&saved).contains("balance_pointer"));
        assert_eq!(
            fs::read_to_string(dir.path().join("legacy-backup/codex.toml.quota-v1.bak")).unwrap(),
            original
        );
        prepare_dir(dir.path()).unwrap();
        assert_eq!(fs::read(dir.path().join(FILES[0])).unwrap(), saved);
    }

    #[test]
    fn migrates_all_pages_preserves_keys_settings_order_and_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        legacy(dir.path());
        let old: Vec<_> = LEGACY
            .iter()
            .map(|f| fs::read(dir.path().join(f)).unwrap())
            .collect();
        prepare_dir(dir.path()).unwrap();
        let scene: SceneFile = read(&dir.path().join(FILES[0])).unwrap();
        assert_eq!(
            scene
                .homes
                .iter()
                .map(|h| h.name.as_str())
                .collect::<Vec<_>>(),
            ["Work", "Personal"]
        );
        assert_eq!(scene.providers[0].key, "fixture-secret");
        assert_eq!(scene.providers[1].key, "fixture-second");
        assert_eq!(scene.providers[0].inspection.models_path, "/custom/models");
        assert_ne!(scene.providers[0].color, scene.providers[1].color);
        let claude: SceneFile = read(&dir.path().join(FILES[1])).unwrap();
        assert_eq!(claude.providers[0].key, "fixture-claude");
        assert_eq!(claude.homes[0].location, "D:\\ClaudeData");
        let apis: ApiFile = read(&dir.path().join(FILES[2])).unwrap();
        assert_eq!(apis.accounts[0].key, "fixture-kimi");
        assert_eq!(apis.accounts[0].quota.profile, "quota_kimi");
        assert!(!dir.path().join(KIMI_LEGACY).exists());
        for (file, bytes) in LEGACY.iter().zip(old) {
            assert!(!dir.path().join(file).exists());
            assert_eq!(
                fs::read(dir.path().join("legacy-backup").join(file)).unwrap(),
                bytes
            );
        }
        let first: Vec<_> = FILES
            .iter()
            .map(|f| fs::read(dir.path().join(f)).unwrap())
            .collect();
        prepare_dir(dir.path()).unwrap();
        for (file, bytes) in FILES.iter().zip(first) {
            assert_eq!(fs::read(dir.path().join(file)).unwrap(), bytes);
        }
    }
    #[test]
    fn invalid_legacy_input_is_non_destructive_and_errors_do_not_echo_keys() {
        let dir = tempfile::tempdir().unwrap();
        legacy(dir.path());
        fs::write(dir.path().join("kimi.json"), "fixture-secret invalid json").unwrap();
        let error = prepare_dir(dir.path()).unwrap_err();
        assert!(!error.contains("fixture-secret"));
        assert!(FILES.iter().all(|f| !dir.path().join(f).exists()));
        assert!(LEGACY.iter().all(|f| dir.path().join(f).exists()));
    }
    #[test]
    fn automatic_switch_initializes_empty_directory_without_copying_current_data() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let target = root.path().join("target");
        fs::create_dir(&source).unwrap();
        prepare_dir(&source).unwrap();
        let packaged = Path::new(env!("CARGO_MANIFEST_DIR")).join("../definitions");
        copy_missing_tree(&packaged, &target.join("definitions")).unwrap();
        switch_directory(&source, &target).unwrap();
        assert!(target.join(FILES[0]).exists());
        assert!(target.join(FILES[1]).exists());
        assert!(target.join(FILES[2]).exists());
        assert_eq!(resolve_dir(&source).unwrap(), canonical(&target).unwrap());
        let occupied = root.path().join("occupied");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("providers.toml"), "keep-me").unwrap();
        assert!(switch_directory(&source, &occupied).is_err());
        assert_eq!(
            fs::read_to_string(occupied.join("providers.toml")).unwrap(),
            "keep-me"
        );
        assert_eq!(resolve_dir(&source).unwrap(), canonical(&target).unwrap());
    }
    #[test]
    fn existing_switch_validates_and_supports_recovery_from_missing_directory() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let target = root.path().join("target");
        fs::create_dir(&source).unwrap();
        prepare_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        legacy(&target);
        let broken = root.path().join("broken");
        fs::create_dir(&broken).unwrap();
        fs::write(broken.join("codex.toml"), "key = fixture-secret invalid").unwrap();
        let error = switch_directory(&source, &broken).unwrap_err();
        assert!(!error.contains("fixture-secret"));
        assert_eq!(resolve_dir(&source).unwrap(), source);
        atomic_write(
            &source.join("storage.json"),
            &serde_json::to_string(&StoragePreferences {
                data_dir: root.path().join("missing"),
            })
            .unwrap(),
        )
        .unwrap();
        assert!(resolve_dir(&source).is_err());
        switch_directory(&source, &target).unwrap();
        let scene: SceneFile = read(&resolve_dir(&source).unwrap().join(FILES[0])).unwrap();
        assert_eq!(scene.providers[0].key, "fixture-secret");
    }
    #[test]
    fn provider_identity_colors_survive_renames_reordering_and_new_entries() {
        let dir = tempfile::tempdir().unwrap();
        legacy(dir.path());
        prepare_dir(dir.path()).unwrap();
        let mut scene: SceneFile = read(&dir.path().join(FILES[0])).unwrap();
        let color = scene.providers[0].color.clone();
        scene.providers[0].name = "Renamed".into();
        scene.providers.reverse();
        let mut added = scene.providers[0].clone();
        added.color = "invalid".into();
        scene.providers.push(added);
        normalize_colors(&mut scene.providers);
        assert_eq!(scene.providers[1].color, color);
        assert_ne!(scene.providers[2].color, color);
        assert_ne!(scene.providers[2].color, scene.providers[0].color);
    }
}
