//! 系统托盘：显示/隐藏宠物、打开对话、退出。契约见 docs/architecture.md §11。

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::windows;
use crate::AppState;

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle = MenuItemBuilder::with_id("toggle_pet", "显示/隐藏宠物").build(app)?;
    let open_chat = MenuItemBuilder::with_id("open_chat", "打开对话").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&toggle, &open_chat, &quit])
        .build()?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle_pet" => {
                if let Some(stage) = app.get_webview_window("stage") {
                    let visible = stage.is_visible().unwrap_or(true);
                    if visible {
                        let _ = stage.hide();
                    } else {
                        let _ = stage.show();
                    }
                    app.state::<AppState>()
                        .config
                        .update(|c| c.pet_visible = !visible);
                }
            }
            "open_chat" => {
                let _ = windows::open_panel(app, "chat");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}
