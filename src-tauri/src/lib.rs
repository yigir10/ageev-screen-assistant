mod ai;
mod capture;
mod secrets;
mod win;

use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalSize, State,
};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Deserialize, Clone, Debug)]
pub struct HitRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

pub struct HitConfig {
    pub mode: String,
    pub rects: Vec<HitRect>,
    pub force_capture: bool,
}

impl Default for HitConfig {
    fn default() -> Self {
        Self {
            mode: "ghost".into(),
            rects: Vec::new(),
            force_capture: false,
        }
    }
}

#[derive(Default)]
pub struct HitState(pub Mutex<HitConfig>);

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main").ok_or_else(|| "Окно не найдено".to_string())
}

fn fit_primary_monitor(app: &AppHandle, w: &tauri::WebviewWindow) {
    if let Ok(Some(m)) = app.primary_monitor() {
        let _ = w.set_position(*m.position());
        let s = m.size();
        let _ = w.set_size(PhysicalSize::new(s.width, s.height.saturating_sub(1)));
    }
}

#[tauri::command]
fn set_window_mode(app: AppHandle, state: State<'_, HitState>, mode: String) -> Result<(), String> {
    let w = main_window(&app)?;
    {
        let mut g = state.0.lock().unwrap();
        g.mode = mode.clone();
        if mode != "interactive" {
            g.force_capture = false;
        }
    }

    match mode.as_str() {
        "ghost" => {
            w.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
            w.set_focusable(false).map_err(|e| e.to_string())?;
            w.set_always_on_top(true).map_err(|e| e.to_string())?;
        }
        "snipping" => {
            fit_primary_monitor(&app, &w);
            w.set_ignore_cursor_events(false).map_err(|e| e.to_string())?;
            w.set_focusable(true).map_err(|e| e.to_string())?;
            w.set_always_on_top(true).map_err(|e| e.to_string())?;
            let _ = w.set_focus();
        }
        _ => {
            fit_primary_monitor(&app, &w);
            w.set_focusable(true).map_err(|e| e.to_string())?;
            w.set_always_on_top(true).map_err(|e| e.to_string())?;
            let _ = w.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
fn set_hit_rects(state: State<'_, HitState>, rects: Vec<HitRect>, force_capture: bool) {
    let mut g = state.0.lock().unwrap();
    g.rects = rects;
    g.force_capture = force_capture;
}

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
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit("tray", "interactive".to_string());
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(ai::StreamState::default())
        .manage(capture::Snapshot::default())
        .manage(HitState::default())
        .setup(|app| {
            let w = app.get_webview_window("main").expect("main window");
            fit_primary_monitor(app.handle(), &w);
            w.set_ignore_cursor_events(true)?;
            w.show()?;
            build_tray(app.handle())?;

            let app_hit = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(25));
                let mut last_ignore: Option<bool> = None;
                loop {
                    interval.tick().await;
                    let (mode, rects, force_capture) = {
                        let st = app_hit.state::<HitState>();
                        let g = st.0.lock().unwrap();
                        (g.mode.clone(), g.rects.clone(), g.force_capture)
                    };
                    if mode != "interactive" {
                        last_ignore = None;
                        continue;
                    }
                    let Some(w) = app_hit.get_webview_window("main") else {
                        continue;
                    };
                    let inside = if force_capture {
                        true
                    } else if let Some((cx, cy)) = win::get_cursor_pos() {
                        let (wx, wy) = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
                        let rx = cx - wx;
                        let ry = cy - wy;
                        rects.iter().any(|r| {
                            rx >= r.x - 6
                                && rx <= r.x + r.w + 6
                                && ry >= r.y - 6
                                && ry <= r.y + r.h + 6
                        })
                    } else {
                        true
                    };
                    let want_ignore = !inside;
                    if last_ignore != Some(want_ignore) {
                        let _ = w.set_ignore_cursor_events(want_ignore);
                        last_ignore = Some(want_ignore);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_mode,
            set_hit_rects,
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
