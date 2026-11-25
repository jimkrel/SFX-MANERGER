use crate::transfer::save_export;
use base64::Engine;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use walkdir::WalkDir;
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn read(p: &Path) -> Result<Value> {
    serde_json::from_slice(&fs::read(p).map_err(err)?).map_err(err)
}
fn write(p: &Path, v: &Value) -> Result<()> {
    save_export(p, &serde_json::to_vec_pretty(v).map_err(err)?).map_err(err)
}
fn edit(p: &Path, old: &[u8], v: &Value) -> Result<()> {
    if fs::read(p).map_err(err)? != old {
        return Err("File đã thay đổi trong CapCut".into());
    }
    let mut bak = p.as_os_str().to_owned();
    bak.push(".bak");
    save_export(Path::new(&bak), old).map_err(err)?;
    write(p, v)
}
fn files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut v = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let e = entry.map_err(err)?;
        if !e.file_type().map_err(err)?.is_symlink() {
            v.push(e.path());
        }
    }
    v.sort();
    Ok(v)
}
fn ext(p: &Path) -> String {
    p.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}
fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn walk(v: &Value, f: &mut impl FnMut(&Value)) {
    match v {
        Value::Object(o) => {
            f(v);
            for child in o.values() {
                walk(child, f);
            }
        }
        Value::Array(a) => {
            for child in a {
                walk(child, f)
            }
        }
        _ => {}
    }
}
fn draft(p: &Path) -> PathBuf {
    p.join("preset_draft/draft_content.json")
}
fn preset(p: &Path) -> Result<Value> {
    for file in [draft(p), p.join("preset_draft/template-2.tmp")] {
        if file.exists()
            && !file
                .canonicalize()
                .map_err(err)?
                .starts_with(p.canonicalize().map_err(err)?)
        {
            return Err("File nằm ngoài preset".into());
        }
    }
    let objects = files(p)?;
    let meta = objects
        .iter()
        .find(|p| ext(p) == "json")
        .ok_or("Thiếu metadata")?;
    let m = read(meta)?;
    if !m.is_object() || !(m["id"].is_string() || m["name"].is_string() || draft(p).is_file()) {
        return Err("Không phải preset".into());
    }
    let data = if draft(p).is_file() {
        read(&draft(p))?
    } else {
        Value::Null
    };
    let mut ids = Vec::new();
    let mut materials = HashMap::new();
    let mut effects = Vec::new();
    let mut animations = Vec::new();
    let mut resources = HashSet::new();
    walk(&data, &mut |v| {
        if let Some(id) = v["id"].as_str() {
            if v.get("content").is_some() || v.get("font_path").is_some() {
                materials.insert(id.to_owned(), v.clone());
            }
        }
        if v["type"] == "text" {
            for seg in list(&v["segments"]) {
                if let Some(id) = seg["material_id"].as_str() {
                    if !ids.iter().any(|s| s == id) {
                        ids.push(id.to_owned());
                    }
                }
            }
        }
        if !string(v, "resource_id").is_empty()
            && !string(v, "name").is_empty()
            && resources.insert(v["resource_id"].clone().to_string())
        {
            effects.push(json!({"id":string(v,"id"),"name":v["name"],"type":v["type"],"resourceId":v["resource_id"],"effectPath":string(v,"path")}));
        }
        for a in list(&v["material_animations"]) {
            animations.push(
                json!({"id":a["id"],"type":a["type"].as_str().unwrap_or("sticker_animation")}),
            );
        }
    });
    let mut texts = Vec::new();
    let mut broken = 0;
    for id in ids {
        if let Some(t) = materials.get(&id) {
            let font = string(t, "font_path");
            let missing = !font.is_empty() && !Path::new(font).is_file();
            broken += usize::from(missing);
            let raw = string(t, "content");
            let parsed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
            texts.push(json!({"id":id,"parsedText":parsed["text"].as_str().unwrap_or(raw),"fontPath":font,"fontFilename":font.rsplit(['/','\\']).next().unwrap_or(""),"fontSize":t["font_size"].as_f64().unwrap_or(15.),"color":parsed.pointer("/styles/0/fill/content/solid/color").cloned().unwrap_or(json!([1,1,1])),"bold":parsed.pointer("/styles/0/bold").and_then(Value::as_bool).unwrap_or(false),"isFontBroken":missing}));
        }
    }
    let name = p.file_name().unwrap_or_default().to_string_lossy();
    Ok(
        json!({"id":m["id"].as_str().unwrap_or(&name),"name":m["name"].as_str().unwrap_or(&name),"folderPath":p,"thumbnailPath":objects.iter().find(|p|matches!(ext(p).as_str(),"jpeg"|"jpg"|"png")).and_then(|p|p.to_str()).unwrap_or(""),"createdAt":m["import_time_ms"].as_i64().unwrap_or(0),"draftVersion":string(&m,"draft_version"),"type":m["type"].as_str().unwrap_or("video"),"texts":texts,"effects":effects,"animations":animations,"hasBrokenFonts":broken>0,"brokenFontCount":broken}),
    )
}
pub struct Catalog {
    pub presets: PathBuf,
    pub drafts: PathBuf,
    pub fonts: Vec<PathBuf>,
    known: HashSet<PathBuf>,
    projects: HashSet<PathBuf>,
    assets: HashSet<PathBuf>,
}
impl Catalog {
    pub fn new(presets: PathBuf, drafts: PathBuf, fonts: Vec<PathBuf>) -> Self {
        Self {
            presets,
            drafts,
            fonts,
            known: Default::default(),
            projects: Default::default(),
            assets: Default::default(),
        }
    }
    pub fn scan(&mut self, dir: Option<&Path>) -> Result<Value> {
        self.known.clear();
        self.assets.clear();
        let dir = dir.unwrap_or(&self.presets);
        if !dir.exists() {
            return Ok(json!([]));
        }
        let mut rows = Vec::new();
        for p in files(dir)? {
            if !p.is_dir() {
                continue;
            }
            if let Ok(v) = preset(&p) {
                self.known.insert(p.canonicalize().map_err(err)?);
                for asset in std::iter::once(string(&v, "thumbnailPath"))
                    .chain(list(&v["texts"]).iter().map(|t| string(t, "fontPath")))
                {
                    if let Ok(path) = Path::new(asset).canonicalize() {
                        self.assets.insert(path);
                    }
                }
                rows.push(v);
            }
        }
        rows.sort_by_key(|v| std::cmp::Reverse(v["createdAt"].as_i64()));
        Ok(json!(rows))
    }
    pub fn checked(&self, path: &Path) -> Result<PathBuf> {
        let p = path.canonicalize().map_err(err)?;
        if !self.known.contains(&p) {
            return Err("Preset chưa được quét".into());
        }
        Ok(p)
    }
    pub fn asset(&self, p: &Path) -> Result<Value> {
        let Ok(p) = p.canonicalize() else {
            return Ok(Value::Null);
        };
        if !self.assets.contains(&p) {
            return Ok(Value::Null);
        }
        let mime = match ext(&p).as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "webp" => "image/webp",
            "ttf" => "font/ttf",
            "otf" => "font/otf",
            "woff2" => "font/woff2",
            _ => return Ok(Value::Null),
        };
        Ok(json!(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(fs::read(p).map_err(err)?)
        )))
    }
    pub fn rename(&self, p: &Path, name: &str) -> Result<Value> {
        let p = self.checked(p)?;
        let meta = files(&p)?
            .into_iter()
            .find(|f| ext(f) == "json")
            .ok_or("Thiếu metadata")?;
        let mut v = read(&meta)?;
        if !v.is_object() {
            return Err("Metadata không hợp lệ".into());
        }
        v["name"] = json!(name);
        write(&meta, &v)?;
        Ok(json!({"success":true}))
    }
    pub fn delete(&mut self, p: &Path) -> Result<Value> {
        let p = self.checked(p)?;
        preset(&p)?;
        fs::remove_dir_all(&p).map_err(err)?;
        self.known.remove(&p);
        Ok(json!({"success":true}))
    }
    pub fn font_action(&self, p: &Path, fix: bool) -> Result<Value> {
        let p = self.checked(p)?;
        let v = preset(&p)?;
        let mut analysis = Vec::new();
        let mut changes = HashMap::new();
        let mut missing = Vec::new();
        let wanted: HashSet<_> = list(&v["texts"])
            .iter()
            .filter(|t| t["isFontBroken"] == true)
            .map(|t| string(t, "fontFilename").to_lowercase())
            .collect();
        let mut found = HashMap::new();
        if !wanted.is_empty() {
            for root in &self.fonts {
                for e in WalkDir::new(root)
                    .max_depth(6)
                    .into_iter()
                    .flatten()
                    .filter(|e| e.file_type().is_file())
                {
                    let key = e.file_name().to_string_lossy().to_lowercase();
                    if wanted.contains(&key) {
                        found.entry(key).or_insert_with(|| e.into_path());
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        for t in list(&v["texts"])
            .iter()
            .filter(|t| t["isFontBroken"] == true)
        {
            let name = string(t, "fontFilename");
            let from = string(t, "fontPath");
            let to = found.get(&name.to_lowercase());
            if let Some(path) = to {
                changes.insert(
                    from.replace('\\', "/"),
                    path.to_string_lossy().replace('\\', "/"),
                );
            }
            if seen.insert(name) {
                analysis.push(json!({"filename":name,"originalPath":from,"foundPath":to,"found":to.is_some()}));
                if to.is_none() {
                    missing.push(name);
                }
            }
        }
        if !fix {
            return Ok(json!(analysis));
        }
        let mut fixed = 0;
        for file in [draft(&p), p.join("preset_draft/template-2.tmp")] {
            if changes.is_empty() || !file.exists() {
                continue;
            }
            let old = fs::read(&file).map_err(err)?;
            let mut v: Value = serde_json::from_slice(&old).map_err(err)?;
            if patch_fonts(&mut v, &changes) {
                edit(&file, &old, &v)?;
                fixed += 1;
            }
        }
        Ok(
            json!({"presetId":v["id"],"totalBroken":v["brokenFontCount"],"fixed":fixed,"stillMissing":missing}),
        )
    }
    pub fn list_projects(&mut self) -> Result<Value> {
        let root = self.drafts.join("root_meta_info.json");
        if !root.exists() {
            return Ok(json!([]));
        }
        let m = read(&root)?;
        let mut rows = Vec::new();
        self.projects.clear();
        for item in list(&m["all_draft_store"]) {
            let path = Path::new(string(item, "draft_json_file"));
            if !path.is_file() {
                continue;
            }
            self.projects.insert(path.canonicalize().map_err(err)?);
            rows.push(json!({"id":item["draft_id"],"name":item["draft_name"],"folderPath":item["draft_fold_path"],"jsonPath":path,"coverPath":string(item,"draft_cover"),"lastModifiedMs":item["tm_draft_modified"].as_i64().or(item["tm_draft_create"].as_i64()).unwrap_or(0)/1000,"durationMs":item["tm_duration"].as_i64().unwrap_or(0)/1000}));
        }
        rows.sort_by_key(|v| std::cmp::Reverse(v["lastModifiedMs"].as_i64()));
        Ok(json!(rows))
    }
    pub fn inject(&self, p: &Path, target: &Path, ms: f64) -> Result<Value> {
        let p = self.checked(p)?;
        let target = target.canonicalize().map_err(err)?;
        if !self.projects.contains(&target) {
            return Err("Dự án chưa được liệt kê".into());
        }
        let old = fs::read(&target).map_err(err)?;
        let mut dst: Value = serde_json::from_slice(&old).map_err(err)?;
        if !dst.is_object() || !(dst["materials"].is_object() || dst["materials"].is_null()) {
            return Err("Dự án không hợp lệ".into());
        }
        let (mut tracks, mats, _) = content(&p)?;
        let count = tracks.len();
        for (key, items) in mats.as_object().ok_or("Materials không hợp lệ")? {
            let target = &mut dst["materials"][key];
            if target.is_null() {
                *target = json!([]);
            }
            let array = target.as_array_mut().ok_or("Materials đích không hợp lệ")?;
            for m in list(items) {
                if !array.iter().any(|i| i["id"] == m["id"]) {
                    array.push(m.clone());
                }
            }
        }
        for t in &mut tracks {
            t["id"] = json!(id());
            if let Some(s) = t["segments"].as_array_mut() {
                for seg in s {
                    seg["id"] = json!(id());
                    if seg.pointer("/target_timerange/duration").is_some() {
                        seg["target_timerange"]["start"] = json!((ms * 1000.).round() as i64);
                    }
                }
            }
        }
        if dst["tracks"].is_null() {
            dst["tracks"] = json!([]);
        }
        dst["tracks"]
            .as_array_mut()
            .ok_or("Tracks không hợp lệ")?
            .extend(tracks);
        edit(&target, &old, &dst)?;
        Ok(
            json!({"success":true,"tracksAdded":count,"projectName":target.parent().and_then(Path::file_name).and_then(|name|name.to_str())}),
        )
    }
    pub fn create(&mut self, p: &Path, name: Option<&str>) -> Result<Value> {
        let p = self.checked(p)?;
        let preset = preset(&p)?;
        let name = name
            .filter(|s| !s.is_empty())
            .unwrap_or(string(&preset, "name"));
        if name.contains(['/', '\\', '\0']) {
            return Err("Tên dự án không hợp lệ".into());
        }
        let (tracks, mats, duration) = content(&p)?;
        fs::create_dir_all(&self.drafts).map_err(err)?;
        let root = self.drafts.join("root_meta_info.json");
        let old = if root.exists() {
            Some(fs::read(&root).map_err(err)?)
        } else {
            None
        };
        let mut index = if let Some(ref s) = old {
            serde_json::from_slice(s).map_err(err)?
        } else {
            json!({"all_draft_store":[],"draft_ids":0})
        };
        if !index.is_object() {
            return Err("Metadata dự án không hợp lệ".into());
        }
        let base = format!("[PRESET] {name}");
        let mut name = base.clone();
        for n in 2.. {
            match fs::create_dir(self.drafts.join(&name)) {
                Ok(()) => break,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                    name = format!("{base} ({n})")
                }
                Err(e) => return Err(err(e)),
            }
        }
        let dest = self.drafts.join(&name);
        let result = (|| {
            let mut d: Value = serde_json::from_str(include_str!("draft.json")).map_err(err)?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(err)?
                .as_micros() as u64;
            d["name"] = json!(name);
            d["id"] = json!(id());
            d["tracks"] = json!(tracks);
            d["materials"] = mats;
            d["materials"]["videos"] = json!([]);
            d["materials"]["audios"] = json!([]);
            d["duration"] = json!(duration);
            d["create_time"] = json!(now / 1000000);
            d["update_time"] = d["create_time"].clone();
            if cfg!(target_os = "macos") {
                d["platform"]["os"] = json!("mac");
                d["last_modified_platform"]["os"] = json!("mac");
            }
            let file = dest.join("draft_content.json");
            write(&file, &d)?;
            let mut e: Value = serde_json::from_str(include_str!("entry.json")).map_err(err)?;
            if let Some(cover) = preset["thumbnailPath"].as_str().filter(|s| !s.is_empty()) {
                let target = dest.join("draft_cover.jpg");
                fs::copy(cover, &target).map_err(err)?;
                e["draft_cover"] = json!(target.to_string_lossy().replace('\\', "/"));
            }
            e["draft_id"] = d["id"].clone();
            e["draft_name"] = json!(name);
            e["draft_json_file"] = json!(file.to_string_lossy().replace('\\', "/"));
            e["draft_fold_path"] = json!(dest.to_string_lossy().replace('\\', "/"));
            e["draft_root_path"] = json!(self.drafts.to_string_lossy().replace('\\', "/"));
            e["tm_duration"] = json!(duration);
            e["tm_draft_create"] = json!(now);
            e["tm_draft_modified"] = json!(now);
            if index["all_draft_store"].is_null() {
                index["all_draft_store"] = json!([]);
            }
            index["all_draft_store"]
                .as_array_mut()
                .ok_or("Danh sách dự án không hợp lệ")?
                .insert(0, e);
            index["draft_ids"] = json!(index["draft_ids"].as_u64().unwrap_or(0) + 1);
            if let Some(ref original) = old {
                edit(&root, original, &index)?;
            } else {
                write(&root, &index)?;
            }
            Ok(json!({"success":true,"projectName":name,"projectFolder":dest}))
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&dest);
        }
        result
    }
    pub fn export(&self, p: &Path, dest: &Path) -> Result<Value> {
        let p = self.checked(p)?;
        if dest
            .parent()
            .ok_or("Invalid destination")?
            .canonicalize()
            .map_err(err)?
            .starts_with(&p)
        {
            return Err("Không thể lưu ZIP bên trong thư mục preset".into());
        }
        let mut tmp = tempfile::NamedTempFile::new_in(dest.parent().unwrap()).map_err(err)?;
        let mut archive = zip::ZipWriter::new(tmp.as_file_mut());
        let options = zip::write::SimpleFileOptions::default();
        for entry in WalkDir::new(&p).min_depth(1) {
            let entry = entry.map_err(err)?;
            let name = entry
                .path()
                .strip_prefix(&p)
                .map_err(err)?
                .to_string_lossy()
                .replace('\\', "/");
            if entry.file_type().is_dir() {
                archive.add_directory(name, options).map_err(err)?;
            } else if entry.file_type().is_file() {
                archive.start_file(name, options).map_err(err)?;
                io::copy(
                    &mut fs::File::open(entry.path()).map_err(err)?,
                    &mut archive,
                )
                .map_err(err)?;
            }
        }
        archive.finish().map_err(err)?;
        tmp.persist(dest).map_err(err)?;
        Ok(json!({"success":true,"path":dest}))
    }
}
fn id() -> String {
    uuid::Uuid::new_v4().to_string().to_uppercase()
}
fn content(p: &Path) -> Result<(Vec<Value>, Value, i64)> {
    let raw = read(&draft(p))?;
    let src = raw
        .pointer("/materials/drafts/0/draft")
        .filter(|v| v.is_object())
        .unwrap_or(&raw);
    let all = list(&src["tracks"]);
    let mut tracks: Vec<_> = all
        .iter()
        .filter(|t| {
            matches!(string(t, "type"), "text" | "effect" | "sticker")
                && !list(&t["segments"]).is_empty()
        })
        .cloned()
        .collect();
    if tracks.is_empty() {
        tracks = all.to_vec();
    }
    if tracks.is_empty() {
        return Err("Preset không có track".into());
    }
    if tracks.iter().any(|track| {
        !track.is_object()
            || list(&track["segments"])
                .iter()
                .any(|segment| !segment.is_object())
    }) {
        return Err("Track không hợp lệ".into());
    }
    let mut mats = json!({});
    for key in [
        "texts",
        "material_animations",
        "video_effects",
        "effects",
        "stickers",
        "speeds",
        "placeholder_infos",
        "canvases",
        "chromas",
    ] {
        if !list(&src["materials"][key]).is_empty() {
            mats[key] = src["materials"][key].clone();
        }
    }
    Ok((
        tracks,
        mats,
        src["duration"]
            .as_i64()
            .filter(|d| *d > 0)
            .unwrap_or(3000000),
    ))
}
fn patch_fonts(v: &mut Value, changes: &HashMap<String, String>) -> bool {
    match v {
        Value::String(s) => {
            if let Some(to) = changes.get(&s.replace('\\', "/")) {
                *s = to.clone();
                true
            } else if s.starts_with('{') {
                if let Ok(mut nested) = serde_json::from_str(s) {
                    if patch_fonts(&mut nested, changes) {
                        *s = nested.to_string();
                        return true;
                    }
                }
                false
            } else {
                false
            }
        }
        Value::Array(a) => a
            .iter_mut()
            .fold(false, |changed, v| patch_fonts(v, changes) || changed),
        Value::Object(o) => o
            .values_mut()
            .fold(false, |changed, v| patch_fonts(v, changes) || changed),
        _ => false,
    }
}
