use sfx_music_manager::transfer::{BounceCache,drag_paths,save_export,stage_external};
use std::fs;

#[test]
fn cache_rejects_jobs_from_before_source_edit_or_clear(){
    let dir=tempfile::tempdir().unwrap();let source=dir.path().join("Tiếng gió.mp3");fs::write(&source,b"original").unwrap();
    let cache_dir=dir.path().join("cache");
    let mut cache=BounceCache::open(cache_dir.clone()).unwrap();
    let old=cache.check(&source).unwrap();assert_eq!(old["cached"],false);
    let bytes=[9u8;52];
    let p=cache.save(&source,&bytes,old["sourceToken"].as_str()).unwrap().unwrap();
    assert_eq!(fs::read(&p).unwrap(),bytes);
    assert_eq!(cache.check(&source).unwrap()["cached"],true);
    fs::write(&source,b"edited file").unwrap();
    assert_eq!(cache.check(&source).unwrap()["cached"],false);
    assert!(cache.save(&source,&bytes,old["sourceToken"].as_str()).unwrap().is_none());
    let next=cache.check(&source).unwrap();
    fs::write(cache_dir.join("unrelated"),b"keep").unwrap();
    let cleared=cache.clear().unwrap();assert_eq!(cleared["cleared"],1);assert_eq!(cleared["freedBytes"],52);
    assert!(cache_dir.join("unrelated").exists());
    assert!(cache.save(&source,&bytes,next["sourceToken"].as_str()).unwrap().is_none());
}

#[test]
fn exports_replace_exact_bytes_and_drag_preserves_file_identity(){
    let dir=tempfile::tempdir().unwrap();
    let root=dir.path();
    let a=root.join("Đêm.mp3");
    let b=root.join("second").join("Đêm.mp3");
    fs::create_dir(b.parent().unwrap()).unwrap();
    fs::write(&a,b"one").unwrap();fs::write(&b,b"two").unwrap();
    let files=drag_paths(&[a.clone(),a.clone(),root.join("missing"),b.clone()],None);
    assert_eq!(files,[a.clone(),b.clone()]);
    let stage=root.join("fast-drop");
    let pa=stage_external(&a,&stage).unwrap();let pb=stage_external(&b,&stage).unwrap();
    assert_ne!(pa,pb);assert_eq!(pa.file_name(),a.file_name());assert_eq!(fs::read(pa).unwrap(),b"one");
    assert_eq!(fs::read(&pb).unwrap(),b"two");
    fs::write(&a,b"longer").unwrap();let revised=stage_external(&a,&stage).unwrap();
    assert_eq!(fs::read(revised).unwrap(),b"longer");
    let export=root.join("export.wav");
    save_export(&export,b"longer bytes").unwrap();save_export(&export,b"new").unwrap();
    assert_eq!(fs::read(export).unwrap(),b"new");
}
