import Database from 'better-sqlite3';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] PHASE 1 — SCAFFOLD VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

// 1. Test build artifacts
console.log('1. Kiểm tra build artifacts:');
assert(fs.existsSync(path.join(rootDir, 'dist/main/index.js')), 'Main bundle (dist/main/index.js) tồn tại');
assert(fs.existsSync(path.join(rootDir, 'dist/preload/index.js')), 'Preload bundle (dist/preload/index.js) tồn tại');
assert(fs.existsSync(path.join(rootDir, 'dist/renderer/index.html')), 'Renderer bundle (dist/renderer/index.html) tồn tại');

// 2. Test better-sqlite3 local DB
console.log('\n2. Kiểm tra Database local (better-sqlite3):');
const testDbPath = path.join(rootDir, 'test-phase1.db');
try {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');

  const versionRow = db.prepare('SELECT sqlite_version() AS v').get();
  assert(Boolean(versionRow && versionRow.v), `SQLite engine hoạt động (version: ${versionRow?.v})`);

  db.exec('CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT);');
  db.prepare('INSERT INTO test_table (name) VALUES (?)').run('SFX Clip Test');
  const countRow = db.prepare('SELECT count(*) AS total FROM test_table').get();
  assert(countRow?.total === 1, 'Ghi & đọc dữ liệu SQLite thành công');

  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  assert(true, 'better-sqlite3 dọn dẹp kết nối an toàn');
} catch (err) {
  assert(false, `better-sqlite3 gặp lỗi: ${err.message}`);
}

// 3. Test chokidar file watcher
console.log('\n3. Kiểm tra chokidar file watcher:');
const testWatchDir = path.join(rootDir, 'test-watch-dir');
try {
  if (!fs.existsSync(testWatchDir)) fs.mkdirSync(testWatchDir);

  await new Promise((resolve) => {
    const watcher = chokidar.watch(testWatchDir, { ignoreInitial: true });
    watcher.on('add', (filePath) => {
      assert(path.basename(filePath) === 'test-sound.wav', 'chokidar phát hiện file âm thanh mới thêm vào thư mục');
      watcher.close().then(() => {
        fs.rmSync(testWatchDir, { recursive: true, force: true });
        resolve();
      });
    });

    watcher.on('ready', () => {
      // Create a test file
      fs.writeFileSync(path.join(testWatchDir, 'test-sound.wav'), 'dummy audio content');
    });
  });
} catch (err) {
  assert(false, `chokidar gặp lỗi: ${err.message}`);
}

// 4. Test electron-builder config
console.log('\n4. Kiểm tra cấu hình electron-builder:');
const builderYml = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf-8');
assert(builderYml.includes('target: dmg') || builderYml.includes('dmg'), 'Target đóng gói là dmg');
assert(builderYml.includes('arm64'), 'Kiến trúc target là Apple Silicon (arm64)');
assert(builderYml.includes('public.app-category.utilities'), 'Category là public.app-category.utilities');

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO PHASE 1 ĐÃ ĐẠT (PASS) 100%!');
  process.exit(0);
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
  process.exit(1);
}
