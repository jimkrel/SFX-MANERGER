use sfx_music_manager::{database, indexer, preview};
use std::{
    fs,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn playback_and_detail_waveform_follow_the_indexed_revision() {
    let path = std::env::temp_dir().join(format!(
        "preview-{}-{}.wav",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    // Stereo PCM with a transient exclusively in the right channel of frame 800.
    let mut data = Vec::from(&b"RIFF"[..]);
    data.extend(6436u32.to_le_bytes());
    data.extend(b"WAVEfmt ");
    data.extend(16u32.to_le_bytes());
    for n in [1u16, 2] {
        data.extend(n.to_le_bytes());
    }
    for n in [48000u32, 192000] {
        data.extend(n.to_le_bytes());
    }
    for n in [4u16, 16] {
        data.extend(n.to_le_bytes());
    }
    data.extend(b"data");
    data.extend(6400u32.to_le_bytes());
    data.resize(6444, 0);
    data[3246..3248].copy_from_slice(&i16::MIN.to_le_bytes());
    fs::write(&path, &data).unwrap();
    let mut conn = database::open(Path::new(":memory:")).unwrap();
    assert_eq!(
        indexer::import_paths(&mut conn, &[path.clone()])["imported"],
        1
    );
    let db = Mutex::new(conn);
    let path_str = path.to_str().unwrap();
    assert_eq!(
        preview::read_audio(&db, path_str, Some(1), Some(0)).unwrap(),
        Some(data.clone())
    );
    assert_eq!(
        preview::read_audio(&db, path_str, Some(2), None).unwrap(),
        None
    );
    assert_eq!(preview::waveform(&db, 1, 0, None).unwrap(), None);
    let peaks = preview::waveform(&db, 1, 800, Some(0)).unwrap().unwrap();
    assert_eq!(peaks.len(), 800);
    assert_eq!(peaks[400], 1.0);
    assert_eq!(peaks.iter().sum::<f32>(), 1.0);
    assert_eq!(
        preview::waveform(&db, 1, 800, None).unwrap().unwrap(),
        peaks
    );
    assert_eq!(
        db.lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM waveform_cache WHERE resolution=800",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    data.extend([0u8; 4]);
    fs::write(&path, &data).unwrap();
    assert_eq!(
        preview::read_audio(&db, path_str, Some(1), None).unwrap(),
        None
    );
    assert_eq!(preview::waveform(&db, 1, 800, None).unwrap(), None);
    indexer::import_paths(&mut db.lock().unwrap(), &[path.clone()]);
    assert_eq!(preview::waveform(&db, 1, 800, Some(0)).unwrap(), None);
    fs::remove_file(&path).unwrap();
    assert_eq!(
        preview::read_audio(&db, path_str, None, None).unwrap(),
        None
    );
}
