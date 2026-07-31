//! 窗口创建与定位。契约见 docs/architecture.md §1（窗口模型）、
//! §4（拖动落地防抖）、§7（open_panel/close_panel）。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::config::{Config, PetPosition};
use crate::AppState;

const STAGE_SIZE: f64 = 420.0;
const PANEL_W: f64 = 400.0;
const PANEL_H: f64 = 560.0;
const PANEL_MAX_W: f64 = 760.0;
const PANEL_MAX_H: f64 = 720.0;
const EDGE_MARGIN: f64 = 40.0;
const PANEL_GAP: f64 = 12.0;

/// 拖动事件去抖代次：每次 Moved 递增，延迟任务发现代次过期就放弃。
static MOVE_GEN: AtomicU64 = AtomicU64::new(0);
/// 启动 1s 内忽略 Moved（程序化 set_position 也会触发 Moved，不应播落地动画）。
static MOVES_ARMED: AtomicBool = AtomicBool::new(false);

pub fn create_windows(app: &AppHandle, cfg: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let stage = WebviewWindowBuilder::new(app, "stage", WebviewUrl::App("index.html".into()))
        .title("DeskBot Stage")
        .inner_size(STAGE_SIZE, STAGE_SIZE)
        // 视觉透明：tao transparent(true)（NOREDIRECTIONBITMAP，WebView2 渲染正常）。
        // 绝不能调用 set_ignore_cursor_events——它会加 WS_EX_LAYERED，
        // 使 WebView2 内容完全不渲染。点击穿透见 hotspot.rs（WM_NCHITTEST 子类，§5）。
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .build()?;

    // 初始位置：petPosition 优先，否则主屏工作区右下角留 40px 边距。
    let pos = cfg
        .pet_position
        .map(|p| PhysicalPosition::new(p.x, p.y))
        .unwrap_or_else(|| default_stage_pos(&stage));
    let _ = stage.set_position(pos);
    // 延迟显示，避免 WebView2 首帧白闪
    if cfg.pet_visible {
        let stage = stage.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let _ = stage.show();
        });
    }

    // 拖动落地：防抖 300ms 发 `pet://signal landed`，防抖 800ms 写回 petPosition。
    let app_handle = app.clone();
    stage.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(pos) = event {
            on_stage_moved(&app_handle, *pos);
        }
    });
    tauri::async_runtime::spawn(async {
        tokio::time::sleep(Duration::from_secs(1)).await;
        MOVES_ARMED.store(true, Ordering::SeqCst);
    });

    WebviewWindowBuilder::new(app, "panel", WebviewUrl::App("panel.html".into()))
        .title("DeskBot")
        .inner_size(PANEL_W, PANEL_H)
        .max_inner_size(PANEL_MAX_W, PANEL_MAX_H)
        .decorations(false)
        .always_on_top(true)
        .resizable(true)
        .visible(false)
        .build()?;

    Ok(())
}

fn default_stage_pos(stage: &WebviewWindow) -> PhysicalPosition<i32> {
    if let Ok(Some(monitor)) = stage.primary_monitor() {
        let wa = monitor.work_area();
        let sf = monitor.scale_factor();
        let win = (STAGE_SIZE * sf) as i32;
        let margin = (EDGE_MARGIN * sf) as i32;
        PhysicalPosition::new(
            wa.position.x + wa.size.width as i32 - win - margin,
            wa.position.y + wa.size.height as i32 - win - margin,
        )
    } else {
        PhysicalPosition::new(1200, 600)
    }
}

fn on_stage_moved(app: &AppHandle, pos: PhysicalPosition<i32>) {
    if !MOVES_ARMED.load(Ordering::SeqCst) {
        return;
    }
    // 窗口最小化时 Windows 上报 (-32000, -32000)，不响应也不持久化
    if pos.x < -10000 || pos.y < -10000 {
        return;
    }
    let gen = MOVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            if MOVE_GEN.load(Ordering::SeqCst) == gen {
                let _ = app.emit_to("stage", "pet://signal", json!({"signal": "landed"}));
            }
        });
    }
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(800)).await;
            if MOVE_GEN.load(Ordering::SeqCst) == gen {
                app.state::<AppState>()
                    .config
                    .update(|c| c.pet_position = Some(PetPosition { x: pos.x, y: pos.y }));
            }
        });
    }
}

/// open_panel：定位到 stage 左上方（钳制在显示器工作区内），show + focus，发 `panel://tab`。
pub fn open_panel(app: &AppHandle, tab: &str) -> Result<(), String> {
    let panel = app
        .get_webview_window("panel")
        .ok_or("panel 窗口不存在")?;
    let stage = app
        .get_webview_window("stage")
        .ok_or("stage 窗口不存在")?;

    if let (Ok(stage_pos), Ok(panel_size)) = (stage.outer_position(), panel.outer_size()) {
        let monitor = stage
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(m) = monitor {
            let wa = m.work_area();
            let gap = (PANEL_GAP * m.scale_factor()) as i32;
            let (pw, ph) = (panel_size.width as i32, panel_size.height as i32);
            // clamp 要求 min <= max：面板比工作区还大时退化为贴边。
            let max_x = (wa.position.x + wa.size.width as i32 - pw).max(wa.position.x);
            let max_y = (wa.position.y + wa.size.height as i32 - ph).max(wa.position.y);
            let x = (stage_pos.x - pw - gap).clamp(wa.position.x, max_x);
            let y = (stage_pos.y - ph - gap).clamp(wa.position.y, max_y);
            let _ = panel.set_position(PhysicalPosition::new(x, y));
        }
    }
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("panel", "panel://tab", json!({"tab": tab}))
        .map_err(|e| e.to_string())?;

    // 懒启动 ACP：打开 chat tab 时拉起（契约 §9）。
    if tab == "chat" {
        let acp = app.state::<AppState>().acp.clone();
        tauri::async_runtime::spawn(async move { acp.ensure_started().await });
    }
    Ok(())
}

pub fn close_panel(app: &AppHandle) -> Result<(), String> {
    let panel = app
        .get_webview_window("panel")
        .ok_or("panel 窗口不存在")?;
    panel.hide().map_err(|e| e.to_string())
}
