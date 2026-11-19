//! Захват экрана строго в ОЗУ: монитор -> RGBA -> (crop) -> resize -> (сетка) -> JPEG -> base64.
//! На диск ничего не пишется.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder, imageops, imageops::FilterType, DynamicImage, ExtendedColorType, RgbImage, RgbaImage,
};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::State;
use xcap::Monitor;

const JPEG_QUALITY: u8 = 80;
const FULL_MAX_WIDTH: u32 = 1600; // даёт ~150-250 КБ при quality 80
const REGION_MAX_WIDTH: u32 = 2000;
const SNAP_BG_WIDTH: u32 = 1920; // «замороженный» фон для выделения области
const GRID_COLOR: [u8; 3] = [255, 214, 10];

/// Прямоугольник в ФИЗИЧЕСКИХ пикселях основного монитора (фронтенд уже умножил на devicePixelRatio).
#[derive(Deserialize)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Кадр, снятый в момент начала выделения области (чтобы картинка не менялась, пока пользователь выделяет).
#[derive(Default)]
pub struct Snapshot(Mutex<Option<RgbaImage>>);

fn grab_primary() -> Result<RgbaImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("Монитор: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or("Основной монитор не найден")?;
    monitor.capture_image().map_err(|e| format!("Захват: {e}"))
}

// ───────────── координатная сетка (помогает модели точнее указывать места) ─────────────

// Шрифт цифр 3x5, каждая строка — 3 бита
const FONT: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

fn put(img: &mut RgbImage, x: i64, y: i64, c: [u8; 3], a: f32) {
    if x < 0 || y < 0 || x >= img.width() as i64 || y >= img.height() as i64 {
        return;
    }
    let p = img.get_pixel_mut(x as u32, y as u32);
    for i in 0..3 {
        p.0[i] = (p.0[i] as f32 * (1.0 - a) + c[i] as f32 * a) as u8;
    }
}

fn fill_rect(img: &mut RgbImage, x: i64, y: i64, w: i64, h: i64, c: [u8; 3], a: f32) {
    for yy in y..y + h {
        for xx in x..x + w {
            put(img, xx, yy, c, a);
        }
    }
}

fn draw_number(img: &mut RgbImage, x: i64, y: i64, s: i64, text: &str) {
    let w = text.len() as i64 * 4 * s;
    fill_rect(img, x - s, y - s, w + s, 7 * s, [0, 0, 0], 0.7);
    for (i, ch) in text.bytes().enumerate() {
        if !ch.is_ascii_digit() {
            continue;
        }
        let digit = (ch - b'0') as usize;
        for (row, bits) in FONT[digit].iter().enumerate() {
            for col in 0..3u32 {
                if (*bits >> (2 - col)) & 1 == 1 {
                    let px = x + (i as i64 * 4 + col as i64) * s;
                    fill_rect(img, px, y + row as i64 * s, s, s, GRID_COLOR, 1.0);
                }
            }
        }
    }
}

/// Линии каждые 10% и подписи 100…900 (координаты в тысячных) на верхнем и левом краях.
fn draw_grid(img: &mut RgbImage) {
    let (w, h) = (img.width() as i64, img.height() as i64);
    let s = ((h as f32 / 540.0).round() as i64).max(1);
    for k in 1..10 {
        let x = w * k / 10;
        for y in 0..h {
            put(img, x, y, GRID_COLOR, 0.40);
        }
        let y = h * k / 10;
        for x in 0..w {
            put(img, x, y, GRID_COLOR, 0.40);
        }
    }
    for k in 1..10 {
        let label = (k * 100).to_string();
        draw_number(img, w * k / 10 + 2 * s, 2 * s, s, &label);
        draw_number(img, 2 * s, h * k / 10 + 2 * s, s, &label);
    }
}

fn encode_jpeg_b64(img: RgbaImage, max_width: u32, quality: u8, grid: bool) -> Result<String, String> {
    let mut dynimg = DynamicImage::ImageRgba8(img);
    if dynimg.width() > max_width {
        dynimg = dynimg.resize(max_width, 20_000, FilterType::Triangle);
    }
    let mut rgb = dynimg.to_rgb8();
    if grid {
        draw_grid(&mut rgb);
    }
    let mut buf: Vec<u8> = Vec::with_capacity(256 * 1024);
    JpegEncoder::new_with_quality(&mut buf, quality)
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), ExtendedColorType::Rgb8)
        .map_err(|e| format!("JPEG: {e}"))?;
    Ok(STANDARD.encode(buf))
}

// ───────────── команды ─────────────

#[tauri::command]
pub async fn capture_full(grid: bool) -> Result<String, String> {
    tokio::task::spawn_blocking(move || encode_jpeg_b64(grab_primary()?, FULL_MAX_WIDTH, JPEG_QUALITY, grid))
        .await
        .map_err(|e| e.to_string())?
}

/// Снимает кадр для режима выделения, кэширует его в ОЗУ и возвращает как фон оверлея.
#[tauri::command]
pub async fn snapshot_begin(state: State<'_, Snapshot>) -> Result<String, String> {
    let (img, bg) = tokio::task::spawn_blocking(|| -> Result<(RgbaImage, String), String> {
        let img = grab_primary()?;
        let bg = encode_jpeg_b64(img.clone(), SNAP_BG_WIDTH, 85, false)?;
        Ok((img, bg))
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.0.lock().unwrap() = Some(img);
    Ok(bg)
}

#[tauri::command]
pub fn snapshot_drop(state: State<'_, Snapshot>) {
    state.0.lock().unwrap().take();
}

#[tauri::command]
pub async fn capture_region(
    state: State<'_, Snapshot>,
    region: Region,
    grid: bool,
    use_cached: bool,
) -> Result<String, String> {
    let cached = if use_cached { state.0.lock().unwrap().take() } else { None };
    tokio::task::spawn_blocking(move || {
        let img = match cached {
            Some(i) => i,
            None => grab_primary()?,
        };
        let (iw, ih) = img.dimensions();
        let x = region.x.min(iw.saturating_sub(1));
        let y = region.y.min(ih.saturating_sub(1));
        let w = region.w.min(iw - x);
        let h = region.h.min(ih - y);
        if w < 4 || h < 4 {
            return Err("Область слишком мала".to_string());
        }
        let cropped = imageops::crop_imm(&img, x, y, w, h).to_image();
        encode_jpeg_b64(cropped, REGION_MAX_WIDTH, JPEG_QUALITY, grid)
    })
    .await
    .map_err(|e| e.to_string())?
}
