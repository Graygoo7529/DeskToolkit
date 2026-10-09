//! 按场景保存面板数据；storage.json 仅记录用户选择的数据目录。
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub const FILES: [&str; 4] = ["codex.toml", "claude.toml", "kimi.toml", "apis.toml"];
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiAccount {
    pub name: String,
    pub url: String,
    #[serde(default)]
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
}

impl Default for ApiFile {
    fn default() -> Self {
        Self {
            version: 1,
            accounts: vec![],
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
            version: 1,
            homes: vec![],
            providers: vec![],
        }
    }
}
#[derive(Serialize, Deserialize)]
pub struct KimiAccount {
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
    if value.version != 1 {
        return Err("配置版本不受支持，请使用更新版本的 APIConfig".into());
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
    if value.version != 1 {
        return Err("API 配置版本不受支持，请使用更新版本的 APIConfig".into());
    }
    let mut names = std::collections::HashSet::new();
    if value.accounts.iter().any(|a| {
        a.name.trim().is_empty()
            || a.key.trim().is_empty()
            || !names.insert(a.name.as_str())
            || endpoint_is_invalid(&a.url)
            || (!a.anthropic_url.trim().is_empty() && endpoint_is_invalid(&a.anthropic_url))
    }) {
        return Err("API 配置中有空字段、重名或无效地址，请先修正".into());
    }
    Ok(())
}

fn endpoint_is_invalid(value: &str) -> bool {
    let value = value.trim();
    value.is_empty() || (!value.starts_with("http://") && !value.starts_with("https://"))
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
        let mut scene = if exists {
            read::<SceneFile>(&dir.join(file))?
        } else {
            SceneFile {
                homes: if dir.join(homes).exists() {
                    read::<SceneFile>(&dir.join(homes))?.homes
                } else {
                    vec![]
                },
                providers: if dir.join(providers).exists() {
                    read::<SceneFile>(&dir.join(providers))?.providers
                } else {
                    vec![]
                },
                ..Default::default()
            }
        };
        validate_scene(&scene)?;
        let colors_changed = normalize_colors(&mut scene.providers);
        scenes.push((file, scene, !exists || colors_changed));
    }
    let kimi_exists = dir.join(FILES[2]).exists();
    let kimi: KimiFile = if kimi_exists {
        read(&dir.join(FILES[2]))?
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
    let api_path = dir.join(FILES[3]);
    if api_path.exists() {
        let api: ApiFile = read(&api_path)?;
        validate_api_file(&api)?;
    } else {
        write(&api_path, &ApiFile::default())?;
    }
    for (file, scene, changed) in &scenes {
        if *changed {
            write(&dir.join(file), scene)?;
        }
    }
    if !kimi_exists {
        write(&dir.join(FILES[2]), &kimi)?;
    }
    for file in LEGACY {
        let source = dir.join(file);
        if !source.exists() {
            continue;
        }
        let backup = dir.join("legacy-backup");
        fs::create_dir_all(&backup).map_err(|_| "新配置已生成，但无法创建旧配置备份目录")?;
        let target = backup.join(file);
        if target.exists() {
            return Err(
                "新配置已生成，但旧配置备份已存在；请检查 legacy-backup 后移走根目录中的旧文件"
                    .into(),
            );
        }
        fs::rename(source, target).map_err(|_| "新配置已生成，但旧配置归档失败，请检查目录权限")?;
    }
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
    prepare_dir(&dir)?;
    Ok(dir)
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryMode {
    Copy,
    Existing,
}
fn switch_directory(default: &Path, target: &Path, mode: DirectoryMode) -> Result<PathBuf, String> {
    if !target.is_absolute() {
        return Err("请选择本地目录的绝对路径".into());
    }
    fs::create_dir_all(target).map_err(|_| "无法创建目标目录")?;
    let target = canonical(target)?;
    let current = resolve_dir(default);
    if current
        .as_ref()
        .ok()
        .and_then(|p| canonical(p).ok())
        .as_ref()
        == Some(&target)
    {
        prepare_dir(&target)?;
        return Ok(target);
    }
    match mode {
        DirectoryMode::Copy => {
            if FILES
                .iter()
                .chain(LEGACY.iter())
                .any(|f| target.join(f).exists())
            {
                return Err("目标目录已有配置；请选择“使用已有配置”，或选择新的空目录".into());
            }
            let source = current?;
            prepare_dir(&source)?;
            let staged = tempfile::tempdir_in(&target).map_err(|_| "目标目录不可写")?;
            for file in FILES {
                fs::copy(source.join(file), staged.path().join(file))
                    .map_err(|_| "复制配置失败，当前目录未改变")?;
            }
            let mut copied = Vec::new();
            for file in FILES {
                let result = (|| -> Result<(), String> {
                    let content =
                        fs::read(staged.path().join(file)).map_err(|_| "读取复制配置失败")?;
                    let mut temp =
                        tempfile::NamedTempFile::new_in(&target).map_err(|_| "目标目录不可写")?;
                    temp.write_all(&content)
                        .and_then(|_| temp.as_file().sync_all())
                        .map_err(|_| "复制配置失败")?;
                    temp.persist_noclobber(target.join(file))
                        .map_err(|_| "目标文件已存在或无法写入")?;
                    Ok(())
                })();
                if let Err(error) = result {
                    for created in copied {
                        let _ = fs::remove_file(created);
                    }
                    return Err(error);
                }
                copied.push(target.join(file));
            }
        }
        DirectoryMode::Existing => {
            if !FILES
                .iter()
                .chain(LEGACY.iter())
                .any(|f| target.join(f).exists())
            {
                return Err("此目录没有 APIConfig 配置；请选择“复制当前配置”".into());
            }
            prepare_dir(&target)?;
        }
    }
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
pub fn change_dir(app: &AppHandle, path: &str, mode: DirectoryMode) -> Result<(), String> {
    switch_directory(
        &default_dir(app)?,
        Path::new(path.trim().trim_matches('"')),
        mode,
    )
    .map(|_| ())
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
pub fn load_kimi(app: &AppHandle) -> Result<KimiAccount, String> {
    Ok(read::<KimiFile>(&data_dir(app)?.join(FILES[2]))?.account)
}
pub fn save_kimi(app: &AppHandle, account: KimiAccount) -> Result<(), String> {
    write(
        &data_dir(app)?.join(FILES[2]),
        &KimiFile {
            version: 1,
            account,
        },
    )
}

pub fn load_api_accounts(app: &AppHandle) -> Result<Vec<ApiAccount>, String> {
    let file: ApiFile = read(&data_dir(app)?.join(FILES[3]))?;
    validate_api_file(&file)?;
    Ok(file.accounts)
}

pub fn save_api_accounts(app: &AppHandle, accounts: &[ApiAccount]) -> Result<(), String> {
    let mut file = ApiFile {
        version: 1,
        accounts: accounts.to_vec(),
    };
    for (index, account) in file.accounts.iter_mut().enumerate() {
        if account.color.len() != 7 || !account.color.starts_with('#') {
            account.color = PALETTE[index % PALETTE.len()].to_string();
        }
    }
    validate_api_file(&file)?;
    write(&data_dir(app)?.join(FILES[3]), &file)
}

#[cfg(test)]
mod storage_tests {
    use super::*;
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
        let kimi: KimiFile = read(&dir.path().join(FILES[2])).unwrap();
        assert_eq!(kimi.account.key, "fixture-kimi");
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
    fn copy_switch_is_persistent_and_never_overwrites_existing_configs() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let target = root.path().join("target");
        fs::create_dir(&source).unwrap();
        legacy(&source);
        prepare_dir(&source).unwrap();
        switch_directory(&source, &target, DirectoryMode::Copy).unwrap();
        assert_eq!(resolve_dir(&source).unwrap(), canonical(&target).unwrap());
        for file in FILES {
            assert_eq!(
                fs::read(source.join(file)).unwrap(),
                fs::read(target.join(file)).unwrap()
            );
        }
        let occupied = root.path().join("occupied");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("providers.toml"), "keep-me").unwrap();
        assert!(switch_directory(&source, &occupied, DirectoryMode::Copy).is_err());
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
        let error = switch_directory(&source, &broken, DirectoryMode::Existing).unwrap_err();
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
        switch_directory(&source, &target, DirectoryMode::Existing).unwrap();
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
