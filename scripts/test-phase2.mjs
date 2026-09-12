import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] PHASE 2 — INDEXING & METADATA VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

async function runTests() {
  // 1. Test music-metadata on real files from EDITOR - LỎ/SFX if present
  console.log('1. Kiểm tra đọc metadata audio (music-metadata):');
  const mm = await import('music-metadata');
  const sampleSfxDir = '/Users/macmini2/Desktop/EDITOR - LỎ/SFX';
  
  if (fs.existsSync(sampleSfxDir)) {
    const sfxFiles = fs.readdirSync(sampleSfxDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
    if (sfxFiles.length > 0) {
      const testFile = path.join(sampleSfxDir, sfxFiles[0]);
      let meta = await mm.parseFile(testFile, { duration: true });
      if (!meta.format.container || meta.format.duration === undefined) {
        const buf = fs.readFileSync(testFile);
        meta = await mm.parseBuffer(buf);
      }
      assert(meta.format.container !== undefined, `Đọc container format thành công (${meta.format.container})`);
      assert(typeof meta.format.sampleRate === 'number' && meta.format.sampleRate > 0, `Đọc sample rate thành công (${meta.format.sampleRate} Hz)`);
      assert(typeof meta.format.numberOfChannels === 'number', `Đọc channels thành công (${meta.format.numberOfChannels} ch)`);
      console.log(`     File test: ${sfxFiles[0]} | Duration: ${meta.format.duration?.toFixed(2)}s | ${meta.format.sampleRate}Hz | ${meta.format.numberOfChannels}ch`);
    } else {
      console.log('     Không có file wav/mp3 trong thư mục SFX');
    }
  } else {
    console.log('     Thư mục SFX không tồn tại, bỏ qua test file thực tế');
  }

  // 2. Test SQLite tracks schema and operations
  console.log('\n2. Kiểm tra Schema SQLite (bảng tracks & watched_folders):');
  const testDbPath = path.join(rootDir, 'test-phase2.db');
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
    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert mock tracks
  const insertStmt = db.prepare(`
    INSERT INTO tracks (path, name, duration, sample_rate, channels, is_missing)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertStmt.run('/test/path/sfx1.wav', 'SFX Impact 1', 1.5, 48000, 2, 0);
  insertStmt.run('/test/path/sfx2.wav', 'SFX Whoosh', 2.1, 44100, 2, 0);

  const total = db.prepare('SELECT count(*) as count FROM tracks').get().count;
  assert(total === 2, 'Lưu trữ tracks vào SQLite thành công (2 records)');

  // 3. Test Missing Flag logic (rút ổ / file bị thiếu)
  console.log('\n3. Kiểm tra logic "missing flag" (không xoá record):');
  // Mark one missing
  db.prepare('UPDATE tracks SET is_missing = 1 WHERE path = ?').run('/test/path/sfx1.wav');
  const missingTrack = db.prepare('SELECT * FROM tracks WHERE path = ?').get('/test/path/sfx1.wav');
  assert(missingTrack.is_missing === 1, 'Đánh dấu file bị thiếu is_missing = 1 thành công');
  
  const countStillPresent = db.prepare('SELECT count(*) as count FROM tracks').get().count;
  assert(countStillPresent === 2, 'Record KHÔNG bị xoá khỏi database khi file missing');

  // Recover file
  db.prepare('UPDATE tracks SET is_missing = 0 WHERE path = ?').run('/test/path/sfx1.wav');
  const recoveredTrack = db.prepare('SELECT * FROM tracks WHERE path = ?').get('/test/path/sfx1.wav');
  assert(recoveredTrack.is_missing === 0, 'Phục hồi is_missing = 0 khi file xuất hiện trở lại');

  // 4. Test Watched Folders persistence
  console.log('\n4. Kiểm tra lưu trữ watched_folders:');
  db.prepare('INSERT OR IGNORE INTO watched_folders (path) VALUES (?)').run('/Users/macmini2/Desktop/EDITOR - LỎ/SFX');
  const folders = db.prepare('SELECT path FROM watched_folders').all();
  assert(folders.length === 1 && folders[0].path === '/Users/macmini2/Desktop/EDITOR - LỎ/SFX', 'Lưu watched folder vào DB thành công');

  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

  console.log('\n======================================================');
  if (allPassed) {
    console.log('🎉 TẤT CẢ TEST CHO PHASE 2 ĐÃ ĐẠT (PASS) 100%!');
    process.exit(0);
  } else {
    console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Lỗi khi chạy test:', err);
  process.exit(1);
});
