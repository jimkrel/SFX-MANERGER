use super::Library;
use crate::launcher_keys::{parse, read_saved, store};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const LABEL: &str = "quick-launcher";
#[derive(Default)]
struct Binding(Mutex<Option<Shortcut>>);

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _, event| {
            if event.state() == ShortcutState::Pressed {
                if let Err(e) = launcher_window(app.clone(), "toggle".into()) {
                    eprintln!("Quick Launcher: {e}");
                }
            }
        })
        .build()
}

#[tauri::command]
pub fn launcher_shortcut(state: tauri::State<'_, Library>) -> Result<String, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    read_saved(&db).map_err(|e| e.to_string())
}

fn bind(app: &AppHandle, text: &str, save: bool) -> Result<(), String> {
    let shortcut = parse(text)?;
    let state = app.state::<Binding>();
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if *active == Some(shortcut) {
        return Ok(());
    }
    let manager = app.global_shortcut();
    manager
        .register(shortcut)
        .map_err(|e| format!("Không thể đăng ký {text}: {e}"))?;
    if let Some(old) = *active {
        if let Err(e) = manager.unregister(old) {
            let _ = manager.unregister(shortcut);
            return Err(e.to_string());
        }
    }
    if save {
        let library = app.state::<Library>();
        let saved = library
            .0
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|db| store(&db, text).map_err(|e| e.to_string()));
        if let Err(e) = saved {
            let _ = manager.unregister(shortcut);
            *active = active.filter(|old| manager.register(*old).is_ok());
            return Err(e);
        }
    }
    *active = Some(shortcut);
    Ok(())
}

#[tauri::command]
pub async fn set_launcher_shortcut(app: AppHandle, shortcut: String) -> Result<Value, String> {
    Ok(match bind(&app, shortcut.trim(), true) {
        Ok(()) => json!({"success":true}),
        Err(error) => json!({"success":false,"error":error}),
    })
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| "Quick Launcher window unavailable".into())
}

fn hide(w: &WebviewWindow) -> tauri::Result<()> {
    if w.is_visible()? {
        w.hide()?;
        w.emit("launcher-hidden", ())?;
    }
    Ok(())
}
#[tauri::command]
pub fn launcher_window(app: AppHandle, action: String) -> Result<(), String> {
    if !matches!(action.as_str(), "show" | "hide" | "toggle") {
        return Err("Unknown launcher action".into());
    }
    let w = window(&app)?;
    let result = (|| -> tauri::Result<()> {
        if action == "hide" || (action == "toggle" && w.is_visible()?) {
            return hide(&w);
        }
        if let Ok(p) = app.cursor_position() {
            if let Some(m) = w.monitor_from_point(p.x, p.y)? {
                let area = m.work_area();
                let size = w.outer_size()?;
                let x = area.position.x as f64 + (area.size.width as f64 - size.width as f64) / 2.;
                let y = area.position.y as f64
                    + ((area.size.height as f64 - size.height as f64) * 0.28)
                        .max(60. * m.scale_factor());
                w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
            }
        }
        w.show()?;
        w.set_focus()?;
        w.emit("launcher-shown", ())
    })();
    result.map_err(|e| e.to_string())
}
#[tauri::command]
pub fn launcher_height(app: AppHandle, height: f64) -> Result<(), String> {
    let w = window(&app)?;
    let target = height.round().clamp(100., 520.);
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    let size = w
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    if (size.height - target).abs() > 2. {
        w.set_size(LogicalSize::new(size.width, target))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn accessibility(prompt: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::{
            base::TCFType,
            boolean::CFBoolean,
            dictionary::{CFDictionary, CFDictionaryRef},
            string::CFString,
        };
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        }
        let options = CFDictionary::from_CFType_pairs(&[(
            CFString::new("AXTrustedCheckOptionPrompt"),
            CFBoolean::from(prompt),
        )]);
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0 }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        true
    }
}
#[tauri::command]
pub fn open_accessibility() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("/usr/bin/open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    app.manage(Binding::default());
    let w = window(app)?;
    let launcher = w.clone();
    w.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let w = launcher.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let handle = w.app_handle().clone();
                let _ = handle.run_on_main_thread(move || {
                    if matches!(w.is_focused(), Ok(false)) {
                        let _ = hide(&w);
                    }
                });
            });
        }
    });
    let saved = launcher_shortcut(app.state())?;
    if let Err(e) = bind(app, &saved, false) {
        eprintln!("Quick Launcher: {e}");
    }
    #[cfg(target_os = "macos")]
    if !accessibility(true) {
        let handle = app.clone();
        std::thread::spawn(move || {
            while handle.get_webview_window("main").is_some() {
                std::thread::sleep(std::time::Duration::from_secs(2));
                if accessibility(false) {
                    if let Ok(text) = launcher_shortcut(handle.state()) {
                        let _ = bind(&handle, &text, false);
                    }
                    let _ = handle.emit("accessibility-changed", json!({"granted":true}));
                    break;
                }
            }
        });
    }
    Ok(())
}
