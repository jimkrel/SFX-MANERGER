import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] PHASE 5 — UI POLISH VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

// 1. Check CSS design tokens
console.log('1. Kiểm tra Design Tokens trong CSS:');
const cssContent = fs.readFileSync(path.join(rootDir, 'src/renderer/src/styles/index.css'), 'utf-8');
assert(cssContent.includes('#1C1B19'), 'Nền chính chuẩn #1C1B19 (than chì ấm)');
assert(cssContent.includes('#242220'), 'Nền panel chuẩn #242220');
assert(cssContent.includes('#E8E3DA'), 'Màu chữ chuẩn #E8E3DA (kem ngà)');
assert(cssContent.includes('#C9974E'), 'Màu accent chuẩn #C9974E (brass/amber VU meter)');
assert(cssContent.includes('Inter'), 'Font UI là Inter');
assert(cssContent.includes('JetBrains Mono'), 'Font số liệu kỹ thuật là JetBrains Mono');

// 2. Check Native Drag & Drop registration in Main & Preload
console.log('\n2. Kiểm tra tính năng kéo thả Native ra Premiere/Resolve:');
const mainContent = fs.readFileSync(path.join(rootDir, 'src/main/index.ts'), 'utf-8');
assert(mainContent.includes('drag:start'), 'Main process xử lý sự kiện drag:start');
assert(mainContent.includes('startDrag'), 'Main process gọi event.sender.startDrag');

const preloadContent = fs.readFileSync(path.join(rootDir, 'src/preload/index.ts'), 'utf-8');
assert(preloadContent.includes('startDrag:'), 'Preload expose API startDrag');

// 3. Check System-Voice Empty State messages
console.log('\n3. Kiểm tra thông báo trạng thái theo giọng hệ thống (System voice):');
const appContent = fs.readFileSync(path.join(rootDir, 'src/renderer/src/App.tsx'), 'utf-8');
assert(appContent.includes('[HỆ THỐNG]'), 'Thông báo rỗng/lỗi viết theo tiền tố [HỆ THỐNG]');
assert(appContent.includes('Thao tác tiếp theo:'), 'Chỉ rõ thao tác xử lý tiếp theo thay vì xin lỗi chung chung');
assert(appContent.includes('draggable-clip') || appContent.includes('draggable'), 'Dòng clip kích hoạt draggable');

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO PHASE 5 ĐÃ ĐẠT (PASS) 100%!');
  process.exit(0);
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
  process.exit(1);
}
