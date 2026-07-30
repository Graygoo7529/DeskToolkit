mod codex;
mod data;

use data::{Home, Provider};
use serde::Serialize;
use std::collections::HashMap;
use tauri::AppHandle;

#[derive(Serialize)]
struct State {
    homes: Vec<Home>,
    providers: Vec<ProviderView>,
    data_dir: String,
    statuses: HashMap<String, codex::HomeStatus>,
}

#[derive(Serialize)]
struct ProviderView {
    name: String,
    url: String,
    key_masked: String,
}

fn assemble(app: &AppHandle) -> Result<State, String> {
    let homes = data::load_homes(app)?;
    let providers = data::load_providers(app)?;
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
            url: provider.url.clone(),
            key_masked: codex::mask_key(&provider.key),
        })
        .collect();
    let data_dir = data::data_dir(app)?.display().to_string();
    Ok(State {
        homes,
        providers: provider_views,
        data_dir,
        statuses,
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
    assemble(&app)
}

#[tauri::command]
fn save_home(
    app: AppHandle,
    original_name: Option<String>,
    name: String,
    location: String,
) -> Result<State, String> {
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
            name: name.clone(),
            url: url.clone(),
            key: key.clone(),
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
    let mut providers = data::load_providers(&app)?;
    providers.retain(|p| p.name != name);
    data::save_providers(&app, &providers)?;
    assemble(&app)
}

#[tauri::command]
fn apply_provider(
    app: AppHandle,
    home_name: String,
    provider_name: String,
) -> Result<State, String> {
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
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data::data_dir(&app)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| format!("打开目录失败：{e}"))
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
            open_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
