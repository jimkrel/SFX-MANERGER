use crate::Scanner;
use serde_json::{json, Value};
use sfx_music_manager::{
    capcut::Catalog,
    downloader::{self, Jobs, Options},
    indexer,
};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

struct Media {
    catalog: Mutex<Catalog>,
    jobs: Jobs,
    install: Mutex<()>,
    bin: PathBuf,
}
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let home = app.path().home_dir()?;
    let local = app.path().local_data_dir()?;
    let mut root = local.join("CapCut/User Data");
    if cfg!(target_os = "macos") {
        let movies = home.join("Movies/CapCut/User Data");
        if movies.is_dir() || !root.exists() {
            root = movies;
        }
    }
    let fonts = if cfg!(windows) {
        vec![
            PathBuf::from(std::env::var_os("WINDIR").unwrap_or_else(|| "C:\\Windows".into()))
                .join("Fonts"),
            local.join("Microsoft/Windows/Fonts"),
            root.join("Cache/effect"),
        ]
    } else {
        vec![
            home.join("Library/Fonts"),
            "/Library/Fonts".into(),
            "/System/Library/Fonts".into(),
            root.join("Cache/effect"),
        ]
    };
    app.manage(Arc::new(Media {
        catalog: Mutex::new(Catalog::new(
            root.join("Presets/Combination/Presets"),
            root.join("Projects/com.lveditor.draft"),
            fonts,
        )),
        jobs: Jobs::default(),
        install: Mutex::new(()),
        bin: app.path().app_data_dir()?.join("bin"),
    }));
    Ok(())
}
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<Arc<Media>>() {
        state.jobs.cancel_all();
    }
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn yt(bin: &Path) -> Result<PathBuf, String> {
    downloader::binary(bin, "yt-dlp").ok_or("Thiếu yt-dlp".into())
}
#[tauri::command]
pub async fn media_call(app: AppHandle, operation: String, args: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Arc<Media>>();
        let bin = &state.bin;
        match operation.as_str() {
            "status" => Ok(downloader::status(bin)),
            "install" => {
                let _guard = state.install.lock().map_err(error)?;
                Ok(
                    match downloader::install(bin, args["ffOnly"] == true, |percent, msg| {
                        let _ = app.emit(
                            "download-install-progress",
                            json!({"percent":percent,"statusText":msg}),
                        );
                    }) {
                        Ok(()) => json!({"success":true}),
                        Err(e) => json!({"success":false,"error":e}),
                    },
                )
            }
            "info" => downloader::info(&yt(bin)?, args["url"].as_str().ok_or("Thiếu URL")?),
            "cancel" => Ok(json!(state
                .jobs
                .cancel(args["jobId"].as_str().unwrap_or_default()))),
            "download" => {
                let opts: Options = serde_json::from_value(args).map_err(error)?;
                let dir = app
                    .path()
                    .download_dir()
                    .map_err(error)?
                    .join("SFX-Studio-Downloads");
                let out = downloader::download(
                    &yt(bin)?,
                    downloader::binary(bin, "ffmpeg").as_deref(),
                    &opts,
                    &dir,
                    &state.jobs,
                    |v| {
                        let _ = app.emit("download-progress", v);
                    },
                )?;
                if !opts.format.starts_with("mp4") {
                    let scanner = app.state::<Scanner>();
                    let mut db = scanner.0.lock().map_err(error)?;
                    indexer::import_paths(
                        &mut db,
                        &[out["filePath"].as_str().ok_or("Thiếu đường dẫn")?.into()],
                    );
                    let _ = app.emit("library-updated", ());
                }
                Ok(out)
            }
            _ => Err("Lệnh tải không hợp lệ".into()),
        }
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn capcut_call(app: AppHandle, operation: String, args: Value) -> Result<Value, String> {
    let export = if operation == "exportPreset" {
        let dest = rfd::AsyncFileDialog::new()
            .set_title("Xuất preset CapCut")
            .set_file_name(format!(
                "{}.zip",
                Path::new(args["folderPath"].as_str().unwrap_or("preset"))
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ))
            .add_filter("ZIP", &["zip"])
            .save_file()
            .await;
        let Some(file) = dest else {
            return Ok(json!({"success":false,"canceled":true}));
        };
        Some(file.path().to_owned())
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Arc<Media>>();
        let mut catalog = state.catalog.lock().map_err(error)?;
        let path = Path::new(args["folderPath"].as_str().unwrap_or(""));
        let result = match operation.as_str() {
            "getPresetsPath" => Ok(json!(catalog.presets)),
            "scanPresets" => catalog.scan(
                args["customPath"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(Path::new),
            ),
            "analyzeFont" | "fixFonts" => catalog.font_action(path, operation == "fixFonts"),
            "deletePreset" => catalog.delete(path),
            "renamePreset" => catalog.rename(path, args["newName"].as_str().ok_or("Thiếu tên")?),
            "openFolder" => {
                if !path.is_absolute() || !path.is_dir() {
                    return Err("Thư mục không hợp lệ".into());
                }
                let tool = if cfg!(windows) {
                    "explorer.exe"
                } else if cfg!(target_os = "macos") {
                    "open"
                } else {
                    "xdg-open"
                };
                Command::new(tool).arg(path).spawn().map_err(error)?;
                Ok(Value::Null)
            }
            "exportPreset" => catalog.export(path, export.as_ref().unwrap()),
            "getAssetDataUrl" => catalog.asset(Path::new(args["filePath"].as_str().unwrap_or(""))),
            "listProjects" => catalog.list_projects(),
            "injectPreset" => catalog.inject(
                path,
                Path::new(args["target"].as_str().ok_or("Thiếu dự án")?),
                args["startTimeMs"].as_f64().unwrap_or(0.),
            ),
            "createDraft" => catalog.create(path, args["customName"].as_str()),
            _ => Err("Lệnh CapCut không hợp lệ".into()),
        };
        match result {
            Err(e)
                if matches!(
                    operation.as_str(),
                    "deletePreset"
                        | "renamePreset"
                        | "exportPreset"
                        | "injectPreset"
                        | "createDraft"
                ) =>
            {
                Ok(json!({"success":false,"error":e}))
            }
            other => other,
        }
    })
    .await
    .map_err(error)?
}
