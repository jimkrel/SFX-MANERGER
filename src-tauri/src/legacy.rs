//! Take a coherent snapshot of the Electron library on first launch, including committed WAL pages.
use rusqlite::{backup::Backup, Connection, OpenFlags};
use std::{
    error::Error,
    fs, io,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub fn open_library(root: &Path, electron_data: &Path) -> Result<Connection, Box<dyn Error>> {
    fs::create_dir_all(root)?;
    let target = root.join("library.db");
    if !target.try_exists()? {
        let mut sources = Vec::new();
        for name in ["sfx-music-manager", "SFX Music Manager"] {
            let path = electron_data.join(name).join("library.db");
            if path.try_exists()? {
                sources.push(path);
            }
        }
        if sources.len() > 1 {
            return Err(
                "Two Electron libraries found. Choose one before importing into Tauri.".into(),
            );
        }
        if let Some(source) = sources.first() {
            let stage = root.join(format!(
                "library-{}-{}.tmp",
                std::process::id(),
                SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
            ));
            let original = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            original.prepare("SELECT id,path,name FROM tracks")?;
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&stage)?;
            let result = (|| -> Result<(), Box<dyn Error>> {
                let mut copy = Connection::open(&stage)?;
                Backup::new(&original, &mut copy)?.run_to_completion(
                    128,
                    Duration::from_millis(10),
                    None,
                )?;
                drop(copy);
                let migrated = crate::database::open(&stage)?;
                let check: String = migrated.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
                if check != "ok" {
                    return Err(check.into());
                }
                migrated.execute_batch("PRAGMA journal_mode=DELETE;")?;
                drop(migrated);
                match fs::hard_link(&stage, &target) {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => Ok(()),
                    Err(e) => Err(e.into()),
                }
            })();
            fs::remove_file(&stage)?;
            result?;
        }
    }
    Ok(crate::database::open(&target)?)
}
