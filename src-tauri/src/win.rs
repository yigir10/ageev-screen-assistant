//! Win32: защита окна от захвата экрана (SetWindowDisplayAffinity).

#[cfg(windows)]
pub fn set_exclude_from_capture(window: &tauri::WebviewWindow, enable: bool) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    let raw = window.hwnd().map_err(|e| e.to_string())?;
    // `as _` — на случай, если версия `windows` в tauri отличается от нашей
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
