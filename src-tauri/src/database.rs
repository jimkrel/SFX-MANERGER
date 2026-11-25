pub use crate::library_edit::{write, Edit};
use rusqlite::OptionalExtension;
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, Result};
use serde_json::{json, Value};
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection> {
    let mut db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let tx = db.transaction()?;
    let legacy_flat_tags: bool = tx.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='track_tags')",
        [],
        |r| r.get(0),
    )?;
    tx.execute_batch("
        CREATE TABLE IF NOT EXISTS tracks(id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT UNIQUE NOT NULL,name TEXT NOT NULL,duration REAL NOT NULL DEFAULT 0,sample_rate INTEGER,channels INTEGER,tags TEXT DEFAULT '',is_missing INTEGER DEFAULT 0,added_at DATETIME DEFAULT CURRENT_TIMESTAMP,rating INTEGER DEFAULT 0,is_favorite INTEGER DEFAULT 0,category TEXT DEFAULT '',bpm INTEGER,peak_gain REAL,artist TEXT,album TEXT,genre TEXT,file_size INTEGER,file_mtime REAL,content_version INTEGER NOT NULL DEFAULT 0,type_override TEXT);
        CREATE TABLE IF NOT EXISTS watched_folders(id INTEGER PRIMARY KEY AUTOINCREMENT,path TEXT UNIQUE NOT NULL,added_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL COLLATE NOCASE);
        CREATE TABLE IF NOT EXISTS track_tags(track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(track_id,tag_id));
        CREATE TABLE IF NOT EXISTS waveform_cache(track_id INTEGER REFERENCES tracks(id) ON DELETE CASCADE,resolution INTEGER NOT NULL,peaks TEXT NOT NULL,PRIMARY KEY(track_id,resolution));
        CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(track_id UNINDEXED,name,tags,category,tokenize='unicode61');")?;
    if legacy_flat_tags {
        for record in rows(
            &tx,
            "SELECT id,tags FROM tracks WHERE coalesce(tags,'')<>''",
            &[],
        )? {
            for name in record["tags"].as_str().unwrap_or("").split(',') {
                crate::library_edit::add_tag(&tx, record["id"].as_i64().unwrap(), name)?;
            }
        }
    }
    migrate(&tx)?;
    tx.commit()?;
    Ok(db)
}

pub(crate) fn rows(db: &Connection, sql: &str, args: &[SqlValue]) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let result = stmt
        .query_map(params_from_iter(args.iter()), |row| {
            let mut object = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get::<_, SqlValue>(i)? {
                    SqlValue::Null => Value::Null,
                    SqlValue::Integer(v) => json!(v),
                    SqlValue::Real(v) => json!(v),
                    SqlValue::Text(v) => json!(v),
                    SqlValue::Blob(_) => Value::Null,
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(result)
}

pub fn read(db: &Connection, operation: &str, options: Option<&Value>) -> Result<Value> {
    match operation {
        "status" => Ok(json!({"connected":true,"path":db.path(),"sqliteVersion":rusqlite::version()})),
        "setting" => Ok(json!(db.query_row("SELECT value FROM app_settings WHERE key=?", [options.and_then(|o|o["key"].as_str())],|r|r.get::<_,String>(0)).optional()?)),
        "peaks" => {
            let o=options.ok_or(rusqlite::Error::InvalidQuery)?;
            let peaks=db.query_row("SELECT peaks FROM waveform_cache JOIN tracks ON tracks.id=track_id WHERE track_id=?1 AND resolution=?2 AND (?3 IS NULL OR content_version=?3)",
                rusqlite::params![o["trackId"].as_i64(),o["resolution"].as_i64(),o["version"].as_i64()],|r|r.get::<_,String>(0)).optional()?;
            Ok(peaks.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
        }
        "folders" => Ok(json!(rows(db,"SELECT path FROM watched_folders ORDER BY added_at", &[])?.iter().filter_map(|v| v.get("path")).collect::<Vec<_>>())),
        "tags" => Ok(json!(rows(db,"SELECT t.id,t.name,COUNT(tt.track_id) AS count FROM tags t LEFT JOIN track_tags tt ON tt.tag_id=t.id GROUP BY t.id ORDER BY count DESC,t.name", &[])?)),
        "storage" => Ok(rows(db,"SELECT COALESCE(SUM(file_size),0) AS totalBytes,COUNT(*) AS totalFiles FROM tracks WHERE is_missing=0", &[])?.remove(0)),
        "stats" => Ok(rows(db,"SELECT COUNT(CASE WHEN is_missing=0 AND kind='SFX' THEN 1 END) AS totalSfx,COUNT(CASE WHEN is_missing=0 AND kind='Music' THEN 1 END) AS totalMusic,COUNT(CASE WHEN is_missing=0 AND added_at>=datetime('now','-7 days') THEN 1 END) AS newThisWeek,COUNT(CASE WHEN is_missing=1 THEN 1 END) AS totalMissing FROM tracks JOIN library_types USING(id)", &[])?.remove(0)),
        "tracks" => {
            let empty = json!({}); let o = options.unwrap_or(&empty);
            let mut sql = String::from("SELECT t.*,w.peaks AS peaks_80 FROM tracks t LEFT JOIN waveform_cache w ON w.track_id=t.id AND w.resolution=80 WHERE 1=1");
            let mut args = Vec::new();
            if o["onlyAvailable"] == true { sql.push_str(" AND t.is_missing=0"); }
            if o["favoriteOnly"] == true { sql.push_str(" AND t.is_favorite=1"); }
            if let Some(rating)=o["rating"].as_i64().filter(|r|*r>0) {
                sql.push_str(" AND t.rating>=?"); args.push(rating.into());
            }
            if let Some(kind)=o["audioClassification"].as_str().filter(|k|matches!(*k,"SFX"|"Music")) {
                sql.push_str(" AND t.id IN (SELECT id FROM library_types WHERE kind=?)"); args.push(kind.to_string().into());
            }
            if let Some(folder)=o["folderPath"].as_str().filter(|f|!f.is_empty()) {
                let folder=folder.replace(char::from(92),"/");
                let folder=folder.trim_end_matches('/');
                sql.push_str(" AND (replace(t.path,char(92),'/')=? OR replace(t.path,char(92),'/') LIKE ? ESCAPE '!')");
                args.push(folder.to_owned().into());
                args.push(format!("{}/%",folder.replace('!',"!!").replace('%',"!%").replace('_',"!_")).into());
            }
            if let Some(ids)=o["tagIds"].as_array().filter(|ids|!ids.is_empty()) {
                sql.push_str(" AND t.id IN (SELECT track_id FROM track_tags WHERE tag_id IN (SELECT value FROM json_each(?))");
                args.push(json!(ids).to_string().into());
                if o["tagMode"]=="AND" { sql.push_str(" GROUP BY track_id HAVING count(DISTINCT tag_id)=?"); args.push((ids.len() as i64).into()); }
                sql.push(')');
            }
            if let Some(q) = o["searchQuery"].as_str() {
                let q = q.split_whitespace().map(|s|s.replace(['"','*','^'], "")).filter(|s|!s.is_empty()).map(|s| format!("\"{}\"*", s.replace('"', ""))).collect::<Vec<_>>().join(" ");
                if !q.is_empty() { sql.push_str(" AND t.id IN (SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?)"); args.push(SqlValue::Text(q)); }
            }
            if let Some(c) = o["category"].as_str().filter(|c| !c.is_empty() && *c != "Tất cả") { sql.push_str(" AND t.category=?"); args.push(SqlValue::Text(c.into())); }
            sql.push_str(match o["sortBy"].as_str() {Some("name_asc")=>" ORDER BY t.name COLLATE NOCASE",Some("duration_desc")=>" ORDER BY t.duration DESC",Some("favorite_desc")=>" ORDER BY t.is_favorite DESC,t.added_at DESC",Some("rating_desc")=>" ORDER BY t.rating DESC,t.added_at DESC",_=>" ORDER BY t.added_at DESC"});
            if let Some(n) = o["limit"].as_i64().filter(|n| *n>0) { sql.push_str(" LIMIT ?"); args.push(SqlValue::Integer(n)); }
            let mut tracks = rows(db,&sql,&args)?;
            let ids: Vec<_> = tracks.iter().map(|t| &t["id"]).collect();
            let mut tags = std::collections::HashMap::<i64,Vec<Value>>::new();
            for tag in rows(db,"SELECT track_id,t.id,t.name FROM tags t JOIN track_tags ON t.id=tag_id
                WHERE track_id IN (SELECT value FROM json_each(?)) ORDER BY t.name",&[json!(ids).to_string().into()])? {
                tags.entry(tag["track_id"].as_i64().unwrap()).or_default().push(json!({"id":tag["id"],"name":tag["name"]}));
            }
            for track in &mut tracks {
                let id = track["id"].as_i64().unwrap_or_default();
                track["tagList"] = json!(tags.remove(&id).unwrap_or_default());
                track["peaks_80"] = track["peaks_80"].as_str().and_then(|s| serde_json::from_str::<Vec<f64>>(s).ok()).filter(|p| p.len()==80).map(|p|json!(p)).unwrap_or(Value::Null);
            }
            Ok(json!(tracks))
        }
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_empty_library_and_searches_index() {
        let db = open(Path::new(":memory:")).unwrap();
        assert_eq!(read(&db, "tracks", None).unwrap(), json!([]));
        db.execute_batch("INSERT INTO tracks(id,path,name,duration) VALUES(1,'a.wav','Whoosh',2); INSERT INTO tracks_fts(track_id,name,tags,category) VALUES(1,'Whoosh','SFX','Cinematic'); INSERT INTO track_tags SELECT 1,id FROM tags WHERE name='SFX';").unwrap();
        let result = read(&db, "tracks", Some(&json!({"searchQuery":"whoo"}))).unwrap();
        assert_eq!(result[0]["name"], "Whoosh");
        assert_eq!(result[0]["tagList"][0]["name"], "SFX");
        assert_eq!(read(&db, "stats", None).unwrap()["totalSfx"], 1);
    }
}

fn migrate(db: &Connection) -> Result<()> {
    let columns = rows(db, "PRAGMA table_info(tracks)", &[])?;
    let has = |name: &str| columns.iter().any(|r| r["name"] == name);
    for (name, kind) in [
        ("added_at", "DATETIME"),
        ("rating", "INTEGER DEFAULT 0"),
        ("is_favorite", "INTEGER DEFAULT 0"),
        ("category", "TEXT DEFAULT ''"),
        ("bpm", "INTEGER"),
        ("peak_gain", "REAL"),
        ("artist", "TEXT"),
        ("album", "TEXT"),
        ("genre", "TEXT"),
        ("file_size", "INTEGER"),
        ("file_mtime", "REAL"),
        ("content_version", "INTEGER NOT NULL DEFAULT 0"),
        ("type_override", "TEXT"),
    ] {
        if !has(name) {
            db.execute_batch(&format!("ALTER TABLE tracks ADD COLUMN {name} {kind}"))?;
        }
    }
    if !has("added_at") {
        db.execute_batch("UPDATE tracks SET added_at=CURRENT_TIMESTAMP WHERE added_at IS NULL;
            CREATE TRIGGER IF NOT EXISTS tracks_added_at AFTER INSERT ON tracks WHEN NEW.added_at IS NULL BEGIN UPDATE tracks SET added_at=CURRENT_TIMESTAMP WHERE id=NEW.id; END;")?;
    }
    if !has("type_override") {
        db.execute_batch("UPDATE tracks SET type_override=(SELECT CASE lower(name) WHEN 'sfx' THEN 'SFX' ELSE 'Music' END
            FROM tags JOIN track_tags ON tags.id=tag_id WHERE track_id=tracks.id AND name IN ('SFX','Music') GROUP BY track_id HAVING count(*)=1)")?;
    }
    db.execute_batch("CREATE INDEX IF NOT EXISTS idx_tracks_is_missing ON tracks(is_missing);
        CREATE INDEX IF NOT EXISTS idx_tracks_is_favorite ON tracks(is_favorite);
        CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(rating);
        CREATE TABLE IF NOT EXISTS tauri_migrations(version INTEGER PRIMARY KEY);
        CREATE TEMP VIEW library_types AS SELECT t.id,coalesce(nullif(type_override,''),
            (SELECT CASE lower(name) WHEN 'sfx' THEN 'SFX' ELSE 'Music' END FROM track_tags JOIN tags ON tags.id=tag_id
            WHERE track_id=t.id AND name IN ('SFX','Music') ORDER BY (name='SFX') DESC LIMIT 1),
            CASE WHEN duration<30 THEN 'SFX' ELSE 'Music' END) AS kind FROM tracks t;")?;
    if !db.query_row(
        "SELECT EXISTS(SELECT 1 FROM tauri_migrations WHERE version=1)",
        [],
        |r| r.get::<_, bool>(0),
    )? {
        // Normalize on the current OS without requiring media to be mounted.
        for table in ["tracks", "watched_folders"] {
            let select = format!("SELECT id,path FROM {table}");
            let update = format!("UPDATE OR IGNORE {table} SET path=? WHERE id=?");
            for record in rows(db, &select, &[])? {
                let original = record["path"].as_str().unwrap();
                let mut path = std::path::PathBuf::new();
                for part in Path::new(original).components() {
                    use std::path::Component::*;
                    match part {
                        CurDir => {}
                        ParentDir if path.file_name().is_some() => {
                            path.pop();
                        }
                        ParentDir if path.has_root() => {}
                        _ => path.push(part.as_os_str()),
                    }
                }
                let clean = path.to_str().filter(|p| !p.is_empty()).unwrap_or(".");
                if clean != original {
                    db.execute(&update, rusqlite::params![clean, record["id"].as_i64()])?;
                }
            }
        }
        for track in rows(
            db,
            "SELECT id,path,name FROM tracks WHERE coalesce(category,'') IN ('','Khác')",
            &[],
        )? {
            let category = crate::classification::category(
                track["path"].as_str().unwrap(),
                track["name"].as_str().unwrap(),
            );
            if category != "Khác" {
                db.execute(
                    "UPDATE tracks SET category=? WHERE id=?",
                    rusqlite::params![category, track["id"].as_i64()],
                )?;
            }
        }
        db.execute_batch("DROP TABLE tracks_fts;
            CREATE VIRTUAL TABLE tracks_fts USING fts5(track_id UNINDEXED,name,tags,category,tokenize='unicode61');
            INSERT INTO tracks_fts SELECT id,name,(SELECT group_concat(name,' ') FROM tags JOIN track_tags ON tags.id=tag_id WHERE track_id=t.id),category FROM tracks t;
            INSERT INTO tauri_migrations VALUES(1);")?;
    }
    crate::library_edit::reclassify(db)?;
    Ok(())
}
