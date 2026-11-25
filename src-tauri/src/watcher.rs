use crate::indexer;
use notify::{EventKind, RecursiveMode, Watcher};
use rusqlite::Connection;
use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub struct LibraryWatcher {
    stop: Arc<AtomicBool>,
    wake: mpsc::SyncSender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl LibraryWatcher {
    pub fn start(
        db: Arc<Mutex<Connection>>,
        changed: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let (wake, events) = mpsc::sync_channel(1);
        let callback = wake.clone();
        // None requests full reconciliation after overflow or OS notification loss.
        let pending = Arc::new(Mutex::new(Some(BTreeSet::<PathBuf>::new())));
        let queued = Arc::clone(&pending);
        let mut watcher=notify::recommended_watcher(move |event:notify::Result<notify::Event>| {
            // Reading metadata or decoding media can itself generate access events.
            if matches!(event, Ok(ref e) if !e.need_rescan() && matches!(e.kind,EventKind::Access(_))) {return;}
            if let Ok(mut queue)=queued.lock(){
                match event {
                    Ok(e) if !e.need_rescan() && !e.paths.is_empty()=>{
                        if let Some(paths)=queue.as_mut(){
                            paths.extend(e.paths);
                            if paths.len()>4096 { *queue=None; }
                        }
                    }
                    _=>*queue=None,
                }
            }
            let _=callback.try_send(());
        }).map_err(|e|e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("library-watcher".into())
            .spawn(move || {
                let mut watching = BTreeSet::<PathBuf>::new();
                let mut heartbeat = Instant::now();
                let mut initial = true;
                while !stopping.load(Ordering::Acquire) {
                    let outcome = (|| {
                        let mut db = db
                            .lock()
                            .map_err(|_| "Library scanner stopped".to_owned())?;
                        let roots = indexer::folders(&db)?;
                        for old in watching.clone() {
                            if !roots.contains(&old) || !old.is_dir() {
                                let _ = watcher.unwatch(&old);
                                watching.remove(&old);
                            }
                        }
                        let mut discover = initial;
                        for root in roots.difference(&watching).cloned().collect::<Vec<_>>() {
                            if root.is_dir() {
                                discover = true;
                                match watcher.watch(&root, RecursiveMode::Recursive) {
                                    Ok(()) => {
                                        watching.insert(root);
                                    }
                                    Err(e) => eprintln!("Cannot watch {}: {e}", root.display()),
                                }
                            }
                        }
                        // Reconcile after subscribing, including missed events on removable drives.
                        let paths = pending
                            .lock()
                            .map_err(|_| "Watcher queue stopped".to_string())?
                            .replace(BTreeSet::new());
                        initial = false;
                        process_pending(
                            &mut db,
                            &roots,
                            paths,
                            discover,
                            &mut heartbeat,
                            Instant::now(),
                        )
                    })();
                    match outcome {
                        Ok(r)
                            if ["missing", "imported", "recovered"]
                                .iter()
                                .any(|k| r[k].as_u64().unwrap_or(0) > 0) =>
                        {
                            changed()
                        }
                        Err(e) => eprintln!("Library watcher: {e}"),
                        _ => {}
                    }
                    if events.recv_timeout(Duration::from_secs(30)).is_ok() {
                        let deadline = Instant::now() + Duration::from_secs(2);
                        while !stopping.load(Ordering::Acquire)
                            && Instant::now() < deadline
                            && events.recv_timeout(Duration::from_millis(400)).is_ok()
                        {
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            stop,
            wake,
            thread: Some(thread),
        })
    }
    pub fn refresh(&self) {
        let _ = self.wake.try_send(());
    }
}
impl Drop for LibraryWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.refresh();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn process_pending(
    db: &mut Connection,
    roots: &BTreeSet<PathBuf>,
    paths: Option<BTreeSet<PathBuf>>,
    discover: bool,
    heartbeat: &mut Instant,
    now: Instant,
) -> Result<serde_json::Value, String> {
    if discover || paths.is_none() || now >= *heartbeat {
        *heartbeat = now + Duration::from_secs(30);
        indexer::reconcile(db, true)
    } else {
        indexer::apply_events(db, roots, paths.unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_imports_file_when_os_event_is_missed() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = crate::database::open(std::path::Path::new(":memory:")).unwrap();
        let folder = dir.path().to_owned();
        indexer::import_paths(&mut db, std::slice::from_ref(&folder));
        let roots = indexer::folders(&db).unwrap();
        assert!(roots.contains(&folder));
        let now = Instant::now();
        let deadline = now + Duration::from_secs(30);
        let mut heartbeat = deadline;
        std::fs::write(
            folder.join("missed.flac"),
            include_bytes!("../tests/audio/tone.flac"),
        )
        .unwrap();
        for (time, expected) in [(now, 0), (deadline, 1)] {
            let result = process_pending(
                &mut db,
                &roots,
                Some(BTreeSet::new()),
                false,
                &mut heartbeat,
                time,
            )
            .unwrap();
            assert_eq!(result["imported"], expected);
        }
        assert!(heartbeat > deadline);
        let tracks = crate::database::read(&db, "tracks", None).unwrap();
        assert_eq!(
            tracks[0]["path"],
            folder.join("missed.flac").to_str().unwrap()
        );
    }
}
