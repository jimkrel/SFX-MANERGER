import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const isWin = process.platform === 'win32';
console.log(`=== [TEST RUNNER] PHASE 6 — PACKAGE VERIFICATION (${isWin ? 'WINDOWS' : 'MACOS'}) ===\n`);

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

if (isWin) {
  // 1. Check packaged Windows installer & portable .exe
  console.log('1. Kiểm tra file đóng gói Windows (.exe):');
  const setupExePath = path.join(rootDir, 'release/SFX Music Manager Setup 1.0.0.exe');
  const portableExePath = path.join(rootDir, 'release/SFX Music Manager 1.0.0.exe');

  assert(fs.existsSync(setupExePath), 'File NSIS Installer (SFX Music Manager Setup 1.0.0.exe) tồn tại trong release/');
  assert(fs.existsSync(portableExePath), 'File Portable (SFX Music Manager 1.0.0.exe) tồn tại trong release/');

  if (fs.existsSync(setupExePath)) {
    const stat = fs.statSync(setupExePath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
    assert(stat.size > 40 * 1024 * 1024, `Dung lượng installer hợp lệ (${sizeMb} MB)`);
  }

  // 2. Check unpacked binary bundle
  console.log('\n2. Kiểm tra binary native thực thi:');
  const unpackedExePath = path.join(rootDir, 'release/win-unpacked/SFX Music Manager.exe');
  assert(fs.existsSync(unpackedExePath), 'File thực thi win-unpacked/SFX Music Manager.exe tồn tại');

  // 3. Check electron-builder config
  console.log('\n3. Kiểm tra cấu hình electron-builder cho Windows:');
  const builderConfig = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf-8');
  assert(builderConfig.includes('nsis'), 'Cấu hình target có hỗ trợ nsis installer');
  assert(builderConfig.includes('portable'), 'Cấu hình target có hỗ trợ portable .exe');
  assert(builderConfig.includes('x64'), 'Cấu hình kiến trúc target x64');
} else {
  // macOS verification
  console.log('1. Kiểm tra file đóng gói DMG:');
  const dmgPath = path.join(rootDir, 'release/SFX Music Manager-1.0.0-arm64.dmg');
  assert(fs.existsSync(dmgPath), 'File SFX Music Manager-1.0.0-arm64.dmg tồn tại trong thư mục release/');

  if (fs.existsSync(dmgPath)) {
    const stat = fs.statSync(dmgPath);
    const sizeMb = (stat.size / (1024 * 1024)).toFixed(1);
    assert(stat.size > 50 * 1024 * 1024, `Dung lượng file DMG hợp lệ (${sizeMb} MB)`);
  }

  console.log('\n2. Kiểm tra bundle ứng dụng native (.app):');
  const appPath = path.join(rootDir, 'release/mac-arm64/SFX Music Manager.app');
  assert(fs.existsSync(appPath), 'Bundle ứng dụng SFX Music Manager.app tồn tại');

  const appExecPath = path.join(appPath, 'Contents/MacOS/SFX Music Manager');
  assert(fs.existsSync(appExecPath), 'File thực thi nhị phân native tồn tại trong Contents/MacOS');

  console.log('\n3. Kiểm tra cấu hình electron-builder cho macOS:');
  const builderConfig = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf-8');
  assert(builderConfig.includes('arm64'), 'Cấu hình target đúng kiến trúc Apple Silicon arm64');
  assert(builderConfig.includes('dmg'), 'Cấu hình target đúng định dạng DMG');
  assert(builderConfig.includes('public.app-category.utilities'), 'Category là public.app-category.utilities');
}

console.log('\n======================================================');
if (allPassed) {
  console.log('🎉 TẤT CẢ TEST CHO PHASE 6 ĐÃ ĐẠT (PASS) 100%!');
  process.exit(0);
} else {
  console.error('⚠️ MỘT SỐ TEST THẤT BẠI. VUI LÒNG KIỂM TRA LẠI.');
  process.exit(1);
}
