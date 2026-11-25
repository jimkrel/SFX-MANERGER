use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use symphonia::core::{
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::{MetadataOptions, StandardTagKey},
    probe::Hint,
};

pub(crate) fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "wav" | "mp3" | "aiff" | "aif" | "flac" | "m4a" | "aac" | "ogg" | "caf"
    )
}

pub(crate) fn signature(path: &Path) -> Result<(i64, f64), String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    if !m.is_file() {
        return Err("Not a file".into());
    }
    let modified = m
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs_f64()
        * 1000.0;
    Ok((m.len() as i64, modified))
}

struct Metadata {
    peaks: Option<Vec<f32>>,
    name: String,
    duration: f64,
    sample_rate: Option<u32>,
    channels: Option<usize>,
    artist: Option<String>,
    album: Option<String>,
    genre: Option<String>,
    bpm: Option<f64>,
}

fn metadata(path: &Path) -> Result<Metadata, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }
    let mut probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("No audio track")?;
    let p = &track.codec_params;
    let duration = match (p.n_frames, p.time_base, p.sample_rate) {
        (Some(n), Some(tb), _) => {
            let t = tb.calc_time(n);
            t.seconds as f64 + t.frac
        }
        (Some(n), None, Some(sr)) if sr > 0 => n as f64 / sr as f64,
        _ => 0.0,
    };
    let frames = p.n_frames;
    let track_id = track.id;
    let codec = p.clone();
    let mut out = Metadata {
        peaks: None,
        name: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        duration,
        sample_rate: p.sample_rate,
        channels: p.channels.map(|c| c.count()),
        artist: None,
        album: None,
        genre: None,
        bpm: None,
    };
    let mut apply = |tags: &[symphonia::core::meta::Tag]| {
        for tag in tags {
            let v = tag.value.to_string();
            match tag.std_key {
                Some(StandardTagKey::TrackTitle) => out.name = v,
                Some(StandardTagKey::Artist) => out.artist = Some(v),
                Some(StandardTagKey::Album) => out.album = Some(v),
                Some(StandardTagKey::Bpm) => {
                    out.bpm = v.parse::<f64>().ok().filter(|b| b.is_finite() && *b > 0.0)
                }
                Some(StandardTagKey::Genre) => out.genre = Some(v),
                _ => {}
            }
        }
    };
    if let Some(meta) = probed.metadata.get() {
        if let Some(rev) = meta.current() {
            apply(rev.tags());
        }
    }
    if let Some(rev) = format.metadata().current() {
        apply(rev.tags());
    }
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("wav"))
    {
        if let Some(frames) = frames.filter(|n| *n > 0) {
            out.peaks = decode_peaks(&mut *format, track_id, &codec, frames, 80);
        }
    }
    if out.sample_rate.is_none() || out.channels.is_none() {
        if let Ok(mut decoder) = symphonia::default::get_codecs().make(&codec, &Default::default())
        {
            while let Ok(packet) = format.next_packet() {
                if packet.track_id() != track_id {
                    continue;
                }
                if let Ok(buffer) = decoder.decode(&packet) {
                    out.channels = Some(buffer.spec().channels.count());
                    out.sample_rate = Some(buffer.spec().rate);
                    break;
                }
            }
        }
    }
    if out.duration == 0.0 {
        if let Some(time_base) = codec.time_base {
            let mut end = 0;
            while let Ok(packet) = format.next_packet() {
                if packet.track_id() == track_id {
                    end = end.max(packet.ts().saturating_add(packet.dur()));
                }
            }
            let t = time_base.calc_time(end.saturating_sub(codec.start_ts));
            out.duration = t.seconds as f64 + t.frac;
        }
    }
    Ok(out)
}

pub(crate) fn decode_peaks(
    format: &mut dyn symphonia::core::formats::FormatReader,
    track: u32,
    codec: &symphonia::core::codecs::CodecParameters,
    frames: u64,
    resolution: usize,
) -> Option<Vec<f32>> {
    use symphonia::core::audio::SampleBuffer;
    let mut decoder = symphonia::default::get_codecs()
        .make(codec, &Default::default())
        .ok()?;
    let mut peaks = vec![0f32; resolution];
    let mut frame = 0u64;
    while frame < frames {
        let packet = format.next_packet().ok()?;
        if packet.track_id() != track {
            continue;
        }
        let decoded = decoder.decode(&packet).ok()?;
        let channels = decoded.spec().channels.count();
        if channels == 0 {
            return None;
        }
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        for values in samples.samples().chunks_exact(channels) {
            let bin = (frame as u128 * resolution as u128 / frames as u128)
                .min(resolution as u128 - 1) as usize;
            for &v in values {
                if !v.is_finite() {
                    return None;
                }
                peaks[bin] = peaks[bin].max(v.abs().min(1.0));
            }
            frame += 1;
        }
    }
    for p in &mut peaks {
        *p = (*p * 10000.0).round() / 10000.0;
    }
    Some(peaks)
}

type Previous = Option<(i64, Option<i64>, Option<f64>, i64)>;
fn previous(db: &Connection, path: &Path) -> Result<Previous, String> {
    db.query_row(
        "SELECT id,file_size,file_mtime,is_missing FROM tracks WHERE path=?",
        [path.to_str().ok_or("Non-Unicode path")?],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn prepare(path: &Path, prev: Previous) -> Result<Option<(Metadata, (i64, f64))>, String> {
    for _ in 0..3 {
        let sig = signature(path)?;
        if prev
            .is_some_and(|(_, s, t, missing)| missing == 0 && s == Some(sig.0) && t == Some(sig.1))
        {
            return Ok(None);
        }
        let data = metadata(path);
        if sig == signature(path)? {
            return data.map(|m| Some((m, sig)));
        }
    }
    Err("File changed during metadata scan".into())
}

fn save(
    db: &mut Connection,
    path: &Path,
    previous: Previous,
    m: Metadata,
    (size, mtime): (i64, f64),
) -> Result<(), String> {
    let key = path.to_str().ok_or("Non-Unicode path")?;
    if signature(path)? != (size, mtime) {
        return Err("File changed before indexing".into());
    }
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let changed = previous.is_some_and(|(_, s, t, _)| s != Some(size) || t != Some(mtime));
    tx.execute(
        "INSERT INTO tracks(path,name,duration,sample_rate,channels,artist,album,genre,file_size,file_mtime,bpm,is_missing)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(path) DO UPDATE SET name=excluded.name,duration=excluded.duration,
             sample_rate=excluded.sample_rate,channels=excluded.channels,artist=excluded.artist,
             album=excluded.album,genre=excluded.genre,file_size=excluded.file_size,
             file_mtime=excluded.file_mtime,is_missing=0,content_version=tracks.content_version+?12,
             bpm=CASE WHEN ?12 OR tracks.bpm IS NULL THEN excluded.bpm ELSE tracks.bpm END,
             peak_gain=CASE WHEN ?12 THEN NULL ELSE tracks.peak_gain END",
        params![key,m.name,m.duration,m.sample_rate,m.channels,m.artist,m.album,m.genre,size,mtime,m.bpm,changed]
    ).map_err(|e|e.to_string())?;
    let id: i64 = tx
        .query_row("SELECT id FROM tracks WHERE path=?", [key], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if changed {
        tx.execute("DELETE FROM waveform_cache WHERE track_id=?", [id])
            .map_err(|e| e.to_string())?;
    }
    let category = crate::classification::category(key, &m.name);
    tx.execute(
        "UPDATE tracks SET category=? WHERE id=? AND coalesce(category,'') IN ('','Khác')",
        params![category, id],
    )
    .map_err(|e| e.to_string())?;
    let typed: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM track_tags JOIN tags ON tags.id=tag_id
        WHERE track_id=? AND name IN ('SFX','Music'))",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !typed {
        let tracks = crate::database::rows(&tx, "SELECT * FROM tracks WHERE id=?", &[id.into()])
            .map_err(|e| e.to_string())?;
        let track = &tracks[0];
        let kind = track["type_override"]
            .as_str()
            .unwrap_or_else(|| crate::classification::audio_type(track));
        crate::library_edit::add_tag(&tx, id, kind).map_err(|e| e.to_string())?;
    }
    crate::library_edit::sync_search(&tx, id).map_err(|e| e.to_string())?;
    if let Some(peaks) = m.peaks {
        tx.execute(
            "INSERT OR REPLACE INTO waveform_cache(track_id,resolution,peaks) VALUES(?,80,?)",
            params![id, json!(peaks).to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn collect_files(path: &Path, files: &mut BTreeSet<PathBuf>, errors: &mut Vec<String>) {
    for entry in walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
    {
        match entry {
            Ok(e) if e.file_type().is_file() && supported(e.path()) => {
                files.insert(e.into_path());
            }
            Err(e) => errors.push(e.to_string()),
            _ => {}
        }
    }
}

fn index_files(
    db: &mut Connection,
    files: BTreeSet<PathBuf>,
    errors: &mut Vec<String>,
) -> (usize, usize) {
    use rayon::prelude::*;
    let mut imported = 0;
    let mut recovered = 0;
    let files: Vec<_> = files.into_iter().collect();
    for chunk in files.chunks(32) {
        let jobs: Vec<_> = chunk
            .iter()
            .map(|path| (path, previous(db, path)))
            .collect();
        let prepared: Vec<_> = jobs
            .into_par_iter()
            .map(|(path, prev)| (path, prev.and_then(|p| prepare(path, p).map(|m| (p, m)))))
            .collect();
        for (path, result) in prepared {
            match result.and_then(|(p, m)| {
                if let Some((m, sig)) = m {
                    save(db, path, p, m, sig)?;
                    imported += 1;
                    if p.is_some_and(|p| p.3 == 1) {
                        recovered += 1;
                    }
                }
                Ok(())
            }) {
                Ok(()) => {}
                Err(e) => errors.push(format!("{}: {e}", path.display())),
            }
        }
    }
    (imported, recovered)
}

pub fn import_paths(db: &mut Connection, paths: &[PathBuf]) -> Value {
    let mut files = BTreeSet::new();
    let mut errors = Vec::new();
    let mut folders = 0;
    for input in paths {
        let path = match std::path::absolute(input) {
            Ok(path) => path,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        if path.is_dir() {
            match db.execute(
                "INSERT OR IGNORE INTO watched_folders(path) VALUES(?)",
                [path.to_string_lossy().as_ref()],
            ) {
                Ok(n) => folders += n,
                Err(e) => {
                    errors.push(e.to_string());
                    continue;
                }
            }
            collect_files(&path, &mut files, &mut errors);
        } else if path.is_file() && supported(&path) {
            files.insert(path);
        } else {
            errors.push(format!("Unsupported or missing: {}", path.display()));
        }
    }
    let (imported, _) = index_files(db, files, &mut errors);
    json!({"imported":imported,"folders":folders,"errors":errors})
}

pub(crate) fn folders(db: &Connection) -> Result<BTreeSet<PathBuf>, String> {
    let mut stmt = db
        .prepare("SELECT path FROM watched_folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0).map(PathBuf::from))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

pub fn rescan(db: &mut Connection) -> Result<Value, String> {
    reconcile(db, true)
}

pub(crate) fn reconcile(db: &mut Connection, discover: bool) -> Result<Value, String> {
    let mut files = BTreeSet::new();
    let mut errors = Vec::new();
    let mut missing = 0;
    let tracks = {
        let mut stmt = db
            .prepare("SELECT path FROM tracks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
    };
    for path in &tracks {
        let absent = match fs::metadata(path) {
            Ok(m) if m.is_file() => {
                files.insert(PathBuf::from(path));
                false
            }
            Ok(_) => true,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                true
            }
            Err(e) => {
                errors.push(format!("{path}: {e}"));
                false
            }
        };
        if absent {
            missing += db
                .execute(
                    "UPDATE tracks SET is_missing=1 WHERE path=? AND is_missing=0",
                    [path],
                )
                .map_err(|e| e.to_string())?;
        }
    }
    if discover {
        for folder in folders(db)? {
            if folder.is_dir() {
                collect_files(&folder, &mut files, &mut errors);
            }
        }
    }
    let (imported, recovered) = index_files(db, files, &mut errors);
    Ok(
        json!({"checked":tracks.len(),"missing":missing,"recovered":recovered,"imported":imported,"errors":errors}),
    )
}

pub(crate) fn apply_events(
    db: &mut Connection,
    roots: &BTreeSet<PathBuf>,
    paths: BTreeSet<PathBuf>,
) -> Result<Value, String> {
    let mut files = BTreeSet::new();
    let mut errors = Vec::new();
    let mut missing = 0;
    for path in paths {
        if !roots.iter().any(|root| {
            path.strip_prefix(root).is_ok_and(|rel| {
                !rel.components()
                    .any(|p| p.as_os_str().to_string_lossy().starts_with('.'))
            })
        }) {
            continue;
        }
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_dir() => collect_files(&path, &mut files, &mut errors),
            Ok(m) if m.is_file() && supported(&path) => {
                files.insert(path);
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                let key = path.to_string_lossy();
                let prefix = format!("{}{}", key, std::path::MAIN_SEPARATOR);
                missing+=db.execute("UPDATE tracks SET is_missing=1 WHERE is_missing=0 AND (path=?1 OR substr(path,1,length(?2))=?2)",params![key,prefix]).map_err(|e|e.to_string())?;
            }
            Err(e) => errors.push(format!("{}: {e}", path.display())),
            _ => {}
        }
    }
    let (imported, recovered) = index_files(db, files, &mut errors);
    Ok(json!({"missing":missing,"imported":imported,"recovered":recovered,"errors":errors}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wav(frames: u32) -> Vec<u8> {
        let bytes = frames * 2;
        let mut v = Vec::new();
        v.extend(b"RIFF");
        v.extend((36 + bytes).to_le_bytes());
        v.extend(b"WAVEfmt ");
        v.extend(16u32.to_le_bytes());
        v.extend(1u16.to_le_bytes());
        v.extend(1u16.to_le_bytes());
        v.extend(48000u32.to_le_bytes());
        v.extend(96000u32.to_le_bytes());
        v.extend(2u16.to_le_bytes());
        v.extend(16u16.to_le_bytes());
        v.extend(b"data");
        v.extend(bytes.to_le_bytes());
        v.resize(44 + bytes as usize, 0);
        v
    }
    #[test]
    fn imports_and_updates_audio_preserving_favorite() {
        let dir = std::env::temp_dir().join(format!(
            "sfx-index-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&dir).unwrap();
        let file = dir.join("Tiếng gió.wav");
        let mut impulse = wav(48000);
        let offset = 44 + 24000 * 2;
        impulse[offset..offset + 2].copy_from_slice(&i16::MIN.to_le_bytes());
        fs::write(&file, impulse).unwrap();
        let mut db = crate::database::open(Path::new(":memory:")).unwrap();
        assert_eq!(import_paths(&mut db, &[dir.clone()])["imported"], 1);
        assert_eq!(import_paths(&mut db, &[file.clone()])["imported"], 0);
        let before = crate::database::read(&db, "tracks", None).unwrap();
        assert_eq!(before[0]["peaks_80"][40], 1.0);
        assert_eq!(before[0]["peaks_80"].as_array().unwrap().len(), 80);
        db.execute("UPDATE tracks SET is_favorite=1", []).unwrap();
        fs::write(&file, wav(96000)).unwrap();
        assert_eq!(import_paths(&mut db, &[file.clone()])["imported"], 1);
        let result = crate::database::read(&db, "tracks", None).unwrap();
        assert_eq!(result[0]["duration"], 2.0);
        assert_eq!(result[0]["is_favorite"], 1);
        assert_eq!(result[0]["content_version"], 1);
        assert_eq!(result[0]["peaks_80"][40], 0.0);
        fs::remove_file(&file).unwrap();
        assert_eq!(rescan(&mut db).unwrap()["missing"], 1);
        fs::write(&file, wav(48000)).unwrap();
        assert_eq!(rescan(&mut db).unwrap()["recovered"], 1);
        fs::remove_file(file).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
