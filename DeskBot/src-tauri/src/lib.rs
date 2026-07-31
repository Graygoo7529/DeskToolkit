//! DeskBot 后端入口：窗口、托盘、ACP 桥、额度轮询的装配点。
//! 契约见 docs/architecture.md（§7 命令、§8 事件）。

mod acp;
mod config;
mod hotspot;
mod quota;
mod tray;
mod windows;

use std::sync::{Arc, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use config::ConfigStore;
use quota::QuotaInfo;

pub struct AppState {
    pub config: Arc<ConfigStore>,
    quota: RwLock<Option<QuotaInfo>>,
    pub acp: acp::AcpHandle,
}

impl AppState {
    pub fn set_quota(&self, info: QuotaInfo) {
        *self.quota.write().unwrap_or_else(|e| e.into_inner()) = Some(info);
    }

    pub fn cached_quota(&self) -> Option<QuotaInfo> {
        self.quota.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    quota: Option<QuotaInfo>,
    session_active: bool,
}

// ---------------------------------------------------------------------------
// IPC 命令（契约 §7）
// ---------------------------------------------------------------------------

#[tauri::command]
fn update_hot_regions(app: AppHandle, regions: Vec<hotspot::HotRegion>) {
    hotspot::set_regions(&app, regions);
}

#[tauri::command]
fn open_panel(app: AppHandle, tab: String) -> Result<(), String> {
    match tab.as_str() {
        "chat" | "quota" => windows::open_panel(&app, &tab),
        other => Err(format!("未知 tab: {other}")),
    }
}

#[tauri::command]
fn close_panel(app: AppHandle) -> Result<(), String> {
    windows::close_panel(&app)
}

#[tauri::command]
async fn chat_send(state: State<'_, AppState>, text: String) -> Result<(), String> {
    state.acp.chat_send(text).await;
    Ok(())
}

#[tauri::command]
async fn chat_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state.acp.cancel().await;
    Ok(())
}

#[tauri::command]
async fn chat_permission_response(
    state: State<'_, AppState>,
    request_id: String,
    option_id: String,
) -> Result<(), String> {
    state.acp.resolve_permission(&request_id, &option_id).await;
    Ok(())
}

#[tauri::command]
async fn quota_refresh(app: AppHandle) -> Result<QuotaInfo, String> {
    quota::refresh(&app).await
}

#[tauri::command]
fn get_quota_cached(state: State<'_, AppState>) -> Option<QuotaInfo> {
    state.cached_quota()
}

#[tauri::command]
async fn get_bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    Ok(Bootstrap {
        quota: state.cached_quota(),
        session_active: state.acp.is_ready().await,
    })
}

// ---------------------------------------------------------------------------
// 应用装配
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 本机 WebView2 的 GPU 2D canvas 加速会导致 canvas 内容无法合成（页面其余部分正常）。
    // 强制 canvas 走软件渲染；须在创建任何 webview 之前设置。
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-accelerated-2d-canvas",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已运行时再启动：聚焦 panel，否则确保宠物可见
            if let Some(panel) = app.get_webview_window("panel") {
                if panel.is_visible().unwrap_or(false) {
                    let _ = panel.set_focus();
                    return;
                }
            }
            if let Some(stage) = app.get_webview_window("stage") {
                let _ = stage.show();
            }
        }))
        .setup(|app| {
            let config = Arc::new(ConfigStore::load());
            let cfg = config.get();
            app.manage(AppState {
                config,
                quota: RwLock::new(None),
                acp: acp::AcpHandle::new(app.handle().clone()),
            });

            windows::create_windows(app.handle(), &cfg)?;
            hotspot::start(app.handle().clone());
            quota::start_polling(app.handle().clone());
            tray::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_hot_regions,
            open_panel,
            close_panel,
            chat_send,
            chat_cancel,
            chat_permission_response,
            quota_refresh,
            get_quota_cached,
            get_bootstrap,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskBot");
}
