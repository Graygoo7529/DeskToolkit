use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    data_dir: String,
    version: &'static str,
}

#[derive(Deserialize)]
struct StoredWorkspace {
    #[allow(dead_code)]
    clusters: Vec<serde_json::Value>,
}

fn workspace_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("workspace.json"))
}

#[tauri::command]
fn app_info(app: AppHandle) -> Result<AppInfo, String> {
    let path = workspace_path(&app)?;
    Ok(AppInfo {
        data_dir: path.parent().map(|value| value.to_string_lossy().to_string()).unwrap_or_default(),
        version: "0.1.0",
    })
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<Option<String>, String> {
    let path = workspace_path(&app)?;
    match fs::read_to_string(path) {
        Ok(value) => {
            let _: StoredWorkspace = serde_json::from_str(&value).map_err(|error| error.to_string())?;
            Ok(Some(value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_workspace(app: AppHandle, workspace: String) -> Result<(), String> {
    let _: StoredWorkspace = serde_json::from_str(&workspace).map_err(|error| error.to_string())?;
    fs::write(workspace_path(&app)?, workspace).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info, load_workspace, save_workspace])
        .run(tauri::generate_context!())
        .expect("error while running DeskTodo");
}
