mod ai;
mod capture;
mod secrets;
mod win;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalSize,
};
use tauri_plugin_autostart::MacosLauncher;

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "Окно не найдено".to_string())
}

/// Ghost (interactive = false): клики проходят сквозь окно, фокус не перехватывается.
/// Interactive (true): окно ловит мышь и клавиатуру.
#[tauri::command]
fn set_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let w = main_window(&app)?;
    w.set_ignore_cursor_events(!interactive).map_err(|e| e.to_string())?;
    w.set_focusable(interactive).map_err(|e| e.to_string())?;
    w.set_always_on_top(true).map_err(|e| e.to_string())?;
    if interactive {
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Включает/выключает WDA_EXCLUDEFROMCAPTURE: окно видно на мониторе, но не в записи/трансляции.
#[tauri::command]
fn set_stealth(app: AppHandle, enabled: bool) -> Result<(), String> {
    win::set_exclude_from_capture(&main_window(&app)?, enabled)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Ghost ⇄ Interactive", true, None::<&str>)?;
    let visibility = MenuItem::with_id(app, "visibility", "Показать / скрыть оверлей", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &visibility, &settings, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Stealth HUD")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            id => {
                let _ = app.emit("tray", id.to_string());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = tray.app_handle().emit("tray", "toggle".to_string());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Второй запуск не создаёт новое окно, а переключает уже работающее в Interactive
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit("tray", "interactive".to_string());
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(ai::StreamState::default())
        .manage(capture::Snapshot::default())
        .setup(|app| {
            let w = app.get_webview_window("main").expect("main window");
            // Окно растягивается на основной монитор (высота -1 px: окно, полностью
            // закрывающее монитор, может вывести игры из режима flip/fullscreen-optimizations)
            if let Some(m) = app.primary_monitor()? {
                w.set_position(*m.position())?;
                let s = m.size();
                w.set_size(PhysicalSize::new(s.width, s.height.saturating_sub(1)))?;
            }
            w.set_ignore_cursor_events(true)?;
            w.show()?;
            build_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_interactive,
            set_stealth,
            quit_app,
            capture::capture_full,
            capture::capture_region,
            capture::snapshot_begin,
            capture::snapshot_drop,
            ai::stream_chat,
            ai::cancel_chat,
            ai::fetch_models,
            ai::test_proxy,
            ai::test_key,
            secrets::secret_get,
            secrets::secret_set,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска Stealth HUD");
}
