mod api_manager;
mod claude;
mod codex;
mod data;
mod inspection;
mod kimi;

use data::{ClaudeHome, ClaudeProvider, Home, Provider};
use serde::Serialize;
use std::collections::HashMap;
use tauri::AppHandle;

#[derive(Serialize)]
struct State {
    homes: Vec<Home>,
    providers: Vec<ProviderView>,
    data_dir: String,
    statuses: HashMap<String, codex::HomeStatus>,
    claude_homes: Vec<ClaudeHome>,
    claude_providers: Vec<ProviderView>,
    claude_statuses: HashMap<String, claude::ClaudeStatus>,
}

#[derive(Serialize)]
struct ProviderView {
    name: String,
    color: String,
    url: String,
    key_masked: String,
    inspection: inspection::InspectionSettings,
}

fn assemble(app: &AppHandle) -> Result<State, String> {
    let homes = data::load_homes(app)?;
    let providers = data::load_providers(app)?;
    let claude_homes = data::load_claude_homes(app)?;
    let claude_providers = data::load_claude_providers(app)?;
    let mut statuses = HashMap::new();
    for home in &homes {
        let mut status = codex::read_status(&home.location);
        status.matched_provider = providers
            .iter()
            .find(|p| {
                Some(p.url.as_str()) == status.base_url.as_deref()
                    && Some(p.key.as_str()) == status.api_key.as_deref()
            })
            .map(|p| p.name.clone());
        statuses.insert(home.name.clone(), status);
    }
    let provider_views = providers
        .iter()
        .map(|provider| ProviderView {
            name: provider.name.clone(),
            color: provider.color.clone(),
            url: provider.url.clone(),
            key_masked: codex::mask_key(&provider.key),
            inspection: provider.inspection.clone(),
        })
        .collect();
    let mut claude_statuses = HashMap::new();
    for home in &claude_homes {
        let mut status = claude::read_status(&home.location);
        status.matched_provider = claude_providers
            .iter()
            .find(|provider| {
                Some(provider.url.as_str()) == status.base_url.as_deref()
                    && Some(provider.key.as_str()) == status.auth_token.as_deref()
            })
            .map(|provider| provider.name.clone());
        claude_statuses.insert(home.name.clone(), status);
    }
    let claude_provider_views = claude_providers
        .iter()
        .map(|provider| ProviderView {
            name: provider.name.clone(),
            color: provider.color.clone(),
            url: provider.url.clone(),
            key_masked: codex::mask_key(&provider.key),
            inspection: provider.inspection.clone(),
        })
        .collect();
    let data_dir = data::data_dir(app)?.display().to_string();
    Ok(State {
        homes,
        providers: provider_views,
        data_dir,
        statuses,
        claude_homes,
        claude_providers: claude_provider_views,
        claude_statuses,
    })
}

fn check_unique<T>(
    items: &[T],
    name: &str,
    original: Option<&str>,
    get: impl Fn(&T) -> &str,
    kind: &str,
) -> Result<(), String> {
    if items
        .iter()
        .any(|it| get(it) == name && Some(get(it)) != original)
    {
        return Err(format!("已存在同名{kind}：{name}"));
    }
    Ok(())
}

fn upsert<T>(
    items: &mut Vec<T>,
    original: Option<&str>,
    get: impl Fn(&T) -> &str,
    make: impl Fn() -> T,
    fill: impl Fn(&mut T),
    kind: &str,
) -> Result<(), String> {
    match original {
        Some(orig) => match items.iter_mut().find(|it| get(it) == orig) {
            Some(it) => {
                fill(it);
                Ok(())
            }
            None => Err(format!("原{kind}不存在：{orig}")),
        },
        None => {
            items.push(make());
            Ok(())
        }
    }
}

#[tauri::command]
fn get_state(app: AppHandle) -> Result<State, String> {
    let _guard = data::lock()?;
    assemble(&app)
}

#[tauri::command]
fn save_home(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    location: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let name = name.trim().to_string();
    let location = location.trim().trim_matches('"').to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if location.is_empty() {
        return Err("路径不能为空".into());
    }
    let mut homes = data::load_homes(&app)?;
    check_unique(
        &homes,
        &name,
        original_name.as_deref(),
        |h| &h.name,
        " Home",
    )?;
    upsert(
        &mut homes,
        original_name.as_deref(),
        |h| &h.name,
        || Home {
            name: name.clone(),
            location: location.clone(),
        },
        |h| {
            h.name = name.clone();
            h.location = location.clone();
        },
        " Home",
    )?;
    data::save_homes(&app, &homes)?;
    assemble(&app)
}

#[tauri::command]
fn delete_home(app: AppHandle, name: String) -> Result<State, String> {
    let _guard = data::lock()?;
    let mut homes = data::load_homes(&app)?;
    homes.retain(|h| h.name != name);
    data::save_homes(&app, &homes)?;
    assemble(&app)
}

#[tauri::command]
fn save_provider(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    url: String,
    key: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let name = name.trim().to_string();
    let url = url.trim().trim_matches('"').to_string();
    let key = key.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL 需以 http:// 或 https:// 开头".into());
    }
    if original_name.is_none() && key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    let mut providers = data::load_providers(&app)?;
    check_unique(
        &providers,
        &name,
        original_name.as_deref(),
        |p| &p.name,
        " Provider",
    )?;
    upsert(
        &mut providers,
        original_name.as_deref(),
        |p| &p.name,
        || Provider {
            color: String::new(),
            name: name.clone(),
            url: url.clone(),
            key: key.clone(),
            inspection: Default::default(),
        },
        |p| {
            p.name = name.clone();
            p.url = url.clone();
            if !key.is_empty() {
                p.key = key.clone();
            }
        },
        " Provider",
    )?;
    data::save_providers(&app, &providers)?;
    assemble(&app)
}

#[tauri::command]
fn delete_provider(app: AppHandle, name: String) -> Result<State, String> {
    let _guard = data::lock()?;
    let mut providers = data::load_providers(&app)?;
    providers.retain(|p| p.name != name);
    data::save_providers(&app, &providers)?;
    assemble(&app)
}

#[tauri::command]
fn save_claude_home(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    location: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let name = name.trim().to_string();
    let location = location.trim().trim_matches('"').to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if location.is_empty() {
        return Err("配置目录不能为空".into());
    }
    let mut homes = data::load_claude_homes(&app)?;
    check_unique(
        &homes,
        &name,
        original_name.as_deref(),
        |home| &home.name,
        " Claude 配置",
    )?;
    upsert(
        &mut homes,
        original_name.as_deref(),
        |home| &home.name,
        || ClaudeHome {
            name: name.clone(),
            location: location.clone(),
        },
        |home| {
            home.name = name.clone();
            home.location = location.clone();
        },
        " Claude 配置",
    )?;
    data::save_claude_homes(&app, &homes)?;
    assemble(&app)
}

#[tauri::command]
fn delete_claude_home(app: AppHandle, name: String) -> Result<State, String> {
    let _guard = data::lock()?;
    let mut homes = data::load_claude_homes(&app)?;
    homes.retain(|home| home.name != name);
    data::save_claude_homes(&app, &homes)?;
    assemble(&app)
}

#[tauri::command]
fn save_claude_provider(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    url: String,
    key: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let name = name.trim().to_string();
    let url = url.trim().trim_matches('"').to_string();
    let key = key.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL 需以 http:// 或 https:// 开头".into());
    }
    if original_name.is_none() && key.is_empty() {
        return Err("Auth Token 不能为空".into());
    }
    let mut providers = data::load_claude_providers(&app)?;
    check_unique(
        &providers,
        &name,
        original_name.as_deref(),
        |provider| &provider.name,
        " Claude 中转站",
    )?;
    upsert(
        &mut providers,
        original_name.as_deref(),
        |provider| &provider.name,
        || ClaudeProvider {
            color: String::new(),
            name: name.clone(),
            url: url.clone(),
            key: key.clone(),
            inspection: Default::default(),
        },
        |provider| {
            provider.name = name.clone();
            provider.url = url.clone();
            if !key.is_empty() {
                provider.key = key.clone();
            }
        },
        " Claude 中转站",
    )?;
    data::save_claude_providers(&app, &providers)?;
    assemble(&app)
}

#[tauri::command]
fn delete_claude_provider(app: AppHandle, name: String) -> Result<State, String> {
    let _guard = data::lock()?;
    let mut providers = data::load_claude_providers(&app)?;
    providers.retain(|provider| provider.name != name);
    data::save_claude_providers(&app, &providers)?;
    assemble(&app)
}

#[tauri::command]
fn apply_provider(
    app: AppHandle,
    home_name: String,
    provider_name: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let homes = data::load_homes(&app)?;
    let providers = data::load_providers(&app)?;
    let home = homes
        .iter()
        .find(|h| h.name == home_name)
        .ok_or_else(|| format!("Home 不存在：{home_name}"))?;
    let provider = providers
        .iter()
        .find(|p| p.name == provider_name)
        .ok_or_else(|| format!("Provider 不存在：{provider_name}"))?;
    codex::apply_provider(&home.location, &provider.url, &provider.key)?;
    assemble(&app)
}

#[tauri::command]
fn apply_claude_provider(
    app: AppHandle,
    claude_home_name: String,
    claude_provider_name: String,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let homes = data::load_claude_homes(&app)?;
    let providers = data::load_claude_providers(&app)?;
    let home = homes
        .iter()
        .find(|home| home.name == claude_home_name)
        .ok_or_else(|| format!("Claude 配置不存在：{claude_home_name}"))?;
    let provider = providers
        .iter()
        .find(|provider| provider.name == claude_provider_name)
        .ok_or_else(|| format!("Claude 中转站不存在：{claude_provider_name}"))?;
    claude::apply_provider(&home.location, &provider.url, &provider.key)?;
    assemble(&app)
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let _guard = data::lock()?;
    let dir = data::data_dir(&app)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("打开目录失败：{e}"))
}

#[tauri::command]
fn change_data_dir(
    app: AppHandle,
    path: String,
    mode: data::DirectoryMode,
) -> Result<State, String> {
    let _guard = data::lock()?;
    data::change_dir(&app, &path, mode)?;
    assemble(&app)
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Scene {
    Codex,
    Claude,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum ListKind {
    Providers,
    Homes,
}

fn providers_for(app: &AppHandle, scene: Scene) -> Result<Vec<Provider>, String> {
    match scene {
        Scene::Codex => data::load_providers(app),
        Scene::Claude => data::load_claude_providers(app),
    }
}

#[tauri::command]
async fn inspect_provider(
    app: AppHandle,
    scene: Scene,
    name: String,
    task: inspection::Task,
) -> Result<inspection::ProbeResult, String> {
    let provider = {
        let _guard = data::lock()?;
        providers_for(&app, scene)?
            .into_iter()
            .find(|p| p.name == name)
            .ok_or("Provider 已被删除，请刷新后重试")?
    };
    Ok(inspection::inspect(provider, matches!(scene, Scene::Claude), task).await)
}

#[tauri::command]
fn save_inspection(
    app: AppHandle,
    scene: Scene,
    name: String,
    settings: inspection::InspectionSettings,
) -> Result<State, String> {
    let _guard = data::lock()?;
    let mut providers = providers_for(&app, scene)?;
    let provider = providers
        .iter_mut()
        .find(|p| p.name == name)
        .ok_or("Provider 不存在")?;
    inspection::validate(&provider.url, &settings)?;
    provider.inspection = settings;
    match scene {
        Scene::Codex => data::save_providers(&app, &providers)?,
        Scene::Claude => data::save_claude_providers(&app, &providers)?,
    }
    assemble(&app)
}

fn reorder<T: Clone>(
    items: &[T],
    names: &[String],
    name: impl Fn(&T) -> &str,
) -> Result<Vec<T>, String> {
    let unique: std::collections::HashSet<&String> = names.iter().collect();
    if names.len() != items.len() || unique.len() != names.len() {
        return Err("列表已改变，请刷新后重新排序".into());
    }
    names
        .iter()
        .map(|n| {
            items
                .iter()
                .find(|i| name(i) == n)
                .cloned()
                .ok_or_else(|| "列表已改变，请刷新后重新排序".into())
        })
        .collect()
}

#[tauri::command]
fn reorder_items(
    app: AppHandle,
    scene: Scene,
    kind: ListKind,
    names: Vec<String>,
) -> Result<State, String> {
    let _guard = data::lock()?;
    match (scene, kind) {
        (Scene::Codex, ListKind::Providers) => data::save_providers(
            &app,
            &reorder(&data::load_providers(&app)?, &names, |p| &p.name)?,
        )?,
        (Scene::Claude, ListKind::Providers) => data::save_claude_providers(
            &app,
            &reorder(&data::load_claude_providers(&app)?, &names, |p| &p.name)?,
        )?,
        (Scene::Codex, ListKind::Homes) => data::save_homes(
            &app,
            &reorder(&data::load_homes(&app)?, &names, |p| &p.name)?,
        )?,
        (Scene::Claude, ListKind::Homes) => data::save_claude_homes(
            &app,
            &reorder(&data::load_claude_homes(&app)?, &names, |p| &p.name)?,
        )?,
    }
    assemble(&app)
}

#[cfg(test)]
mod list_tests {
    use super::*;
    #[test]
    fn reorder_rejects_stale_or_duplicate_items() {
        let values = vec!["a".to_string(), "b".to_string()];
        assert_eq!(
            reorder(&values, &["b".into(), "a".into()], |v| v).unwrap(),
            vec!["b", "a"]
        );
        assert!(reorder(&values, &["a".into(), "a".into()], |v| v).is_err());
        assert!(reorder(&values, &["a".into()], |v| v).is_err());
        assert!(reorder(&values, &["a".into(), "c".into()], |v| v).is_err());
    }
    #[test]
    fn old_provider_files_receive_optional_inspection_defaults() {
        let provider: Provider =
            toml::from_str("name = 'old'\nurl = 'https://example.com'\nkey = 'fake'\n").unwrap();
        assert_eq!(provider.inspection.quota.adapter, inspection::Adapter::None);
        let restored: Provider = toml::from_str(&toml::to_string(&provider).unwrap()).unwrap();
        assert_eq!(restored.name, "old");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_home,
            delete_home,
            save_provider,
            delete_provider,
            apply_provider,
            save_claude_home,
            delete_claude_home,
            save_claude_provider,
            delete_claude_provider,
            apply_claude_provider,
            open_data_dir,
            change_data_dir,
            inspect_provider,
            save_inspection,
            reorder_items,
            kimi::get_kimi_config,
            kimi::save_kimi_config,
            kimi::import_kimi_config,
            kimi::query_kimi_quota,
            api_manager::get_api_accounts,
            api_manager::save_api_account,
            api_manager::delete_api_account,
            api_manager::probe_api_account,
            api_manager::check_api_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
