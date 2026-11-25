//! Measure the library operations used by the desktop commands on a disposable catalog.
use serde_json::{json, Value};
use sfx_music_manager::{database, indexer};
use std::{fs, time::Instant};

fn timed<T>(action: impl FnOnce() -> T) -> (T, f64) {
    let start = Instant::now();
    let value = action();
    (value, start.elapsed().as_secs_f64() * 1000.0)
}

fn median(samples: &mut [f64]) -> f64 {
    samples.sort_by(f64::total_cmp);
    samples[samples.len() / 2]
}

fn main() {
    const COUNT: usize = 1000;
    const ROUNDS: usize = 5;
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().join("library");
    fs::create_dir(&folder).unwrap();
    let clip = include_bytes!("../tests/audio/tone.flac");
    for n in 0..COUNT {
        fs::write(
            folder.join(format!("Tone Group{:02} {n}.flac", n % 20)),
            clip,
        )
        .unwrap();
    }
    let mut imports = Vec::new();
    let mut rescans = Vec::new();
    let mut searches = Vec::new();
    for round in 0..ROUNDS {
        let mut db = database::open(&temp.path().join(format!("catalog-{round}.db"))).unwrap();
        let (result, elapsed) =
            timed(|| indexer::import_paths(&mut db, std::slice::from_ref(&folder)));
        assert_eq!(result["imported"], COUNT);
        assert_eq!(result["errors"], json!([]));
        imports.push(elapsed);
        let (result, elapsed) = timed(|| indexer::rescan(&mut db).unwrap());
        assert_eq!(result["errors"], json!([]));
        rescans.push(elapsed);
        // Optionally copy the same indexed rows for the Electron query comparison.
        if round == 0 {
            if let Some(snapshot) = std::env::var_os("SFX_BENCH_SNAPSHOT") {
                db.execute(
                    "VACUUM INTO ?1",
                    [snapshot.to_str().expect("UTF-8 snapshot path")],
                )
                .unwrap();
            }
        }
        for n in 0..100 {
            let query = json!({"searchQuery":format!("Group{:02}", n%20),"limit":50});
            let (rows, elapsed) = timed(|| database::read(&db, "tracks", Some(&query)).unwrap());
            assert_eq!(rows.as_array().map(Vec::len), Some(50));
            searches.push(elapsed);
        }
    }
    let search_median = median(&mut searches);
    let report: Value = json!({"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,
        "debug_assertions":cfg!(debug_assertions),"files":COUNT,"rounds":ROUNDS,"queries":searches.len(),
        "import_median_ms":median(&mut imports),"rescan_median_ms":median(&mut rescans),
        "search_median_ms":search_median,"search_p95_ms":searches[(searches.len()*95).div_ceil(100)-1]});
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}
