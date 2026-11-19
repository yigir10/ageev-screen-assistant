//! Локальный анализ шахматных позиций через Stockfish 19 (UCI) и фоновый трекер изменений доски.

use crate::capture::{grab_primary, Region};
use image::imageops::{crop_imm, resize, FilterType};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

#[derive(Default)]
pub struct ChessWatcher(pub Mutex<Option<JoinHandle<()>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChessResult {
    pub best_move: String,
    pub second_move: Option<String>,
    pub eval_text: String,
    pub normalized_fen: String,
}

fn capture_board_sample(region: &Region) -> Result<Vec<u8>, String> {
    let img = grab_primary()?;
    let (iw, ih) = img.dimensions();
    let x = region.x.min(iw.saturating_sub(1));
    let y = region.y.min(ih.saturating_sub(1));
    let w = region.w.min(iw - x);
    let h = region.h.min(ih - y);
    if w < 16 || h < 16 {
        return Err("Область доски слишком мала".into());
    }
    let cropped = crop_imm(&img, x, y, w, h).to_image();
    let small = resize(&cropped, 64, 64, FilterType::Nearest);
    let mut rgb = Vec::with_capacity(64 * 64 * 3);
    for p in small.pixels() {
        rgb.push(p.0[0]);
        rgb.push(p.0[1]);
        rgb.push(p.0[2]);
    }
    Ok(rgb)
}

/// Доля пикселей (0.0..1.0), цвет которых изменился сильнее порога.
fn diff_ratio(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let total = a.len() / 3;
    let mut changed = 0usize;
    for (ca, cb) in a.chunks_exact(3).zip(b.chunks_exact(3)) {
        let dr = (ca[0] as i16 - cb[0] as i16).abs();
        let dg = (ca[1] as i16 - cb[1] as i16).abs();
        let db = (ca[2] as i16 - cb[2] as i16).abs();
        if dr + dg + db > 45 {
            changed += 1;
        }
    }
    changed as f32 / total as f32
}

#[tauri::command]
pub fn start_chess_watcher(
    app: AppHandle,
    state: State<'_, ChessWatcher>,
    region: Region,
    interval_ms: Option<u64>,
) {
    if let Some(old) = state.0.lock().unwrap().take() {
        old.abort();
    }
    let step = Duration::from_millis(interval_ms.unwrap_or(450).clamp(250, 3000));
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(step);
        let mut baseline: Option<Vec<u8>> = None;
        let mut prev: Option<Vec<u8>> = None;
        let mut dirty = false;
        let mut last_emit = Instant::now() - Duration::from_secs(10);

        loop {
            ticker.tick().await;
            let reg = region.clone();
            let sample = tokio::task::spawn_blocking(move || capture_board_sample(&reg)).await;
            let Ok(Ok(frame)) = sample else {
                continue;
            };

            let Some(ref base) = baseline else {
                baseline = Some(frame.clone());
                prev = Some(frame);
                continue;
            };

            let changed_vs_base = diff_ratio(base, &frame);
            let changed_vs_prev = prev.as_deref().map(|p| diff_ratio(p, &frame)).unwrap_or(0.0);

            if changed_vs_base > 0.015 {
                dirty = true;
            }

            // Ждём стабилизации картинки (завершение анимации фигуры), затем триггерим анализ
            if dirty && changed_vs_prev < 0.004 && last_emit.elapsed() >= Duration::from_millis(1200) {
                dirty = false;
                baseline = Some(frame.clone());
                last_emit = Instant::now();
                let _ = app.emit("chess-board-changed", ());
            }

            prev = Some(frame);
        }
    });
    *state.0.lock().unwrap() = Some(handle);
}

#[tauri::command]
pub fn stop_chess_watcher(state: State<'_, ChessWatcher>) {
    if let Some(old) = state.0.lock().unwrap().take() {
        old.abort();
    }
}

/// Извлекает строку расстановки фигур и дополняет до полного 6-польного FEN для строгой валидации Stockfish 19.
fn normalize_fen(raw: &str, default_turn: &str) -> String {
    let cleaned = raw.replace('`', "");
    let candidate = cleaned
        .lines()
        .map(str::trim)
        .find(|line| line.matches('/').count() == 7)
        .or_else(|| cleaned.lines().map(str::trim).find(|l| !l.is_empty()))
        .unwrap_or("");

    let parts: Vec<&str> = candidate.split_whitespace().collect();
    if parts.is_empty() {
        return String::new();
    }

    let placement = parts[0];
    let turn = match parts.get(1).copied() {
        Some("w") | Some("b") => parts[1],
        _ => default_turn,
    };
    let castling = parts.get(2).copied().unwrap_or("-");
    let ep = parts.get(3).copied().unwrap_or("-");
    let halfmove = parts.get(4).copied().unwrap_or("0");
    let fullmove = parts.get(5).copied().unwrap_or("1");

    format!("{placement} {turn} {castling} {ep} {halfmove} {fullmove}")
}

#[tauri::command]
pub async fn analyze_chess_uci(
    stockfish_path: String,
    fen: String,
    turn: String,
    movetime_ms: u64,
) -> Result<ChessResult, String> {
    let default_turn = if turn.trim() == "b" { "b" } else { "w" };
    let normalized_fen = normalize_fen(&fen, default_turn);
    if normalized_fen.is_empty() || normalized_fen.matches('/').count() != 7 {
        return Err(format!(
            "Некорректный FEN от модели: {}",
            fen.chars().take(120).collect::<String>()
        ));
    }

    let path = if stockfish_path.trim().is_empty() {
        "src-tauri/bin/stockfish.exe"
    } else {
        stockfish_path.trim()
    };

    let mut cmd = Command::new(path);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить Stockfish ({path}): {e}"))?;

    let mut stdin = child.stdin.take().ok_or("Нет доступа к stdin Stockfish")?;
    let stdout = child.stdout.take().ok_or("Нет доступа к stdout Stockfish")?;
    let mut reader = BufReader::new(stdout).lines();

    let script = format!(
        "uci\nsetoption name MultiPV value 2\nucinewgame\nposition fen {normalized_fen}\ngo movetime {}\n",
        movetime_ms.clamp(50, 10_000)
    );
    stdin
        .write_all(script.as_bytes())
        .await
        .map_err(|e| format!("Запись в Stockfish: {e}"))?;
    let _ = stdin.flush().await;

    let mut best_move = String::new();
    let mut second_move: Option<String> = None;
    let mut eval_text = String::from("0.00");

    while let Ok(Some(line)) = reader.next_line().await {
        if line.contains("CRITICAL ERROR") || line.contains("Invalid") {
            let _ = child.kill().await;
            return Err(format!("Stockfish 19 отклонил позицию ({normalized_fen}): {line}"));
        }

        if line.starts_with("info ") && line.contains(" pv ") {
            let tokens: Vec<&str> = line.split_whitespace().collect();
            let is_pv2 = tokens.windows(2).any(|w| w[0] == "multipv" && w[1] == "2");

            if let Some(pv_idx) = tokens.iter().position(|&t| t == "pv") {
                if let Some(&mv) = tokens.get(pv_idx + 1) {
                    if is_pv2 {
                        second_move = Some(mv.to_string());
                    } else {
                        best_move = mv.to_string();
                    }
                }
            }

            if !is_pv2 {
                if let Some(sc_idx) = tokens.iter().position(|&t| t == "score") {
                    if let (Some(&kind), Some(&val_str)) = (tokens.get(sc_idx + 1), tokens.get(sc_idx + 2)) {
                        if let Ok(v) = val_str.parse::<i32>() {
                            if kind == "cp" {
                                eval_text = format!("{:+.2}", (v as f32) / 100.0);
                            } else if kind == "mate" {
                                eval_text = format!("M{v}");
                            }
                        }
                    }
                }
            }
        }

        if line.starts_with("bestmove ") {
            if best_move.is_empty() {
                if let Some(mv) = line.split_whitespace().nth(1) {
                    best_move = mv.to_string();
                }
            }
            break;
        }
    }

    let _ = stdin.write_all(b"quit\n").await;
    let _ = child.wait().await;

    if best_move.is_empty() || best_move == "(none)" {
        return Err("Stockfish не нашёл допустимых ходов (мат или пат)".into());
    }

    Ok(ChessResult {
        best_move,
        second_move,
        eval_text,
        normalized_fen,
    })
}
