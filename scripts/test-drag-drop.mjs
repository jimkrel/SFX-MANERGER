import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] TWO-WAY DRAG & DROP VERIFICATION ===\n');

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
  const testDbPath = path.join(rootDir, 'test-drag-drop.db');
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const userDataDir = path.join(rootDir, '.userData');
  if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true });

  // 1. Setup temporary test directory with various file types
  const tempDir = path.join(rootDir, 'temp-test-drag');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const subDir = path.join(tempDir, 'subfolder');
  fs.mkdirSync(subDir, { recursive: true });

  // Create dummy audio files and non-audio files
  const validAudio1 = path.join(tempDir, 'sound1.wav');
  const validAudio2 = path.join(subDir, 'sound2.mp3');
  const invalidFile1 = path.join(tempDir, 'document.pdf');
  const invalidFile2 = path.join(tempDir, 'video.mp4');

  // Simple minimal header / dummy content
  fs.writeFileSync(validAudio1, 'RIFFdummyWAVEfmt ');
  fs.writeFileSync(validAudio2, 'ID3dummycontent');
  fs.writeFileSync(invalidFile1, '%PDF-1.4 dummy content');
  fs.writeFileSync(invalidFile2, 'dummy mp4 content');

  // Dynamically import compiled indexer
  const { isAudioFile, importDroppedPaths } = await import('../dist/main/indexer.js');

  console.log('1. Kiểm tra nhận diện định dạng file (isAudioFile):');
  assert(isAudioFile('test.wav') === true, 'Nhận diện .wav hợp lệ');
  assert(isAudioFile('test.mp3') === true, 'Nhận diện .mp3 hợp lệ');
  assert(isAudioFile('test.flac') === true, 'Nhận diện .flac hợp lệ');
  assert(isAudioFile('test.aiff') === true, 'Nhận diện .aiff hợp lệ');
  assert(isAudioFile('test.pdf') === false, 'Từ chối .pdf');
  assert(isAudioFile('test.mp4') === false, 'Từ chối .mp4');
  assert(isAudioFile('test.txt') === false, 'Từ chối .txt');

  console.log('\n2. Kiểm tra xử lý importDroppedPaths:');

  // Test dropping non-audio files
  const badDropResult = await importDroppedPaths([invalidFile1, invalidFile2]);
  assert(badDropResult.imported === 0, 'Không import file định dạng không hỗ trợ');
  assert(badDropResult.errors.length === 2, 'Báo lỗi đúng 2 file không hỗ trợ');
  assert(badDropResult.errors[0].includes('document.pdf'), 'Tên file lỗi document.pdf hiển thị rõ ràng');
  assert(badDropResult.errors[1].includes('video.mp4'), 'Tên file lỗi video.mp4 hiển thị rõ ràng');

  // Test dropping single valid audio file
  const singleDropResult = await importDroppedPaths([validAudio1]);
  assert(singleDropResult.imported === 1, 'Import file âm thanh đơn lẻ thành công');
  assert(singleDropResult.errors.length === 0, 'Không có thông báo lỗi');

  // Test dropping duplicate file
  const dupDropResult = await importDroppedPaths([validAudio1]);
  assert(dupDropResult.errors.length === 0, 'Thả lại file cũ không gây lỗi');

  // Test dropping a folder (recursive scan)
  const folderDropResult = await importDroppedPaths([tempDir]);
  assert(folderDropResult.folders === 1, 'Nhận diện thả 1 thư mục thành công');
  assert(folderDropResult.imported >= 1, 'Quét đệ quy tìm và import file trong thư mục');

  // Clean up
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

  console.log('\n======================================================');
  if (allPassed) {
    console.log('🎉 TẤT CẢ TEST CHO TWO-WAY DRAG & DROP ĐÃ ĐẠT (PASS) 100%!');
    process.exit(0);
  } else {
    console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi khi chạy test:', err);
  process.exit(1);
});
