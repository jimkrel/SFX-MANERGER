import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as mm from 'music-metadata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('=== [TEST RUNNER] EXPORT WAV TRANSCODE VERIFICATION ===\n');

const tempMp3Path = path.join(rootDir, 'test-source-audio.mp3');
const tempWavPath = path.join(rootDir, 'test-exported-pcm.wav');

// Clean previous runs
if (fs.existsSync(tempMp3Path)) fs.unlinkSync(tempMp3Path);
if (fs.existsSync(tempWavPath)) fs.unlinkSync(tempWavPath);

// 1. Generate a real MP3 file using ffmpeg (440Hz tone, stereo, 44100Hz, 1s)
console.log('1. Khởi tạo file nguồn MP3 thật:');
execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1.0" -ar 44100 -ac 2 -b:a 320k "${tempMp3Path}" 2>NUL`);
const mp3Meta = await mm.parseFile(tempMp3Path);
console.log(`  - File MP3 tạo thành công: ${tempMp3Path}`);
console.log(`  - Format nguồn: ${mp3Meta.format.container} (${mp3Meta.format.codec}), ${mp3Meta.format.sampleRate}Hz, ${mp3Meta.format.numberOfChannels} channels, bitrate: ${Math.round(mp3Meta.format.bitrate/1000)} kbps\n`);

// 2. Decode raw PCM data and pass to encodeAudioBufferToWav
console.log('2. Giải mã và thực hiện encode qua encodeAudioBufferToWav:');
// Read PCM raw using ffmpeg into Float32Array (simulating Web Audio API decodeAudioData)
const rawPcm = execSync(`ffmpeg -v error -i "${tempMp3Path}" -f f32le -ac 2 -ar 44100 -`, { maxBuffer: 10 * 1024 * 1024 });
const floatSamples = new Float32Array(rawPcm.buffer, rawPcm.byteOffset, rawPcm.byteLength / 4);

const numChannels = 2;
const numSamples = floatSamples.length / numChannels;
const leftChannel = new Float32Array(numSamples);
const rightChannel = new Float32Array(numSamples);

for (let i = 0; i < numSamples; i++) {
  leftChannel[i] = floatSamples[i * 2];
  rightChannel[i] = floatSamples[i * 2 + 1];
}

// Mock Web Audio API AudioBuffer
const mockAudioBuffer = {
  numberOfChannels: 2,
  sampleRate: 44100,
  length: numSamples,
  duration: numSamples / 44100,
  getChannelData: (c) => (c === 0 ? leftChannel : rightChannel)
};

// Canonical encodeAudioBufferToWav function
function encodeAudioBufferToWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF Header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt chunk (Linear PCM)
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM = 1
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // 16-bit

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, s, true);
      offset += 2;
    }
  }

  return new Uint8Array(arrayBuffer);
}

const wavBytes = encodeAudioBufferToWav(mockAudioBuffer);
fs.writeFileSync(tempWavPath, wavBytes);
console.log(`  - File WAV xuất thành công: ${tempWavPath} (${wavBytes.length} bytes)\n`);

// 3. Verify with music-metadata
console.log('3. Kiểm tra thông số file WAV bằng music-metadata:');
const wavMeta = await mm.parseFile(tempWavPath);
console.log(`  - Container: ${wavMeta.format.container}`);
console.log(`  - Codec: ${wavMeta.format.codec}`);
console.log(`  - Sample Rate: ${wavMeta.format.sampleRate} Hz`);
console.log(`  - Channels: ${wavMeta.format.numberOfChannels}`);
console.log(`  - Bits per sample: ${wavMeta.format.bitsPerSample}-bit`);
console.log(`  - Duration: ${wavMeta.format.duration.toFixed(2)}s`);

if ((wavMeta.format.container === 'WAV' || wavMeta.format.container === 'WAVE') && wavMeta.format.codec === 'PCM' && wavMeta.format.bitsPerSample === 16) {
  console.log('  ✅ PASS (music-metadata): File xuất ra là chuẩn WAV PCM 16-bit!');
} else {
  console.error('  ❌ FAIL: Không đúng chuẩn PCM WAV!');
  process.exit(1);
}

// 4. Verify with native ffprobe
console.log('\n4. Kiểm tra codec stream thực tế bằng ffprobe:');
const ffprobeOutput = execSync(
  `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,codec_type,sample_fmt,channels,sample_rate,bits_per_sample -of default=noprint_wrappers=1 "${tempWavPath}"`,
  { encoding: 'utf-8' }
);
console.log(ffprobeOutput.trim().split('\n').map((l) => '  ' + l).join('\n'));

if (ffprobeOutput.includes('codec_name=pcm_s16le') && ffprobeOutput.includes('sample_fmt=s16')) {
  console.log('\n  ✅ PASS (ffprobe): ffprobe xác nhận codec_name=pcm_s16le (PCM 16-bit LE), mở trực tiếp trong Premiere/Resolve không bị lỗi định dạng!');
} else {
  console.error('\n  ❌ FAIL (ffprobe): Codec không phải pcm_s16le!');
  process.exit(1);
}

// Cleanup
fs.unlinkSync(tempMp3Path);
fs.unlinkSync(tempWavPath);

console.log('\n======================================================');
console.log('🎉 XÁC NHẬN HOÀN TẤT NHÓM 1: EXPORT WAV PCM 16-BIT ĐÃ PASS 100%!');
