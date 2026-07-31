//! 点击穿透：WM_NCHITTEST / HTTRANSPARENT 方案。
//!
//! 背景（均已在本机实测验证）：
//! - tao 0.35 的 `transparent(true)` 用 `WS_EX_NOREDIRECTIONBITMAP`，渲染正常；
//! - tao 的 `set_ignore_cursor_events(true)` 会加 `WS_EX_LAYERED`——
//!   stage 窗口一旦带上 WS_EX_LAYERED，WebView2 内容完全不渲染（窗口空白）。
//!   同理 SetLayeredWindowAttributes 色键方案也不可用。
//!
//! 因此：stage 用 `transparent(true)` 负责视觉透明，**永不调用**
//! `set_ignore_cursor_events`；点击穿透改为对 stage 顶层窗口及其全部后代窗口
//! （WebView2 的 Chrome_WidgetWin_* 链）挂 `SetWindowSubclass`：
//! `WM_NCHITTEST` 命中热区（前端上报，物理像素）→ 默认处理（WebView2 收到事件），
//! 否则返回 `HTTRANSPARENT`（点击穿透到下层窗口/桌面）。
//! WebView2 可能重建子窗口，每 2s 重新枚举补挂子类。
//!
//! 契约见 docs/architecture.md §5。

use std::sync::{LazyLock, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Clone, Debug)]
pub struct HotRegion {
    #[allow(dead_code)]
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 热区（相对 stage 窗口的物理像素）：(left, top, right, bottom)
static REGIONS: LazyLock<Mutex<Vec<(i32, i32, i32, i32)>>> = LazyLock::new(|| Mutex::new(Vec::new()));

/// 前端 update_hot_regions 命令入口：逻辑 px → 物理 px（按当前缩放）后存全局。
pub fn set_regions(app: &AppHandle, regions: Vec<HotRegion>) {
    let sf = app
        .get_webview_window("stage")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(1.0);
    let physical = regions
        .into_iter()
        .map(|r| {
            (
                (r.x * sf) as i32,
                (r.y * sf) as i32,
                ((r.x + r.w) * sf) as i32,
                ((r.y + r.h) * sf) as i32,
            )
        })
        .collect();
    *REGIONS.lock().unwrap_or_else(|e| e.into_inner()) = physical;
}

fn hit_inside(x: i32, y: i32) -> bool {
    REGIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|&(l, t, r, b)| x >= l && x < r && y >= t && y < b)
}

// ---------------------------------------------------------------------------
// Win32
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod win32 {
    pub const WM_NCHITTEST: u32 = 0x0084;
    pub const HTTRANSPARENT: isize = -1;
    pub const GA_ROOT: u32 = 2;
    pub const SUBCLASS_ID: usize = 0xD351_0001;

    #[repr(C)]
    #[derive(Default)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    pub type WndEnumProc = extern "system" fn(isize, isize) -> i32;
    pub type SubclassProc = extern "system" fn(isize, u32, usize, isize, usize, usize) -> isize;

    #[link(name = "user32")]
    extern "system" {
        pub fn EnumChildWindows(hwnd: isize, cb: WndEnumProc, lparam: isize) -> i32;
        pub fn GetAncestor(hwnd: isize, flags: u32) -> isize;
        pub fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
    }

    #[link(name = "comctl32")]
    extern "system" {
        pub fn SetWindowSubclass(hwnd: isize, proc: SubclassProc, id: usize, data: usize) -> i32;
        pub fn DefSubclassProc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    }
}

#[cfg(target_os = "windows")]
extern "system" fn hit_test_proc(
    hwnd: isize,
    msg: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    _data: usize,
) -> isize {
    use win32::*;
    if msg == WM_NCHITTEST {
        // lParam：屏幕坐标（LOWORD=x, HIWORD=y，有符号）
        let (sx, sy) = (lparam as i16 as i32, ((lparam >> 16) as i16) as i32);
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let mut rect = Rect::default();
        if root != 0 && unsafe { GetWindowRect(root, &mut rect) } != 0 {
            let (x, y) = (sx - rect.left, sy - rect.top);
            if !hit_inside(x, y) {
                return HTTRANSPARENT;
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(target_os = "windows")]
extern "system" fn subclass_enum_proc(hwnd: isize, _lparam: isize) -> i32 {
    use win32::*;
    unsafe {
        SetWindowSubclass(hwnd, hit_test_proc, SUBCLASS_ID, 0);
    }
    1
}

/// 启动：对 stage 及其全部后代窗口挂子类，并每 2s 补挂（WebView2 可能重建子窗口）。
pub fn start(app: AppHandle) {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn(async move {
            loop {
                if let Some(stage) = app.get_webview_window("stage") {
                    if let Ok(hwnd) = stage.hwnd() {
                        let raw = hwnd.0 as isize;
                        unsafe {
                            win32::SetWindowSubclass(raw, hit_test_proc, win32::SUBCLASS_ID, 0);
                            win32::EnumChildWindows(raw, subclass_enum_proc, 0);
                        }
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}
