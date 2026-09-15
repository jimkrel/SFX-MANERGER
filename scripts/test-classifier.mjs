import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let classify;
try {
  const mod = require(path.resolve(__dirname, "../dist/main/classifier.js"));
  classify = mod.classifyTrackAudio;
  console.log("Loaded classifier\n");
} catch (e) { console.error("Load failed:", e.message); process.exit(1); }
let passed = 0, failed = 0;
function test(label, input, expected) {
  const result = classify(input);
  if (result === expected) { console.log("  OK " + label); passed++; }
  else { console.log("  FAIL " + label + " -- expected " + expected + ", got " + result); failed++; }
}
console.log("=== Metadata ===");
test("Genre Pop -> Music", { filePath: "/s/t.mp3", name: "t", duration: 180, genre: "Pop" }, "Music");
test("Artist present -> Music", { filePath: "/s/song.wav", name: "song", duration: 210, artist: "Ngoc Son" }, "Music");
console.log("=== VN Music Keywords ===");
test("Nhac piano -> Music", { filePath: "/SFX/Nhac piano.mp3", name: "Nhac piano luc LTK", duration: 130 }, "Music");
test("Nhac pinano -> Music (không match nhầm 'no')", { filePath: "/media/Nhạc pinano.mp3", name: "Nhạc pinano", duration: 15 }, "Music");
test("piano solo -> Music (không match nhầm 'no')", { filePath: "/media/piano solo.wav", name: "piano solo", duration: 20 }, "Music");
test("melody_loop_01 -> Music", { filePath: "/music/melody_loop_01.wav", name: "melody_loop_01", duration: 60 }, "Music");
console.log("=== Artist / Layer Priority ===");
test("SFX clearly named with unknown artist -> SFX (artist không đè tên SFX)", { filePath: "/sfx/whoosh.wav", name: "whoosh_001", duration: 1.5, artist: "Random Composer" }, "SFX");
test("SFX punch with producer artist -> SFX (artist không đè tên SFX)", { filePath: "/audio/punch.wav", name: "heavy punch hit", duration: 2.0, artist: "Epic Sound Lab" }, "SFX");
test("No keyword in filename with valid artist -> Music", { filePath: "/lib/audio_99.mp3", name: "audio_99", duration: 120, artist: "Son Tung MTP" }, "Music");
console.log("=== SFX Keywords ===");
test("whoosh -> SFX", { filePath: "/sfx/whoosh_001.wav", name: "whoosh_001", duration: 0.8 }, "SFX");
test("foley_footsteps -> SFX", { filePath: "/sfx/foley.wav", name: "foley_footsteps", duration: 2.1 }, "SFX");
test("explosion -> SFX", { filePath: "/sfx/exp.wav", name: "explosion_big", duration: 1.8 }, "SFX");
console.log("=== Folder Heuristics ===");
test("/music/ folder -> Music", { filePath: "/library/music/track_001.wav", name: "track_001", duration: 45 }, "Music");
test("/bgm/ folder -> Music", { filePath: "/project/bgm/loop.wav", name: "loop", duration: 60 }, "Music");
console.log("=== Duration Fallback ===");
test("0.3s -> SFX", { filePath: "/library/sound_001.wav", name: "sound_001", duration: 0.3 }, "SFX");
test("180s -> Music", { filePath: "/library/track_a.wav", name: "track_a", duration: 180 }, "Music");
test("240s in /SFX/ -> Music", { filePath: "/SFX/long_ambient.wav", name: "long_ambient_background", duration: 240 }, "Music");
console.log("=== Edge cases & Homophones ===");
test("Track 01 (1.2s) -> SFX (không match nhầm keyword 'track')", { filePath: "/s/Track 01.wav", name: "Track 01", duration: 1.2 }, "SFX");
test("Tiếng Nổ impact căng căng -> SFX", { filePath: "/s/Tiếng Nổ impact căng căng.mp3", name: "Tiếng Nổ impact căng căng", duration: 4.9 }, "SFX");
test("Nhạc Lê Tuấn Khang quảng cáo hóng coi -> Music (không match nhầm 'coi')", { filePath: "/s/nhac.mp3", name: "Nhạc Lê Tuấn Khang quảng cáo, hóng coi quảng cáo cái gì", duration: 15 }, "Music");
test("No Love (200s) -> Music (không match nhầm 'no')", { filePath: "/s/No Love.mp3", name: "No Love", duration: 200 }, "Music");
test("Mùa thu lá bay (210s) -> Music (không match nhầm 'mua')", { filePath: "/s/Mua thu la bay.mp3", name: "Mùa thu lá bay", duration: 210 }, "Music");
test("Tiếng mưa rơi (20s) -> SFX", { filePath: "/s/Tiếng mưa rơi.wav", name: "Tiếng mưa rơi", duration: 20 }, "SFX");

const total = passed + failed;
console.log("\nResults: " + passed + "/" + total + " passed");
if (failed === 0) { console.log("ALL TESTS PASSED!"); process.exit(0); }
else { console.log(failed + " test(s) FAILED"); process.exit(1); }
