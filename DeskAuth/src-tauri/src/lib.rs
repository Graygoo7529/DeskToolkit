mod legacy;
mod model;
mod otp;
mod store;
mod time_sync;

use model::{AccountInput, AccountSummary};
use serde::Serialize;
use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

type Shared = Mutex<store::Store>;
fn lock<'a>(state: &'a State<'_, Shared>) -> Result<MutexGuard<'a, store::Store>, String> {
    state
        .lock()
        .map_err(|_| "数据操作中断，请重新启动应用".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    data_dir: Option<String>,
    accounts: Vec<AccountSummary>,
    startup_error: Option<String>,
}
fn snapshot(s: &store::Store) -> AppState {
    AppState {
        data_dir: s.dir.as_deref().map(store::display_path),
        accounts: s.vault.accounts.iter().map(AccountSummary::from).collect(),
        startup_error: s.startup_error.clone(),
    }
}
#[tauri::command]
fn get_state(state: State<Shared>) -> Result<AppState, String> {
    let s = lock(&state)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn suggest_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|_| "无法获取默认目录")?;
    Ok(store::display_path(&base.join("DeskAuth")))
}
#[tauri::command]
fn change_data_dir(state: State<Shared>, path: String) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.open(Path::new(path.trim()))?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn open_data_dir(app: tauri::AppHandle, state: State<Shared>) -> Result<(), String> {
    let dir = lock(&state)?.dir.clone().ok_or("尚未选择数据目录")?;
    app.opener()
        .open_path(store::display_path(&dir), None::<&str>)
        .map_err(|_| "无法打开数据目录".into())
}
#[derive(Serialize)]
struct Saved {
    state: AppState,
    id: String,
}
#[tauri::command]
fn save_account(state: State<Shared>, input: AccountInput) -> Result<Saved, String> {
    let mut s = lock(&state)?;
    let id = s.save(input)?;
    Ok(Saved {
        state: snapshot(&s),
        id,
    })
}
#[tauri::command]
fn delete_account(state: State<Shared>, id: String) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.delete(&id)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn set_favorite(state: State<Shared>, id: String, favorite: bool) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.favorite(&id, favorite)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn reveal_password(state: State<Shared>, id: String) -> Result<String, String> {
    Ok(lock(&state)?.account(&id)?.password.clone())
}
#[tauri::command]
fn copy_password(app: tauri::AppHandle, state: State<Shared>, id: String) -> Result<(), String> {
    let password = lock(&state)?.account(&id)?.password.clone();
    if password.is_empty() {
        return Err("该账户尚未记录密码".into());
    }
    app.clipboard()
        .write_text(password)
        .map_err(|_| "无法写入剪贴板，请重试".into())
}
#[tauri::command]
fn open_website(app: tauri::AppHandle, state: State<Shared>, id: String) -> Result<(), String> {
    let website = lock(&state)?.account(&id)?.website.clone();
    if website.is_empty() {
        return Err("该账户尚未记录网站地址".into());
    }
    model::validate_website(&website)?;
    app.opener()
        .open_url(website, None::<&str>)
        .map_err(|_| "无法打开网站".into())
}
#[derive(Serialize)]
struct Imported {
    state: AppState,
    added: usize,
    skipped: usize,
}
#[tauri::command]
fn import_backup(state: State<Shared>, path: String) -> Result<Imported, String> {
    let mut s = lock(&state)?;
    let (added, skipped) = s.import(Path::new(&path))?;
    Ok(Imported {
        state: snapshot(&s),
        added,
        skipped,
    })
}
#[tauri::command]
fn export_backup(state: State<Shared>, path: String) -> Result<(), String> {
    lock(&state)?.export(Path::new(&path))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Code {
    code: String,
    period: u64,
    valid_until: u64,
    generated_at: u64,
    time_status: time_sync::TimeStatus,
}
#[tauri::command]
fn get_code(
    state: State<Shared>,
    clock: State<Arc<time_sync::TimeService>>,
    id: String,
) -> Result<Code, String> {
    let s = lock(&state)?;
    let t = s
        .account(&id)?
        .totp
        .as_ref()
        .ok_or("此账户尚未配置认证器")?;
    let (now, time_status) = clock.now()?;
    Ok(Code {
        code: otp::generate(&t.secret, t.algorithm, t.digits, t.period, now / 1000)?,
        period: t.period,
        generated_at: now,
        valid_until: (now / 1000 / t.period + 1) * t.period * 1000,
        time_status,
    })
}
#[tauri::command]
fn configure_totp(
    state: State<Shared>,
    id: String,
    input: model::TotpInput,
) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.configure_totp(&id, input)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn remove_totp(state: State<Shared>, id: String) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.remove_totp(&id)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn reveal_totp_secret(state: State<Shared>, id: String) -> Result<String, String> {
    Ok(lock(&state)?
        .account(&id)?
        .totp
        .as_ref()
        .ok_or("此账户尚未配置认证器")?
        .secret
        .clone())
}
#[tauri::command]
fn parse_uri(uri: String) -> Result<otp::ParsedUri, String> {
    otp::parse_uri(&uri)
}
#[tauri::command]
fn preview_twofauth(path: String) -> Result<legacy::Preview, String> {
    legacy::preview(Path::new(&path))
}
#[tauri::command]
fn select_twofauth(
    path: String,
    fingerprint: String,
    id: String,
) -> Result<otp::ParsedUri, String> {
    legacy::select(Path::new(&path), &fingerprint, &id)
}
#[tauri::command]
fn get_time_status(
    clock: State<Arc<time_sync::TimeService>>,
) -> Result<time_sync::TimeStatus, String> {
    clock.status()
}
#[tauri::command]
fn set_online_time(
    clock: State<Arc<time_sync::TimeService>>,
    enabled: bool,
) -> Result<time_sync::TimeStatus, String> {
    clock.set_enabled(enabled)
}
#[tauri::command]
fn sync_time(clock: State<Arc<time_sync::TimeService>>) -> Result<time_sync::TimeStatus, String> {
    clock.request_sync()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let clock = Arc::new(time_sync::TimeService::new(
                app.path().app_config_dir()?.join("time-settings.json"),
            ));
            app.manage(clock.clone());
            tauri::async_runtime::spawn(clock.run());
            app.manage(Mutex::new(store::Store::new(
                app.path().app_config_dir()?.join("storage.json"),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            suggest_data_dir,
            change_data_dir,
            open_data_dir,
            save_account,
            delete_account,
            set_favorite,
            reveal_password,
            copy_password,
            open_website,
            import_backup,
            export_backup,
            get_code,
            configure_totp,
            remove_totp,
            reveal_totp_secret,
            parse_uri,
            preview_twofauth,
            select_twofauth,
            get_time_status,
            set_online_time,
            sync_time
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 DeskAuth");
}
