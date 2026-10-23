mod otp;
mod store;

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};
use store::{AccountInput, AccountSummary, RecoveryCode, Store};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

type Shared = Mutex<Store>;
fn lock<'a>(state: &'a State<'_, Shared>) -> Result<MutexGuard<'a, Store>, String> {
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
fn snapshot(store: &Store) -> AppState {
    AppState {
        data_dir: store.dir.as_deref().map(store::display_path),
        accounts: store
            .vault
            .accounts
            .iter()
            .map(AccountSummary::from)
            .collect(),
        startup_error: store.startup_error.clone(),
    }
}

#[tauri::command]
fn get_state(state: State<Shared>) -> Result<AppState, String> {
    let store = lock(&state)?;
    Ok(snapshot(&store))
}
#[tauri::command]
fn suggest_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|_| "无法获取默认目录")?;
    Ok(store::display_path(&base.join("2FAuth")))
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
#[tauri::command]
fn parse_uri(uri: String) -> Result<otp::ParsedUri, String> {
    otp::parse_uri(&uri)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
    s.update(&id, |a| a.favorite = favorite)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn reveal_secret(state: State<Shared>, id: String) -> Result<String, String> {
    Ok(lock(&state)?.account(&id)?.secret.clone())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Code {
    code: String,
    period: u64,
    valid_until: u64,
    generated_at: u64,
}
#[tauri::command]
fn get_code(state: State<Shared>, id: String) -> Result<Code, String> {
    let s = lock(&state)?;
    let a = s.account(&id)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间早于 1970 年，请校准系统时间")?;
    Ok(Code {
        code: otp::generate(&a.secret, a.algorithm, a.digits, a.period, now.as_secs())?,
        period: a.period,
        generated_at: now.as_millis() as u64,
        valid_until: (now.as_secs() / a.period + 1) * a.period * 1000,
    })
}
#[tauri::command]
fn get_recovery_codes(state: State<Shared>, id: String) -> Result<Vec<RecoveryCode>, String> {
    Ok(lock(&state)?.account(&id)?.recovery_codes.clone())
}
#[tauri::command]
fn save_recovery_codes(state: State<Shared>, id: String, text: String) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.recovery(&id, &text)?;
    Ok(snapshot(&s))
}
#[tauri::command]
fn set_recovery_used(
    state: State<Shared>,
    id: String,
    code_id: String,
    used: bool,
) -> Result<AppState, String> {
    let mut s = lock(&state)?;
    s.set_recovery_used(&id, &code_id, used)?;
    Ok(snapshot(&s))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let config: PathBuf = app.path().app_config_dir()?.join("storage.json");
            app.manage(Mutex::new(Store::new(config)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            suggest_data_dir,
            change_data_dir,
            open_data_dir,
            parse_uri,
            save_account,
            delete_account,
            set_favorite,
            reveal_secret,
            get_code,
            get_recovery_codes,
            save_recovery_codes,
            set_recovery_used,
            import_backup,
            export_backup
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 2FAuth");
}
