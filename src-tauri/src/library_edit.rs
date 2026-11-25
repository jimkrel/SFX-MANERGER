use crate::{
    classification,
    database::{read, rows},
};
use icu_normalizer::ComposingNormalizer;
use rusqlite::{params, Connection, Result};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Edit {
    SetRating {
        track_id: i64,
        rating: f64,
    },
    ToggleFavorite {
        track_id: i64,
    },
    SetCategory {
        track_id: i64,
        category: String,
    },
    SetBpm {
        track_id: i64,
        bpm: Option<f64>,
        version: Option<i64>,
    },
    SetPeakGain {
        track_id: i64,
        peak_gain: f64,
        version: Option<i64>,
    },
    AddTagToTrack {
        track_id: i64,
        tag_name: String,
    },
    BulkTag {
        track_ids: Vec<i64>,
        tag_name: String,
    },
    RemoveTagFromTrack {
        track_id: i64,
        tag_id: i64,
    },
    BulkRemoveTag {
        track_ids: Vec<i64>,
        tag_id: i64,
    },
    BulkDelete {
        track_ids: Vec<i64>,
    },
    ToggleTrackType {
        track_id: i64,
    },
    ReclassifyAll,
    RemoveWatchedFolder {
        folder_path: String,
    },
    SetSetting {
        key: String,
        value: String,
    },
    SaveWaveformPeaks {
        track_id: i64,
        resolution: usize,
        peaks: Vec<f64>,
        version: Option<i64>,
    },
}

pub(crate) fn sync_search(db: &Connection, id: i64) -> Result<()> {
    db.execute("DELETE FROM tracks_fts WHERE track_id=?", [id])?;
    db.execute("INSERT INTO tracks_fts(track_id,name,tags,category)
        SELECT id,name,(SELECT group_concat(name,' ') FROM tags JOIN track_tags ON tags.id=tag_id WHERE track_id=?1),category
        FROM tracks WHERE id=?1", [id])?;
    Ok(())
}

pub(crate) fn add_tag(db: &Connection, id: i64, name: &str) -> Result<Value> {
    let name = ComposingNormalizer::new_nfc().normalize(name.trim());
    if name.is_empty() {
        return Ok(Value::Null);
    }
    db.execute(
        "INSERT OR IGNORE INTO tags(name) VALUES(?)",
        [name.as_ref()],
    )?;
    let tag = db.query_row(
        "SELECT id,name FROM tags WHERE name=?",
        [name.as_ref()],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )?;
    db.execute(
        "INSERT OR IGNORE INTO track_tags VALUES(?,?)",
        params![id, tag.0],
    )?;
    Ok(json!({"id":tag.0,"name":tag.1}))
}

fn remove_tags(db: &Connection, ids: &[i64], tag: i64) -> Result<()> {
    for id in ids {
        db.execute(
            "DELETE FROM track_tags WHERE track_id=? AND tag_id=?",
            [*id, tag],
        )?;
        sync_search(db, *id)?;
    }
    if !ids.is_empty() {
        db.execute(
            "DELETE FROM tags WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM track_tags WHERE tag_id=?1)",
            [tag],
        )?;
    }
    Ok(())
}

fn assign_type(db: &Connection, id: i64, kind: &str) -> Result<()> {
    db.execute("DELETE FROM track_tags WHERE track_id=? AND tag_id IN (SELECT id FROM tags WHERE name IN ('Music','SFX') AND name<>?)",params![id,kind])?;
    add_tag(db, id, kind)?;
    db.execute("UPDATE tracks SET tags=(SELECT group_concat(name,', ') FROM (SELECT name FROM tags JOIN track_tags ON tag_id=tags.id WHERE track_id=?1 ORDER BY name)) WHERE id=?1",[id])?;
    sync_search(db, id)
}

pub(crate) fn reclassify(db: &Connection) -> Result<Value> {
    db.execute_batch("INSERT OR IGNORE INTO tags(name) VALUES ('SFX'),('Music');")?;
    let tracks = rows(db,"SELECT t.*,EXISTS(SELECT 1 FROM track_tags JOIN tags ON tags.id=tag_id WHERE track_id=t.id AND name='Music') AS music,
        EXISTS(SELECT 1 FROM track_tags JOIN tags ON tags.id=tag_id WHERE track_id=t.id AND name='SFX') AS sfx FROM tracks t WHERE is_missing=0",&[])?;
    let (mut sfx, mut updated) = (0, 0);
    for track in &tracks {
        let kind = track["type_override"]
            .as_str()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| classification::audio_type(track));
        let is_sfx = kind == "SFX";
        sfx += usize::from(is_sfx);
        if (track["sfx"] == 1) != is_sfx || (track["music"] == 1) == is_sfx {
            assign_type(db, track["id"].as_i64().unwrap(), kind)?;
            updated += 1;
        }
    }
    Ok(
        json!({"totalScanned":tracks.len(),"updatedCount":updated,"sfxCount":sfx,"musicCount":tracks.len()-sfx}),
    )
}

pub fn write(db: &mut Connection, edit: Edit) -> Result<Value> {
    use Edit::*;
    let tx = db.transaction()?;
    let mut result = json!(true);
    match edit {
        SetRating { track_id, rating } => {
            tx.execute(
                "UPDATE tracks SET rating=? WHERE id=?",
                params![rating.round().clamp(0., 5.) as i64, track_id],
            )?;
        }
        ToggleFavorite { track_id } => {
            result=json!(tx.query_row("UPDATE tracks SET is_favorite=CASE WHEN is_favorite=1 THEN 0 ELSE 1 END WHERE id=? RETURNING is_favorite",[track_id],|r|r.get::<_,i64>(0))?);
        }
        SetCategory { track_id, category } => {
            tx.execute(
                "UPDATE tracks SET category=? WHERE id=?",
                params![category, track_id],
            )?;
            sync_search(&tx, track_id)?;
        }
        SetBpm {
            track_id,
            bpm,
            version,
        } => {
            tx.execute(
                "UPDATE tracks SET bpm=?1 WHERE id=?2 AND (?3 IS NULL OR content_version=?3)",
                params![bpm, track_id, version],
            )?;
        }
        SetPeakGain {
            track_id,
            peak_gain,
            version,
        } => {
            tx.execute(
                "UPDATE tracks SET peak_gain=?1 WHERE id=?2 AND (?3 IS NULL OR content_version=?3)",
                params![peak_gain, track_id, version],
            )?;
        }
        AddTagToTrack { track_id, tag_name } => {
            result = add_tag(&tx, track_id, &tag_name)?;
            sync_search(&tx, track_id)?;
        }
        BulkTag {
            track_ids,
            tag_name,
        } => {
            for id in track_ids {
                add_tag(&tx, id, &tag_name)?;
                sync_search(&tx, id)?;
            }
        }
        BulkRemoveTag { track_ids, tag_id } => remove_tags(&tx, &track_ids, tag_id)?,
        RemoveTagFromTrack { track_id, tag_id } => remove_tags(&tx, &[track_id], tag_id)?,
        BulkDelete { track_ids } => {
            for id in track_ids {
                tx.execute("DELETE FROM tracks WHERE id=?", [id])?;
                tx.execute("DELETE FROM tracks_fts WHERE track_id=?", [id])?;
            }
        }
        ToggleTrackType { track_id } => {
            let music:bool=tx.query_row("SELECT CASE WHEN coalesce(type_override,'')<>'' THEN type_override='Music'
                ELSE EXISTS(SELECT 1 FROM track_tags JOIN tags ON tags.id=tag_id WHERE track_id=t.id AND name='Music')
                OR (duration>=30 AND NOT EXISTS(SELECT 1 FROM track_tags JOIN tags ON tags.id=tag_id WHERE track_id=t.id AND name='SFX')) END
                FROM tracks t WHERE id=?", [track_id], |r| r.get(0))?;
            let kind = if music { "SFX" } else { "Music" };
            assign_type(&tx, track_id, kind)?;
            tx.execute(
                "UPDATE tracks SET type_override=? WHERE id=?",
                params![kind, track_id],
            )?;
            result = json!(kind);
        }
        ReclassifyAll => result = reclassify(&tx)?,
        RemoveWatchedFolder { folder_path } => {
            tx.execute("DELETE FROM watched_folders WHERE rtrim(replace(path,char(92),'/'),'/')=rtrim(replace(?,char(92),'/'),'/')",[folder_path])?;
            result = read(&tx, "folders", None)?;
        }
        SetSetting { key, value } => {
            tx.execute("INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value])?;
        }
        SaveWaveformPeaks {
            track_id,
            resolution,
            peaks,
            version,
        } => {
            if (1..=10000).contains(&resolution)
                && peaks.len() == resolution
                && peaks.iter().all(|p| (0.0..=1.0).contains(p))
            {
                tx.execute("INSERT OR REPLACE INTO waveform_cache SELECT id,?1,?2 FROM tracks WHERE id=?3 AND (?4 IS NULL OR content_version=?4)",params![resolution,json!(peaks).to_string(),track_id,version])?;
            }
        }
    }
    tx.commit()?;
    Ok(result)
}
