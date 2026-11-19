import fs from 'node:fs';
import path from 'node:path';

// 1. Безопасная перекодировка README.md из UTF-16 LE в UTF-8 (если нужно)
const readmePath = path.resolve(process.cwd(), 'README.md');
if (fs.existsSync(readmePath)) {
  const raw = fs.readFileSync(readmePath);
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    fs.writeFileSync(readmePath, raw.subarray(2).toString('utf16le'), 'utf8');
    console.log('✔ Перекодирован в UTF-8: README.md');
  } else if (raw.includes(0x00)) {
    fs.writeFileSync(readmePath, raw.toString('utf16le').replace(/^\uFEFF/, ''), 'utf8');
    console.log('✔ Перекодирован в UTF-8: README.md');
  }
}

const files = {
  // ───────────── RUST: Win32 (Stealth + GetCursorPos) ─────────────
  'src-tauri/src/win.rs': `//! Win32: защита окна от захвата экрана и чтение позиции курсора для динамического hit-testing.

#[cfg(windows)]
pub fn set_exclude_from_capture(window: &tauri::WebviewWindow, enable: bool) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let raw = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = HWND(raw.0 as _);
    let affinity = if enable { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    unsafe {
        SetWindowDisplayAffinity(hwnd, affinity)
            .map_err(|e| format!("SetWindowDisplayAffinity: {e} (нужна Windows 10 2004+)"))
    }
}

#[cfg(not(windows))]
pub fn set_exclude_from_capture(_window: &tauri::WebviewWindow, _enable: bool) -> Result<(), String> {
    Err("Stealth поддерживается только в Windows".into())
}

#[cfg(windows)]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT::default();
    unsafe { GetCursorPos(&mut pt).ok()? };
    Some((pt.x, pt.y))
}

#[cfg(not(windows))]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}
`,

  // ───────────── RUST: lib.rs (Hit-testing в Interactive Mode + автоподстройка разрешения) ─────────────
  'src-tauri/src/lib.rs': `mod ai;
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

/// Управление режимами окна:
/// - "ghost": клики всегда проходят сквозь окно
/// - "snipping": окно ловит клики на весь экран для выделения области
/// - "interactive": динамический hit-testing (клики ловятся только над панелями, вокруг работает весь экран)
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

            // Фоновый цикл динамического hit-testing (25 мс) для Interactive Mode
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
`,

  // ───────────── RUST: ai.rs (добавлено событие ai-status для видимых ретраев) ─────────────
  'src-tauri/src/ai.rs': `//! Мульти-провайдерный стриминг: Gemini (нативный SSE), OpenRouter и Local (OpenAI-совместимые).
//! Ответ уходит во фронтенд событиями: \`ai-chunk\`, \`ai-status\`, \`ai-done\`, \`ai-error\`.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::Duration};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, State};

const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta";
const OPENROUTER_BASE: &str = "https://openrouter.ai/api/v1";
const LOCAL_DEFAULT: &str = "http://127.0.0.1:8080/v1";

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub proxy: Option<String>,
    #[serde(default)]
    pub system_prompt: String,
}

#[derive(Deserialize, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub image: Option<String>,
}

#[derive(Serialize, Clone)]
struct ChunkEvt {
    id: u64,
    text: String,
}
#[derive(Serialize, Clone)]
struct StatusEvt {
    id: u64,
    text: String,
}
#[derive(Serialize, Clone)]
struct DoneEvt {
    id: u64,
}
#[derive(Serialize, Clone)]
struct ErrEvt {
    id: u64,
    message: String,
}

#[derive(Default)]
pub struct StreamState(Mutex<Option<JoinHandle<()>>>);

fn build_client(cfg: &AiConfig, timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder().connect_timeout(Duration::from_secs(15));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    if cfg.provider != "local" {
        if let Some(p) = cfg.proxy.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            b = b.proxy(reqwest::Proxy::all(p).map_err(|e| format!("Прокси: {e}"))?);
        }
    }
    b.build().map_err(|e| e.to_string())
}

fn local_base(cfg: &AiConfig) -> String {
    let b = cfg.base_url.trim().trim_end_matches('/');
    if b.is_empty() { LOCAL_DEFAULT.to_string() } else { b.to_string() }
}

fn short(s: &str) -> String {
    s.chars().take(400).collect()
}

fn gemini_body(cfg: &AiConfig, msgs: &[ChatMsg]) -> Value {
    let contents: Vec<Value> = msgs
        .iter()
        .map(|m| {
            let mut parts: Vec<Value> = Vec::new();
            if let Some(img) = &m.image {
                parts.push(json!({ "inline_data": { "mime_type": "image/jpeg", "data": img } }));
            }
            parts.push(json!({ "text": m.text }));
            json!({ "role": if m.role == "assistant" { "model" } else { "user" }, "parts": parts })
        })
        .collect();
    let mut body = json!({ "contents": contents });
    if !cfg.system_prompt.trim().is_empty() {
        body["system_instruction"] = json!({ "parts": [{ "text": cfg.system_prompt }] });
    }
    body
}

fn openai_body(cfg: &AiConfig, msgs: &[ChatMsg]) -> Value {
    let mut messages: Vec<Value> = Vec::new();
    if !cfg.system_prompt.trim().is_empty() {
        messages.push(json!({ "role": "system", "content": cfg.system_prompt }));
    }
    for m in msgs {
        let content = match &m.image {
            Some(img) => json!([
                { "type": "text", "text": m.text },
                { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{img}") } }
            ]),
            None => json!(m.text),
        };
        messages.push(json!({ "role": m.role, "content": content }));
    }
    json!({ "model": cfg.model, "stream": true, "messages": messages })
}

fn extract_gemini(v: &Value) -> String {
    let mut out = String::new();
    if let Some(parts) = v["candidates"][0]["content"]["parts"].as_array() {
        for p in parts {
            if p["thought"].as_bool() == Some(true) {
                continue;
            }
            if let Some(t) = p["text"].as_str() {
                out.push_str(t);
            }
        }
    }
    out
}

fn extract_openai(v: &Value) -> String {
    v["choices"][0]["delta"]["content"].as_str().unwrap_or("").to_string()
}

async fn run_stream(app: &AppHandle, cfg: &AiConfig, msgs: &[ChatMsg], id: u64) -> Result<(), String> {
    if cfg.provider != "local" && cfg.api_key.trim().is_empty() {
        return Err("Не задан API-ключ (Настройки → Провайдер)".into());
    }
    if cfg.model.trim().is_empty() && cfg.provider != "local" {
        return Err("Не выбрана модель".into());
    }
    let client = build_client(cfg, None)?;
    let gemini = cfg.provider == "gemini";

    let req = match cfg.provider.as_str() {
        "gemini" => {
            let model = cfg.model.trim().trim_start_matches("models/");
            client
                .post(format!("{GEMINI_BASE}/models/{model}:streamGenerateContent?alt=sse"))
                .header("x-goog-api-key", cfg.api_key.trim())
                .json(&gemini_body(cfg, msgs))
        }
        "openrouter" => client
            .post(format!("{OPENROUTER_BASE}/chat/completions"))
            .bearer_auth(cfg.api_key.trim())
            .header("X-Title", "Stealth HUD")
            .json(&openai_body(cfg, msgs)),
        "local" => {
            let mut r = client.post(format!("{}/chat/completions", local_base(cfg)));
            if !cfg.api_key.trim().is_empty() {
                r = r.bearer_auth(cfg.api_key.trim());
            }
            r.json(&openai_body(cfg, msgs))
        }
        other => return Err(format!("Неизвестный провайдер: {other}")),
    };

    let mut attempt = 0u32;
    let resp = loop {
        let this = req.try_clone().ok_or("Не удалось повторить запрос")?;
        match this.send().await {
            Ok(r) if r.status().is_success() => break r,
            Ok(r) => {
                let st = r.status();
                if (st.as_u16() == 429 || st.is_server_error()) && attempt < 3 {
                    let wait = 1u64 << attempt;
                    let _ = app.emit(
                        "ai-status",
                        StatusEvt {
                            id,
                            text: format!("Повтор {}/3 через {wait} с (HTTP {})…", attempt + 1, st.as_u16()),
                        },
                    );
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                    attempt += 1;
                    continue;
                }
                let body = r.text().await.unwrap_or_default();
                return Err(format!("HTTP {st}: {}", short(&body)));
            }
            Err(e) => {
                if attempt < 3 && (e.is_connect() || e.is_timeout()) {
                    let wait = 1u64 << attempt;
                    let _ = app.emit(
                        "ai-status",
                        StatusEvt {
                            id,
                            text: format!("Сбой сети, повтор {}/3 через {wait} с…", attempt + 1),
                        },
                    );
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                    attempt += 1;
                    continue;
                }
                return Err(format!("Сеть: {e}"));
            }
        }
    };

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Поток: {e}"))?;
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|b| *b == b'\\n') {
            let raw: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&raw);
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                return Ok(());
            }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(err) = v.get("error") {
                return Err(short(&err.to_string()));
            }
            let text = if gemini { extract_gemini(&v) } else { extract_openai(&v) };
            if !text.is_empty() {
                let _ = app.emit("ai-chunk", ChunkEvt { id, text });
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    state: State<'_, StreamState>,
    cfg: AiConfig,
    messages: Vec<ChatMsg>,
    request_id: u64,
) -> Result<(), String> {
    if let Some(h) = state.0.lock().unwrap().take() {
        h.abort();
    }
    let app2 = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        match run_stream(&app2, &cfg, &messages, request_id).await {
            Ok(()) => {
                let _ = app2.emit("ai-done", DoneEvt { id: request_id });
            }
            Err(message) => {
                let _ = app2.emit("ai-error", ErrEvt { id: request_id, message });
            }
        }
    });
    *state.0.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, StreamState>) {
    if let Some(h) = state.0.lock().unwrap().take() {
        h.abort();
    }
}

#[tauri::command]
pub async fn fetch_models(cfg: AiConfig) -> Result<Vec<String>, String> {
    let client = build_client(&cfg, Some(Duration::from_secs(20)))?;
    let mut ids: Vec<String> = Vec::new();

    match cfg.provider.as_str() {
        "gemini" => {
            if cfg.api_key.trim().is_empty() {
                return Err("Сначала введите API-ключ".into());
            }
            let v: Value = client
                .get(format!("{GEMINI_BASE}/models?pageSize=200"))
                .header("x-goog-api-key", cfg.api_key.trim())
                .send().await.map_err(|e| format!("Сеть: {e}"))?
                .error_for_status().map_err(|e| e.to_string())?
                .json().await.map_err(|e| e.to_string())?;
            for m in v["models"].as_array().into_iter().flatten() {
                let can_generate = m["supportedGenerationMethods"]
                    .as_array()
                    .map(|a| a.iter().any(|x| x == "generateContent"))
                    .unwrap_or(false);
                if let (true, Some(name)) = (can_generate, m["name"].as_str()) {
                    ids.push(name.trim_start_matches("models/").to_string());
                }
            }
        }
        "openrouter" => {
            let v: Value = client
                .get(format!("{OPENROUTER_BASE}/models"))
                .send().await.map_err(|e| format!("Сеть: {e}"))?
                .error_for_status().map_err(|e| e.to_string())?
                .json().await.map_err(|e| e.to_string())?;
            for m in v["data"].as_array().into_iter().flatten() {
                let vision = m["architecture"]["input_modalities"]
                    .as_array()
                    .map(|a| a.iter().any(|x| x == "image"))
                    .unwrap_or(false);
                if let (true, Some(id)) = (vision, m["id"].as_str()) {
                    ids.push(id.to_string());
                }
            }
        }
        "local" => {
            let v: Value = client
                .get(format!("{}/models", local_base(&cfg)))
                .send().await.map_err(|e| format!("Сеть: {e}"))?
                .error_for_status().map_err(|e| e.to_string())?
                .json().await.map_err(|e| e.to_string())?;
            for m in v["data"].as_array().into_iter().flatten() {
                if let Some(id) = m["id"].as_str() {
                    ids.push(id.to_string());
                }
            }
        }
        other => return Err(format!("Неизвестный провайдер: {other}")),
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

#[tauri::command]
pub async fn test_proxy(proxy: String) -> Result<u64, String> {
    let cfg = AiConfig {
        provider: "gemini".into(),
        api_key: String::new(),
        model: String::new(),
        base_url: String::new(),
        proxy: Some(proxy),
        system_prompt: String::new(),
    };
    let client = build_client(&cfg, Some(Duration::from_secs(10)))?;
    let t = std::time::Instant::now();
    client
        .get("https://www.google.com/generate_204")
        .send().await.map_err(|e| format!("Нет соединения: {e}"))?;
    Ok(t.elapsed().as_millis() as u64)
}

#[tauri::command]
pub async fn test_key(cfg: AiConfig) -> Result<u64, String> {
    let client = build_client(&cfg, Some(Duration::from_secs(15)))?;
    let key = cfg.api_key.trim().to_string();
    let t = std::time::Instant::now();
    let req = match cfg.provider.as_str() {
        "gemini" => {
            if key.is_empty() {
                return Err("Не задан API-ключ (Настройки → Провайдер)".into());
            }
            client.get(format!("{GEMINI_BASE}/models?pageSize=1")).header("x-goog-api-key", key)
        }
        "openrouter" => {
            if key.is_empty() {
                return Err("Не задан API-ключ (Настройки → Провайдер)".into());
            }
            client.get(format!("{OPENROUTER_BASE}/auth/key")).bearer_auth(key)
        }
        "local" => client.get(format!("{}/models", local_base(&cfg))),
        other => return Err(format!("Неизвестный провайдер: {other}")),
    };
    let resp = req.send().await.map_err(|e| format!("Сеть: {e}"))?;
    if !resp.status().is_success() {
        let st = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {st}: {}", short(&body)));
    }
    Ok(t.elapsed().as_millis() as u64)
}
`,

  // ───────────── CSS: подключаем KaTeX ─────────────
  'src/app.css': `@import 'katex/dist/katex.min.css';
@import 'tailwindcss';

@theme {
	--color-hud: rgba(10, 12, 18, 0.84);
	--color-hud-solid: #0b0d12;
	--color-surface: #151922;
	--color-line: rgba(255, 255, 255, 0.08);
	--color-fg: #e6e9f0;
	--color-muted: #8b93a7;
	--color-accent: #6ee7b7;
	--color-accent2: #818cf8;
	--color-danger: #f87171;
	--color-warn: #fbbf24;
	--font-sans: 'Inter', 'Segoe UI', system-ui, sans-serif;
	--font-mono: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
	--radius-panel: 14px;
	--radius-ctl: 8px;
}

html,
body {
	background: transparent !important;
	margin: 0;
	height: 100%;
	overflow: hidden;
	font-family: var(--font-sans);
	color: var(--color-fg);
}

button,
input,
textarea {
	font-family: inherit;
}

.katex-display {
	overflow-x: auto;
	overflow-y: hidden;
	margin: 0.45rem 0;
}

.caret {
	animation: caret-blink 1s steps(2, start) infinite;
	color: var(--color-accent);
}
@keyframes caret-blink {
	to {
		visibility: hidden;
	}
}

@media (prefers-reduced-motion: reduce) {
	* {
		animation-duration: 0.01ms !important;
		transition-duration: 0.01ms !important;
	}
}
`,

  // ───────────── LIB: state.svelte.ts (чистый UTF-8 + pinnedRegion + statusDetail + fromHistory + dragging) ─────────────
  'src/lib/state.svelte.ts': `import type { Mark } from './marks';

export type Provider = 'gemini' | 'openrouter' | 'local';
export type Mode = 'ghost' | 'interactive' | 'snipping';
export type Phase = 'idle' | 'capturing' | 'thinking' | 'streaming';
export type HotkeyName = 'full' | 'snip' | 'toggle' | 'visibility' | 'marks' | 'cancel' | 'preset';
export type Hotkeys = Record<HotkeyName, string>;

export interface Preset {
	id: string;
	name: string;
	prompt: string;
}

export interface PinnedRegion {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	text: string;
	image?: string;
}

export interface HistoryItem {
	id: string;
	ts: number;
	title: string;
	messages: { role: 'user' | 'assistant'; text: string }[];
}

export const PRESETS: Record<Provider, string[]> = {
	gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
	openrouter: [
		'google/gemini-2.5-flash',
		'google/gemini-2.0-flash-exp:free',
		'qwen/qwen2.5-vl-72b-instruct:free',
		'openai/gpt-4o-mini'
	],
	local: ['local-model']
};

export const DEFAULT_HOTKEYS: Hotkeys = {
	full: 'Alt+Q',
	snip: 'Alt+W',
	toggle: 'Alt+E',
	visibility: 'Alt+H',
	marks: 'Alt+M',
	cancel: 'Alt+X',
	preset: 'Alt+P'
};

export const HOTKEY_LABELS: Record<HotkeyName, string> = {
	full: 'Скрин (область / экран)',
	snip: 'Выделить область',
	toggle: 'Ghost ⇄ Interactive',
	visibility: 'Скрыть / показать HUD',
	marks: 'Очистить метки',
	cancel: 'Стоп генерации',
	preset: 'Следующий пресет'
};

export const DEFAULT_PRESETS: Preset[] = [
	{
		id: 'solve',
		name: 'Решить',
		prompt: 'Реши задачу со скриншота пошагово (используй формулы LaTeX $...$) и чётко выдели итоговый ответ.'
	},
	{
		id: 'brief',
		name: 'Кратко',
		prompt: 'Проанализируй скриншот и дай максимально краткий, точный ответ на русском языке без воды.'
	},
	{
		id: 'code',
		name: 'Код',
		prompt: 'Разбери код на скриншоте, найди ошибки или напиши исправленный вариант.'
	},
	{
		id: 'translate',
		name: 'Перевод',
		prompt: 'Переведи весь текст со скриншота на естественный русский язык.'
	}
];

function loadJson<T>(key: string, fallback: T): T {
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

const initialSettings = loadJson('stealth_hud_settings', {
	provider: 'gemini' as Provider,
	apiKeys: { gemini: '', openrouter: '', local: '' } as Record<Provider, string>,
	models: {
		gemini: 'gemini-2.5-flash',
		openrouter: 'google/gemini-2.0-flash-exp:free',
		local: 'local-model'
	} as Record<Provider, string>,
	localBaseUrl: 'http://127.0.0.1:8080/v1',
	proxyEnabled: false,
	proxyUrl: '',
	hotkeys: { ...DEFAULT_HOTKEYS } as Hotkeys,
	stealth: true,
	marksEnabled: false,
	marksTtl: 15,
	marksGrid: true,
	presets: structuredClone(DEFAULT_PRESETS) as Preset[],
	activePreset: DEFAULT_PRESETS[0].id,
	systemPrompt: 'Ты лаконичный и точный ИИ-ассистент. Отвечай на русском языке чётко и по делу.',
	opacity: 92,
	fontSize: 13,
	panelWidth: 420,
	panelPos: null as { x: number; y: number } | null,
	pinnedRegion: null as PinnedRegion | null,
	onboarded: false
});

initialSettings.hotkeys = { ...DEFAULT_HOTKEYS, ...initialSettings.hotkeys };
if (!Array.isArray(initialSettings.presets) || !initialSettings.presets.length) {
	initialSettings.presets = structuredClone(DEFAULT_PRESETS);
}

export const settings = $state(initialSettings);

export const ui = $state({
	mode: 'ghost' as Mode,
	hidden: false,
	capturing: false,
	phase: 'idle' as Phase,
	statusDetail: '',
	settingsOpen: false,
	historyOpen: false,
	recording: false,
	dragging: false,
	snipBg: '',
	marks: [] as Mark[],
	toasts: [] as { id: string; text: string; kind: 'info' | 'error' | 'ok' }[],
	models: { gemini: [], openrouter: [], local: [] } as Record<Provider, string[]>,
	secretsOk: false
});

export const session = $state({
	id: '',
	frame: { x: 0, y: 0, w: 1280, h: 720 },
	messages: [] as ChatMessage[],
	streaming: false,
	error: '',
	fromHistory: false
});

const initialHistory = (() => {
	if (typeof localStorage === 'undefined') return [] as HistoryItem[];
	try {
		const raw = localStorage.getItem('stealth_hud_history');
		return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
	} catch {
		return [];
	}
})();

export const history = $state({
	items: initialHistory
});

export function motion(ms = 150): number {
	if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return 0;
	}
	return ms;
}

if (typeof window !== 'undefined') {
	$effect.root(() => {
		$effect(() => {
			const snap = $state.snapshot(settings);
			const { apiKeys: _omit, ...safe } = snap;
			try {
				localStorage.setItem('stealth_hud_settings', JSON.stringify(safe));
			} catch {}
		});
		$effect(() => {
			const items = $state.snapshot(history.items);
			try {
				localStorage.setItem('stealth_hud_history', JSON.stringify(items));
			} catch {}
		});
	});
}
`,

  // ───────────── LIB: marks.ts (чистый UTF-8) ─────────────
  'src/lib/marks.ts': `export interface Mark {
	type: 'box' | 'arrow' | 'point' | 'text';
	x: number;
	y: number;
	x2?: number;
	y2?: number;
	label?: string;
}

export const MARKS_PROMPT = \`
Если нужно указать конкретное место на скриншоте, добавь в самом конце ответа блок:
\\\`\\\`\\\`marks
[{"type":"arrow","x":200,"y":300,"x2":500,"y2":600,"label":"Сюда"}]
\\\`\\\`\\\`
Координаты от 0 до 1000 относительно скриншота. Типы: box (x,y,x2,y2), arrow (x,y,x2,y2), point (x,y), text (x,y,label).\`;

export const GRID_PROMPT = \`
На скриншоте нанесена жёлтая координатная сетка 100..900 — используй её для точных координат в блоке marks.\`;

export function stripMarks(text: string): string {
	return text.replace(/\\\`\\\`\\\`marks[\\s\\S]*?(\\\`\\\`\\\`|$)/g, '').trimEnd();
}

export function extractMarks(text: string): Mark[] {
	const m = text.match(/\\\`\\\`\\\`marks\\s*([\\s\\S]*?)\\\`\\\`\\\`/);
	if (!m) return [];
	try {
		const arr = JSON.parse(m[1].trim());
		if (!Array.isArray(arr)) return [];
		return arr.filter(
			(x): x is Mark =>
				x &&
				typeof x === 'object' &&
				['box', 'arrow', 'point', 'text'].includes(x.type) &&
				typeof x.x === 'number' &&
				typeof x.y === 'number'
		);
	} catch {
		return [];
	}
}
`,

  // ───────────── LIB: hotkeys.ts (пропуск пустых хоткеев) ─────────────
  'src/lib/hotkeys.ts': `import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import type { HotkeyName, Hotkeys } from './state.svelte';

const MODIFIER_CODES = new Set([
	'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
	'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'
]);

const PASS_THROUGH = new Set([
	'Space', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon',
	'Quote', 'Comma', 'Period', 'Slash', 'Backslash',
	'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'
]);

function codeToKey(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit\\d$/.test(code)) return code.slice(5);
	if (/^F\\d{1,2}$/.test(code)) return code;
	return PASS_THROUGH.has(code) ? code : null;
}

export function eventToAccelerator(e: KeyboardEvent): string | null {
	if (MODIFIER_CODES.has(e.code)) return null;
	const key = codeToKey(e.code);
	if (!key) return null;
	const mods: string[] = [];
	if (e.ctrlKey) mods.push('CommandOrControl');
	if (e.altKey) mods.push('Alt');
	if (e.shiftKey) mods.push('Shift');
	if (e.metaKey) mods.push('Super');
	if (mods.length === 0 && !/^F\\d{1,2}$/.test(key)) return null;
	return [...mods, key].join('+');
}

const PRETTY: Record<string, string> = {
	CommandOrControl: 'Ctrl', Super: 'Win', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
	Backquote: '\`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
	Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\\\'
};

export function prettyAccelerator(accel: string): string[] {
	if (!accel.trim()) return ['—'];
	return accel.split('+').map((p) => PRETTY[p] ?? p);
}

export async function unregisterHotkeys() {
	try {
		await unregisterAll();
	} catch {}
}

export async function registerHotkeys(
	keys: Hotkeys,
	handlers: Record<HotkeyName, () => void>
): Promise<HotkeyName[]> {
	await unregisterHotkeys();
	const failed: HotkeyName[] = [];
	for (const name of Object.keys(keys) as HotkeyName[]) {
		const accel = keys[name]?.trim();
		if (!accel) continue;
		try {
			await register(accel, (ev) => {
				if (ev.state === 'Pressed') handlers[name]();
			});
		} catch {
			failed.push(name);
		}
	}
	return failed;
}
`,

  // ───────────── LIB: markdown.ts (с рендерингом формул KaTeX) ─────────────
  'src/lib/markdown.ts': `import katex from 'katex';

export type Seg = { t: 'code'; lang: string; code: string } | { t: 'html'; html: string };

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(math: string, displayMode: boolean): string {
	try {
		return katex.renderToString(math.trim(), { displayMode, throwOnError: false });
	} catch {
		return esc(math);
	}
}

function inline(src: string): string {
	const tokens: string[] = [];
	const stash = (html: string) => {
		const idx = tokens.push(html) - 1;
		return \`\\x00TOK\${idx}\\x00\`;
	};

	let s = src;
	// 1. Инлайн-код
	s = s.replace(/\`([^\`\\n]+)\`/g, (_, code) =>
		stash(\`<code class="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em] text-accent">\${esc(code)}</code>\`)
	);
	// 2. Блочные формулы $$...$$
	s = s.replace(/\\$\\$([\\s\\S]+?)\\$\\$/g, (_, math) => stash(renderMath(math, true)));
	// 3. Инлайн-формулы $...$
	s = s.replace(/(?<!\\\\)\\$([^\\n$]+?)\\$/g, (_, math) => stash(renderMath(math, false)));

	s = esc(s);
	s = s.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^#{1,6}\\s+(.*)$/gm, '<strong class="font-semibold">$1</strong>');
	s = s.replace(/^\\s*[-*]\\s+/gm, '• ');

	let html = s
		.split(/\\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => \`<p class="my-1.5">\${p.replace(/\\n/g, '<br>')}</p>\`)
		.join('');

	return html.replace(/\\x00TOK(\\d+)\\x00/g, (_, i) => tokens[Number(i)] ?? '');
}

export function parseMarkdown(src: string): Seg[] {
	const segs: Seg[] = [];
	const re = /\\\`\\\`\\\`([\\w+-]*)\\n?([\\s\\S]*?)(\\\`\\\`\\\`|$)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src))) {
		if (m.index > last) segs.push({ t: 'html', html: inline(src.slice(last, m.index)) });
		segs.push({ t: 'code', lang: m[1], code: m[2].replace(/\\n$/, '') });
		last = re.lastIndex;
	}
	if (last < src.length) segs.push({ t: 'html', html: inline(src.slice(last)) });
	return segs;
}
`,

  // ───────────── LIB: actions.ts (все фиксы + закрепляемая область + текстовый чат + Ctrl+V) ─────────────
  'src/lib/actions.ts': `import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tick } from 'svelte';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { extractMarks, GRID_PROMPT, MARKS_PROMPT } from './marks';
import { friendlyError } from './errors';
import {
	DEFAULT_PRESETS,
	HOTKEY_LABELS,
	history,
	session,
	settings,
	ui,
	type HotkeyName,
	type Mode
} from './state.svelte';

let reqId = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
	const id = crypto.randomUUID();
	ui.toasts.push({ id, text, kind });
	setTimeout(() => {
		ui.toasts = ui.toasts.filter((t) => t.id !== id);
	}, 4500);
}

// ───────────── режимы окна и шторки ─────────────

export async function setMode(mode: Mode) {
	ui.mode = mode;
	if (mode !== 'ghost') ui.hidden = false;
	if (mode !== 'interactive') {
		ui.settingsOpen = false;
		ui.historyOpen = false;
		ui.dragging = false;
	}
	try {
		await invoke('set_window_mode', { mode });
	} catch (e) {
		toast(String(e), 'error');
	}
}

export const toggleMode = () => setMode(ui.mode === 'ghost' ? 'interactive' : 'ghost');

export function toggleVisibility() {
	ui.hidden = !ui.hidden;
	if (ui.hidden && ui.mode !== 'ghost') void setMode('ghost');
}

export function openSettings(open?: boolean) {
	const next = open ?? !ui.settingsOpen;
	ui.settingsOpen = next;
	if (next) ui.historyOpen = false;
}

export function openHistory(open?: boolean) {
	const next = open ?? !ui.historyOpen;
	ui.historyOpen = next;
	if (next) ui.settingsOpen = false;
}

export async function applyStealth() {
	try {
		await invoke('set_stealth', { enabled: settings.stealth });
	} catch (e) {
		toast(\`Stealth: \${e}\`, 'error');
	}
}

// ───────────── захват экрана и закреплённая область ─────────────

async function hideUiForCapture() {
	if (settings.stealth) return;
	ui.capturing = true;
	await tick();
	await new Promise((r) => requestAnimationFrame(() => r(null)));
	await sleep(90);
}

async function capture(
	cmd: 'capture_full' | 'capture_region',
	frame: { x: number; y: number; w: number; h: number },
	args?: Record<string, unknown>,
	skipHide = false
) {
	await cancel();
	ui.hidden = false;
	if (!skipHide) await hideUiForCapture();
	ui.phase = 'capturing';
	ui.statusDetail = '';
	try {
		const image = await invoke<string>(cmd, args);
		session.frame = frame;
		beginChat(image);
	} catch (e) {
		ui.phase = 'idle';
		toast(String(e), 'error');
	} finally {
		ui.capturing = false;
	}
}

const useGrid = () => settings.marksEnabled && settings.marksGrid;

function clampRect(r: Rect): Rect | null {
	const maxW = window.innerWidth;
	const maxH = window.innerHeight;
	const x = Math.max(0, Math.min(r.x, maxW - 10));
	const y = Math.max(0, Math.min(r.y, maxH - 10));
	const w = Math.min(r.w, maxW - x);
	const h = Math.min(r.h, maxH - y);
	return w >= 10 && h >= 10 ? { x, y, w, h } : null;
}

/** Быстрый «Скрин»: если область закреплена — снимает её мгновенно, иначе — весь экран. */
export async function captureFull() {
	const pinned = settings.pinnedRegion ? clampRect(settings.pinnedRegion) : null;
	if (pinned) {
		const dpr = window.devicePixelRatio || 1;
		await capture('capture_region', pinned, {
			region: {
				x: Math.round(pinned.x * dpr),
				y: Math.round(pinned.y * dpr),
				w: Math.round(pinned.w * dpr),
				h: Math.round(pinned.h * dpr)
			},
			grid: useGrid(),
			useCached: false
		});
		return;
	}
	await capture('capture_full', { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, { grid: useGrid() });
}

export function clearPinnedRegion() {
	settings.pinnedRegion = null;
	toast('Сброшено: быстрый скрин снимает весь экран', 'info');
}

export async function startSnip() {
	await cancel();
	ui.hidden = false;
	await hideUiForCapture();
	try {
		ui.snipBg = await invoke<string>('snapshot_begin');
	} catch (e) {
		ui.snipBg = '';
		toast(String(e), 'error');
	} finally {
		ui.capturing = false;
	}
	await setMode('snipping');
}

export async function cancelSnip() {
	ui.snipBg = '';
	await invoke('snapshot_drop').catch(() => {});
	await setMode('ghost');
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Выделение области: запоминает зону для быстрого скрина и сразу отправляет её в ИИ. */
export async function captureRegion(rect: Rect) {
	const dpr = window.devicePixelRatio || 1;
	const cached = !!ui.snipBg;
	ui.snipBg = '';
	settings.pinnedRegion = { ...rect };
	await setMode('ghost');
	await capture(
		'capture_region',
		rect,
		{
			region: {
				x: Math.round(rect.x * dpr),
				y: Math.round(rect.y * dpr),
				w: Math.round(rect.w * dpr),
				h: Math.round(rect.h * dpr)
			},
			grid: useGrid(),
			useCached: cached
		},
		cached
	);
}

// ───────────── чат и пресеты ─────────────

const proxyOn = () => settings.proxyEnabled && settings.proxyUrl.trim() !== '';

export function activePrompt(): string {
	const p = settings.presets.find((x) => x.id === settings.activePreset) ?? settings.presets[0];
	return p?.prompt.trim() || 'Проанализируй скриншот и ответь на то, что на нём спрашивается или требуется сделать.';
}

/** Одиночный клик только переключает активный пресет (без лишней траты API). */
export function selectPreset(id: string) {
	settings.activePreset = id;
}

/** Повторный прогон по текущему скриншоту выбранным пресетом (двойной клик). */
export function runPresetNow(id: string) {
	settings.activePreset = id;
	if (session.messages.length && !session.streaming) ask(activePrompt());
}

export function cyclePreset() {
	if (!settings.presets.length) return;
	const i = settings.presets.findIndex((p) => p.id === settings.activePreset);
	const next = settings.presets[(i + 1) % settings.presets.length];
	settings.activePreset = next.id;
	toast(\`Пресет: \${next.name}\`, 'info');
}

export function addPreset() {
	settings.presets.push({ id: crypto.randomUUID(), name: 'Новый пресет', prompt: '' });
}

export function removePreset(id: string) {
	if (settings.presets.length <= 1) return;
	settings.presets = settings.presets.filter((p) => p.id !== id);
	if (settings.activePreset === id) settings.activePreset = settings.presets[0].id;
}

export function resetPresets() {
	settings.presets = structuredClone(DEFAULT_PRESETS);
	settings.activePreset = DEFAULT_PRESETS[0].id;
}

function beginChat(image: string, customText?: string) {
	session.id = crypto.randomUUID();
	session.fromHistory = false;
	session.messages = [
		{ role: 'user', text: customText?.trim() || activePrompt(), image },
		{ role: 'assistant', text: '' }
	];
	void send();
}

/** Текстовый вопрос работает как с историей, так и с нуля (или с картинкой из буфера Ctrl+V). */
export function ask(text: string, pastedImage?: string | null) {
	const t = text.trim();
	if (session.streaming) return;
	if (!t && !pastedImage) return;

	if (session.messages.length === 0) {
		session.id = crypto.randomUUID();
		session.fromHistory = false;
		session.frame = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
		session.messages = [
			{ role: 'user', text: t || activePrompt(), image: pastedImage ?? undefined },
			{ role: 'assistant', text: '' }
		];
	} else {
		if (pastedImage) session.fromHistory = false;
		session.messages.push(
			{ role: 'user', text: t || activePrompt(), image: pastedImage ?? undefined },
			{ role: 'assistant', text: '' }
		);
	}
	void send();
}

async function send() {
	const id = ++reqId;
	const p = settings.provider;
	session.streaming = true;
	session.error = '';
	ui.phase = 'thinking';
	ui.statusDetail = '';
	clearMarks();

	const all = session.messages.slice(0, -1);
	const trimmed = all.length > 13 ? [all[0], ...all.slice(-12)] : all;
	const payload = trimmed.map((m) => ({ role: m.role, text: m.text, image: m.image ?? null }));
	const cfg = {
		provider: p,
		apiKey: settings.apiKeys[p],
		model: settings.models[p],
		baseUrl: settings.localBaseUrl,
		proxy: proxyOn() ? settings.proxyUrl.trim() : null,
		systemPrompt:
			settings.systemPrompt +
			(settings.marksEnabled ? MARKS_PROMPT + (settings.marksGrid ? GRID_PROMPT : '') : '')
	};
	try {
		await invoke('stream_chat', { cfg, messages: payload, requestId: id });
	} catch (e) {
		fail(String(e));
	}
}

function fail(message: string) {
	session.streaming = false;
	ui.phase = 'idle';
	ui.statusDetail = '';
	message = friendlyError(message, settings.provider, proxyOn());
	session.error = message;
	const last = session.messages.at(-1);
	if (last?.role === 'assistant' && !last.text) session.messages.pop();
	toast(message, 'error');
}

export function retry() {
	if (session.streaming) return;
	if (session.messages.at(-1)?.role === 'assistant') session.messages.pop();
	if (session.messages.at(-1)?.role !== 'user') return;
	session.messages.push({ role: 'assistant', text: '' });
	void send();
}

export async function cancel() {
	await invoke('cancel_chat').catch(() => {});
	session.streaming = false;
	ui.phase = 'idle';
	ui.statusDetail = '';
}

// ───────────── разметка на экране ─────────────

let marksTimer: ReturnType<typeof setTimeout> | undefined;

export function clearMarks() {
	clearTimeout(marksTimer);
	ui.marks = [];
}

function showMarksFrom(text: string) {
	if (!settings.marksEnabled) return;
	const marks = extractMarks(text);
	if (!marks.length) return;
	ui.marks = marks;
	clearTimeout(marksTimer);
	if (settings.marksTtl > 0) marksTimer = setTimeout(clearMarks, settings.marksTtl * 1000);
}

export function clearChat() {
	void cancel();
	clearMarks();
	session.messages = [];
	session.id = '';
	session.error = '';
	session.fromHistory = false;
}

// ───────────── ключи в Windows Credential Manager (с дебаунсом и диффом) ─────────────

const PROVIDERS = ['gemini', 'openrouter', 'local'] as const;
const lastSavedKeys: Record<(typeof PROVIDERS)[number], string> = { gemini: '', openrouter: '', local: '' };
const saveTimers: Partial<Record<(typeof PROVIDERS)[number], ReturnType<typeof setTimeout>>> = {};

export async function loadSecrets() {
	try {
		for (const p of PROVIDERS) {
			const v = await invoke<string | null>('secret_get', { name: \`apikey-\${p}\` });
			if (v) {
				settings.apiKeys[p] = v;
				lastSavedKeys[p] = v;
			} else if (settings.apiKeys[p]) {
				await invoke('secret_set', { name: \`apikey-\${p}\`, value: settings.apiKeys[p] });
				lastSavedKeys[p] = settings.apiKeys[p];
			}
		}
		ui.secretsOk = true;
	} catch (e) {
		ui.secretsOk = false;
		toast(\`Хранилище ключей недоступно: \${e}\`, 'error');
	}
}

export function scheduleSaveSecret(p: (typeof PROVIDERS)[number], value: string) {
	if (!ui.secretsOk || lastSavedKeys[p] === value) return;
	clearTimeout(saveTimers[p]);
	saveTimers[p] = setTimeout(() => {
		lastSavedKeys[p] = value;
		void invoke('secret_set', { name: \`apikey-\${p}\`, value }).catch((e) => toast(String(e), 'error'));
	}, 400);
}

export const quitApp = () => invoke('quit_app');

export async function initEvents(): Promise<UnlistenFn[]> {
	return [
		await listen<string>('tray', (e) => {
			if (e.payload === 'toggle') void toggleMode();
			else if (e.payload === 'visibility') toggleVisibility();
			else if (e.payload === 'interactive') void setMode('interactive');
			else if (e.payload === 'settings') {
				void setMode('interactive');
				openSettings(true);
			}
		}),
		await listen<{ id: number; text: string }>('ai-status', (e) => {
			if (e.payload.id !== reqId) return;
			ui.statusDetail = e.payload.text;
		}),
		await listen<{ id: number; text: string }>('ai-chunk', (e) => {
			if (e.payload.id !== reqId) return;
			const last = session.messages.at(-1);
			if (last?.role === 'assistant') last.text += e.payload.text;
			ui.phase = 'streaming';
			ui.statusDetail = '';
		}),
		await listen<{ id: number }>('ai-done', (e) => {
			if (e.payload.id !== reqId) return;
			session.streaming = false;
			ui.phase = 'idle';
			ui.statusDetail = '';
			const last = session.messages.at(-1);
			if (last?.role === 'assistant') showMarksFrom(last.text);
			saveHistory();
		}),
		await listen<{ id: number; message: string }>('ai-error', (e) => {
			if (e.payload.id === reqId) fail(e.payload.message);
		})
	];
}

// ───────────── настройки: модели и прокси ─────────────

export async function loadModels(): Promise<void> {
	const p = settings.provider;
	try {
		const list = await invoke<string[]>('fetch_models', {
			cfg: {
				provider: p,
				apiKey: settings.apiKeys[p],
				model: '',
				baseUrl: settings.localBaseUrl,
				proxy: proxyOn() ? settings.proxyUrl.trim() : null,
				systemPrompt: ''
			}
		});
		ui.models[p] = list;
		toast(\`Загружено моделей: \${list.length}\`, 'ok');
	} catch (e) {
		toast(friendlyError(String(e), p, proxyOn()), 'error');
	}
}

export async function checkProxy(): Promise<void> {
	if (!settings.proxyUrl.trim()) return toast('Введите URL прокси', 'error');
	try {
		const ms = await invoke<number>('test_proxy', { proxy: settings.proxyUrl.trim() });
		toast(\`Прокси работает: \${ms} мс\`, 'ok');
	} catch (e) {
		toast(friendlyError(String(e), settings.provider, true), 'error');
	}
}

// ───────────── хоткеи ─────────────

export async function applyHotkeys() {
	const failed = await registerHotkeys(
		{ ...settings.hotkeys },
		{
			full: () => void captureFull(),
			snip: () => void startSnip(),
			toggle: () => void toggleMode(),
			visibility: toggleVisibility,
			marks: clearMarks,
			cancel: () => {
				void cancel();
				clearMarks();
			},
			preset: cyclePreset
		}
	);
	if (failed.length) {
		toast(\`Хоткей занят: \${failed.map((n: HotkeyName) => HOTKEY_LABELS[n]).join(', ')}\`, 'error');
	}
}

export const releaseHotkeys = unregisterHotkeys;

// ───────────── проверка ключа, онбординг ─────────────

export async function testKey(): Promise<boolean> {
	const p = settings.provider;
	try {
		const ms = await invoke<number>('test_key', {
			cfg: {
				provider: p,
				apiKey: settings.apiKeys[p],
				model: '',
				baseUrl: settings.localBaseUrl,
				proxy: proxyOn() ? settings.proxyUrl.trim() : null,
				systemPrompt: ''
			}
		});
		toast(\`Подключение работает (\${ms} мс)\`, 'ok');
		return true;
	} catch (e) {
		toast(friendlyError(String(e), p, proxyOn()), 'error');
		return false;
	}
}

export function finishOnboarding() {
	settings.onboarded = true;
}

// ───────────── история ─────────────

function saveHistory() {
	if (!session.id) return;
	const msgs = session.messages.map((m) => ({ role: m.role, text: m.text }));
	const firstAnswer = msgs.find((m) => m.role === 'assistant' && m.text);
	if (!firstAnswer) return;
	const title = firstAnswer.text.replace(/\\\`\\\`\\\`marks[\\s\\S]*$/, '').trim().slice(0, 70) || 'Без названия';
	const i = history.items.findIndex((h) => h.id === session.id);
	if (i >= 0) history.items.splice(i, 1);
	history.items.unshift({ id: session.id, ts: Date.now(), title, messages: msgs });
	if (history.items.length > 30) history.items.length = 30;
}

export function openHistoryItem(id: string) {
	const item = history.items.find((h) => h.id === id);
	if (!item) return;
	void cancel();
	clearMarks();
	session.messages = JSON.parse(JSON.stringify(item.messages));
	session.id = item.id;
	session.error = '';
	session.fromHistory = true;
	ui.historyOpen = false;
}

export function deleteHistoryItem(id: string) {
	history.items = history.items.filter((h) => h.id !== id);
}

export function clearHistory() {
	history.items = [];
}

export async function exportHistoryItem(id: string) {
	const item = history.items.find((h) => h.id === id);
	if (!item) return;
	const md = item.messages
		.map((m) => \`**\${m.role === 'user' ? 'Вы' : 'Модель'}:**\\n\\n\${m.text.replace(/\\\`\\\`\\\`marks[\\s\\S]*?\\\`\\\`\\\`/g, '').trim()}\`)
		.join('\\n\\n---\\n\\n');
	try {
		await navigator.clipboard.writeText(md);
		toast('Диалог скопирован в буфер как markdown', 'ok');
	} catch {
		toast('Не удалось скопировать в буфер', 'error');
	}
}
`,

  // ───────────── COMPONENT: Header.svelte (чистый UTF-8 + взаимоисключающие шторки) ─────────────
  'src/lib/components/Header.svelte': `<script lang="ts">
	import { captureFull, clearChat, openHistory, openSettings, setMode, startSnip } from '$lib/actions';
	import { session, ui } from '$lib/state.svelte';

	let { ondragstart }: { ondragstart: (e: PointerEvent) => void } = $props();
	const btn =
		'h-7 cursor-pointer rounded-md border border-line bg-surface px-2 text-xs text-muted hover:border-accent hover:text-fg';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	onpointerdown={ondragstart}
	class="flex cursor-move items-center justify-between gap-2 border-b border-line bg-white/[0.02] px-3 py-2 select-none"
>
	<div class="flex items-center gap-1.5">
		<span class="text-xs font-semibold text-fg">Stealth HUD</span>
		<button
			type="button"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={captureFull}
			title="Сделать быстрый скрин"
			class={btn}>Скрин</button
		>
		<button
			type="button"
			onpointerdown={(e) => e.stopPropagation()}
			onclick={startSnip}
			title="Выделить и закрепить область"
			class={btn}>Область</button
		>
	</div>

	<div class="flex items-center gap-1" onpointerdown={(e) => e.stopPropagation()}>
		{#if session.messages.length}
			<button type="button" title="Очистить чат" onclick={clearChat} class={btn}>Очистить</button>
		{/if}
		<button
			type="button"
			title="История"
			onclick={() => openHistory()}
			class="{btn} {ui.historyOpen ? 'border-accent text-accent' : ''}">История</button
		>
		<button
			type="button"
			title="Настройки"
			onclick={() => openSettings()}
			class="{btn} {ui.settingsOpen ? 'border-accent text-accent' : ''}">⚙</button
		>
		<button type="button" title="Вернуться в Ghost Mode (Esc)" onclick={() => setMode('ghost')} class={btn}>Ghost</button>
	</div>
</div>
`,

  // ───────────── COMPONENT: Panel.svelte (зажим координат + бейдж области + data-hit-area) ─────────────
  'src/lib/components/Panel.svelte': `<script lang="ts">
	import { fly } from 'svelte/transition';
	import { clearPinnedRegion } from '$lib/actions';
	import { motion, session, settings, ui } from '$lib/state.svelte';
	import Header from './Header.svelte';
	import Messages from './Messages.svelte';
	import ChatInput from './ChatInput.svelte';

	let innerWidth = $state(1280);
	let innerHeight = $state(720);

	const interactive = $derived(ui.mode === 'interactive');
	const pos = $derived.by(() => {
		const raw = settings.panelPos ?? { x: Math.max(0, innerWidth - settings.panelWidth - 24), y: 24 };
		return {
			x: Math.min(Math.max(0, raw.x), Math.max(0, innerWidth - Math.min(settings.panelWidth, 160))),
			y: Math.min(Math.max(0, raw.y), Math.max(0, innerHeight - 60))
		};
	});

	const dotColor = $derived(interactive ? 'bg-accent' : 'bg-muted');
	const statusText = $derived(
		session.streaming ? 'стримится…' : session.error ? 'ошибка' : session.messages.length ? 'готово' : 'ожидание'
	);

	let drag: { dx: number; dy: number } | null = null;
	let resize: { startX: number; startW: number } | null = null;

	function ondragstart(e: PointerEvent) {
		drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
		ui.dragging = true;
	}
	function onpointermove(e: PointerEvent) {
		if (resize) {
			settings.panelWidth = Math.min(720, Math.max(320, Math.round(resize.startW + e.clientX - resize.startX)));
		}
		if (!drag) return;
		settings.panelPos = {
			x: Math.min(Math.max(0, e.clientX - drag.dx), Math.max(0, innerWidth - 80)),
			y: Math.min(Math.max(0, e.clientY - drag.dy), Math.max(0, innerHeight - 40))
		};
	}
	function onpointerup() {
		drag = null;
		resize = null;
		ui.dragging = false;
	}
	function onresizestart(e: PointerEvent) {
		e.stopPropagation();
		resize = { startX: e.clientX, startW: settings.panelWidth };
		ui.dragging = true;
	}
</script>

<svelte:window bind:innerWidth bind:innerHeight {onpointermove} {onpointerup} />

<div
	data-hit-area
	class="fixed flex flex-col overflow-hidden rounded-panel border bg-hud shadow-2xl {interactive ? 'border-accent' : 'border-line'}"
	style="left:{pos.x}px; top:{pos.y}px; width:{settings.panelWidth}px; font-size:{settings.fontSize}px; opacity:{settings.opacity / 100};
		{interactive ? 'height:min(72vh, 640px)' : 'max-height:60vh'}"
>
	{#if interactive}
		<div transition:fly={{ y: -4, duration: motion() }}>
			<Header {ondragstart} />
		</div>
	{/if}

	<Messages {interactive} />

	<div class="flex items-center justify-between gap-2 px-3.5 py-2 text-[11px] text-muted">
		<div class="flex min-w-0 items-center gap-1.5">
			<span class="h-1.5 w-1.5 flex-none rounded-full {session.error ? 'bg-danger' : session.streaming ? 'bg-warn' : dotColor}"></span>
			<span class="truncate">{settings.provider} · {settings.models[settings.provider]} · {statusText}</span>
		</div>

		{#if settings.pinnedRegion}
			<span class="inline-flex flex-none items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
				{Math.round(settings.pinnedRegion.w)}×{Math.round(settings.pinnedRegion.h)}
				{#if interactive}
					<button
						type="button"
						title="Сбросить на весь экран"
						onclick={clearPinnedRegion}
						class="cursor-pointer border-0 bg-transparent p-0 text-accent hover:text-fg">✕</button
					>
				{/if}
			</span>
		{:else}
			<span class="flex-none text-[10px] text-muted">Весь экран</span>
		{/if}
	</div>

	{#if interactive}
		<div transition:fly={{ y: 4, duration: motion() }}>
			<ChatInput />
		</div>
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Изменить ширину панели"
			onpointerdown={onresizestart}
			class="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize hover:bg-accent/40"
		></div>
	{/if}
</div>
`,

  // ───────────── COMPONENT: ChatInput.svelte (Ctrl+V скриншоты + честный плейсхолдер + умные пресеты) ─────────────
  'src/lib/components/ChatInput.svelte': `<script lang="ts">
	import { fade } from 'svelte/transition';
	import { ask, cancel, retry, runPresetNow, selectPreset, toast } from '$lib/actions';
	import { motion, session, settings } from '$lib/state.svelte';

	let text = $state('');
	let pendingImage = $state<string | null>(null);
	let zoom = $state(false);

	const shot = $derived(pendingImage ?? session.messages.find((m) => m.image)?.image ?? null);
	const placeholder = $derived(
		pendingImage
			? 'Картинка из буфера готова — напишите вопрос или Enter…'
			: session.fromHistory
				? 'Диалог из истории (без скриншота) — спросите текстом или Ctrl+V…'
				: session.messages.length
					? 'Уточнить вопрос или Ctrl+V скриншот…'
					: 'Спросите текстом или вставьте скриншот (Ctrl+V)…'
	);

	function submit() {
		if (!text.trim() && !pendingImage) return;
		const img = pendingImage;
		pendingImage = null;
		ask(text, img);
		text = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		}
	}

	function onpaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			const file = item.getAsFile();
			if (!file) continue;
			e.preventDefault();
			const url = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				const maxW = 1800;
				const scale = img.width > maxW ? maxW / img.width : 1;
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(img.width * scale);
				canvas.height = Math.round(img.height * scale);
				const ctx = canvas.getContext('2d');
				if (ctx) {
					ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
					pendingImage = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? null;
					toast('Скриншот из буфера прикреплён', 'ok');
				}
				URL.revokeObjectURL(url);
			};
			img.src = url;
			break;
		}
	}
</script>

<div class="relative flex flex-col gap-2 border-t border-line p-3">
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Пресеты запросов">
		{#each settings.presets as p (p.id)}
			<button
				type="button"
				aria-pressed={settings.activePreset === p.id}
				title="{p.prompt}\\n(Двойной клик — сразу спросить по текущему скриншоту)"
				onclick={() => selectPreset(p.id)}
				ondblclick={() => runPresetNow(p.id)}
				class="h-6 cursor-pointer rounded-full border px-2.5 text-[11px] {settings.activePreset === p.id
					? 'border-accent bg-accent/15 text-accent'
					: 'border-line bg-surface text-muted hover:text-fg'}"
			>{p.name}</button>
		{/each}
	</div>

	{#if zoom && shot}
		<div
			data-hit-area
			transition:fade={{ duration: motion() }}
			class="absolute bottom-full left-3 z-10 mb-2 overflow-hidden rounded-ctl border border-line bg-hud-solid shadow-xl"
		>
			<img alt="Скриншот" class="max-h-64 max-w-[380px]" src="data:image/jpeg;base64,{shot}" />
		</div>
	{/if}

	<div class="flex items-end gap-2">
		<div class="relative">
			<button
				type="button"
				aria-label="Показать скриншот"
				disabled={!shot}
				onclick={() => (zoom = !zoom)}
				class="h-9 w-14 flex-none cursor-pointer overflow-hidden rounded-ctl border bg-surface p-0 disabled:cursor-default disabled:opacity-40 {pendingImage
					? 'border-accent'
					: 'border-line'}"
			>
				{#if shot}<img alt="" class="h-full w-full object-cover" src="data:image/jpeg;base64,{shot}" />{/if}
			</button>
			{#if pendingImage}
				<button
					type="button"
					title="Убрать вставленную картинку"
					onclick={() => (pendingImage = null)}
					class="absolute -top-1.5 -right-1.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-danger text-[10px] text-hud-solid"
				>✕</button>
			{/if}
		</div>

		<textarea
			aria-label="Уточнить вопрос"
			rows="1"
			bind:value={text}
			{onkeydown}
			{onpaste}
			{placeholder}
			class="max-h-28 min-h-9 flex-1 resize-none rounded-ctl border border-line bg-surface px-3 py-2 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent"
		></textarea>

		{#if !session.streaming && session.messages.length}
			<button
				type="button"
				aria-label="Повторить"
				title="Повторить запрос"
				onclick={retry}
				class="h-9 cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg hover:border-accent">↻</button
			>
		{/if}

		{#if session.streaming}
			<button
				type="button"
				onclick={cancel}
				class="h-9 cursor-pointer rounded-ctl border border-danger bg-transparent px-3 text-[13px] text-danger">Стоп</button
			>
		{:else}
			<button
				type="button"
				aria-label="Отправить"
				onclick={submit}
				class="h-9 cursor-pointer rounded-ctl border-0 bg-accent px-3.5 text-[13px] font-semibold text-hud-solid">↵</button
			>
		{/if}
	</div>
</div>
`,

  // ───────────── COMPONENT: Messages.svelte (кнопка копирования всего ответа) ─────────────
  'src/lib/components/Messages.svelte': `<script lang="ts">
	import { stripMarks } from '$lib/marks';
	import { session, settings, HOTKEY_LABELS, type HotkeyName } from '$lib/state.svelte';
	import Markdown from './Markdown.svelte';
	import Kbd from './Kbd.svelte';

	let { interactive }: { interactive: boolean } = $props();

	let box: HTMLDivElement | undefined = $state();
	let copiedIdx = $state(-1);
	const names: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset'];

	const visible = $derived(
		interactive ? session.messages : session.messages.filter((m) => m.role === 'assistant').slice(-1)
	);

	async function copyWhole(text: string, idx: number) {
		try {
			await navigator.clipboard.writeText(stripMarks(text));
			copiedIdx = idx;
			setTimeout(() => (copiedIdx = -1), 1200);
		} catch {}
	}

	$effect(() => {
		void session.messages.at(-1)?.text;
		void session.messages.length;
		if (box) box.scrollTop = box.scrollHeight;
	});
</script>

<div bind:this={box} class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5 {interactive ? 'select-text' : 'select-none'}">
	{#if session.messages.length === 0}
		<div class="flex flex-col gap-2 text-muted">
			<span class="text-fg">Готов к работе. Горячие клавиши:</span>
			{#each names as n (n)}
				<div class="flex items-center justify-between gap-3">
					<span>{HOTKEY_LABELS[n]}</span>
					<Kbd accel={settings.hotkeys[n]} />
				</div>
			{/each}
		</div>
	{/if}

	{#each visible as m, i (i)}
		{#if m.role === 'user'}
			<div class="max-w-[85%] self-end rounded-[12px_12px_4px_12px] bg-accent2 px-3 py-2 text-hud-solid">
				{#if m.image}
					<img class="mb-1.5 max-h-24 rounded-md" alt="Скриншот" src="data:image/jpeg;base64,{m.image}" />
				{/if}
				<div class="whitespace-pre-wrap">{m.text}</div>
			</div>
		{:else}
			{@const isLast = m === session.messages.at(-1)}
			<div class="group relative max-w-full self-start rounded-[12px_12px_12px_4px] {interactive ? 'bg-surface px-3 py-2' : ''}">
				<Markdown text={stripMarks(m.text)} streaming={session.streaming && isLast} />
				{#if interactive && m.text && !(session.streaming && isLast)}
					<div class="mt-1.5 flex justify-end">
						<button
							type="button"
							onclick={() => copyWhole(m.text, i)}
							class="cursor-pointer rounded-md border border-line bg-hud-solid px-2 py-0.5 text-[10px] text-muted hover:border-accent hover:text-fg"
						>
							{copiedIdx === i ? 'Скопировано ✓' : 'Копировать ответ'}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	{/each}
</div>
`,

  // ───────────── COMPONENT: SnipOverlay.svelte (ПКМ отмена + умная позиция бейджа) ─────────────
  'src/lib/components/SnipOverlay.svelte': `<script lang="ts">
	import type { Rect } from '$lib/actions';
	import { ui } from '$lib/state.svelte';

	let { ondone, oncancel }: { ondone: (r: Rect) => void; oncancel: () => void } = $props();

	let start = $state<{ x: number; y: number } | null>(null);
	let cur = $state({ x: 0, y: 0 });

	const rect = $derived(
		start
			? {
					x: Math.min(start.x, cur.x),
					y: Math.min(start.y, cur.y),
					w: Math.abs(cur.x - start.x),
					h: Math.abs(cur.y - start.y)
				}
			: null
	);
	const dpr = $derived(window.devicePixelRatio || 1);

	function onpointerdown(e: PointerEvent) {
		if (e.button === 2) {
			e.preventDefault();
			oncancel();
			return;
		}
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		start = { x: e.clientX, y: e.clientY };
		cur = { x: e.clientX, y: e.clientY };
	}
	function onpointermove(e: PointerEvent) {
		cur = { x: e.clientX, y: e.clientY };
	}
	function onpointerup(e: PointerEvent) {
		if (e.button !== 0) return;
		const r = rect;
		start = null;
		if (r && r.w >= 8 && r.h >= 8) ondone(r);
		else oncancel();
	}
</script>

<div
	role="application"
	aria-label="Выделение области экрана"
	class="fixed inset-0 cursor-crosshair select-none"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	oncontextmenu={(e) => {
		e.preventDefault();
		oncancel();
	}}
>
	{#if ui.snipBg}
		<img alt="" draggable="false" class="absolute inset-0 h-full w-full object-fill" src="data:image/jpeg;base64,{ui.snipBg}" />
	{/if}
	{#if rect}
		{@const badgeTop = rect.y + rect.h + 32 > window.innerHeight ? Math.max(8, rect.y - 26) : rect.y + rect.h + 8}
		<div
			class="absolute box-border border border-accent"
			style="left:{rect.x}px; top:{rect.y}px; width:{rect.w}px; height:{rect.h}px; box-shadow:0 0 0 9999px rgba(0,0,0,0.35)"
		></div>
		{#each [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]] as c, i (i)}
			<div class="absolute h-2 w-2 bg-accent" style="left:{c[0] - 4}px; top:{c[1] - 4}px"></div>
		{/each}
		<div
			class="absolute rounded-md bg-hud-solid px-2 py-0.5 font-mono text-xs text-accent"
			style="left:{rect.x}px; top:{badgeTop}px"
		>
			{Math.round(rect.w * dpr)}×{Math.round(rect.h * dpr)}
		</div>
	{:else}
		<div class="absolute inset-0 bg-black/35"></div>
		<div class="absolute top-0 h-full w-px bg-accent/50" style="left:{cur.x}px"></div>
		<div class="absolute left-0 h-px w-full bg-accent/50" style="top:{cur.y}px"></div>
	{/if}

	<div class="absolute top-5 left-1/2 -translate-x-1/2 rounded-[10px] border border-line bg-hud px-3.5 py-2 text-xs">
		Выделите область (закрепится за «Скрин») · <kbd class="font-mono text-accent">Esc</kbd> или <kbd class="font-mono text-accent">ПКМ</kbd> — отмена
	</div>
</div>
`,

  // ───────────── COMPONENT: MarksLayer.svelte (зажим подписей по краям + хоткей очистки) ─────────────
  'src/lib/components/MarksLayer.svelte': `<script lang="ts">
	import { fade } from 'svelte/transition';
	import { motion, session, settings, ui } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	const px = (v: number) => session.frame.x + (v / 1000) * session.frame.w;
	const py = (v: number) => session.frame.y + (v / 1000) * session.frame.h;
	const clampX = (x: number) => Math.max(8, Math.min(x, window.innerWidth - 268));
	const clampY = (y: number) => Math.max(20, Math.min(y, window.innerHeight - 24));
</script>

<div class="pointer-events-none fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-hud px-3 py-1 text-[11px] text-muted">
	<span>≈ метки приблизительные</span>
	{#if settings.hotkeys.marks}
		<span>· убрать:</span>
		<Kbd accel={settings.hotkeys.marks} />
	{/if}
</div>

<svg class="pointer-events-none fixed inset-0 h-full w-full" aria-hidden="true">
	<defs>
		<marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 z" fill="#6ee7b7" stroke="#0b0d12" stroke-width="1" />
		</marker>
	</defs>

	{#each ui.marks as m, i (i)}
		<g transition:fade={{ duration: motion() }}>
			{#if m.type === 'box' && m.x2 !== undefined && m.y2 !== undefined}
				{@const x = Math.min(px(m.x), px(m.x2)) - 4}
				{@const y = Math.min(py(m.y), py(m.y2)) - 4}
				{@const w = Math.abs(px(m.x2) - px(m.x)) + 8}
				{@const h = Math.abs(py(m.y2) - py(m.y)) + 8}
				<rect {x} {y} width={w} height={h} rx="4" fill="rgba(110,231,183,0.12)" stroke="#0b0d12" stroke-width="5" />
				<rect {x} {y} width={w} height={h} rx="4" fill="none" stroke="#6ee7b7" stroke-width="2.5" />
			{:else if m.type === 'arrow' && m.x2 !== undefined && m.y2 !== undefined}
				<line x1={px(m.x)} y1={py(m.y)} x2={px(m.x2)} y2={py(m.y2)} stroke="#0b0d12" stroke-width="6" stroke-linecap="round" />
				<line x1={px(m.x)} y1={py(m.y)} x2={px(m.x2)} y2={py(m.y2)} stroke="#6ee7b7" stroke-width="3" stroke-linecap="round" marker-end="url(#head)" />
			{:else if m.type === 'point'}
				<circle cx={px(m.x)} cy={py(m.y)} r="11" fill="none" stroke="#0b0d12" stroke-width="5" />
				<circle cx={px(m.x)} cy={py(m.y)} r="11" fill="rgba(110,231,183,0.25)" stroke="#6ee7b7" stroke-width="2.5" />
			{/if}

			{#if m.label}
				{@const rawX = m.type === 'arrow' && m.x2 !== undefined ? px(m.x2) + 10 : px(m.x) + (m.type === 'text' ? 0 : 14)}
				{@const rawY = m.type === 'arrow' && m.y2 !== undefined ? py(m.y2) - 10 : py(m.y) - (m.type === 'text' ? 0 : 14)}
				<foreignObject x={clampX(rawX)} y={clampY(rawY) - 14} width="260" height="30" style="overflow:visible">
					<div class="inline-block max-w-[260px] truncate rounded-md border border-accent bg-hud-solid px-2 py-0.5 text-xs text-fg">
						{m.label}
					</div>
				</foreignObject>
			{/if}
		</g>
	{/each}
</svg>
`,

  // ───────────── COMPONENT: Status.svelte (отображение ретраев сети) ─────────────
  'src/lib/components/Status.svelte': `<script lang="ts">
	import { fade } from 'svelte/transition';
	import { motion, ui, type Phase } from '$lib/state.svelte';

	const label: Record<Phase, string> = {
		idle: '',
		capturing: 'Снимаю экран…',
		thinking: 'Думаю…',
		streaming: 'Пишу ответ…'
	};
</script>

{#if ui.phase !== 'idle'}
	<div
		transition:fade={{ duration: motion(120) }}
		role="status"
		class="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-accent bg-hud px-3 py-1 text-xs text-fg shadow-lg"
	>
		<span class="h-2 w-2 animate-pulse rounded-full bg-accent"></span>{ui.statusDetail || label[ui.phase]}
	</div>
{/if}
`,

  // ───────────── COMPONENT: Toggle.svelte (добавлен колбэк onchange) ─────────────
  'src/lib/components/Toggle.svelte': `<script lang="ts">
	let {
		checked = $bindable(false),
		label,
		onchange
	}: { checked?: boolean; label: string; onchange?: (v: boolean) => void } = $props();

	function toggle() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={toggle}
	class="relative h-[18px] w-[34px] flex-none cursor-pointer rounded-full border border-line p-0 transition-colors {checked
		? 'bg-accent'
		: 'bg-surface'}"
>
	<span
		class="absolute top-[2px] h-3 w-3 rounded-full transition-all {checked
			? 'left-[18px] bg-hud-solid'
			: 'left-[2px] bg-muted'}"
	></span>
</button>
`,

  // ───────────── COMPONENT: HotkeyField.svelte (кнопка очистки бинда) ─────────────
  'src/lib/components/HotkeyField.svelte': `<script lang="ts">
	import { eventToAccelerator } from '$lib/hotkeys';
	import { DEFAULT_HOTKEYS, HOTKEY_LABELS, settings, ui, type HotkeyName } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	let { name }: { name: HotkeyName } = $props();

	let recording = $state(false);
	let warning = $state('');

	function start() {
		recording = true;
		ui.recording = true;
		warning = '';
	}
	function stop() {
		recording = false;
		ui.recording = false;
	}

	function onkeydown(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') return stop();
		const accel = eventToAccelerator(e);
		if (!accel) {
			warning = 'Нужен модификатор (Ctrl / Alt / Shift) и клавиша';
			return;
		}
		const clash = (Object.keys(settings.hotkeys) as HotkeyName[]).find(
			(n) => n !== name && settings.hotkeys[n] === accel
		);
		if (clash) {
			warning = \`Конфликт с «\${HOTKEY_LABELS[clash]}»\`;
			return;
		}
		settings.hotkeys[name] = accel;
		stop();
	}

	function reset() {
		settings.hotkeys[name] = DEFAULT_HOTKEYS[name];
		warning = '';
	}

	function clear() {
		settings.hotkeys[name] = '';
		warning = '';
	}
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center justify-between gap-2">
		<span>{HOTKEY_LABELS[name]}</span>
		<div class="flex items-center gap-1">
			<button
				type="button"
				{onkeydown}
				onclick={start}
				onblur={stop}
				class="min-h-[30px] cursor-pointer rounded-md border bg-surface px-2 {recording
					? 'border-accent text-accent'
					: 'border-line'}"
			>
				{#if recording}Нажмите комбинацию…{:else}<Kbd accel={settings.hotkeys[name]} />{/if}
			</button>
			<button
				type="button"
				title="Отключить хоткей"
				aria-label="Отключить хоткей"
				onclick={clear}
				class="h-[30px] cursor-pointer rounded-md border border-line bg-surface px-2 text-muted hover:text-danger">✕</button
			>
			<button
				type="button"
				title="Сбросить к стандартному"
				aria-label="Сбросить хоткей"
				onclick={reset}
				class="h-[30px] cursor-pointer rounded-md border border-line bg-surface px-2 text-muted hover:text-fg">↺</button
			>
		</div>
	</div>
	{#if warning}<span class="text-[11px] text-warn">{warning}</span>{/if}
</div>
`,

  // ───────────── COMPONENT: HistoryDrawer.svelte (data-hit-area) ─────────────
  'src/lib/components/HistoryDrawer.svelte': `<script lang="ts">
	import { fly } from 'svelte/transition';
	import { clearHistory, deleteHistoryItem, exportHistoryItem, openHistoryItem } from '$lib/actions';
	import { history, motion, ui } from '$lib/state.svelte';

	const fmt = (ts: number) =>
		new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	const small = 'h-7 cursor-pointer rounded-md border border-line bg-surface px-2 text-[11px] text-muted hover:text-fg';
</script>

<aside
	data-hit-area
	transition:fly={{ x: 360, duration: motion(180) }}
	aria-label="История"
	class="fixed top-4 right-4 bottom-4 z-40 flex w-[360px] flex-col overflow-hidden rounded-panel border border-accent bg-hud text-[13px] shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-line px-3.5 py-3">
		<span class="text-sm font-semibold">История</span>
		<div class="flex gap-1.5">
			{#if history.items.length}<button type="button" class={small} onclick={clearHistory}>Очистить всё</button>{/if}
			<button
				type="button"
				aria-label="Закрыть"
				onclick={() => (ui.historyOpen = false)}
				class="h-[30px] w-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-fg">✕</button
			>
		</div>
	</div>

	<div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
		{#each history.items as h (h.id)}
			<div class="rounded-ctl border border-line bg-surface p-2.5">
				<button
					type="button"
					onclick={() => openHistoryItem(h.id)}
					class="w-full cursor-pointer border-0 bg-transparent p-0 text-left text-fg"
				>
					<div class="text-[11px] text-muted">{fmt(h.ts)} · сообщений: {h.messages.length}</div>
					<div class="mt-0.5 line-clamp-2">{h.title}</div>
				</button>
				<div class="mt-2 flex gap-1.5">
					<button type="button" class={small} onclick={() => exportHistoryItem(h.id)}>Копировать markdown</button>
					<button type="button" class={small} onclick={() => deleteHistoryItem(h.id)}>Удалить</button>
				</div>
			</div>
		{:else}
			<span class="text-muted">Пока пусто. Диалоги сохраняются автоматически (только текст, без скриншотов).</span>
		{/each}
	</div>
</aside>
`,

  // ───────────── COMPONENT: SettingsDrawer.svelte (чистый автозапуск + сброс области + data-hit-area) ─────────────
  'src/lib/components/SettingsDrawer.svelte': `<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
	import {
		addPreset,
		checkProxy,
		clearMarks,
		clearPinnedRegion,
		loadModels,
		quitApp,
		removePreset,
		resetPresets,
		testKey,
		toast
	} from '$lib/actions';
	import { PRESETS, motion, settings, ui, type HotkeyName, type Provider } from '$lib/state.svelte';
	import HotkeyField from './HotkeyField.svelte';
	import Toggle from './Toggle.svelte';

	const providers: [Provider, string][] = [
		['gemini', 'Google AI'],
		['openrouter', 'OpenRouter'],
		['local', 'Local']
	];
	const hotkeyNames: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset'];

	let showKey = $state(false);
	let busyKey = $state(false);
	let busyModels = $state(false);
	let autostart = $state(false);

	const modelOptions = $derived([...new Set([...PRESETS[settings.provider], ...ui.models[settings.provider]])]);

	onMount(() => {
		void isEnabled()
			.then((v) => (autostart = v))
			.catch(() => {});
	});

	async function onAutostartChange(want: boolean) {
		try {
			if (want) await enable();
			else await disable();
		} catch (e) {
			autostart = !want;
			toast(\`Автозапуск: \${e}\`, 'error');
		}
	}

	async function checkKey() {
		busyKey = true;
		await testKey();
		busyKey = false;
	}

	async function fetchModels() {
		busyModels = true;
		await loadModels();
		busyModels = false;
	}

	const field =
		'h-[34px] w-full rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg outline-none focus:border-accent';
	const label = 'text-[11px] font-semibold tracking-wider text-muted uppercase';
	const summary = 'cursor-pointer list-none py-2 text-[11px] font-semibold tracking-wider text-muted uppercase';
</script>

<aside
	data-hit-area
	transition:fly={{ x: 360, duration: motion(180) }}
	aria-label="Настройки"
	class="fixed top-4 right-4 bottom-4 z-40 flex w-[360px] flex-col overflow-hidden rounded-panel border border-accent bg-hud text-[13px] shadow-2xl"
>
	<div class="flex items-center justify-between border-b border-line px-3.5 py-3">
		<span class="text-sm font-semibold">Настройки</span>
		<button
			type="button"
			aria-label="Закрыть"
			onclick={() => (ui.settingsOpen = false)}
			class="h-[30px] w-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-fg">✕</button
		>
	</div>

	<div class="flex-1 space-y-1 overflow-y-auto px-3.5 py-2 select-text">
		<details open>
			<summary class={summary}>Провайдер</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex gap-[3px] rounded-ctl bg-surface p-[3px]" role="group" aria-label="Провайдер">
					{#each providers as [id, title] (id)}
						<button
							type="button"
							aria-pressed={settings.provider === id}
							onclick={() => (settings.provider = id)}
							class="h-[30px] flex-1 cursor-pointer rounded-md border-0 text-xs {settings.provider === id
								? 'bg-accent font-semibold text-hud-solid'
								: 'bg-transparent text-muted'}"
						>{title}</button>
					{/each}
				</div>

				<div class="flex gap-1.5">
					<input
						class={field}
						aria-label="API-ключ"
						type={showKey ? 'text' : 'password'}
						autocomplete="off"
						placeholder={settings.provider === 'local' ? 'API-ключ (необязательно)' : 'API-ключ'}
						bind:value={settings.apiKeys[settings.provider]}
					/>
					<button
						type="button"
						onclick={() => (showKey = !showKey)}
						class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg"
					>{showKey ? 'Скрыть' : 'Показать'}</button>
				</div>

				<button
					type="button"
					onclick={checkKey}
					disabled={busyKey}
					class="h-[34px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent disabled:opacity-50"
				>
					{busyKey ? 'Проверяю…' : 'Проверить ключ и соединение'}
				</button>

				{#if settings.provider === 'local'}
					<input class={field} aria-label="Base URL" placeholder="http://127.0.0.1:8080/v1" bind:value={settings.localBaseUrl} />
				{/if}
			</div>
		</details>

		<details open>
			<summary class={summary}>Модель</summary>
			<div class="flex flex-col gap-2 pb-3">
				<input
					class="{field} font-mono text-xs"
					aria-label="ID модели"
					list="model-options"
					placeholder="Выберите или введите ID вручную"
					bind:value={settings.models[settings.provider]}
				/>
				<datalist id="model-options">
					{#each modelOptions as m (m)}<option value={m}></option>{/each}
				</datalist>
				<button
					type="button"
					onclick={fetchModels}
					disabled={busyModels}
					class="h-[34px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent disabled:opacity-50"
				>
					{busyModels ? 'Загрузка…' : 'Загрузить список по API'}
				</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Прокси</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between"><span>Использовать прокси</span><Toggle label="Прокси" bind:checked={settings.proxyEnabled} /></div>
				<div class="flex gap-1.5">
					<input class={field} aria-label="URL прокси" placeholder="socks5://127.0.0.1:1080" bind:value={settings.proxyUrl} />
					<button type="button" onclick={checkProxy} class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg">Проверить</button>
				</div>
				<span class="text-[11px] text-muted">http://, https://, socks5://. Local LLM всегда идёт напрямую.</span>
			</div>
		</details>

		<details open>
			<summary class={summary}>Хоткеи</summary>
			<div class="flex flex-col gap-2 pb-3">
				{#each hotkeyNames as n (n)}<HotkeyField name={n} />{/each}
			</div>
		</details>

		<details open>
			<summary class={summary}>Захват и Stealth</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between">
					<span>Скрывать от записи экрана</span>
					<Toggle label="Stealth" bind:checked={settings.stealth} />
				</div>
				{#if settings.pinnedRegion}
					<button
						type="button"
						onclick={clearPinnedRegion}
						class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg"
					>
						Сбросить область ({Math.round(settings.pinnedRegion.w)}×{Math.round(settings.pinnedRegion.h)}) на весь экран
					</button>
				{/if}
			</div>
		</details>

		<details>
			<summary class={summary}>Разметка на экране</summary>
			<div class="flex flex-col gap-3 pb-3">
				<div class="flex items-center justify-between"><span>Модель может рисовать метки</span><Toggle label="Разметка" bind:checked={settings.marksEnabled} /></div>
				<label class="flex flex-col gap-1">
					<span>Исчезают через: {settings.marksTtl === 0 ? 'только вручную' : \`\${settings.marksTtl} с\`}</span>
					<input type="range" min="0" max="120" step="5" bind:value={settings.marksTtl} class="accent-accent" />
				</label>
				<div class="flex items-center justify-between"><span>Сетка на скриншоте (точнее)</span><Toggle label="Сетка" bind:checked={settings.marksGrid} /></div>
				<button type="button" onclick={clearMarks} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg">Очистить сейчас</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Пресеты запросов</summary>
			<div class="flex flex-col gap-2.5 pb-3">
				<span class="text-[11px] text-muted">Активный пресет (●) используется при каждом скрине. В чате двойной клик по пресету сразу переспрашивает по текущему скриншоту.</span>
				{#each settings.presets as p (p.id)}
					<div class="flex flex-col gap-1.5 rounded-ctl border p-2 {settings.activePreset === p.id ? 'border-accent' : 'border-line'}">
						<div class="flex gap-1.5">
							<input class={field} aria-label="Название пресета" bind:value={p.name} />
							<button type="button" aria-label="Сделать активным" onclick={() => (settings.activePreset = p.id)} class="h-[34px] w-9 flex-none cursor-pointer rounded-ctl border border-line bg-surface text-fg">{settings.activePreset === p.id ? '●' : '○'}</button>
							<button type="button" aria-label="Удалить пресет" disabled={settings.presets.length <= 1} onclick={() => removePreset(p.id)} class="h-[34px] w-9 flex-none cursor-pointer rounded-ctl border border-line bg-surface text-fg disabled:opacity-40">✕</button>
						</div>
						<textarea class="{field} h-16 resize-none py-2" aria-label="Текст пресета" bind:value={p.prompt}></textarea>
					</div>
				{/each}
				<button type="button" onclick={addPreset} class="h-[30px] cursor-pointer rounded-ctl border border-accent bg-transparent text-xs text-accent">+ Добавить пресет</button>
				<button type="button" onclick={resetPresets} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-muted">Сбросить к стандартным</button>
			</div>
		</details>

		<details>
			<summary class={summary}>Промпты</summary>
			<div class="flex flex-col gap-2 pb-3">
				<span class={label}>System prompt</span>
				<textarea class="{field} h-20 resize-none py-2" aria-label="System prompt" bind:value={settings.systemPrompt}></textarea>
			</div>
		</details>

		<details>
			<summary class={summary}>Система</summary>
			<div class="flex flex-col gap-2 pb-3">
				<div class="flex items-center justify-between">
					<span>Запускать с Windows</span>
					<Toggle label="Автозапуск" bind:checked={autostart} onchange={onAutostartChange} />
				</div>
				<button type="button" onclick={quitApp} class="h-[30px] cursor-pointer rounded-ctl border border-danger bg-transparent text-xs text-danger">Выйти из приложения</button>
				<span class="text-[11px] text-muted">API-ключи хранятся в Windows Credential Manager.</span>
			</div>
		</details>

		<details>
			<summary class={summary}>Вид</summary>
			<div class="flex flex-col gap-3 pb-3">
				<label class="flex flex-col gap-1"><span>Прозрачность: {settings.opacity}%</span><input type="range" min="40" max="100" bind:value={settings.opacity} class="accent-accent" /></label>
				<label class="flex flex-col gap-1"><span>Шрифт: {settings.fontSize}px</span><input type="range" min="12" max="18" bind:value={settings.fontSize} class="accent-accent" /></label>
				<label class="flex flex-col gap-1"><span>Ширина панели: {settings.panelWidth}px</span><input type="range" min="320" max="720" step="10" bind:value={settings.panelWidth} class="accent-accent" /></label>
				<button type="button" onclick={() => (settings.panelPos = null)} class="h-[30px] cursor-pointer rounded-ctl border border-line bg-surface text-xs text-fg">Вернуть панель в угол</button>
			</div>
		</details>
	</div>
</aside>
`,

  // ───────────── COMPONENT: Onboarding.svelte (выбор модели + data-hit-area только на диалоге) ─────────────
  'src/lib/components/Onboarding.svelte': `<script lang="ts">
	import { fly } from 'svelte/transition';
	import { finishOnboarding, loadModels, testKey } from '$lib/actions';
	import { HOTKEY_LABELS, PRESETS, motion, settings, ui, type HotkeyName, type Provider } from '$lib/state.svelte';
	import Kbd from './Kbd.svelte';

	let step = $state(0);
	let busy = $state(false);
	let busyModels = $state(false);

	const providers: { id: Provider; title: string; hint: string }[] = [
		{ id: 'gemini', title: 'Google AI Studio', hint: 'Бесплатный ключ на aistudio.google.com/apikey. Из России нужен прокси или VPN.' },
		{ id: 'openrouter', title: 'OpenRouter', hint: 'Один ключ, много моделей, есть бесплатные. Обычно работает без прокси.' },
		{ id: 'local', title: 'Локальная модель', hint: 'Своя модель через llama-server. Ключ не нужен.' }
	];
	const names: HotkeyName[] = ['full', 'snip', 'toggle', 'visibility', 'marks', 'cancel', 'preset'];
	const modelOptions = $derived([...new Set([...PRESETS[settings.provider], ...ui.models[settings.provider]])]);

	async function check() {
		busy = true;
		await testKey();
		busy = false;
	}

	async function fetchModels() {
		busyModels = true;
		await loadModels();
		busyModels = false;
	}

	const field =
		'h-[34px] w-full rounded-ctl border border-line bg-surface px-2.5 text-[13px] text-fg outline-none focus:border-accent';
	const primary = 'h-9 cursor-pointer rounded-ctl border-0 bg-accent px-4 text-[13px] font-semibold text-hud-solid';
	const ghost = 'h-9 cursor-pointer rounded-ctl border border-line bg-surface px-4 text-[13px] text-fg';
</script>

<div class="pointer-events-none fixed inset-0 z-50 grid place-items-center">
	<div
		data-hit-area
		in:fly={{ y: 4, duration: motion() }}
		role="dialog"
		aria-label="Первый запуск"
		class="pointer-events-auto flex w-[480px] max-w-[92vw] flex-col gap-4 rounded-panel border border-accent bg-hud p-5 text-[13px] shadow-2xl"
	>
		<div class="flex items-center justify-between">
			<span class="text-base font-semibold">Stealth HUD · настройка {step + 1}/3</span>
			<button type="button" onclick={finishOnboarding} class="cursor-pointer border-0 bg-transparent text-xs text-muted hover:text-fg">Пропустить</button>
		</div>

		{#if step === 0}
			<p class="m-0 text-muted">Выберите, какая модель будет отвечать по вашим скриншотам.</p>
			<div class="flex flex-col gap-2">
				{#each providers as p (p.id)}
					<button
						type="button"
						aria-pressed={settings.provider === p.id}
						onclick={() => (settings.provider = p.id)}
						class="cursor-pointer rounded-ctl border bg-surface p-3 text-left text-fg {settings.provider === p.id ? 'border-accent' : 'border-line'}"
					>
						<div class="font-semibold">{p.title}</div>
						<div class="text-xs text-muted">{p.hint}</div>
					</button>
				{/each}
			</div>
			<div class="flex justify-end"><button type="button" class={primary} onclick={() => (step = 1)}>Далее</button></div>
		{:else if step === 1}
			{#if settings.provider === 'local'}
				<p class="m-0 text-muted">Адрес вашего локального сервера (OpenAI-совместимого).</p>
				<input class={field} aria-label="Base URL" bind:value={settings.localBaseUrl} />
			{:else}
				<p class="m-0 text-muted">Вставьте API-ключ. Он хранится в Windows Credential Manager.</p>
				<input
					class={field}
					aria-label="API-ключ"
					type="password"
					autocomplete="off"
					placeholder="API-ключ"
					bind:value={settings.apiKeys[settings.provider]}
				/>
			{/if}

			<div class="flex gap-1.5">
				<input
					class="{field} font-mono text-xs"
					aria-label="Модель"
					list="onboard-models"
					placeholder="ID модели"
					bind:value={settings.models[settings.provider]}
				/>
				<datalist id="onboard-models">
					{#each modelOptions as m (m)}<option value={m}></option>{/each}
				</datalist>
				<button
					type="button"
					onclick={fetchModels}
					disabled={busyModels}
					class="h-[34px] flex-none cursor-pointer rounded-ctl border border-line bg-surface px-2.5 text-xs text-fg disabled:opacity-50"
				>
					{busyModels ? '…' : 'Список'}
				</button>
			</div>

			{#if settings.provider !== 'local'}
				<label class="flex items-center gap-2 text-muted">
					<input type="checkbox" bind:checked={settings.proxyEnabled} class="accent-accent" /> Нужен прокси (например, из России для Gemini)
				</label>
				{#if settings.proxyEnabled}
					<input class={field} aria-label="URL прокси" placeholder="socks5://127.0.0.1:1080" bind:value={settings.proxyUrl} />
				{/if}
			{/if}

			<div class="flex justify-between gap-2">
				<button type="button" class={ghost} onclick={() => (step = 0)}>Назад</button>
				<div class="flex gap-2">
					<button type="button" class={ghost} onclick={check} disabled={busy}>{busy ? 'Проверяю…' : 'Проверить'}</button>
					<button type="button" class={primary} onclick={() => (step = 2)}>Далее</button>
				</div>
			</div>
		{:else}
			<p class="m-0 text-muted">Горячие клавиши работают в любом окне. Их можно поменять в ⚙ → Хоткеи.</p>
			<div class="flex flex-col gap-1.5">
				{#each names as n (n)}
					<div class="flex items-center justify-between"><span>{HOTKEY_LABELS[n]}</span><Kbd accel={settings.hotkeys[n]} /></div>
				{/each}
			</div>
			<p class="m-0 text-xs text-muted">В Interactive Mode экран вокруг панели остаётся кликабельным. Esc возвращает в Ghost Mode.</p>
			<div class="flex justify-between">
				<button type="button" class={ghost} onclick={() => (step = 1)}>Назад</button>
				<button type="button" class={primary} onclick={finishOnboarding}>Готово</button>
			</div>
		{/if}
	</div>
</div>
`,

  // ───────────── ROUTE: +page.svelte (синхронизация hit-rects + Esc в Ghost + дебаунс ключей) ─────────────
  'src/routes/+page.svelte': `<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onMount, untrack } from 'svelte';
	import * as A from '$lib/actions';
	import { settings, ui } from '$lib/state.svelte';
	import HistoryDrawer from '$lib/components/HistoryDrawer.svelte';
	import MarksLayer from '$lib/components/MarksLayer.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import Panel from '$lib/components/Panel.svelte';
	import SettingsDrawer from '$lib/components/SettingsDrawer.svelte';
	import SnipOverlay from '$lib/components/SnipOverlay.svelte';
	import Status from '$lib/components/Status.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	function syncHitRects() {
		if (ui.mode !== 'interactive' || ui.hidden || ui.capturing) return;
		const dpr = window.devicePixelRatio || 1;
		const rects = Array.from(document.querySelectorAll<HTMLElement>('[data-hit-area]'))
			.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					x: Math.round(r.left * dpr),
					y: Math.round(r.top * dpr),
					w: Math.round(r.width * dpr),
					h: Math.round(r.height * dpr)
				};
			})
			.filter((r) => r.w > 0 && r.h > 0);
		void invoke('set_hit_rects', { rects, forceCapture: ui.dragging }).catch(() => {});
	}

	onMount(() => {
		let unlisten: (() => void)[] = [];
		void (async () => {
			await A.loadSecrets();
			unlisten = await A.initEvents();
			await A.setMode(settings.onboarded ? 'ghost' : 'interactive');
			syncHitRects();
		})();

		const timer = setInterval(syncHitRects, 120);
		return () => {
			clearInterval(timer);
			unlisten.forEach((f) => f());
		};
	});

	$effect(() => {
		void ui.mode;
		void ui.settingsOpen;
		void ui.historyOpen;
		void ui.dragging;
		void settings.onboarded;
		void settings.panelPos;
		void settings.panelWidth;
		requestAnimationFrame(syncHitRects);
	});

	$effect(() => {
		const keys = $state.snapshot(settings.hotkeys);
		const recording = ui.recording;
		void keys;
		untrack(() => {
			if (recording) void A.releaseHotkeys();
			else void A.applyHotkeys();
		});
	});

	$effect(() => {
		const keys = { ...settings.apiKeys };
		untrack(() => {
			if (!ui.secretsOk) return;
			for (const p of ['gemini', 'openrouter', 'local'] as const) A.scheduleSaveSecret(p, keys[p]);
		});
	});

	$effect(() => {
		void settings.stealth;
		untrack(() => void A.applyStealth());
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (ui.mode === 'snipping') void A.cancelSnip();
		else if (ui.settingsOpen) ui.settingsOpen = false;
		else if (ui.historyOpen) ui.historyOpen = false;
		else if (ui.mode === 'interactive' && !ui.recording && settings.onboarded) void A.setMode('ghost');
	}
</script>

<svelte:window {onkeydown} />

<div class="fixed inset-0 overflow-hidden" class:invisible={ui.hidden || ui.capturing}>
	<Status />
	{#if ui.mode === 'snipping'}
		<SnipOverlay ondone={A.captureRegion} oncancel={A.cancelSnip} />
	{:else}
		{#if ui.marks.length}<MarksLayer />{/if}
		<Panel />
		{#if ui.mode === 'interactive' && ui.settingsOpen}
			<SettingsDrawer />
		{/if}
		{#if ui.mode === 'interactive' && ui.historyOpen}
			<HistoryDrawer />
		{/if}
		{#if ui.mode === 'interactive' && !settings.onboarded}
			<Onboarding />
		{/if}
	{/if}
</div>

<Toasts />
`
};

for (const [relPath, content] of Object.entries(files)) {
  const fullPath = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✔ Обновлён: ${relPath}`);
}

console.log('\nГотово! Теперь выполни:');
console.log('1. npm install katex @types/katex');
console.log('2. npm run check && cargo check --manifest-path src-tauri/Cargo.toml');
console.log('3. npm run tauri dev');