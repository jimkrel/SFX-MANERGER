use percent_encoding::percent_decode_str;
use serde_json::Value;
use sfx_music_manager::transfer::{self, BounceCache};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager, State,
};

pub type Cache = Arc<Mutex<BounceCache>>;
fn header(req: &Request<'_>, key: &str) -> Result<String, String> {
    let value = req
        .headers()
        .get(key)
        .and_then(|s| s.to_str().ok())
        .ok_or_else(|| format!("Missing {key}"))?;
    percent_decode_str(value)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|e| e.to_string())
}
fn body(req: &Request<'_>) -> Result<Vec<u8>, String> {
    match req.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("Expected binary audio".into()),
    }
}
#[tauri::command]
pub async fn export_audio(request: Request<'_>) -> Result<Option<PathBuf>, String> {
    let format = header(&request, "x-audio-format")?;
    if !matches!(format.as_str(), "wav" | "mp3") {
        return Err("Unsupported export format".into());
    }
    let name = header(&request, "x-audio-name")?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title(format!("Xuất Âm Thanh ({})", format.to_uppercase()))
        .add_filter(format.to_uppercase(), &[&format])
        .set_file_name(
            Path::new(&name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy(),
        )
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_owned();
    let data = body(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        transfer::save_export(&path, &data)
            .map(|()| Some(path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn bounce_check(state: State<'_, Cache>, source_path: PathBuf) -> Result<Value, String> {
    let cache = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .lock()
            .map_err(|e| e.to_string())?
            .check(&source_path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn bounce_save(state: State<'_, Cache>, request: Request<'_>) -> Result<PathBuf, String> {
    let source = header(&request, "x-source-path")?;
    let token = if request.headers().contains_key("x-source-token") {
        Some(header(&request, "x-source-token")?)
    } else {
        None
    };
    let data = body(&request)?;
    let cache = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .lock()
            .map_err(|e| e.to_string())?
            .save(Path::new(&source), &data, token.as_deref())
            .map(Option::unwrap_or_default)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn bounce_clear(state: State<'_, Cache>) -> Result<Value, String> {
    let cache = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .lock()
            .map_err(|e| e.to_string())?
            .clear()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn prepare_drag(app: AppHandle, paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    let stage = if cfg!(target_os = "macos") {
        app.path()
            .download_dir()
            .ok()
            .map(|p| p.join(".sfx-fast-drop"))
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || transfer::drag_paths(&paths, stage.as_deref()))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn reveal_file(file_path: PathBuf) -> Result<bool, String> {
    if !file_path.is_absolute() || !file_path.exists() {
        return Ok(false);
    }
    #[cfg(windows)]
    let child = Command::new("explorer.exe")
        .arg("/select,")
        .arg(file_path)
        .spawn();
    #[cfg(target_os = "macos")]
    let child = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(file_path)
        .spawn();
    #[cfg(target_os = "linux")]
    let child = Command::new("xdg-open")
        .arg(file_path.parent().unwrap_or(&file_path))
        .spawn();
    child
        .map(|mut c| {
            std::thread::spawn(move || c.wait());
            true
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn copy_paths(paths: Vec<PathBuf>) -> Result<bool, String> {
    let files = transfer::drag_paths(&paths, None);
    if files.is_empty() {
        return Ok(false);
    }
    let names: Vec<_> = files
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    #[cfg(windows)]
    {
        use clipboard_win::{formats, Clipboard, Setter};
        let _clip = Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
        clipboard_win::empty().map_err(|e| e.to_string())?;
        if formats::FileList.write_clipboard(&names[..]).is_ok() {
            return Ok(true);
        }
        formats::Unicode
            .write_clipboard(&names.join("\n"))
            .map_err(|e| e.to_string())?;
        Ok(false)
    }
    #[cfg(not(windows))]
    {
        use std::{io::Write, process::Stdio};
        #[cfg(target_os = "macos")]
        let mut cmd = Command::new("/usr/bin/pbcopy");
        #[cfg(target_os = "linux")]
        let mut cmd = {
            let mut c = Command::new("xclip");
            c.args(["-selection", "clipboard"]);
            c
        };
        let mut child = cmd
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        child
            .stdin
            .take()
            .ok_or("Clipboard pipe closed")?
            .write_all(names.join("\n").as_bytes())
            .map_err(|e| e.to_string())?;
        child.wait().map(|s| s.success()).map_err(|e| e.to_string())
    }
}
