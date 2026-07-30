//! DeskFinger 后端命令层：运行目录、项目、快速启动/一键启动、文档管理。

mod store;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

// ---------- 数据模型（与前端 src/types.ts 保持一致） ----------

fn default_enabled() -> bool {
    true
}

fn default_shell() -> String {
    "cmd".to_string()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchItem {
    pub id: String,
    /// folder | app | file | command | web
    pub kind: String,
    pub name: String,
    /// 目标路径；kind 为 command 时是终端命令内容（支持多行，逐行顺序执行）
    pub path: String,
    #[serde(default)]
    pub args: String,
    /// 终端类型：cmd | powershell（仅 kind 为 command 时有意义）
    #[serde(default = "default_shell")]
    pub shell: String,
    /// 执行完是否保持终端窗口打开（仅 kind 为 command 时有意义）
    #[serde(default = "default_enabled")]
    pub keep_open: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub quick_links: Vec<LaunchItem>,
    #[serde(default)]
    pub one_click: Vec<LaunchItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    runtime_dir: Option<String>,
}

fn now_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}{nanos:x}")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------- 运行目录 ----------

#[tauri::command]
fn get_state(app: AppHandle) -> AppState {
    AppState {
        runtime_dir: store::get_runtime_dir(&app).map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn suggest_runtime_dir(app: AppHandle) -> String {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("DeskFinger").to_string_lossy().to_string()
}

#[tauri::command]
fn set_runtime_dir(app: AppHandle, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径不能为空".to_string());
    }
    store::set_runtime_dir(&app, Path::new(&path))
}

// ---------- 项目 ----------

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    store::list_projects(&app)
}

#[tauri::command]
fn create_project(
    app: AppHandle,
    name: String,
    description: String,
    icon: String,
    color: String,
) -> Result<Project, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let project = Project {
        id: now_id("p"),
        name,
        description: description.trim().to_string(),
        icon: if icon.is_empty() { "📁".into() } else { icon },
        color: if color.is_empty() {
            "#6e8bff".into()
        } else {
            color
        },
        created_at: now_secs(),
        quick_links: Vec::new(),
        one_click: Vec::new(),
    };
    // 默认看板文档：仅以项目名称作为标题，内容留空
    let kanban = format!("# {}\n", project.name);
    store::create_project(&app, &project, &kanban)?;
    Ok(project)
}

#[tauri::command]
fn update_project(app: AppHandle, project: Project) -> Result<(), String> {
    if project.name.trim().is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    store::save_project(&app, &project)
}

#[tauri::command]
fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    store::delete_project(&app, &id)
}

// ---------- 启动 ----------

/// 根据类型启动一个条目：文件夹 / 文档用系统默认方式打开，
/// 应用程序直接拉起（可带参数），命令在新终端窗口中执行。
#[tauri::command]
fn launch_item(app: AppHandle, item: LaunchItem) -> Result<(), String> {
    match item.kind.as_str() {
        "command" => launch_terminal(&app, &item.path, &item.shell, item.keep_open),
        "app" => {
            // .lnk 快捷方式本身不是可执行文件，交给系统 Shell 解析并启动目标
            if item.path.to_ascii_lowercase().ends_with(".lnk") {
                return app
                    .opener()
                    .open_path(&item.path, None::<&str>)
                    .map_err(|e| format!("启动快捷方式失败: {e}"));
            }
            let mut cmd = Command::new(&item.path);
            if !item.args.trim().is_empty() {
                cmd.args(item.args.split_whitespace());
            }
            cmd.spawn()
                .map(|_| ())
                .map_err(|e| format!("启动应用失败: {e}"))
        }
        "web" => app
            .opener()
            .open_url(&item.path, None::<&str>)
            .map_err(|e| format!("打开网页失败: {e}")),
        _ => app
            .opener()
            .open_path(&item.path, None::<&str>)
            .map_err(|e| format!("打开失败: {e}")),
    }
}

/// 将多行命令按行拆分（忽略空行），按 shell 语法拼成顺序执行的单条命令。
#[cfg(unix)]
fn join_command_lines(command: &str, separator: &str) -> Result<String, String> {
    let joined = command
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(separator);
    if joined.is_empty() {
        Err("命令内容为空".to_string())
    } else {
        Ok(joined)
    }
}

#[cfg(target_os = "windows")]
fn launch_terminal(
    app: &AppHandle,
    command: &str,
    shell: &str,
    keep_open: bool,
) -> Result<(), String> {
    let lines: Vec<&str> = command
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return Err("命令内容为空".to_string());
    }

    let dir = std::env::temp_dir().join("deskfinger");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败: {e}"))?;
    cleanup_old_scripts(&dir);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // 统一生成 .cmd 包装脚本，经 ShellExecute（open_path）打开新控制台窗口执行：
    // - ShellExecute 不继承父进程句柄：直接 spawn cmd /K 时，若父进程（如 dev 模式
    //   下的应用）的 stdin 是管道，cmd /K 会读到 EOF、执行完立即退出（闪退根因）；
    // - 脚本按 GBK 写入，cmd 原生解析，中文路径不乱码（同时避开批处理内
    //   chcp 65001 导致后续行解析错位的 bug）；
    // - 批处理逐行执行：前一条命令（如 conda activate）结束才执行下一条，
    //   某条失败不会中断后续，行为等同在终端里逐行输入。
    let mut script = String::new();
    if shell == "powershell" {
        let ps_path = dir.join(format!("launch-{stamp}.ps1"));
        // 带 BOM 的 UTF-8，确保 Windows PowerShell 5.1 正确识别中文
        let mut ps = String::from("\u{feff}");
        for l in &lines {
            ps.push_str(l);
            ps.push_str("\r\n");
        }
        std::fs::write(&ps_path, ps).map_err(|e| format!("写入脚本失败: {e}"))?;
        script.push_str(&format!(
            "powershell{} -NoProfile -ExecutionPolicy Bypass -File \"{}\"\r\n",
            if keep_open { " -NoExit" } else { "" },
            ps_path.to_string_lossy()
        ));
    } else {
        for l in &lines {
            // 关键：批处理中调用另一个批处理（conda.bat、npm.cmd、yarn.cmd 等）
            // 必须加 call，否则控制不返回——后续命令和保持窗口的 cmd /K 都
            // 执行不到，窗口直接关闭（闪退）。call 对普通 exe/内部命令无副作用。
            if l.len() >= 5 && l[..5].eq_ignore_ascii_case("call ") {
                script.push_str(l);
            } else {
                script.push_str("call ");
                script.push_str(l);
            }
            script.push_str("\r\n");
        }
        if keep_open {
            // 脚本结束后留在交互式提示符（conda 等命令改动的环境依然有效）
            script.push_str("cmd /K\r\n");
        }
    }

    let cmd_path = dir.join(format!("launch-{stamp}.cmd"));
    let (bytes, _, _) = encoding_rs::GBK.encode(&script);
    std::fs::write(&cmd_path, &bytes[..]).map_err(|e| format!("写入脚本失败: {e}"))?;

    app.opener()
        .open_path(cmd_path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("打开终端失败: {e}"))
}

/// 清理一天前的临时启动脚本（脚本执行期间必须保留，不能启动后立即删除）
#[cfg(target_os = "windows")]
fn cleanup_old_scripts(dir: &std::path::Path) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let is_old = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| now.saturating_sub(d.as_secs()) > 86_400)
                .unwrap_or(false);
            if is_old {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn launch_terminal(
    _app: &AppHandle,
    command: &str,
    _shell: &str,
    _keep_open: bool,
) -> Result<(), String> {
    let joined = join_command_lines(command, "; ")?;
    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        joined.replace('\\', "\\\\").replace('"', "\\\"")
    );
    Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开终端失败: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_terminal(
    _app: &AppHandle,
    command: &str,
    _shell: &str,
    _keep_open: bool,
) -> Result<(), String> {
    let joined = join_command_lines(command, " && ")?;
    for term in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
        if Command::new(term)
            .args(["-e", &format!("sh -c '{joined}; exec sh'")])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("未找到可用的终端模拟器".to_string())
}

/// 判断路径类型，供前端拖放后推断条目类型。
#[tauri::command]
fn path_kind(path: String) -> String {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        "folder".into()
    } else if p.is_file() {
        "file".into()
    } else {
        "missing".into()
    }
}

// ---------- 项目文档 ----------

#[tauri::command]
fn list_docs(app: AppHandle, project_id: String) -> Result<Vec<String>, String> {
    store::list_docs(&app, &project_id)
}

#[tauri::command]
fn read_doc(app: AppHandle, project_id: String, name: String) -> Result<String, String> {
    store::read_doc(&app, &project_id, &store::normalize_doc_name(&name)?)
}

#[tauri::command]
fn write_doc(
    app: AppHandle,
    project_id: String,
    name: String,
    content: String,
) -> Result<(), String> {
    store::write_doc(
        &app,
        &project_id,
        &store::normalize_doc_name(&name)?,
        &content,
    )
}

#[tauri::command]
fn create_doc(app: AppHandle, project_id: String, name: String) -> Result<String, String> {
    store::create_doc(&app, &project_id, &name)
}

#[tauri::command]
fn delete_doc(app: AppHandle, project_id: String, name: String) -> Result<(), String> {
    store::delete_doc(&app, &project_id, &name)
}

#[tauri::command]
fn rename_doc(
    app: AppHandle,
    project_id: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    store::rename_doc(&app, &project_id, &old_name, &new_name)
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            suggest_runtime_dir,
            set_runtime_dir,
            list_projects,
            create_project,
            update_project,
            delete_project,
            launch_item,
            path_kind,
            list_docs,
            read_doc,
            write_doc,
            create_doc,
            delete_doc,
            rename_doc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
