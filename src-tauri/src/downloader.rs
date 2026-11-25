use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{self, BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};
use tempfile::NamedTempFile;
use url::Url;

type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn command(bin: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}
pub fn clean_url(input: &str) -> Result<Url> {
    let mut u = Url::parse(input.trim()).map_err(error)?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("Đường dẫn phải dùng HTTP hoặc HTTPS".into());
    }
    if platform(&u) == "youtube" && u.query_pairs().any(|(k, _)| k == "v") {
        let pairs: Vec<_> = u
            .query_pairs()
            .filter(|(k, _)| !matches!(k.as_ref(), "list" | "index" | "start_radio"))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        u.query_pairs_mut().clear().extend_pairs(pairs);
    }
    Ok(u)
}
fn platform(u: &Url) -> &'static str {
    let host = u.host_str().unwrap_or_default();
    for (domain, label) in [
        ("youtube.com", "youtube"),
        ("youtu.be", "youtube"),
        ("tiktok.com", "tiktok"),
        ("soundcloud.com", "soundcloud"),
    ] {
        if host == domain || host.ends_with(&format!(".{domain}")) {
            return label;
        }
    }
    "generic"
}
pub fn binary(bin: &Path, name: &str) -> Option<PathBuf> {
    let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let mut dirs = vec![bin.to_owned()];
    // Electron and Tauri profiles are siblings under AppData or Application Support.
    if let Some(parent) = bin.parent().and_then(Path::parent) {
        for profile in ["sfx-music-manager", "SFX Music Manager"] {
            dirs.push(parent.join(profile).join("bin"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    #[cfg(target_os = "macos")]
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    dirs.into_iter()
        .map(|p| p.join(&file))
        .find(|p| p.is_file() && p.is_absolute())
}
fn version(path: &Path, arg: &str) -> Option<String> {
    let out = command(path).arg(arg).output().ok()?;
    out.status.success().then(|| {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .to_owned()
    })
}
pub fn status(bin: &Path) -> Value {
    let yt = binary(bin, "yt-dlp");
    let ver = yt.as_deref().and_then(|p| version(p, "--version"));
    let ff = binary(bin, "ffmpeg").filter(|p| version(p, "-version").is_some());
    json!({"isReady":ver.is_some(),"hasYtDlp":ver.is_some(),"hasFfmpeg":ff.is_some(),"canDownloadVideo":ver.is_some()&&ff.is_some(),"ytDlpPath":yt,"ffmpegPath":ff,"version":ver})
}
pub fn install(bin: &Path, ff_only: bool, progress: impl Fn(u8, &str)) -> Result<()> {
    fs::create_dir_all(bin).map_err(error)?;
    for name in ["yt-dlp", "ffmpeg"] {
        if name == "yt-dlp" && ff_only {
            continue;
        }
        let flag = if name == "yt-dlp" {
            "--version"
        } else {
            "-version"
        };
        if binary(bin, name).and_then(|p| version(&p, flag)).is_some() {
            continue;
        }
        let os = std::env::consts::OS;
        let addr = if name == "yt-dlp" {
            let asset = match os {
                "windows" => "yt-dlp.exe",
                "macos" => "yt-dlp_macos",
                _ => "yt-dlp",
            };
            format!("https://github.com/yt-dlp/yt-dlp/releases/latest/download/{asset}")
        } else {
            let platform = match os {
                "windows" => "win32",
                "macos" => "darwin",
                _ => "linux",
            };
            let arch = if cfg!(target_arch = "aarch64") && os != "windows" {
                "arm64"
            } else {
                "x64"
            };
            format!("https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-{platform}-{arch}.gz")
        };
        progress(if name == "yt-dlp" { 5 } else { 50 }, name);
        let download = NamedTempFile::new_in(bin).map_err(error)?;
        let out = command(Path::new("curl"))
            .args([
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--proto",
                "=https",
                "--proto-redir",
                "=https",
                "--connect-timeout",
                "20",
                "--max-time",
                "600",
                "--output",
            ])
            .arg(download.path())
            .arg(addr)
            .output()
            .map_err(error)?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        let staged = if name == "ffmpeg" {
            let mut unpacked = NamedTempFile::new_in(bin).map_err(error)?;
            io::copy(
                &mut flate2::read::GzDecoder::new(download.reopen().map_err(error)?),
                &mut unpacked,
            )
            .map_err(error)?;
            unpacked
        } else {
            download
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(staged.path(), fs::Permissions::from_mode(0o755)).map_err(error)?;
        }
        let stage_dir = tempfile::tempdir_in(bin).map_err(error)?;
        let file = format!("{name}{}", std::env::consts::EXE_SUFFIX);
        let executable = stage_dir.path().join(&file);
        drop(staged.persist(&executable).map_err(error)?);
        version(&executable, flag).ok_or_else(|| format!("{name}: không chạy được bản đã tải"))?;
        let temp = tempfile::TempPath::try_from_path(executable).map_err(error)?;
        temp.persist(bin.join(file)).map_err(error)?;
    }
    progress(100, "Hoàn tất");
    Ok(())
}

pub fn info(yt: &Path, input: &str) -> Result<Value> {
    let u = clean_url(input)?;
    let o = command(yt)
        .args([
            "--ignore-config",
            "--no-warnings",
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            "--",
            u.as_str(),
        ])
        .output()
        .map_err(error)?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).into_owned());
    }
    let v: Value = serde_json::from_slice(&o.stdout).map_err(error)?;
    let id = v["id"].as_str().unwrap_or("");
    let mut thumb = v["thumbnail"]
        .as_str()
        .or_else(|| v["thumbnails"].as_array()?.last()?["url"].as_str())
        .unwrap_or("")
        .to_owned();
    if platform(&u) == "youtube" && !id.is_empty() && (thumb.is_empty() || thumb.contains(".webp"))
    {
        thumb = format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg");
    }
    Ok(
        json!({"url":u.as_str(),"platform":platform(&u),"id":id,"title":v["title"].as_str().unwrap_or("Audio không tên"),"uploader":v["uploader"].as_str().or(v["channel"].as_str()).or(v["creator"].as_str()).unwrap_or("Chưa rõ tác giả"),"thumbnail":thumb,"duration":v["duration"].as_f64().unwrap_or_default(),"description":v["description"].as_str().map(|s|s.chars().take(300).collect::<String>())}),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub url: String,
    pub format: String,
    pub output_dir: Option<PathBuf>,
    pub job_id: Option<String>,
}
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, Arc<Mutex<Child>>>>);
impl Jobs {
    pub fn cancel_all(&self) {
        let ids: Vec<String> = self
            .0
            .lock()
            .map(|jobs| jobs.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.cancel(&id);
        }
    }
    pub fn cancel(&self, id: &str) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(id).cloned())
            .is_some_and(|p| {
                p.lock().is_ok_and(|mut c| {
                    #[cfg(windows)]
                    {
                        if command(Path::new("taskkill.exe"))
                            .args(["/T", "/F", "/PID", &c.id().to_string()])
                            .output()
                            .is_ok_and(|out| out.status.success())
                        {
                            return true;
                        }
                    }
                    #[cfg(unix)]
                    {
                        // The child owns this process group from spawn until wait.
                        if unsafe { libc::kill(-(c.id() as libc::pid_t), libc::SIGKILL) } == 0 {
                            return true;
                        }
                    }
                    c.kill().is_ok()
                })
            })
    }
}

pub fn download(
    yt: &Path,
    ff: Option<&Path>,
    opts: &Options,
    default: &Path,
    jobs: &Jobs,
    emit: impl Fn(Value),
) -> Result<Value> {
    let url = clean_url(&opts.url)?;
    let id = opts
        .job_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let video = opts.format.starts_with("mp4");
    let mut dir = opts.output_dir.as_deref().unwrap_or(default).to_owned();
    if video {
        dir.push("Videos");
    }
    fs::create_dir_all(&dir).map_err(error)?;
    let stage = tempfile::tempdir_in(&dir).map_err(error)?;
    let mut c = command(yt);
    c.args(["--ignore-config","--no-playlist","--no-warnings","--no-simulate","--newline","--progress","--progress-template","download:SFX_PROGRESS %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s","--print","post_process:SFX_EXTRACT","--print","after_move:SFX_FILE %(filepath)j","-o"]).arg(stage.path().join(if video{"%(title).160B [%(height)sp].%(ext)s"}else{"%(title).180B.%(ext)s"}));
    if let Some(f) = ff {
        c.arg("--ffmpeg-location").arg(f);
    }
    match opts.format.as_str() {
        "original" => {
            c.arg("-x");
        }
        "wav" | "mp3" if ff.is_none() => {
            c.arg("-x");
        }
        "wav" => {
            c.args([
                "-x",
                "--audio-format",
                "wav",
                "--postprocessor-args",
                "ffmpeg:-ar 48000 -ac 2 -c:a pcm_s16le",
            ]);
        }
        "mp3" => {
            c.args(["-x", "--audio-format", "mp3", "--audio-quality", "320k"]);
        }

        "mp4_best" | "mp4_1080p" | "mp4_720p" => {
            let filter=match opts.format.as_str(){"mp4_1080p"=>"bestvideo[height<=1080][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best","mp4_720p"=>"bestvideo[height<=720][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",_=>"bestvideo+bestaudio/best"};
            c.args(["-f", filter, "--merge-output-format", "mp4"]);
        }
        _ => return Err("Định dạng không hợp lệ".into()),
    }
    let mut map = jobs.0.lock().map_err(error)?;
    if map.contains_key(&id) {
        return Err("Job ID đang được dùng".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    let mut child = c
        .arg("--")
        .arg(url.as_str())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(error)?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let child = Arc::new(Mutex::new(child));
    map.insert(id.clone(), child.clone());
    drop(map);
    let progress = |mut v: Value| {
        v["jobId"] = json!(id);
        v["url"] = json!(opts.url);
        emit(v)
    };
    progress(json!({"status":"starting","percent":0}));
    let log = std::thread::spawn(move || {
        let mut last = Vec::new();
        let mut r = BufReader::new(stderr);
        let mut buf = [0; 4096];
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            last.extend_from_slice(&buf[..n]);
            if last.len() > 8192 {
                last.drain(..last.len() - 8192);
            }
        }
        String::from_utf8_lossy(&last).into_owned()
    });
    let mut output = None;
    let mut percent = 0.0f64;
    for line in BufReader::new(stdout)
        .lines()
        .map_while(std::result::Result::ok)
    {
        if let Some(s) = line.strip_prefix("SFX_FILE ") {
            output = serde_json::from_str::<PathBuf>(s).ok();
        }
        if line.starts_with("SFX_EXTRACT") {
            progress(json!({"status":"extracting","percent":95}));
        }
        if let Some(s) = line.strip_prefix("SFX_PROGRESS ") {
            let parts: Vec<_> = s.split('|').collect();
            if let Ok(n) = parts[0].trim().trim_end_matches('%').parse::<f64>() {
                percent = percent.max((n * 0.94).clamp(0., 94.));
                progress(
                    json!({"status":"downloading","percent":percent,"speed":parts.get(1),"eta":parts.get(2),"totalSize":parts.get(3)}),
                );
            }
        }
    }
    let status = child.lock().map_err(error)?.wait();
    jobs.0.lock().map_err(error)?.remove(&id);
    let err = log.join().unwrap_or_default();
    let result = (|| {
        if !status.map_err(error)?.success() {
            return Err(if err.trim().is_empty() {
                "Tác vụ đã dừng".into()
            } else {
                err
            });
        }
        let file = output
            .ok_or("Không tìm thấy file đầu ra")?
            .canonicalize()
            .map_err(error)?;
        if file.parent() != Some(stage.path().canonicalize().map_err(error)?.as_path())
            || !file.is_file()
        {
            return Err("File đầu ra không hợp lệ".into());
        }
        let mut dest = dir.join(file.file_name().unwrap());
        // Reserve a distinct name if two completed jobs have the same media title.
        for index in 1.. {
            match fs::hard_link(&file, &dest) {
                Ok(()) => break,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    dest = dir.join(format!(
                        "{} ({index}).{}",
                        file.file_stem().unwrap_or_default().to_string_lossy(),
                        file.extension().unwrap_or_default().to_string_lossy()
                    ))
                }
                Err(_) => {
                    let mut tmp = NamedTempFile::new_in(&dir).map_err(error)?;
                    io::copy(&mut fs::File::open(&file).map_err(error)?, &mut tmp)
                        .map_err(error)?;
                    match tmp.persist_noclobber(&dest) {
                        Ok(_) => break,
                        Err(e) => return Err(error(e)),
                    }
                }
            }
        }
        Ok(json!({"filePath":dest,"duration":0,"jobId":id}))
    })();
    match &result {
        Ok(v) => progress(json!({"status":"completed","percent":100,"filePath":v["filePath"]})),
        Err(e) => progress(json!({"status":"error","percent":percent,"error":e})),
    };
    result
}
