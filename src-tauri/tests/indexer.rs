use sfx_music_manager::{database, indexer, watcher::LibraryWatcher};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "sfx-tester3-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn fixture(ext: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/audio")
        .join(format!("tone.{ext}"))
}

#[test]
fn real_formats_in_mixed_batch() {
    let root = Scratch::new();
    let sub = root.0.join("Nhạc");
    fs::create_dir(&sub).unwrap();
    for ext in ["aiff", "caf", "flac", "mp3", "m4a", "aac", "ogg", "aif"] {
        let source = fixture(if ext == "aif" { "aiff" } else { ext });
        fs::copy(source, sub.join(format!("Tone.{ext}"))).unwrap();
    }
    let hidden = root.0.join(".hidden");
    fs::create_dir(&hidden).unwrap();
    fs::copy(fixture("caf"), hidden.join("invisible.caf")).unwrap();
    fs::write(sub.join("corrupt.mp3"), b"invalid media").unwrap();
    let mut db = database::open(Path::new(":memory:")).unwrap();
    let result = indexer::import_paths(&mut db, &[root.0.clone(), sub.join("Tone.flac")]);
    assert_eq!(result["imported"], 8, "{result}");
    assert_eq!(result["errors"].as_array().unwrap().len(), 1);
    for t in database::read(&db, "tracks", None)
        .unwrap()
        .as_array()
        .unwrap()
    {
        let duration = t["duration"].as_f64().unwrap();
        assert!((0.20..0.45).contains(&duration), "{t}");
        assert_eq!(t["sample_rate"], 24000, "{t}");
        assert_eq!(t["channels"], 1, "{t}");
    }
    assert_eq!(
        indexer::import_paths(&mut db, &[root.0.clone()])["imported"],
        0
    );
}

#[test]
fn watches_create_rename_delete_and_restore_then_unwatch() {
    let root = Scratch::new();
    let source = fixture("flac");
    let file = root.0.join("Tiếng gió.flac");
    let renamed = root.0.join("Gió mới.flac");
    let mut db = database::open(Path::new(":memory:")).unwrap();
    indexer::import_paths(&mut db, &[root.0.clone()]);
    let db = Arc::new(Mutex::new(db));
    let (send, changes) = mpsc::channel();
    let guard = LibraryWatcher::start(db.clone(), move || {
        let _ = send.send(());
    })
    .unwrap();
    let wait = || {
        changes
            .recv_timeout(Duration::from_secs(10))
            .expect("no library update within 10s")
    };
    let count = |missing: i64| {
        db.lock()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM tracks WHERE is_missing=?",
                [missing],
                |r| r.get::<_, usize>(0),
            )
            .unwrap()
    };
    fs::copy(&source, &file).unwrap();
    wait();
    assert_eq!(count(0), 1);
    fs::rename(&file, &renamed).unwrap();
    wait();
    assert_eq!((count(0), count(1)), (1, 1));
    fs::remove_file(&renamed).unwrap();
    wait();
    assert_eq!(count(1), 2);
    fs::copy(&source, &renamed).unwrap();
    wait();
    assert_eq!(count(0), 1);
    db.lock()
        .unwrap()
        .execute("DELETE FROM watched_folders", [])
        .unwrap();
    guard.refresh();
    fs::copy(source, root.0.join("ignored.flac")).unwrap();
    assert!(changes.recv_timeout(Duration::from_secs(1)).is_err());
    assert_eq!(count(0), 1);
    drop(guard);
}

#[test]
fn parallel_batches_ignore_overlapping_inputs_and_preserve_search() {
    let root = Scratch::new();
    let nested = root.0.join("ambience");
    fs::create_dir(&nested).unwrap();
    for n in 0..69 {
        fs::copy(fixture("flac"), nested.join(format!("Rain {n}.flac"))).unwrap();
    }
    let mut db = database::open(Path::new(":memory:")).unwrap();
    let report = indexer::import_paths(
        &mut db,
        &[root.0.clone(), nested.clone(), nested.join("Rain 1.flac")],
    );
    assert_eq!(report["imported"], 69);
    assert!(report["errors"].as_array().unwrap().is_empty());
    let tracks = database::read(
        &db,
        "tracks",
        Some(&serde_json::json!({"searchQuery":"Rain","onlyAvailable":true})),
    )
    .unwrap();
    assert_eq!(tracks.as_array().unwrap().len(), 69);
    assert_eq!(indexer::rescan(&mut db).unwrap()["imported"], 0);
}
