// Quick smoke test: verify WASM module loads and parses a real audio file
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const wasmGlue = path.join(__dirname, '../src/main/wasm/sfx_parser.js');

console.log('=== WASM Symphonia Smoke Test ===\n');

// 1. Test: module loads
let mod;
try {
  mod = require(wasmGlue);
  console.log('✅ WASM module loaded successfully');
  console.log('   Exports:', Object.keys(mod).filter(k => !k.startsWith('_')).join(', '));
} catch (e) {
  console.error('❌ WASM load failed:', e.message);
  process.exit(1);
}

// 2. Test: parse a real WAV file
const sfxDir = '/Volumes/Tài/TÀI NGUYÊN/Sound Effect';
const testFiles = [];

function findFiles(dir, exts, out) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name.startsWith('._') || f.name.startsWith('.')) continue; // skip macOS hidden
    const full = path.join(dir, f.name);
    if (f.isDirectory()) findFiles(full, exts, out);
    else if (exts.includes(path.extname(f.name).toLowerCase())) out.push(full);
    if (out.length >= 10) return;
  }
}

findFiles(sfxDir, ['.wav', '.mp3', '.ogg'], testFiles);

if (testFiles.length === 0) {
  console.log('⚠️  No audio files found at', sfxDir, '— using synthetic test');
  // Create a minimal valid WAV header for testing
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0); wavHeader.writeUInt32LE(36, 4);
  wavHeader.write('WAVE', 8); wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(2, 22); wavHeader.writeUInt32LE(44100, 24);
  wavHeader.writeUInt32LE(176400, 28); wavHeader.writeUInt16LE(4, 32);
  wavHeader.writeUInt16LE(16, 34); wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(0, 40);
  const result = mod.parse_audio_metadata(new Uint8Array(wavHeader), 'wav');
  console.log('Synthetic WAV result:', result);
  process.exit(0);
}

console.log(`\nTesting ${testFiles.length} real audio files:\n`);

const results = { pass: 0, fail: 0 };
const timings = { wasm: [], mm: [] };

// Benchmark WASM vs music-metadata
const { parseFile } = await new Function('return import("music-metadata")')();

for (const filePath of testFiles) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const name = path.basename(filePath);

  // WASM
  const t0 = performance.now();
  const data = fs.readFileSync(filePath);
  const wasmResult = mod.parse_audio_metadata(new Uint8Array(data), ext);
  const wasmMs = performance.now() - t0;

  // music-metadata
  const t1 = performance.now();
  let mmResult;
  try { mmResult = await parseFile(filePath, { duration: true, skipCovers: true }); } catch {}
  const mmMs = performance.now() - t1;

  timings.wasm.push(wasmMs);
  timings.mm.push(mmMs);

  const ok = wasmResult && !wasmResult.error && (wasmResult.duration > 0 || wasmResult.sample_rate > 0);
  if (ok) results.pass++;
  else results.fail++;

  const icon = ok ? '✅' : '❌';
  console.log(`${icon} [${ext.toUpperCase()}] ${name}`);
  console.log(`   WASM: ${wasmMs.toFixed(2)}ms | mm: ${mmMs.toFixed(2)}ms | duration: ${wasmResult?.duration?.toFixed(2)}s | sr: ${wasmResult?.sample_rate}Hz`);
  if (wasmResult?.error) console.log(`   error: ${wasmResult.error}`);
}

const avgWasm = timings.wasm.reduce((a, b) => a + b, 0) / timings.wasm.length;
const avgMm = timings.mm.reduce((a, b) => a + b, 0) / timings.mm.length;

console.log('\n=== Benchmark Summary ===');
console.log(`WASM avg: ${avgWasm.toFixed(2)}ms/file`);
console.log(`music-metadata avg: ${avgMm.toFixed(2)}ms/file`);
console.log(`🚀 SPEEDUP: ${(avgMm / avgWasm).toFixed(1)}x`);
console.log(`\nPASS: ${results.pass}/${testFiles.length} | FAIL: ${results.fail}/${testFiles.length}`);
