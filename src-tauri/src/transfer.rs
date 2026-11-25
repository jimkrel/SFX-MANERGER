use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tempfile::NamedTempFile;

fn fingerprint(path: &Path) -> io::Result<String> {
    let absolute = fs::canonicalize(path)?;
    let m = fs::metadata(&absolute)?;
    if !m.is_file() {
        return Err(io::Error::other("Expected a regular file"));
    }
    let mut hash = Sha256::new();
    hash.update(absolute.as_os_str().as_encoded_bytes());
    hash.update(m.len().to_le_bytes());
    hash.update(format!("{:?}", m.modified()?));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        hash.update(m.ctime().to_le_bytes());
        hash.update(m.ctime_nsec().to_le_bytes());
    }
    #[cfg(windows)]
    hash.update(format!("{:?}", m.created()?));
    Ok(format!("{:x}", hash.finalize()))
}

pub fn save_export(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut temp = NamedTempFile::new_in(
        target
            .parent()
            .ok_or_else(|| io::Error::other("Invalid export path"))?,
    )?;
    temp.write_all(bytes)?;
    temp.persist(target)?;
    Ok(())
}

pub struct BounceCache {
    directory: PathBuf,
    generation: u64,
}
impl BounceCache {
    pub fn open(directory: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let mut cache = Self {
            directory,
            generation: 0,
        };
        cache.remove(Some(Duration::from_secs(86400)))?;
        Ok(cache)
    }
    fn destination(&self, source: &Path) -> io::Result<(PathBuf, String)> {
        let key = fingerprint(source)?;
        let stem: String = source
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .chars()
            .take(40)
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let path = self.directory.join(format!("{stem}_{key}_48k16b.wav"));
        Ok((path, format!("{}:{key}", self.generation)))
    }
    pub fn check(&self, source: &Path) -> io::Result<Value> {
        let (p, token) = self.destination(source)?;
        Ok(
            json!({"cached":fs::metadata(&p).is_ok_and(|m|m.is_file() && m.len()>44),"bouncedPath":p,"bouncePath":p,"sourceToken":token}),
        )
    }
    pub fn save(
        &self,
        source: &Path,
        bytes: &[u8],
        token: Option<&str>,
    ) -> io::Result<Option<PathBuf>> {
        let (p, current) = self.destination(source)?;
        if token.is_some_and(|t| t != current) {
            return Ok(None);
        }
        let mut tmp = NamedTempFile::new_in(&self.directory)?;
        tmp.write_all(bytes)?;
        if self.destination(source)?.1 != current {
            return Ok(None);
        }
        tmp.persist(&p)?;
        Ok(Some(p))
    }
    fn remove(&mut self, older_than: Option<Duration>) -> io::Result<Value> {
        let (mut count, mut bytes) = (0u64, 0u64);
        for item in fs::read_dir(&self.directory)? {
            let entry = item?;
            let p = entry.path();
            if !p
                .file_name()
                .is_some_and(|s| s.to_string_lossy().ends_with("_48k16b.wav"))
            {
                continue;
            }
            let Ok(m) = entry.metadata() else { continue };
            if older_than.is_some_and(|age| {
                !m.modified()
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|elapsed| elapsed > age)
            }) {
                continue;
            }
            if fs::remove_file(p).is_ok() {
                count += 1;
                bytes += m.len();
            }
        }
        Ok(json!({"cleared":count,"clearedCount":count,"freedBytes":bytes,"totalBytes":bytes}))
    }
    pub fn clear(&mut self) -> io::Result<Value> {
        self.generation += 1;
        self.remove(None)
    }
}

/// Preserve the original filename and extension, including when two external volumes use the same name.
pub fn stage_external(source: &Path, root: &Path) -> io::Result<PathBuf> {
    let key = fingerprint(source)?;
    let dir = root.join(&key);
    let dest = dir.join(
        source
            .file_name()
            .ok_or_else(|| io::Error::other("Missing filename"))?,
    );
    if dest.is_file() && fs::metadata(&dest)?.len() == fs::metadata(source)?.len() {
        return Ok(dest);
    }
    fs::create_dir_all(&dir)?;
    let mut temp = NamedTempFile::new_in(&dir)?;
    io::copy(&mut fs::File::open(source)?, &mut temp)?;
    if fingerprint(source)? != key {
        return Err(io::Error::other("Source changed during drag preparation"));
    }
    temp.persist(&dest)?;
    Ok(dest)
}

pub fn drag_paths(inputs: &[PathBuf], stage: Option<&Path>) -> Vec<PathBuf> {
    let mut result = Vec::new();
    for file in inputs.iter().filter(|p| p.is_absolute() && p.is_file()) {
        let path = if let Some(dir) = stage.filter(|_| file.starts_with("/Volumes")) {
            stage_external(file, dir).unwrap_or_else(|_| file.clone())
        } else {
            file.clone()
        };
        if !result.contains(&path) {
            result.push(path);
        }
    }
    result
}
