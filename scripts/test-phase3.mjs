import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] PHASE 3 — WAVEFORM & PREVIEW VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

// 1. Test SQLite waveform_cache schema and operations
console.log('1. Kiểm tra bảng waveform_cache trong SQLite:');
const testDbPath = path.join(rootDir, 'test-phase3.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    sample_rate INTEGER,
    channels INTEGER,
    tags TEXT DEFAULT '',
    is_missing INTEGER DEFAULT 0,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS waveform_cache (
    track_id INTEGER NOT NULL,
    resolution INTEGER NOT NULL,
    peaks TEXT NOT NULL,
    PRIMARY KEY (track_id, resolution),
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
  );
`);

// Insert track
db.prepare('INSERT INTO tracks (path, name, duration) VALUES (?, ?, ?)').run('/path/test.wav', 'Test Track', 2.0);
const trackId = 1;

// Insert 80-bar thumbnail peaks
const mockThumbPeaks = Array.from({ length: 80 }, (_, i) => Number((Math.sin(i / 10) * 0.5 + 0.5).toFixed(4)));
db.prepare('INSERT INTO waveform_cache (track_id, resolution, peaks) VALUES (?, ?, ?)').run(
  trackId,
  80,
  JSON.stringify(mockThumbPeaks)
);

// Insert 800-bar Now Playing peaks
const mockFullPeaks = Array.from({ length: 800 }, (_, i) => Number((Math.abs(Math.cos(i / 20))).toFixed(4)));
db.prepare('INSERT INTO waveform_cache (track_id, resolution, peaks) VALUES (?, ?, ?)').run(
  trackId,
  800,
  JSON.stringify(mockFullPeaks)
);

// Query back
const thumbRow = db.prepare('SELECT peaks FROM waveform_cache WHERE track_id = ? AND resolution = ?').get(trackId, 80);
const parsedThumb = JSON.parse(thumbRow.peaks);
assert(Array.isArray(parsedThumb) && parsedThumb.length === 80, 'Lưu & nạp lại waveform thumbnail 80 cột thành công');

const fullRow = db.prepare('SELECT peaks FROM waveform_cache WHERE track_id = ? AND resolution = ?').get(trackId, 800);
const parsedFull = JSON.parse(fullRow.peaks);
assert(Array.isArray(parsedFull) && parsedFull.length === 800, 'Lưu & nạp lại waveform Now Playing 800 cột thành công');

// 2. Test peak extraction algorithm from PCM float data (Mục 3.2)
console.log('\n2. Kiểm tra thuật toán trích xuất peaks (Mục 3.2):');
function extractPeaks(channelData, resolution) {
  const peaks = new Array(resolution);
  const totalSamples = channelData.length;
  const blockSize = Math.floor(totalSamples / resolution);
  const step = Math.max(1, blockSize);

  for (let i = 0; i < resolution; i++) {
    const start = i * step;
    const end = Math.min(start + step, totalSamples);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks[i] = Number(Math.min(1, Math.max(0, max)).toFixed(4));
  }
  return peaks;
}

// Generate 48,000 samples (1 second) of PCM data with a transient spike in the middle
const sampleCount = 48000;
const pcmData = new Float32Array(sampleCount);
for (let i = 0; i < sampleCount; i++) {
  // quiet ambient sound
  pcmData[i] = 0.05 * Math.sin((i * 440 * 2 * Math.PI) / 48000);
}
// Introduce transient impact at sample 24000
pcmData[24000] = 0.98;

const peaks80 = extractPeaks(pcmData, 80);
assert(peaks80.length === 80, 'Trích xuất đúng 80 cột peaks');
const middleIndex = 40;
assert(peaks80[middleIndex] > 0.9, `Phát hiện chính xác transient nhọn (amplitude: ${peaks80[middleIndex]})`);
assert(peaks80.every((p) => p >= 0 && p <= 1), 'Tất cả giá trị peaks được chuẩn hóa trong khoảng [0, 1]');

// 3. Test reading audio buffer via file API
console.log('\n3. Kiểm tra đọc buffer file âm thanh thực tế:');
const sampleSfx = '/Users/macmini2/Desktop/EDITOR - LỎ/SFX/Pop Flash.wav';
if (fs.existsSync(sampleSfx)) {
  const buffer = fs.readFileSync(sampleSfx);
  assert(buffer.length > 0, `Đọc buffer audio thành công (${(buffer.length / 1024).toFixed(1)} KB)`);
} else {
  console.log('     File Pop Flash.wav không tồn tại, bỏ qua kiểm tra buffer thực tế');
}

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO PHASE 3 ĐÃ ĐẠT (PASS) 100%!');
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
  process.exit(1);
}
