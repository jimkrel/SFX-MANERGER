use crate::indexer::{decode_peaks, signature};
use rusqlite::{params, Connection, OptionalExtension};
use std::{fs, path::Path, sync::Mutex};
use symphonia::core::{io::MediaSourceStream, probe::Hint};

#[derive(PartialEq)]
struct Source {
    id: i64,
    path: String,
    version: i64,
    size: Option<i64>,
    mtime: Option<f64>,
}

fn source(
    db: &Mutex<Connection>,
    path: Option<&str>,
    id: Option<i64>,
    version: Option<i64>,
) -> Result<Option<Source>, String> {
    db.lock().map_err(|e|e.to_string())?.query_row(
        "SELECT id,path,content_version,file_size,file_mtime FROM tracks WHERE is_missing=0
        AND (?1 IS NULL OR path=?1) AND (?2 IS NULL OR id=?2) AND (?3 IS NULL OR content_version=?3)",
        params![path,id,version],|r|Ok(Source{id:r.get(0)?,path:r.get(1)?,version:r.get(2)?,size:r.get(3)?,mtime:r.get(4)?})
    ).optional().map_err(|e|e.to_string())
}

impl Source {
    fn signature(&self) -> Option<(i64, f64)> {
        let sig = signature(Path::new(&self.path)).ok()?;
        if self.size.is_some_and(|size| size != sig.0)
            || self.mtime.is_some_and(|mtime| mtime != sig.1)
        {
            return None;
        }
        Some(sig)
    }
}

pub fn read_audio(
    db: &Mutex<Connection>,
    path: &str,
    id: Option<i64>,
    version: Option<i64>,
) -> Result<Option<Vec<u8>>, String> {
    let Some(track) = source(db, Some(path), id, version)? else {
        return Ok(None);
    };
    let Some(before) = track.signature() else {
        return Ok(None);
    };
    let Ok(bytes) = fs::read(path) else {
        return Ok(None);
    };
    if bytes.len() as i64 != before.0
        || track.signature() != Some(before)
        || source(db, Some(path), Some(track.id), Some(track.version))?.as_ref() != Some(&track)
    {
        return Ok(None);
    }
    Ok(Some(bytes))
}

fn wav_peaks(path: &Path, resolution: usize) -> Option<Vec<f32>> {
    if !path.extension()?.eq_ignore_ascii_case("wav") {
        return None;
    }
    let stream = MediaSourceStream::new(Box::new(fs::File::open(path).ok()?), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("wav");
    let mut format = symphonia::default::get_probe()
        .format(&hint, stream, &Default::default(), &Default::default())
        .ok()?
        .format;
    let track = format.default_track()?;
    let codec = track.codec_params.clone();
    let id = track.id;
    decode_peaks(
        &mut *format,
        id,
        &codec,
        codec.n_frames.filter(|n| *n > 0)?,
        resolution,
    )
}

pub fn waveform(
    db: &Mutex<Connection>,
    id: i64,
    resolution: usize,
    version: Option<i64>,
) -> Result<Option<Vec<f32>>, String> {
    if !(1..=10000).contains(&resolution) {
        return Ok(None);
    }
    let Some(track) = source(db, None, Some(id), version)? else {
        return Ok(None);
    };
    let Some(before) = track.signature() else {
        return Ok(None);
    };
    let cached: Option<String> = db
        .lock()
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT peaks FROM waveform_cache JOIN tracks ON tracks.id=track_id
         WHERE track_id=? AND resolution=? AND content_version=? AND is_missing=0",
            params![id, resolution, track.version],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(peaks) = cached
        .and_then(|v| serde_json::from_str::<Vec<f32>>(&v).ok())
        .filter(|v| v.len() == resolution && v.iter().all(|p| (0.0..=1.0).contains(p)))
    {
        return Ok(Some(peaks));
    }
    let Some(peaks) = wav_peaks(Path::new(&track.path), resolution) else {
        return Ok(None);
    };
    if track.signature() != Some(before) {
        return Ok(None);
    }
    let saved=db.lock().map_err(|e|e.to_string())?.execute(
        "INSERT OR REPLACE INTO waveform_cache SELECT id,?1,?2 FROM tracks WHERE id=?3 AND path=?4 AND content_version=?5 AND is_missing=0",
        params![resolution,serde_json::json!(peaks).to_string(),id,track.path,track.version]).map_err(|e|e.to_string())?;
    Ok((saved == 1).then_some(peaks))
}
