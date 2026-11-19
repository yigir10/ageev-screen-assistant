//! Мульти-провайдерный стриминг: Gemini (нативный SSE), OpenRouter и Local (OpenAI-совместимые).
//! Ответ уходит во фронтенд событиями: `ai-chunk`, `ai-status`, `ai-done`, `ai-error`.

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
        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
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
