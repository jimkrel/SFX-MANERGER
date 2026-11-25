# Tauri migration — test branch

Baseline: Electron commit `51a92e9bbc5e2ec5a1569262a87f2cfe4bc3a5d1`.

This branch is an incomplete migration prototype. Do not use it as a replacement for the working Electron application. Tauri uses its own application data directory. On first launch with no Tauri library, it discovers the Electron library under the platform configuration directory and takes a read-only SQLite backup. Existing Tauri databases are upgraded in place.

| Phase | Status |
|---|---|
| 0 | Baseline and isolated local branch created; native performance baseline pending |
| 1 | Tauri configuration and initial renderer adapter; full command parity pending |
| 2 | Rust library database implemented and core-tested, including legacy import, schema upgrades, FTS, filters, stats, edits, type overrides, settings and versioned waveform cache. Native platform acceptance pending. |
| 3 | Indexer, native filesystem notifications, bounded parallel metadata reads, native file/folder dialogs, inbound drop handling and library update events implemented. Native desktop acceptance pending. |
| 4 | Binary audio reads, version checks and on-demand WAV peaks implemented. The existing Web Audio player passed a headless FLAC transport check. Native listening and waveform UI acceptance pending. |
| 5 | Converter wired to the native save dialog and atomic file writes. Bounce cache checks source revisions, invalidates stale jobs on clear and prunes old entries. |
| 6 | Native outbound copy drag wired for single and multiple files, including completion and cancellation. Finder/Explorer reveal, clipboard and external-volume staging implemented. Interactive OS and editor acceptance pending. |
| 7 | Quick Launcher window, cursor-display positioning, focus/blur, global shortcut, SQLite preference and macOS Accessibility implemented. Native platform acceptance pending. |
| 8 | Native downloader commands connected to the renderer. Local media extraction, conversion, job cancellation and file naming tested. Remote sites and tool installation on native hosts pending. |
| 9 | CapCut preset and project commands connected to the renderer. Synthetic preset and draft round trip passed. Opening the result in CapCut on Windows and macOS pending. |
| 10 | Automated regression suite passed on Linux. Windows x64 desktop target passed cargo check. Interactive Windows/macOS acceptance pending. |
| 11 | Linux x64 core benchmark and Electron query comparison recorded below. Native desktop startup and memory measurements pending. |
| 12 | Local automated acceptance passed. Native Windows and macOS jobs configured. Platform sign-off pending. |

Local checks: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run build:renderer`, `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features`. Desktop compilation requires the host platform's native development dependencies. The existing Electron commands and behavior remain available.

Run `npm run test:tauri:phase3` for the Rust indexer and renderer bridge tests. Linux verification covered native filesystem events, rename, removal, recovery, unwatch, overlapping directories with 69 files, corrupt and hidden files, metadata from all nine supported extensions, and invalidation of cached WAV peaks. The test clips under `src-tauri/tests/audio` contain a generated 440 Hz tone. The legacy waveform script passed under Node with a real AIFF fixture. The complete Rust suite passed all nine tests. The renderer typecheck and build passed. The desktop binary and tests passed cross-target cargo check for Windows x64 GNU. Interactive file dialogs and OS drag-and-drop still require native Windows and macOS acceptance.

Phase 2 integration tests cover Electron WAL snapshots, reopening after migration, failed-import retry, legacy tag formats, compound filters, transactional rollback, manual classification and stale analysis writes. When both supported Electron profile names contain a library, startup reports the ambiguity. Automatic import runs only when the destination database does not exist.

Phase 4 checks include a stereo PCM transient present only in the right channel, 800-bin cache creation, stale and missing file rejection, renderer playback controls, and Windows x64 cross-target compilation. Local headless playback used a silent output device and simulated IPC.

Phase 5–6 checks cover 16/24-bit WAV and four MP3 bitrates, binary IPC, cache invalidation, export replacement, same-name files from different folders and the drag callback. Twelve Rust tests passed on Linux. The Windows x64 desktop code passed cross-target cargo check. Actual drops into CapCut, Premiere and Resolve and native save dialogs still require interactive testing on Windows and macOS.

Phase 7 tests run with `npm run test:tauri:phase7`. A headless React check also exercised focus, keyboard navigation, debounced search and Escape. The Windows x64 desktop target passed cargo check. Test global hotkeys while another application is focused, multi-display placement, drag into an editor and macOS permission changes during native acceptance.

Run the Phase 10 regression suite with `npm run test:tauri:phase10`. The suite includes Rust tests for cancellation, malformed project data, JSON backups, font repair, ZIP contents and timeline insertion, plus five renderer bridge checks. The Windows and macOS workflow runs on pull requests to main or by manual dispatch.

A separate local integration test ran against a one-second H.264/AAC clip served over loopback HTTP. It invoked real yt-dlp and FFmpeg in all six modes, repeated the WAV download to check filename collisions, verified 48 kHz stereo PCM and 320 kbps MP3 with ffprobe, and indexed those files into fresh SQLite databases. To repeat with the same tools available on PATH, set `SFX_FIXTURE_URL` to a locally hosted MP4 clip and run `cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features --test media downloader_local_fixture -- --ignored`.

Native acceptance still needs a fresh tool installation, a download from each supported service and opening an exported or modified project in CapCut using a disposable copy of a real project. The low-resolution clip exercises the MP4 selectors but does not measure resolution selection against a multi-resolution stream.

## Phase 11 measurements

Linux x64, optimized Rust library, one local run. Each of five rounds opens a fresh database and imports 1,000 copies of the generated FLAC fixture from a temporary folder, rescans the folder, then executes 100 indexed searches returning 50 tracks each. File creation is outside the timed region. Filesystem pages may be cached. The Electron comparison calls the original database module under Node on a copy of the indexed catalog per round. Both search timings exclude desktop startup, IPC and rendering.

| Operation | Rust | Electron database under Node |
|---|---:|---:|
| Import 1,000 FLAC files, median | 251.18 ms | Unmeasured |
| Rescan unchanged folder, median | 14.23 ms | Unmeasured |
| Search, median of 500 queries | 0.481 ms | 0.469 ms |
| Search, 95th percentile | 0.694 ms | 0.784 ms |

Run `npm run bench:tauri:phase11` for Rust timings or `node scripts/benchmark-tauri-compare.mjs` for both search implementations. The comparison also needs the project's better-sqlite3 addon built for the current Node runtime.

## Phase 12 acceptance

Run `npm run test:tauri:phase12` with Node, Rust, Python, yt-dlp, FFmpeg and ffprobe on PATH. The command runs typechecking, the renderer build, the Rust and renderer regression suites, a comparison of exposed Electron and Tauri API keys, and the generated local media download test. The API comparison found two missing bindings, quit and elevation status, which now have regression coverage. On Linux x64 all 18 Rust tests (including the separately invoked media fixture) and six renderer checks passed. Cross-target cargo check covered the Windows x64 binary, tests and benchmark example.

The test-only CI workflow runs the suite, builds the native debug application and records the Rust benchmark on Windows x64, macOS Apple Silicon and macOS Intel. These jobs have not been executed on this local branch.

| Pending on each target OS | Acceptance evidence |
|---|---|
| Launch and library migration | Open a copy of an Electron profile, compare library counts and settings, restart and verify persistence. Measure time to usable library and whole-app idle memory for each app under the same conditions. |
| Playback, export and drag | Listen to previews, verify seek and waveform, save WAV/MP3 through the native dialog and drop a file in a real editor. |
| Launcher and permissions | Invoke the shortcut from another app, confirm display and focus, dismiss with Escape and check Windows elevation or macOS Accessibility state. |
| Downloader and CapCut | Install tools into a fresh profile, check each supported service, then open a disposable CapCut project and verify text, fonts and insertion time on its timeline. |

Release packaging, signing and publication are outside these tester phases.
