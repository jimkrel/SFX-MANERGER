import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as mm from 'music-metadata';
import {
  isBouncedCached,
  saveBouncedWav,
  cleanStaleBounceCache,
  clearBounceCache
} from '../dist/main/bouncer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] ON-THE-FLY BROADCAST WAV 48kHz BOUNCING VERIFICATION ===\n');

function assert(condition, message) {
  if (!condition) {
    console.error('  ❌ FAIL: ' + message);
    process.exit(1);
  }
  console.log('  ✅ PASS: ' + message);
}

async function runTests() {
  const mockSourcePath = 'C:\\\\SimulatedAudio\\\\ambient_drone_96k.flac';
  
  // 1. Check Deterministic Hash Path Resolution
  console.log('1. Kiểm tra tính toán đường dẫn Cache bouncer:');
  const checkInitial = isBouncedCached(mockSourcePath);
  assert(typeof checkInitial.cached === 'boolean', 'isBouncedCached trả về object có thuộc tính cached');
  assert(checkInitial.cached === false, 'File mới chưa bounce thì cached=false');
  assert(checkInitial.bouncePath.endsWith('.wav'), 'Đường dẫn cache đích có đuôi mở rộng .wav');
  assert(checkInitial.bouncePath.includes('sfx-manager-bounce'), 'Đường dẫn cache nằm trong thư mục %TEMP%/sfx-manager-bounce');
  assert(checkInitial.bouncePath.includes('ambient_drone_96k'), 'Tên file giữ nguyên tên gốc của track');

  // 2. Generate 48.000 Hz 16-bit PCM Stereo WAV Buffer
  console.log('\n2. Khởi tạo Buffer Broadcast WAV 48kHz PCM 16-bit Stereo:');
  const sampleRate = 48000;
  const numChannels = 2;
  const duration = 0.5; // 0.5s tone
  const numSamples = Math.floor(sampleRate * duration);
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const wavBuffer = new Uint8Array(bufferSize);
  const view = new DataView(wavBuffer.buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Chunk
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt Subchunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16 bits per sample

  // data Subchunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Fill sine wave audio data
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sampleVal = Math.sin(2 * Math.PI * 440 * t);
    const intVal = Math.max(-32768, Math.min(32767, Math.floor(sampleVal * 32767)));

    // Channel 1 (Left)
    view.setInt16(offset, intVal, true);
    // Channel 2 (Right)
    view.setInt16(offset + 2, intVal, true);
    offset += 4;
  }

  assert(wavBuffer.byteLength === bufferSize, 'Tạo thành công buffer WAV ' + bufferSize + ' bytes');

  // 3. Save Bounced WAV to Cache
  console.log('\n3. Lưu file WAV chuyển mã vào Bouncer Cache:');
  const savedPath = saveBouncedWav(mockSourcePath, wavBuffer);
  assert(savedPath === checkInitial.bouncePath, 'Đường dẫn lưu khớp với bouncePath tính trước');
  assert(fs.existsSync(savedPath), 'File WAV tồn tại thực tế trên ổ đĩa: ' + savedPath);

  // 4. Validate with music-metadata
  console.log('\n4. Kiểm tra thông số audio qua thư viện music-metadata:');
  const metadata = await mm.parseFile(savedPath);
  assert(metadata.format.container === 'WAVE', 'Container: ' + metadata.format.container + ' (chuẩn WAVE)');
  assert(metadata.format.codec === 'PCM', 'Codec: ' + metadata.format.codec + ' (chuẩn PCM uncompressed)');
  assert(metadata.format.sampleRate === 48000, 'Sample Rate: ' + metadata.format.sampleRate + ' Hz (chuẩn Broadcast 48.000 Hz)');
  assert(metadata.format.numberOfChannels === 2, 'Số kênh: ' + metadata.format.numberOfChannels + ' (Stereo)');
  assert(metadata.format.bitsPerSample === 16, 'Độ sâu bit: ' + metadata.format.bitsPerSample + '-bit');

  // 5. Validate with ffprobe if available
  console.log('\n5. Kiểm tra luồng stream qua công cụ chuyên dụng ffprobe:');
  try {
    const probeOut = execSync(
      'ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,bits_per_sample -of default=noprint_wrappers=1 "' + savedPath + '"',
      { encoding: 'utf-8' }
    );
    console.log('   ffprobe output:\n   ' + probeOut.trim().split('\n').join('\n   '));
    assert(probeOut.includes('codec_name=pcm_s16le'), 'ffprobe xác nhận codec_name=pcm_s16le (Broadcast standard)');
    assert(probeOut.includes('sample_rate=48000'), 'ffprobe xác nhận sample_rate=48000');
    assert(probeOut.includes('channels=2'), 'ffprobe xác nhận channels=2');
  } catch {
    console.log('   (ffprobe không có trong PATH, bỏ qua bước gọi binary ngoài)');
  }

  // 6. Test Instant Cache Hit Timing (0ms drag latency)
  console.log('\n6. Kiểm tra tốc độ truy vấn Cache Hit (0ms drag latency):');
  const startTime = performance.now();
  const hitCheck = isBouncedCached(mockSourcePath);
  const durationMs = performance.now() - startTime;
  assert(hitCheck.cached === true, 'Cache Hit thành công (cached=true)');
  assert(hitCheck.bouncePath === savedPath, 'BouncePath trỏ đúng file đã cache');
  assert(durationMs < 10, 'Thời gian kiểm tra cache siêu tốc: ' + durationMs.toFixed(3) + ' ms (< 10ms)');

  // 7. Test Cache Clearing
  console.log('\n7. Kiểm tra dọn dẹp Cache (clearBounceCache):');
  const clearResult = clearBounceCache();
  assert(clearResult.cleared >= 1, 'Đã xóa thành công ' + clearResult.cleared + ' file cache');
  assert(clearResult.freedBytes >= bufferSize, 'Giải phóng ' + clearResult.freedBytes + ' bytes');
  assert(!fs.existsSync(savedPath), 'File cache tạm đã bị xóa khỏi ổ đĩa');

  const afterClearCheck = isBouncedCached(mockSourcePath);
  assert(afterClearCheck.cached === false, 'Sau khi dọn cache, isBouncedCached trả về cached=false');

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ TEST CHO ON-THE-FLY BROADCAST WAV BOUNCING ĐÃ ĐẠT (PASS) 100%!\n');
}

runTests().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
