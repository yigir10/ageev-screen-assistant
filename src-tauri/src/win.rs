//! Win32: защита окна от захвата экрана и чтение позиции курсора для динамического hit-testing.

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
