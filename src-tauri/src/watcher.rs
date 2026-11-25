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
                        if discover || paths.is_none() || Instant::now() >= heartbeat {
                            heartbeat = Instant::now() + Duration::from_secs(30);
                            // Include paths from the same event batch when it coincides with the heartbeat.
                            indexer::reconcile(
                                &mut db,
                                discover || paths.as_ref().is_none_or(|p| !p.is_empty()),
                            )
                        } else {
                            indexer::apply_events(&mut db, &roots, paths.unwrap_or_default())
                        }
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
