use rusqlite::Connection;
use serde_json::{json, Value};
use sfx_music_manager::{
    database::{open, read, write},
    legacy::open_library,
};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn edit(db: &mut Connection, request: Value) -> rusqlite::Result<Value> {
    write(db, serde_json::from_value(request).unwrap())
}

#[test]
fn filters_batch_edits_and_search_stay_in_sync() {
    let mut db = open(Path::new(":memory:")).unwrap();
    db.execute_batch(
        r"INSERT INTO tracks(id,path,name,duration,file_size) VALUES
        (1,'C:\A_50%\Nhạc.wav','Nhạc vui',5,100),(2,'C:/AX500/B.wav','Tiếng cửa',90,200);",
    )
    .unwrap();
    let classified = edit(&mut db, json!({"operation":"reclassifyAll"})).unwrap();
    assert_eq!(
        classified,
        json!({"totalScanned":2,"sfxCount":1,"musicCount":1,"updatedCount":2})
    );
    edit(
        &mut db,
        json!({"operation":"bulkTag","trackIds":[1,2],"tagName":"Shared"}),
    )
    .unwrap();
    assert!(edit(
        &mut db,
        json!({"operation":"bulkTag","trackIds":[1,999],"tagName":"Rollback"})
    )
    .is_err());
    assert!(
        read(&db, "tracks", Some(&json!({"searchQuery":"Rollback"})))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    let tag = edit(
        &mut db,
        json!({"operation":"addTagToTrack","trackId":1,"tagName":" Red "}),
    )
    .unwrap();
    edit(
        &mut db,
        json!({"operation":"setRating","trackId":1,"rating":6.2}),
    )
    .unwrap();
    assert_eq!(
        edit(&mut db, json!({"operation":"toggleFavorite","trackId":1})).unwrap(),
        1
    );
    edit(
        &mut db,
        json!({"operation":"setCategory","trackId":1,"category":"Custom"}),
    )
    .unwrap();
    let ids = json!([
        tag["id"],
        db.query_row("SELECT id FROM tags WHERE name='shared'", [], |r| r
            .get::<_, i64>(0))
            .unwrap()
    ]);
    let options = json!({"folderPath":"C:/A_50%/","searchQuery":"cuSt*","tagIds":ids,"tagMode":"AND","rating":5,"favoriteOnly":true,"category":"Custom","audioClassification":"Music","onlyAvailable":true});
    assert_eq!(read(&db, "tracks", Some(&options)).unwrap()[0]["id"], 1);
    assert_eq!(
        read(&db, "tracks", Some(&json!({"tagIds":ids,"tagMode":"OR"})))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        edit(&mut db, json!({"operation":"toggleTrackType","trackId":1})).unwrap(),
        "SFX"
    );
    assert_eq!(
        edit(&mut db, json!({"operation":"reclassifyAll"})).unwrap()["updatedCount"],
        0
    );
    assert_eq!(read(&db, "stats", None).unwrap()["totalSfx"], 2);
    edit(
        &mut db,
        json!({"operation":"bulkRemoveTag","trackIds":[1,2],"tagId":tag["id"]}),
    )
    .unwrap();
    assert_eq!(
        read(&db, "tracks", Some(&json!({"searchQuery":"red"}))).unwrap(),
        json!([])
    );
    edit(&mut db, json!({"operation":"bulkDelete","trackIds":[2]})).unwrap();
    assert_eq!(
        read(&db, "storage", None).unwrap(),
        json!({"totalBytes":100,"totalFiles":1})
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM tracks_fts WHERE track_id=2",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn stale_analysis_cannot_replace_current_results() {
    let mut db = open(Path::new(":memory:")).unwrap();
    db.execute_batch("INSERT INTO tracks(id,path,name,content_version) VALUES(7,'a','a',3)")
        .unwrap();
    for (version, value) in [(3, 0.4), (2, 0.7)] {
        for req in [
            json!({"operation":"setBpm","bpm":value}),
            json!({"operation":"setPeakGain","peakGain":value}),
            json!({"operation":"saveWaveformPeaks","resolution":1,"peaks":[value]}),
        ] {
            let mut request = req;
            request["trackId"] = json!(7);
            request["version"] = json!(version);
            edit(&mut db, request).unwrap();
        }
    }
    let t = &read(&db, "tracks", None).unwrap()[0];
    assert_eq!(t["bpm"], 0.4);
    assert_eq!(t["peak_gain"], 0.4);
    assert_eq!(
        read(
            &db,
            "peaks",
            Some(&json!({"trackId":7,"resolution":1,"version":2}))
        )
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        read(
            &db,
            "peaks",
            Some(&json!({"trackId":7,"resolution":1,"version":3}))
        )
        .unwrap(),
        json!([0.4])
    );
}

#[test]
fn first_launch_snapshots_live_wal_and_upgrades_old_schema_once() {
    let dir = std::env::temp_dir().join(format!(
        "sfx-db-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let electron = dir.join("sfx-music-manager");
    let tauri = dir.join("tauri");
    fs::create_dir_all(&electron).unwrap();
    let old = Connection::open(electron.join("library.db")).unwrap();
    old.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
        CREATE TABLE tracks(id INTEGER PRIMARY KEY,path TEXT UNIQUE,name TEXT,duration REAL,sample_rate INTEGER,channels INTEGER,tags TEXT,is_missing INTEGER DEFAULT 0);
        CREATE VIRTUAL TABLE tracks_fts USING fts5(track_id UNINDEXED,name,tags);
        CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE);
        CREATE TABLE track_tags(track_id INTEGER REFERENCES tracks ON DELETE CASCADE,tag_id INTEGER REFERENCES tags ON DELETE CASCADE,PRIMARY KEY(track_id,tag_id));
        CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        INSERT INTO tracks(id,path,name,duration) VALUES(13,'/audio/whoosh.wav','whoosh',2);
        INSERT INTO tags VALUES(3,'Music'); INSERT INTO track_tags VALUES(13,3);
        INSERT INTO app_settings VALUES('shortcut','Alt+F');").unwrap();
    assert!(electron.join("library.db-wal").is_file());
    let mut db = open_library(&tauri, &dir).unwrap();
    let t = &read(
        &db,
        "tracks",
        Some(&json!({"audioClassification":"Music","searchQuery":"cinem"})),
    )
    .unwrap()[0];
    assert_eq!(t["id"], 13);
    assert_eq!(t["type_override"], "Music");
    assert!(t["added_at"].is_string());
    assert_eq!(
        read(&db, "setting", Some(&json!({"key":"shortcut"}))).unwrap(),
        "Alt+F"
    );
    edit(
        &mut db,
        json!({"operation":"setRating","trackId":13,"rating":5}),
    )
    .unwrap();
    drop(db);
    old.execute("UPDATE tracks SET name='Electron edit'", [])
        .unwrap();
    let db = open_library(&tauri, &dir).unwrap();
    let t = &read(&db, "tracks", None).unwrap()[0];
    assert_eq!(t["name"], "whoosh");
    assert_eq!(t["rating"], 5);
    assert!(old.prepare("SELECT type_override FROM tracks").is_err());
    drop(db);
    drop(old);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_import_can_be_retried_and_flat_tags_survive() {
    let dir = std::env::temp_dir().join(format!(
        "sfx-db-retry-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let electron = dir.join("SFX Music Manager");
    let target = dir.join("tauri");
    fs::create_dir_all(&electron).unwrap();
    let path = electron.join("library.db");
    fs::write(&path, b"broken database").unwrap();
    assert!(open_library(&target, &dir).is_err());
    assert!(!target.join("library.db").exists());
    fs::remove_file(&path).unwrap();
    let source = Connection::open(path).unwrap();
    source.execute_batch("CREATE TABLE tracks(id INTEGER PRIMARY KEY,path TEXT UNIQUE,name TEXT,duration REAL,sample_rate INTEGER,channels INTEGER,tags TEXT,is_missing INTEGER DEFAULT 0);
        INSERT INTO tracks(id,path,name,duration,tags) VALUES(1,'/a/piano.wav','piano',4,'SFX, Custom');
        CREATE TABLE watched_folders(id INTEGER PRIMARY KEY,path TEXT UNIQUE,added_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO watched_folders(path) VALUES('/a');
        CREATE TABLE waveform_cache(track_id INTEGER,resolution INTEGER,peaks TEXT,PRIMARY KEY(track_id,resolution));
        INSERT INTO waveform_cache VALUES(1,2,'[0.1,0.2]');").unwrap();
    let mut db = open_library(&target, &dir).unwrap();
    let t = &read(
        &db,
        "tracks",
        Some(&json!({"searchQuery":"cust","audioClassification":"SFX"})),
    )
    .unwrap()[0];
    assert_eq!(t["type_override"], "SFX");
    assert_eq!(
        read(&db, "peaks", Some(&json!({"trackId":1,"resolution":2}))).unwrap(),
        json!([0.1, 0.2])
    );
    assert_eq!(
        edit(
            &mut db,
            json!({"operation":"removeWatchedFolder","folderPath":"/a/"})
        )
        .unwrap(),
        json!([])
    );
    assert_eq!(
        read(&db, "tracks", None).unwrap().as_array().unwrap().len(),
        1
    );
    drop(source);
    drop(db);
    fs::remove_dir_all(dir).unwrap();
}
