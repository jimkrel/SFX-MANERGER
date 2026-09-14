import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mm from 'music-metadata';
import { Mp3Encoder } from '@breezystack/lamejs';

console.log('=== [TEST RUNNER] MP3 ENCODER VERIFICATION ===\n');

function assert(condition, message) {
  if (!condition) {
    console.error('  ❌ FAIL: ' + message);
    process.exit(1);
  }
  console.log('  ✅ PASS: ' + message);
}

// 1. Generate 1 second of 44.1kHz stereo audio
const sampleRate = 44100;
const numChannels = 2;
const numSamples = 44100;
const left = new Int16Array(numSamples);
const right = new Int16Array(numSamples);

for (let i = 0; i < numSamples; i++) {
  const t = i / sampleRate;
  const s = Math.sin(2 * Math.PI * 440 * t);
  left[i] = Math.floor(s * 32767);
  right[i] = Math.floor(s * 0.8 * 32767);
}

// 2. Instantiate Mp3Encoder
console.log('1. Khởi tạo Mp3Encoder:');
const encoder = new Mp3Encoder(numChannels, sampleRate, 320);
assert(Boolean(encoder), 'Khởi tạo thành công Mp3Encoder(2, 44100, 320) không bị lỗi MPEGMode');

// 3. Encode chunks
console.log('\n2. Thực hiện encode dữ liệu audio:');
const sampleBlockSize = 1152;
const mp3Chunks = [];

for (let i = 0; i < left.length; i += sampleBlockSize) {
  const leftChunk = left.subarray(i, i + sampleBlockSize);
  const rightChunk = right.subarray(i, i + sampleBlockSize);
  const buf = encoder.encodeBuffer(leftChunk, rightChunk);
  if (buf.length > 0) {
    mp3Chunks.push(Buffer.from(buf));
  }
}

const endBuf = encoder.flush();
if (endBuf.length > 0) {
  mp3Chunks.push(Buffer.from(endBuf));
}

const finalMp3 = Buffer.concat(mp3Chunks);
assert(finalMp3.length > 1000, 'Encode thành công file MP3 kích thước: ' + finalMp3.length + ' bytes');

// 4. Save and inspect with music-metadata
console.log('\n3. Kiểm tra định dạng MP3 bằng music-metadata:');
const tempMp3File = path.resolve('test-verify-output.mp3');
fs.writeFileSync(tempMp3File, finalMp3);

const meta = await mm.parseFile(tempMp3File);
assert(meta.format.container === 'MPEG', 'Container: ' + meta.format.container + ' (chuẩn MPEG/MP3)');
assert(meta.format.codec === 'MPEG 1 Layer 3', 'Codec: ' + meta.format.codec);
assert(meta.format.numberOfChannels === 2, 'Số kênh: ' + meta.format.numberOfChannels + ' (Stereo)');
assert(meta.format.sampleRate === 44100, 'Sample rate: ' + meta.format.sampleRate + ' Hz');

if (fs.existsSync(tempMp3File)) fs.unlinkSync(tempMp3File);

console.log('\n======================================================');
console.log('🎉 TẤT CẢ TEST CHO MP3 ENCODER ĐÃ ĐẠT (PASS) 100%!\n');
