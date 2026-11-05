use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
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
struct StorageLock(Mutex<()>);

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
fn read_workspace(dir: &Path) -> Result<Workspace, String> {
    let bytes = fs::read(dir.join("workspace.json")).map_err(|e| format!("读取便签失败：{e}"))?;
    let workspace: Workspace = serde_json::from_slice(&bytes)
        .map_err(|e| format!("便签格式错误：{e}。原文件已保留，可检查 workspace.json.bak。"))?;
    workspace.validate()?;
    Ok(workspace)
}
// Same-directory temporary file + atomic replacement. The old valid snapshot survives in .bak.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件路径无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(path)
        .map_err(|e| format!("保存失败：{e}"))?;
    Ok(())
}
fn write_workspace(dir: &Path, workspace: &Workspace) -> Result<(), String> {
    workspace.validate()?;
    let target = dir.join("workspace.json");
    if target.exists() {
        let previous = fs::read(&target).map_err(|e| e.to_string())?;
        let valid: Workspace = serde_json::from_slice(&previous)
            .map_err(|e| format!("磁盘数据已损坏，已停止写入：{e}"))?;
        valid.validate()?;
        atomic_write(&dir.join("workspace.json.bak"), &previous)?;
    }
    atomic_write(
        &target,
        &serde_json::to_vec_pretty(workspace).map_err(|e| e.to_string())?,
    )
}
fn prepare_directory(path: &Path, seed: &Workspace) -> Result<Workspace, String> {
    if !path.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    if path.join("workspace.json").exists() {
        return read_workspace(path);
    }
    if path.exists()
        && fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(
            "此目录包含其他文件。请选择空目录或已有 DeskTodo workspace.json 的目录。".into(),
        );
    }
    fs::create_dir_all(path).map_err(|e| format!("无法创建目录：{e}"))?;
    write_workspace(path, seed)?;
    Ok(seed.clone())
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
#[tauri::command]
fn load_workspace(app: AppHandle, lock: tauri::State<StorageLock>) -> Result<Loaded, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let dir = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    Ok(Loaded {
        workspace: read_workspace(&dir)?,
        data_dir: dir.to_string_lossy().into(),
    })
}
#[tauri::command]
fn set_data_dir(
    app: AppHandle,
    path: String,
    seed: Workspace,
    lock: tauri::State<StorageLock>,
) -> Result<Loaded, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = PathBuf::from(path.trim());
    let workspace = prepare_directory(&path, &seed)?;
    let dir = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let config = Config {
        data_dir: dir.to_string_lossy().into(),
    };
    atomic_write(
        &config_path(&app)?,
        &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )?;
    Ok(Loaded {
        data_dir: config.data_dir,
        workspace,
    })
}
#[tauri::command]
fn save_workspace(
    app: AppHandle,
    path: String,
    workspace: Workspace,
    lock: tauri::State<StorageLock>,
) -> Result<(), String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let dir = configured_dir(&app)?.ok_or("尚未选择数据目录")?;
    let canonical = fs::canonicalize(&dir).map_err(|e| format!("数据目录不可用：{e}"))?;
    let requested = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if canonical != requested {
        return Err("数据目录已切换，已拒绝旧目录的延迟写入".into());
    }
    // A disappeared file is an error; do not silently replace external changes with a seed.
    read_workspace(&canonical)?;
    write_workspace(&canonical, &workspace)
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
        .manage(StorageLock(Mutex::new(())))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            load_workspace,
            set_data_dir,
            save_workspace,
            open_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskTodo");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn seed() -> Workspace {
        Workspace {
            clusters: vec![Cluster {
                id: "inbox".into(),
                name: "收件箱".into(),
                icon: "".into(),
                color: default_color(),
                notes: vec![Note {
                    id: "note".into(),
                    title: "随手记".into(),
                    content: "原内容".into(),
                    color: default_color(),
                    updated_at: 1,
                }],
            }],
        }
    }
    #[test]
    fn new_directory_and_reopen_preserve_data() {
        let dir = tempfile::tempdir().unwrap();
        let original = seed();
        prepare_directory(dir.path(), &original).unwrap();
        let mut updated = original.clone();
        updated.clusters[0].notes[0].content = "更新后的中文\n```todo\n- [x] done\n```".into();
        write_workspace(dir.path(), &updated).unwrap();
        let loaded = prepare_directory(dir.path(), &original).unwrap();
        assert_eq!(
            loaded.clusters[0].notes[0].content,
            updated.clusters[0].notes[0].content
        );
        let backup: Workspace =
            serde_json::from_slice(&fs::read(dir.path().join("workspace.json.bak")).unwrap())
                .unwrap();
        assert_eq!(backup.clusters[0].notes[0].content, "原内容");
    }
    #[test]
    fn corrupt_or_unrelated_directory_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("other.txt"), "keep").unwrap();
        assert!(prepare_directory(dir.path(), &seed()).is_err());
        fs::write(dir.path().join("workspace.json"), b"{ broken").unwrap();
        assert!(prepare_directory(dir.path(), &seed()).is_err());
        assert!(write_workspace(dir.path(), &seed()).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("workspace.json")).unwrap(),
            "{ broken"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("other.txt")).unwrap(),
            "keep"
        );
        assert!(prepare_directory(Path::new("relative"), &seed()).is_err());
    }
}
