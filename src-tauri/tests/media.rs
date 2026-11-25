use serde_json::{json, Value};
use sfx_music_manager::{capcut::Catalog, downloader};
use std::{fs, path::Path};

#[test]
fn capcut_preset_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("Presets");
    let preset = root.join("P");
    let draft = preset.join("preset_draft");
    fs::create_dir_all(&draft).unwrap();
    let fonts = tmp.path().join("Fonts");
    fs::create_dir(&fonts).unwrap();
    fs::write(fonts.join("Test.ttf"), b"fixture").unwrap();
    fs::write(preset.join("meta.json"), br#"{"name":"Sample","id":"p"}"#).unwrap();
    fs::write(preset.join("cover.png"), b"png").unwrap();
    let content = json!({"materials":{"drafts":[{"draft":{"duration":2000000,"tracks":[{"type":"text","id":"track","segments":[{"id":"seg","material_id":"m","target_timerange":{"start":0,"duration":2000000}}]}],"materials":{"texts":[{"id":"m","font_path":"missing/Test.ttf","content":"{\"text\":\"Title\"}"}]}}}]}});
    for f in ["draft_content.json", "template-2.tmp"] {
        fs::write(draft.join(f), content.to_string()).unwrap();
    }
    let mut cat = Catalog::new(root, tmp.path().join("Projects"), vec![fonts]);
    let row = cat.scan(None).unwrap()[0].clone();
    assert_eq!(row["texts"][0]["parsedText"], "Title");
    assert_eq!(row["brokenFontCount"], 1);
    assert_eq!(
        cat.asset(&preset.join("cover.png")).unwrap(),
        "data:image/png;base64,cG5n"
    );
    assert_eq!(cat.font_action(&preset, false).unwrap()[0]["found"], true);
    assert_eq!(cat.font_action(&preset, true).unwrap()["fixed"], 2);
    assert_eq!(
        fs::read_to_string(draft.join("draft_content.json.bak")).unwrap(),
        content.to_string()
    );
    assert_eq!(cat.scan(None).unwrap()[0]["brokenFontCount"], 0);
    let project = cat.create(&preset, Some("Round trip")).unwrap();
    let copy = cat.create(&preset, Some("Round trip")).unwrap();
    assert_ne!(project["projectFolder"], copy["projectFolder"]);
    let rows = cat.list_projects().unwrap();
    let target = Path::new(rows[0]["jsonPath"].as_str().unwrap());
    let original = fs::read(target).unwrap();
    assert_eq!(cat.inject(&preset, target, 125.).unwrap()["tracksAdded"], 1);
    let edited: Value = serde_json::from_slice(&fs::read(target).unwrap()).unwrap();
    assert_eq!(
        edited["tracks"][1]["segments"][0]["target_timerange"]["start"],
        125000
    );
    assert_ne!(edited["tracks"][0]["id"], edited["tracks"][1]["id"]);
    assert_eq!(edited["materials"]["texts"].as_array().unwrap().len(), 1);
    assert_eq!(
        fs::read(target.with_extension("json.bak")).unwrap(),
        original
    );
    fs::write(target, br#"{"materials":[]}"#).unwrap();
    assert!(cat.inject(&preset, target, 0.).is_err());
    assert_eq!(fs::read(target).unwrap(), br#"{"materials":[]}"#);
    let zip = tmp.path().join("preset.zip");
    cat.export(&preset, &zip).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(zip).unwrap()).unwrap();
    assert!(archive.by_name("preset_draft/draft_content.json").is_ok());
    cat.rename(&preset, "Edited").unwrap();
    assert_eq!(cat.scan(None).unwrap()[0]["name"], "Edited");
    assert!(cat.delete(tmp.path()).is_err());
    cat.delete(&preset).unwrap();
    assert!(cat.scan(None).unwrap().as_array().unwrap().is_empty());
}
#[test]
fn downloader_urls() {
    assert_eq!(
        downloader::clean_url("https://www.youtube.com/watch?v=abc&list=x&index=2")
            .unwrap()
            .query(),
        Some("v=abc")
    );
    assert!(downloader::clean_url("file:///secret.wav").is_err());
}
#[test]
#[ignore = "requires local fixture HTTP server, yt-dlp and FFmpeg"]
fn downloader_local_fixture() {
    let bin = Path::new("/unused");
    let yt = downloader::binary(bin, "yt-dlp").unwrap();
    let ff = downloader::binary(bin, "ffmpeg").unwrap();
    let temp = tempfile::tempdir().unwrap();
    let url = std::env::var("SFX_FIXTURE_URL").unwrap();
    let info = downloader::info(&yt, &url).unwrap();
    assert_eq!(info["platform"], "generic");
    let jobs = downloader::Jobs::default();
    for fmt in [
        "wav",
        "mp3",
        "wav",
        "original",
        "mp4_720p",
        "mp4_1080p",
        "mp4_best",
    ] {
        let opts = downloader::Options {
            url: url.clone(),
            format: fmt.into(),
            output_dir: None,
            job_id: None,
        };
        let events = std::sync::Mutex::new(Vec::new());
        let out = downloader::download(&yt, Some(&ff), &opts, temp.path(), &jobs, |v| {
            events.lock().unwrap().push(v)
        })
        .unwrap();
        let path = Path::new(out["filePath"].as_str().unwrap());
        assert!(path.metadata().unwrap().len() > 0);
        if fmt == "mp3" || fmt == "wav" {
            assert_eq!(path.extension().unwrap(), fmt);
            let probe = std::process::Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_streams",
                    "-of",
                    "json",
                ])
                .arg(path)
                .output()
                .unwrap();
            assert!(probe.status.success());
            let streams: Value = serde_json::from_slice(&probe.stdout).unwrap();
            let audio = &streams["streams"][0];
            if fmt == "wav" {
                assert_eq!(audio["codec_name"], "pcm_s16le");
                assert_eq!(audio["channels"], 2);
                assert_eq!(audio["sample_rate"], "48000");
            } else {
                assert_eq!(audio["codec_name"], "mp3");
                assert_eq!(audio["bit_rate"], "320000");
            }
            let db_dir = tempfile::tempdir().unwrap();
            let mut db = sfx_music_manager::database::open(&db_dir.path().join("test.db")).unwrap();
            assert_eq!(
                sfx_music_manager::indexer::import_paths(&mut db, &[path.to_owned()])["imported"],
                1
            );
        }
        if fmt.starts_with("mp4") {
            assert_eq!(path.parent().unwrap().file_name().unwrap(), "Videos");
            assert_eq!(path.extension().unwrap(), "mp4");
        }
        let events = events.into_inner().unwrap();
        assert_eq!(events.first().unwrap()["status"], "starting");
        assert_eq!(events.last().unwrap()["status"], "completed");
        assert!(events.iter().all(|v| v["jobId"] == out["jobId"]));
    }
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 5);
}
#[cfg(unix)]
#[test]
fn cancel_running_download() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let yt = tmp.path().join("fake-yt");
    fs::write(&yt, "#!/bin/sh\nexec sleep 15\n").unwrap();
    fs::set_permissions(&yt, fs::Permissions::from_mode(0o700)).unwrap();
    let opt = downloader::Options {
        url: "https://example.org/test".into(),
        format: "original".into(),
        output_dir: None,
        job_id: Some("one".into()),
    };
    let jobs = downloader::Jobs::default();
    let start = std::time::Instant::now();
    let result = downloader::download(&yt, None, &opt, tmp.path(), &jobs, |event| {
        if event["status"] == "starting" {
            assert!(jobs.cancel("one"));
        }
    });
    assert!(result.is_err());
    assert!(start.elapsed().as_secs() < 10);
    assert!(!jobs.cancel("one"));
}
