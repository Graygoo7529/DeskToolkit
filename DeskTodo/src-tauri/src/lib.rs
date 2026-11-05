use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    id: String,
    title: String,
    content: String,
    #[serde(default = "default_color")]
    color: String,
    updated_at: u64,
}
fn default_color() -> String {
    "#8fa9f7".into()
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Cluster {
    id: String,
    name: String,
    #[serde(default)]
    icon: String,
    #[serde(default = "default_color")]
    color: String,
    notes: Vec<Note>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Workspace {
    clusters: Vec<Cluster>,
}
impl Workspace {
    fn validate(&self) -> Result<(), String> {
        if self.clusters.is_empty() {
            return Err("数据中至少需要一个 note 夹".into());
        }
        let mut ids = HashSet::new();
        for c in &self.clusters {
            if c.id.is_empty() || !ids.insert(&c.id) {
                return Err("note 夹 ID 无效或重复".into());
            }
            for n in &c.notes {
                if n.id.is_empty() || !ids.insert(&n.id) {
                    return Err("便签 ID 无效或重复".into());
                }
            }
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    data_dir: Option<String>,
    suggested_dir: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Loaded {
    data_dir: String,
    workspace: Workspace,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    data_dir: String,
}
struct Session {
    path: PathBuf,
    snapshot: store::Snapshot,
}
struct StorageLock(Mutex<Option<Session>>);
mod store;

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("desktodo-config.json"))
}
fn configured_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let path = config_path(app)?;
    match fs::read(&path) {
        Ok(bytes) => {
            let config: Config =
                serde_json::from_slice(&bytes).map_err(|e| format!("目录配置无法读取：{e}"))?;
            if !Path::new(&config.data_dir).is_absolute() {
                return Err("已配置的数据目录不是绝对路径".into());
            }
            Ok(Some(PathBuf::from(config.data_dir)))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取目录配置失败：{e}")),
    }
}
#[tauri::command]
fn get_state(app: AppHandle) -> Result<AppState, String> {
    let suggested = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?
        .join("DeskTodo");
    Ok(AppState {
        data_dir: configured_dir(&app)?.map(|p| p.to_string_lossy().into()),
        suggested_dir: suggested.to_string_lossy().into(),
    })
}
fn install_session(
    session: &mut Option<Session>,
    path: PathBuf,
    snapshot: store::Snapshot,
) -> Loaded {
    let loaded = Loaded {
        data_dir: path.to_string_lossy().into(),
        workspace: snapshot.workspace.clone(),
    };
    *session = Some(Session { path, snapshot });
    loaded
}
#[tauri::command]
fn load_workspace(app: AppHandle, lock: tauri::State<StorageLock>) -> Result<Loaded, String> {
    let mut session = lock.0.lock().map_err(|e| e.to_string())?;
    let dir = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    let dir = fs::canonicalize(dir).map_err(|e| format!("数据目录不可用：{e}"))?;
    let snapshot = store::load(&dir)?;
    Ok(install_session(&mut session, dir, snapshot))
}
#[tauri::command]
fn set_data_dir(
    app: AppHandle,
    path: String,
    seed: Workspace,
    lock: tauri::State<StorageLock>,
) -> Result<Loaded, String> {
    let mut session = lock.0.lock().map_err(|e| e.to_string())?;
    let path = PathBuf::from(path.trim());
    let snapshot = store::prepare(&path, &seed)?;
    let dir = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let config = Config {
        data_dir: dir.to_string_lossy().into(),
    };
    store::atomic_write(
        &config_path(&app)?,
        &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )?;
    Ok(install_session(&mut session, dir, snapshot))
}
#[tauri::command]
fn save_workspace(
    app: AppHandle,
    path: String,
    workspace: Workspace,
    lock: tauri::State<StorageLock>,
) -> Result<(), String> {
    let mut guard = lock.0.lock().map_err(|e| e.to_string())?;
    let configured = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    let current = fs::canonicalize(configured).map_err(|e| format!("数据目录不可用：{e}"))?;
    let requested = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let session = guard.as_mut().ok_or("请先载入便签")?;
    if current != requested || current != session.path {
        return Err("数据目录已切换，已拒绝旧目录的延迟写入".into());
    }
    session.snapshot = store::save(&current, &workspace, &session.snapshot)?;
    Ok(())
}
#[tauri::command]
fn preserve_and_reload(
    app: AppHandle,
    path: String,
    workspace: Workspace,
    lock: tauri::State<StorageLock>,
) -> Result<Loaded, String> {
    let mut session = lock.0.lock().map_err(|e| e.to_string())?;
    let current = fs::canonicalize(configured_dir(&app)?.ok_or("尚未选择数据目录")?)
        .map_err(|e| e.to_string())?;
    if fs::canonicalize(path).map_err(|e| e.to_string())? != current {
        return Err("数据目录已变更".into());
    }
    let draft = store::preserve_draft(&current, &workspace)?;
    let snapshot = store::load(&current)
        .map_err(|e| format!("当前内容已保存在 {}；重新载入失败：{e}", draft.display()))?;
    Ok(install_session(&mut session, current, snapshot))
}
#[tauri::command]
fn open_note_file(app: AppHandle, note_id: String) -> Result<(), String> {
    let dir = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    let path = store::note_path(&dir, &note_id)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StorageLock(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            load_workspace,
            set_data_dir,
            save_workspace,
            preserve_and_reload,
            open_note_file,
            open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskTodo");
}
