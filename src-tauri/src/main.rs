#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_transfer;
mod launcher;
mod launcher_keys;
mod media_tools;
use serde_json::{json, Value};
use sfx_music_manager::database;
use sfx_music_manager::indexer;
use sfx_music_manager::watcher::LibraryWatcher;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

struct Library(Arc<Mutex<rusqlite::Connection>>);
struct Scanner(Arc<Mutex<rusqlite::Connection>>);

fn elevated() -> bool {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn IsUserAnAdmin() -> i32;
        }
        // Reads the current process token without requesting elevation.
        unsafe { IsUserAnAdmin() != 0 }
    }
    #[cfg(unix)]
    {
        unsafe { libc::geteuid() == 0 }
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    media_tools::shutdown(&app);
    app.exit(0);
}

#[tauri::command]
fn app_info() -> Value {
    let platform = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    };
    json!({"version":env!("CARGO_PKG_VERSION"),"platform":platform,"arch":std::env::consts::ARCH,"electronVersion":"","nodeVersion":"","isElevated":elevated()})
}

#[tauri::command]
fn library_read(
    state: State<'_, Library>,
    operation: String,
    options: Option<Value>,
) -> Result<Value, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    database::read(&db, &operation, options.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn library_write(
    watcher: State<'_, LibraryWatcher>,
    state: State<'_, Library>,
    edit: database::Edit,
) -> Result<Value, String> {
    let mut db = state.0.lock().map_err(|e| e.to_string())?;
    let removed_folder = matches!(edit, database::Edit::RemoveWatchedFolder { .. });
    let result = database::write(&mut db, edit).map_err(|e| e.to_string())?;
    if removed_folder {
        watcher.refresh();
    }
    Ok(result)
}

#[tauri::command]
async fn import_paths(
    app: tauri::AppHandle,
    state: State<'_, Scanner>,
    paths: Vec<std::path::PathBuf>,
) -> Result<Value, String> {
    let scanner = Arc::clone(&state.0);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut db = scanner.lock().map_err(|e| e.to_string())?;
        Ok::<_, String>(indexer::import_paths(&mut db, &paths))
    })
    .await
    .map_err(|e| e.to_string())??;
    if result["folders"].as_u64().unwrap_or(0) > 0 {
        app.state::<LibraryWatcher>().refresh();
    }
    app.emit("library-updated", ()).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn rescan_library(app: tauri::AppHandle, state: State<'_, Scanner>) -> Result<Value, String> {
    let scanner = Arc::clone(&state.0);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut db = scanner.lock().map_err(|e| e.to_string())?;
        indexer::rescan(&mut db)
    })
    .await
    .map_err(|e| e.to_string())??;
    app.emit("library-updated", ()).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn read_audio_buffer(
    state: State<'_, Library>,
    file_path: String,
    track_id: Option<i64>,
    version: Option<i64>,
) -> Result<tauri::ipc::Response, String> {
    let db = Arc::clone(&state.0);
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        sfx_music_manager::preview::read_audio(&db, &file_path, track_id, version)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

#[tauri::command]
async fn waveform_peaks(
    state: State<'_, Library>,
    track_id: i64,
    resolution: usize,
    version: Option<i64>,
) -> Result<Option<Vec<f32>>, String> {
    let db = Arc::clone(&state.0);
    tauri::async_runtime::spawn_blocking(move || {
        sfx_music_manager::preview::waveform(&db, track_id, resolution, version)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_folder_dialog() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Chọn Thư Mục Chứa Âm Thanh")
        .pick_folder()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_files_dialog() -> Vec<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Chọn File Âm Thanh")
        .add_filter(
            "Âm thanh",
            &[
                "wav", "aiff", "aif", "mp3", "flac", "m4a", "aac", "ogg", "caf",
            ],
        )
        .pick_files()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|file| file.path().to_string_lossy().into_owned())
        .collect()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .plugin(launcher::plugin())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                media_tools::shutdown(window.app_handle());
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            app.manage(Arc::new(Mutex::new(
                sfx_music_manager::transfer::BounceCache::open(
                    app.path().app_cache_dir()?.join("bounce"),
                )?,
            )));
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let db = sfx_music_manager::legacy::open_library(&root, &app.path().config_dir()?)?;
            let scanner = Arc::new(Mutex::new(database::open(&root.join("library.db"))?));
            let handle = app.handle().clone();
            let watcher = LibraryWatcher::start(Arc::clone(&scanner), move || {
                let _ = handle.emit("library-updated", ());
            })
            .map_err(std::io::Error::other)?;
            app.manage(watcher);
            app.manage(Scanner(scanner));
            app.manage(Library(Arc::new(Mutex::new(db))));
            media_tools::setup(app.handle())?;
            launcher::setup(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launcher::launcher_window,
            launcher::launcher_height,
            launcher::launcher_shortcut,
            launcher::set_launcher_shortcut,
            launcher::accessibility,
            launcher::open_accessibility,
            media_tools::media_call,
            media_tools::capcut_call,
            app_info,
            quit_app,
            library_read,
            library_write,
            import_paths,
            rescan_library,
            read_audio_buffer,
            waveform_peaks,
            desktop_transfer::export_audio,
            desktop_transfer::bounce_save,
            desktop_transfer::bounce_clear,
            desktop_transfer::bounce_check,
            desktop_transfer::prepare_drag,
            desktop_transfer::reveal_file,
            desktop_transfer::copy_paths,
            open_files_dialog,
            open_folder_dialog
        ])
        .run(tauri::generate_context!())
        .expect("SFX Manager startup failed");
}
