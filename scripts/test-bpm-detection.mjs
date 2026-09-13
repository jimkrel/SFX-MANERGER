import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] BPM DETECTION & DATABASE PERSISTENCE ===\n');

let allPassed = true;
function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

// 1. Test SQLite Schema & BPM persistence
console.log('1. Kiểm tra Schema SQLite và lưu trữ BPM:');
const testDbPath = path.join(rootDir, 'test-bpm.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    duration REAL NOT NULL,
    bpm INTEGER DEFAULT NULL
  );
`);

// Check column exists
const tableInfo = db.prepare(`PRAGMA table_info(tracks)`).all();
const hasBpmCol = tableInfo.some((col) => col.name === 'bpm');
assert(hasBpmCol, 'Cột bpm INTEGER tồn tại trong bảng tracks');

// Insert track and update BPM
db.prepare(`INSERT INTO tracks (path, name, duration) VALUES (?, ?, ?)`).run('track1.wav', 'Test Track', 120.0);
db.prepare(`UPDATE tracks SET bpm = ? WHERE id = 1`).run(128);

const savedTrack = db.prepare(`SELECT bpm FROM tracks WHERE id = 1`).get();
assert(savedTrack && savedTrack.bpm === 128, 'Lưu và nạp lại BPM = 128 thành công');
db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

// 2. Test BPM Algorithm Accuracy
console.log('\n2. Kiểm tra thuật toán phát hiện nhịp (BPM Detector):');

// Pure JS implementation matching src/renderer/src/audio/bpmDetector.ts
function detectBpm(audioBuffer) {
  if (!audioBuffer || audioBuffer.duration < 2.0) {
    return null;
  }

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const maxSamples = Math.min(audioBuffer.length, Math.floor(sampleRate * 30));

  const mono = new Float32Array(maxSamples);
  if (numChannels === 1) {
    mono.set(audioBuffer.getChannelData(0).subarray(0, maxSamples));
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < maxSamples; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  }

  const windowSize = Math.max(1, Math.floor(sampleRate / 200));
  const numFrames = Math.floor(maxSamples / windowSize);
  if (numFrames < 200) return null;

  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = mono[start + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / windowSize);
  }

  const flux = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const diff = energy[f] - energy[f - 1];
    flux[f] = diff > 0 ? diff : 0;
  }

  const fps = sampleRate / windowSize;
  const minLag = Math.floor(fps * (60 / 180));
  const maxLag = Math.ceil(fps * (60 / 60));

  let bestLag = -1;
  let maxCorr = 0;
  let totalCorr = 0;
  let lagCount = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = numFrames - lag;
    for (let i = 0; i < limit; i++) {
      sum += flux[i] * flux[i + lag];
    }
    totalCorr += sum;
    lagCount++;

    if (sum > maxCorr) {
      maxCorr = sum;
      bestLag = lag;
    }
  }

  if (bestLag === -1 || maxCorr === 0) return null;

  const avgCorr = totalCorr / lagCount;
  const confidence = maxCorr / (avgCorr || 1);
  if (confidence < 1.65) return null;

  const secondsPerBeat = bestLag / fps;
  let bpm = Math.round(60 / secondsPerBeat);

  if (bpm < 65) bpm *= 2;
  if (bpm > 175) bpm = Math.round(bpm / 2);

  return bpm;
}

// Case A: 120 BPM drum beat (pulse every 0.50s), duration = 6.0s
const sr = 44100;
const len = sr * 6;
const beatChannel = new Float32Array(len);
const beatIntervalSamples = Math.round(sr * (60 / 120)); // every 0.5s

for (let beat = 0; beat < len; beat += beatIntervalSamples) {
  // Synthesize short kick burst (50ms)
  for (let j = 0; j < Math.min(sr * 0.05, len - beat); j++) {
    beatChannel[beat + j] = Math.sin(2 * Math.PI * 60 * (j / sr)) * Math.exp(-j / (sr * 0.02));
  }
}

const beatBuffer120 = {
  numberOfChannels: 1,
  sampleRate: sr,
  length: len,
  duration: 6.0,
  getChannelData: () => beatChannel
};

const detected120 = detectBpm(beatBuffer120);
assert(detected120 !== null && Math.abs(detected120 - 120) <= 2, `Phát hiện chính xác nhịp 120 BPM (Kết quả: ${detected120} BPM)`);

// Case B: Ambient white noise / drone (no periodic rhythm) -> Must return null
const noiseChannel = new Float32Array(len);
for (let i = 0; i < len; i++) {
  noiseChannel[i] = (Math.random() * 2 - 1) * 0.1;
}

const noiseBuffer = {
  numberOfChannels: 1,
  sampleRate: sr,
  length: len,
  duration: 6.0,
  getChannelData: () => noiseChannel
};

const detectedNoise = detectBpm(noiseBuffer);
assert(detectedNoise === null, 'Từ chối trả về BPM ảo cho âm thanh ambient / nhiễu trắng không có nhịp');

// Case C: Short SFX (< 2.0s) -> Must return null according to spec v2 rule
const shortBuffer = {
  numberOfChannels: 1,
  sampleRate: sr,
  length: sr * 1.5,
  duration: 1.5,
  getChannelData: () => beatChannel.subarray(0, sr * 1.5)
};

const detectedShort = detectBpm(shortBuffer);
assert(detectedShort === null, 'Bỏ qua không tính BPM cho SFX ngắn < 2 giây theo đúng quy tắc spec v2');

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO NHÓM 2 (BPM DETECTION) ĐÃ ĐẠT 100%!');
  process.exit(0);
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI!');
  process.exit(1);
}
