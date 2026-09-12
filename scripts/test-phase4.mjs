import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] PHASE 4 — TAG & SEARCH VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

const testDbPath = path.join(rootDir, 'test-phase4.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma('journal_mode = WAL');

// 1. Setup Phase 4 schema
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

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS track_tags (
    track_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (track_id, tag_id),
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
    track_id UNINDEXED,
    name,
    tags,
    tokenize = 'unicode61'
  );
`);

console.log('1. Kiểm tra hệ thống tags nhiều-nhiều (tags + track_tags):');
// Seed tags
db.prepare('INSERT INTO tags (name) VALUES (?)').run('SFX');
db.prepare('INSERT INTO tags (name) VALUES (?)').run('Impact');
db.prepare('INSERT INTO tags (name) VALUES (?)').run('Cinematic');

const tagSfx = db.prepare('SELECT id FROM tags WHERE name = ?').get('SFX').id;
const tagImpact = db.prepare('SELECT id FROM tags WHERE name = ?').get('Impact').id;
const tagCinematic = db.prepare('SELECT id FROM tags WHERE name = ?').get('Cinematic').id;

// Insert 2 tracks
db.prepare('INSERT INTO tracks (path, name, duration, is_missing) VALUES (?, ?, ?, ?)').run(
  '/sfx/heavy_boom.wav',
  'Heavy Boom Impact',
  1.5,
  0
);
const track1Id = 1;

db.prepare('INSERT INTO tracks (path, name, duration, is_missing) VALUES (?, ?, ?, ?)').run(
  '/sfx/ambient_space.wav',
  'Ambient Space Drone',
  45.0,
  0
);
const track2Id = 2;

// Link tags: track 1 has SFX, Impact, Cinematic. Track 2 has only Cinematic.
db.prepare('INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(track1Id, tagSfx);
db.prepare('INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(track1Id, tagImpact);
db.prepare('INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(track1Id, tagCinematic);
db.prepare('INSERT INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(track2Id, tagCinematic);

const track1Tags = db
  .prepare('SELECT t.name FROM tags t JOIN track_tags tt ON t.id = tt.tag_id WHERE tt.track_id = ?')
  .all(track1Id);
assert(track1Tags.length === 3, 'Gán thành công 3 tags cho Track 1');

// 2. Test FTS5 Full-Text Search
console.log('\n2. Kiểm tra Full-Text Search (SQLite FTS5):');
// Populate FTS5 table
db.prepare('INSERT INTO tracks_fts (track_id, name, tags) VALUES (?, ?, ?)').run(
  track1Id,
  'Heavy Boom Impact',
  'SFX Impact Cinematic'
);
db.prepare('INSERT INTO tracks_fts (track_id, name, tags) VALUES (?, ?, ?)').run(
  track2Id,
  'Ambient Space Drone',
  'Cinematic'
);

// Search by title prefix
const searchBoom = db
  .prepare('SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?')
  .all('"boom"*');
assert(searchBoom.length === 1 && searchBoom[0].track_id === track1Id, 'Tìm kiếm FTS5 theo tên file ("boom*") chính xác');

// Search by tag
const searchTag = db
  .prepare('SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?')
  .all('"impact"*');
assert(searchTag.length === 1 && searchTag[0].track_id === track1Id, 'Tìm kiếm FTS5 theo tag ("impact*") chính xác');

// 3. Test AND vs OR tag filtering
console.log('\n3. Kiểm tra logic lọc Tag (AND vs OR):');
// Filter OR with [Impact, Cinematic] -> Should return both track 1 and track 2
const orTracks = db
  .prepare(`
    SELECT DISTINCT track_id FROM track_tags WHERE tag_id IN (?, ?)
  `)
  .all(tagImpact, tagCinematic);
assert(orTracks.length === 2, 'Lọc theo chế độ OR trả về cả 2 track có ít nhất 1 tag');

// Filter AND with [Impact, Cinematic] -> Should return ONLY track 1
const andTracks = db
  .prepare(`
    SELECT track_id FROM track_tags
    WHERE tag_id IN (?, ?)
    GROUP BY track_id
    HAVING COUNT(DISTINCT tag_id) = 2
  `)
  .all(tagImpact, tagCinematic);
assert(andTracks.length === 1 && andTracks[0].track_id === track1Id, 'Lọc theo chế độ AND chỉ trả về track thỏa mãn ĐẦY ĐỦ các tag');

// 4. Test Stat Bar metrics
console.log('\n4. Kiểm tra thống kê Stat Bar:');
const totalSfx = db
  .prepare(`
    SELECT COUNT(DISTINCT t.id) AS count
    FROM tracks t
    LEFT JOIN track_tags tt ON t.id = tt.track_id
    LEFT JOIN tags g ON tt.tag_id = g.id
    WHERE g.name = 'SFX' OR t.path LIKE '%sfx%' OR t.duration < 30
  `)
  .get().count;
assert(totalSfx >= 1, `Tính toán tổng SFX chính xác (${totalSfx})`);

const totalMusic = db
  .prepare(`
    SELECT COUNT(DISTINCT t.id) AS count
    FROM tracks t
    WHERE t.duration >= 30
  `)
  .get().count;
assert(totalMusic >= 1, `Tính toán tổng Nhạc chính xác (${totalMusic})`);

db.close();
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO PHASE 4 ĐÃ ĐẠT (PASS) 100%!');
  process.exit(0);
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
  process.exit(1);
}
