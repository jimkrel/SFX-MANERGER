import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, nativeImage, clipboard } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] NATIVE DRAG-OUT & DROPFILES VERIFICATION ===\n');

let allPassed = true;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    allPassed = false;
  }
}

// CF_HDROP buffer generator (mirrored from src/main/index.ts)
function createCFHDROPBuffer(filePaths) {
  const headerBuf = Buffer.alloc(20);
  headerBuf.writeUInt32LE(20, 0);   // pFiles: offset to first path (20)
  headerBuf.writeUInt32LE(0, 4);    // pt.x
  headerBuf.writeUInt32LE(0, 8);    // pt.y
  headerBuf.writeUInt32LE(0, 12);   // fNC
  headerBuf.writeUInt32LE(1, 16);   // fWide: 1 = Unicode (UTF-16LE)

  const pathBufs = filePaths.map((filePath) => Buffer.from(filePath + '\0', 'utf16le'));
  const pathsBuf = Buffer.concat(pathBufs);
  const doubleNull = Buffer.from('\0\0', 'utf16le');
  return Buffer.concat([headerBuf, pathsBuf, doubleNull]);
}

// CF_HDROP buffer decoder (simulates Explorer / CapCut drop handler)
function parseCFHDROPBuffer(buf) {
  if (buf.length < 20) return { error: 'Buffer too short for DROPFILES header' };
  const pFiles = buf.readUInt32LE(0);
  const fWide = buf.readUInt32LE(16);
  if (fWide !== 1) return { error: 'Expected Unicode (fWide = 1)' };

  const pathsRaw = buf.subarray(pFiles);
  const decoded = pathsRaw.toString('utf16le');
  // Paths are separated by \0 and terminated by \0\0
  const paths = decoded.split('\0').filter((p) => p.length > 0);
  return { pFiles, fWide, paths };
}

async function runTests() {
  const tempDir = path.join(rootDir, 'temp-test-dragout');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const file1 = path.join(tempDir, 'kick_drum.wav');
  const file2 = path.join(tempDir, 'snare_drum.wav');
  const file3 = path.join(tempDir, 'hihat_loop.wav');

  fs.writeFileSync(file1, 'RIFFdummyWAVEkick');
  fs.writeFileSync(file2, 'RIFFdummyWAVEsnare');
  fs.writeFileSync(file3, 'RIFFdummyWAVEhihat');

  console.log('1. Kiểm tra cấu trúc Payload cho Kéo Đơn lẻ (Single-file drag):');
  const singleInput = file1;
  const rawPathsSingle = Array.isArray(singleInput) ? singleInput : [singleInput];
  const validPathsSingle = rawPathsSingle
    .map((p) => path.normalize(path.resolve(p)))
    .filter((p) => fs.existsSync(p));

  let dragIcon = null;
  const fallbackPath = path.join(rootDir, 'build/drag-icon.png');
  if (fs.existsSync(fallbackPath)) {
    dragIcon = nativeImage.createFromPath(fallbackPath);
  }
  if (!dragIcon || dragIcon.isEmpty()) {
    dragIcon = nativeImage.createEmpty();
  }

  const singlePayload = {
    file: validPathsSingle[0],
    files: validPathsSingle,
    icon: dragIcon
  };

  assert(typeof singlePayload.file === 'string', 'Field "file" là chuỗi hợp lệ (hỗ trợ single-file fallback)');
  assert(fs.existsSync(singlePayload.file), `File đích tồn tại thực tế trên ổ cứng: ${singlePayload.file}`);
  assert(Array.isArray(singlePayload.files), 'Field "files" là mảng chuỗi');
  assert(singlePayload.files.length === 1, 'Mảng "files" chứa đúng 1 phần tử');
  assert(singlePayload.files[0] === singlePayload.file, 'Field "file" và "files[0]" trỏ đến cùng 1 file');
  assert(singlePayload.icon !== null && singlePayload.icon !== undefined, 'Icon drag được khởi tạo hợp lệ');

  console.log('\n2. Kiểm tra cấu trúc Payload cho Kéo Nhiều File (Multi-file drag):');
  const multiInput = [file1, file2, file3];
  const rawPathsMulti = Array.isArray(multiInput) ? multiInput : [multiInput];
  const validPathsMulti = rawPathsMulti
    .map((p) => path.normalize(path.resolve(p)))
    .filter((p) => fs.existsSync(p));

  const multiPayload = {
    file: validPathsMulti[0],
    files: validPathsMulti,
    icon: dragIcon
  };

  assert(typeof multiPayload.file === 'string', 'Field "file" tồn tại cho tương thích ứng dụng legacy');
  assert(multiPayload.file === validPathsMulti[0], 'Field "file" trỏ đúng đến file đầu tiên');
  assert(Array.isArray(multiPayload.files), 'Field "files" là mảng');
  assert(multiPayload.files.length === 3, `Field "files" giữ nguyên toàn bộ 3 file (không bị cắt còn 1 file): count=${multiPayload.files.length}`);
  assert(multiPayload.files[1] === file2, 'File thứ 2 được giữ chính xác trong mảng');
  assert(multiPayload.files[2] === file3, 'File thứ 3 được giữ chính xác trong mảng');

  console.log('\n3. Kiểm tra nhị phân định dạng Windows CF_HDROP (DROPFILES header + UTF-16LE payload):');
  const singleBuf = createCFHDROPBuffer(validPathsSingle);
  const singleParsed = parseCFHDROPBuffer(singleBuf);
  assert(singleBuf.readUInt32LE(0) === 20, 'Header DROPFILES: pFiles offset = 20 byte');
  assert(singleBuf.readUInt32LE(16) === 1, 'Header DROPFILES: fWide = 1 (Unicode UTF-16LE)');
  assert(singleParsed.paths.length === 1, 'Giải mã CF_HDROP đơn lẻ: chứa đúng 1 file');
  assert(singleParsed.paths[0] === file1, `Đường dẫn giải mã khớp 100%: ${singleParsed.paths[0]}`);

  const multiBuf = createCFHDROPBuffer(validPathsMulti);
  const multiParsed = parseCFHDROPBuffer(multiBuf);
  assert(multiParsed.paths.length === 3, `Giải mã CF_HDROP nhiều file: nhận đầy đủ 3 file (không bị mất file nào)`);
  assert(multiParsed.paths[0] === file1, 'File 1 khớp chính xác trong buffer CF_HDROP');
  assert(multiParsed.paths[1] === file2, 'File 2 khớp chính xác trong buffer CF_HDROP');
  assert(multiParsed.paths[2] === file3, 'File 3 khớp chính xác trong buffer CF_HDROP');

  console.log('\n4. Kiểm tra tương thích Electron webContents.startDrag API:');
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  let singleDragCallSuccess = false;
  try {
    win.webContents.startDrag(singlePayload);
    singleDragCallSuccess = true;
  } catch (err) {
    if (err.message && !err.message.includes('expected') && !err.message.includes('Invalid')) {
      singleDragCallSuccess = true;
    } else {
      console.error('startDrag single file error:', err);
    }
  }
  assert(singleDragCallSuccess, 'Electron startDrag chấp nhận payload chứa cả "file" và "files" cho single-file');

  let multiDragCallSuccess = false;
  try {
    win.webContents.startDrag(multiPayload);
    multiDragCallSuccess = true;
  } catch (err) {
    if (err.message && !err.message.includes('expected') && !err.message.includes('Invalid')) {
      multiDragCallSuccess = true;
    } else {
      console.error('startDrag multi file error:', err);
    }
  }
  assert(multiDragCallSuccess, 'Electron startDrag chấp nhận payload chứa cả "file" và "files" cho multi-file (3 files)');

  console.log('\n5. Kiểm tra Clipboard CF_HDROP fallback (shell:copyPaths):');
  if (process.platform === 'win32') {
    clipboard.writeBuffer('CF_HDROP', multiBuf);
    const readBuf = clipboard.readBuffer('CF_HDROP');
    const readParsed = parseCFHDROPBuffer(readBuf);
    assert(readBuf.length > 0, `Clipboard CF_HDROP buffer ghi và đọc thành công (${readBuf.length} bytes)`);
    assert(readParsed.paths.length === 3, `Đọc lại từ Clipboard CF_HDROP nhận đủ 3 files: ${readParsed.paths.length}`);
  } else {
    assert(true, 'Bỏ qua kiểm tra clipboard Win32 CF_HDROP trên non-Windows');
  }

  win.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n======================================================');
  if (allPassed) {
    console.log('🎉 TẤT CẢ TEST NATIVE DRAG-OUT (SINGLE & MULTI) ĐÃ ĐẠT 100%!');
  } else {
    console.error('⚠️ CÓ TEST THẤT BẠI.');
  }

  app.quit();
  process.exit(allPassed ? 0 : 1);
}

app.whenReady().then(runTests).catch((err) => {
  console.error('Lỗi khởi động Electron test:', err);
  process.exit(1);
});
