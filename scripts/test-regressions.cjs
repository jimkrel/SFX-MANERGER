const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-regression-'));
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { getPath: () => temp } };
  return originalLoad.call(this, name, ...args);
};
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log('PASS', name);
  passed++;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function loadRenderer(file, mocks = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, 'src/renderer/src/audio', file + '.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in mocks)) throw new Error('Missing test dependency ' + name);
    return mocks[name];
  }, console, setTimeout, clearTimeout, Uint8Array, Float32Array, ArrayBuffer, DataView, ...globals });
  return exports;
}
function wav({ frames = 480, channels = 2, bits = 16, float = false, impulse = frames - 1, junk = 0, extensible = false } = {}) {
  const fmtSize = extensible ? 40 : 16;
  const offset = 12 + (junk ? 8 + junk + (junk & 1) : 0);
  const dataStart = offset + 8 + fmtSize + 8;
  const dataSize = frames * channels * bits / 8;
  const buffer = Buffer.alloc(dataStart + dataSize + (dataSize & 1));
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  if (junk) { buffer.write('JUNK', 12); buffer.writeUInt32LE(junk, 16); }
  buffer.write('fmt ', offset); buffer.writeUInt32LE(fmtSize, offset + 4);
  const fmt = offset + 8;
  buffer.writeUInt16LE(extensible ? 0xfffe : float ? 3 : 1, fmt);
  buffer.writeUInt16LE(channels, fmt + 2); buffer.writeUInt32LE(48000, fmt + 4);
  buffer.writeUInt32LE(48000 * channels * bits / 8, fmt + 8);
  buffer.writeUInt16LE(channels * bits / 8, fmt + 12); buffer.writeUInt16LE(bits, fmt + 14);
  if (extensible) {
    buffer.writeUInt16LE(22, fmt + 16); buffer.writeUInt16LE(bits, fmt + 18);
    buffer.writeUInt32LE(float ? 3 : 1, fmt + 24);
    Buffer.from('00001000800000aa00389b71', 'hex').copy(buffer, fmt + 28);
  }
  buffer.write('data', dataStart - 8); buffer.writeUInt32LE(dataSize, dataStart - 4);
  if (bits === 8) buffer.fill(128, dataStart, dataStart + dataSize);
  if (impulse >= 0 && frames) {
    const pos = dataStart + (impulse * channels + channels - 1) * bits / 8;
    if (float) { if (bits === 32) buffer.writeFloatLE(0.75, pos); else buffer.writeDoubleLE(0.75, pos); }
    else if (bits === 8) buffer[pos] = 224;
    else buffer.writeIntLE(Math.round(0.75 * 2 ** (bits - 1)), pos, bits / 8);
  }
  return buffer;
}

async function main() {
  const { DecodeQueue } = loadRenderer('decodeQueue');
  await test('queue bounds whole jobs, deduplicates and promotes playback', async () => {
    const queue = new DecodeQueue(2), a = deferred(), b = deferred();
    const order = [];
    const p1 = queue.run('a', () => a.promise), p2 = queue.run('b', () => b.promise);
    const p3 = queue.run('low', async () => { order.push('low'); return 3; });
    const p4 = queue.run('play', async () => { order.push('play'); return 4; });
    assert.equal(queue.run('play', async () => 99, 100), p4);
    await tick(); assert.deepEqual(order, []);
    a.resolve(1); await tick(); assert.deepEqual(order, ['play', 'low']);
    b.resolve(2); assert.deepEqual(await Promise.all([p1, p2, p3, p4]), [1, 2, 3, 4]);
    await assert.rejects(queue.run('error', async () => { throw Error('bad'); }));
    await tick(); assert.equal(await queue.run('after-error', async () => 5), 5);
  });

  const sources = [];
  const context = { state: 'running', currentTime: 0, destination: {},
    createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
    createBufferSource: () => { const source = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(source); return source; }
  };
  const player = loadRenderer('player', { './audioContext': { getAudioContext: () => context }, './bufferLoader': {
    trackCacheKey: track => `${track.id}:${track.content_version || 0}`, observeTrack: () => true
  } }, { window: {} }).audioPlayer;
  const a = { id: 1, path: 'A.wav', name: 'A', duration: 1 }, b = { id: 2, path: 'B.wav', name: 'B', duration: 2 };
  await test('out-of-order play completions start only the latest track', async () => {
    const waits = new Map(); player.getAudioBufferForTrack = track => { const d = deferred(); waits.set(track.id, d); return d.promise; };
    const p1 = player.play(a), p2 = player.play(b);
    waits.get(2).resolve({ duration: 2, label: 'B' }); await p2;
    waits.get(1).resolve({ duration: 1, label: 'A' }); await p1;
    assert.equal(player.getState().currentTrack.name, 'B');
    assert.equal(player.getActiveBuffer().label, 'B');
    assert.equal(sources.filter(s => s.started && !s.stopped).length, 1);
  });
  await test('pause cancels an in-flight play and failed loads reset state', async () => {
    const d = deferred(); player.getAudioBufferForTrack = () => d.promise;
    const p = player.play(a); player.pause(); d.resolve({ duration: 1 }); await p;
    assert.equal(player.getState().isPlaying, false);
    assert.equal(sources.filter(s => s.started && !s.stopped).length, 0);
    player.getAudioBufferForTrack = async () => null; await player.play(b);
    assert.equal(player.getState().isPlaying, false); assert.equal(player.getActiveBuffer(), null);
  });

  await test('shared buffer loader rejects stale versions and queues reads before allocation', async () => {
    let reads = 0;
    const loader = loadRenderer('bufferLoader', {
      './audioContext': { decodeAudioBuffer: async () => ({ length: 10, numberOfChannels: 1 }) },
      './decodeQueue': { decodeQueue: new DecodeQueue(2) }
    }, { window: { api: { readAudioBuffer: async () => { reads++; return new Uint8Array(10); } } } });
    const old = { ...a, content_version: 1 }, fresh = { ...a, content_version: 2 };
    const [first, second] = await Promise.all([loader.loadAudioBuffer(old), loader.loadAudioBuffer(old)]);
    assert.equal(first, second); assert.equal(reads, 1);
    await loader.loadAudioBuffer(fresh); assert.equal(reads, 2);
    assert.equal(await loader.loadAudioBuffer(old), null);
  });

  await test('clearing bounce cache forces validation and invalidates pending conversions', async () => {
    let cached = false, checks = 0, saves = 0;
    let encode = async () => new Uint8Array(48);
    const api = {
      isBouncedCached: async () => { checks++; return { cached, bouncePath: 'cache.wav', sourceToken: 'sig' }; },
      saveBouncedWav: async () => { saves++; cached = true; return 'cache.wav'; },
      clearBounceCache: async () => { cached = false; return { cleared: 1, freedBytes: 48 }; }
    };
    const bounce = loadRenderer('bouncerService', {
      './bufferLoader': { loadAudioBuffer: async () => ({ sampleRate: 48000 }), trackCacheKey: t => String(t.id) },
      './decodeQueue': { DecodeQueue }, './audioConverter': {},
      './wavEncoder': { encodeAudioBufferToWavAsync: (...args) => encode(...args) }
    }, { localStorage: { getItem: () => null }, window: { api } });
    const track = { id: 1, path: 'source.mp3' };
    assert.equal(await bounce.getOrPrepareBouncedPath(track), 'cache.wav');
    await tick(); await bounce.clearPreparedBounceCache();
    assert.equal(await bounce.getOrPrepareBouncedPath(track), 'cache.wav');
    assert.equal(saves, 2); assert.equal(checks, 2);
    await tick(); await bounce.clearPreparedBounceCache();
    const d = deferred(); encode = () => d.promise;
    const pending = bounce.getOrPrepareBouncedPath(track); await tick();
    await bounce.clearPreparedBounceCache(); d.resolve(new Uint8Array(48));
    assert.equal(await pending, track.path); assert.equal(saves, 2);
  });

  const database = require('../dist/main/db.js');
  const { extractWavPeaks } = require('../dist/main/wavPeaks.js');
  await test('joined thumbnail peaks avoid IPC and stale renderer cache writes are rejected', async () => {
    let reads = 0, writes = 0, newest = 0;
    const wait = deferred();
    const waveform = loadRenderer('waveform', {
      './decodeQueue': { DecodeQueue },
      './bufferLoader': {
        trackCacheKey: t => `${t.id}:${t.content_version || 0}`,
        observeTrack: t => (t.content_version || 0) >= newest,
        loadAudioBuffer: () => wait.promise
      }
    }, { window: { api: {
      getWaveformPeaks: async () => { reads++; return null; },
      saveWaveformPeaks: async () => { writes++; }
    } } });
    const joined = { ...a, path: 'a.mp3', peaks_80: Array(80).fill(0.5) };
    assert.equal((await waveform.getOrComputePeaks(joined, 80))[0], 0.5);
    assert.equal(reads, 0);
    const pending = waveform.getOrComputePeaks({ ...b, path: 'b.mp3', content_version: 0, peaks_80: null }, 80);
    await tick(); newest = 1;
    wait.resolve({ numberOfChannels: 1, length: 4, getChannelData: () => new Float32Array([0, 0, 0, 1]) });
    await pending; assert.equal(writes, 0);
  });
  await test('cooperative WAV encoding matches synchronous output at 16 and 24 bits', async () => {
    const encoder = loadRenderer('wavEncoder');
    const data = new Float32Array(70000);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 10);
    const buffer = { length: data.length, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => data };
    for (const bits of [16, 24]) {
      assert.deepEqual(await encoder.encodeAudioBufferToWavAsync(buffer, bits), encoder.encodeAudioBufferToWav(buffer, bits));
    }
  });
  await test('WAV worker parser keeps late transients/right channels and supports PCM/float/extensible', async () => {
    for (const settings of [{ bits: 8 }, { bits: 16 }, { bits: 24 }, { bits: 32 }, { bits: 32, float: true }, { bits: 64, float: true }, { bits: 24, extensible: true }]) {
      const file = path.join(temp, 'parser.wav'); fs.writeFileSync(file, wav({ ...settings, junk: 1025 }));
      const peaks = extractWavPeaks(file, 80);
      assert.equal(peaks[79], 0.75); assert.equal(peaks[0], 0);
    }
    const file = path.join(temp, 'parser.wav'); fs.writeFileSync(file, wav({ frames: 3 }));
    assert.equal(Math.max(...extractWavPeaks(file, 80)), 0.75);
    fs.writeFileSync(file, wav().subarray(0, 50)); assert.equal(extractWavPeaks(file, 80), null);
  });
  database.initDatabase();
  const file = path.join(temp, 'whoosh.wav'); fs.writeFileSync(file, wav());
  const stat = fs.statSync(file);
  const input = { path: file, name: 'whoosh', duration: 0.01, fileSize: stat.size, fileMtime: stat.mtimeMs };
  await test('manual type survives restart and automatic reclassification', async () => {
    database.upsertTrack(input);
    const track = database.getTrackByPath(file);
    const type = database.toggleTrackType(track.id);
    database.closeDatabase(); database.initDatabase();
    database.reclassifyAllTracks();
    assert.ok(database.getTrackTags(track.id).some(tag => tag.name === type));
    assert.equal(database.getTrackByPath(file).type_override, type);
  });
  await test('migration preserves legacy classification when manual origin was not recorded', async () => {
    const track = database.getTrackByPath(file);
    const tags = database.getTrackTags(track.id).map(tag => tag.name);
    database.getDatabase().exec('ALTER TABLE tracks DROP COLUMN type_override');
    database.closeDatabase(); database.initDatabase();
    assert.deepEqual(database.getTrackTags(track.id).map(tag => tag.name), tags);
    assert.ok(database.getTrackByPath(file).type_override);
  });
  await test('changed content invalidates peaks/gain/BPM and rejects late cache writes', async () => {
    const track = database.getTrackByPath(file);
    database.saveWaveformPeaks(track.id, 80, Array(80).fill(0.25), track.content_version);
    assert.equal(database.getTracks().find(t => t.id === track.id).peaks_80[0], 0.25);
    database.updateTrackPeakGain(track.id, 1.2); database.updateTrackBpm(track.id, 120); database.updateTrackRating(track.id, 5);
    database.upsertTrack({ ...input, fileMtime: stat.mtimeMs + 1 });
    const fresh = database.getTrackByPath(file);
    assert.equal(fresh.content_version, track.content_version + 1);
    assert.equal(fresh.peak_gain, null); assert.equal(fresh.bpm, null); assert.equal(fresh.rating, 5);
    database.saveWaveformPeaks(track.id, 80, Array(80).fill(0.9), track.content_version);
    database.updateTrackPeakGain(track.id, 1.5, track.content_version);
    assert.equal(database.getWaveformPeaks(track.id, 80), null); assert.equal(database.getTrackByPath(file).peak_gain, null);
  });
  await test('storage stats do not perform filesystem operations', async () => {
    const oldStat = fs.statSync, oldExists = fs.existsSync;
    fs.statSync = fs.existsSync = () => { throw Error('Unexpected synchronous filesystem access'); };
    try { assert.equal(database.getStorageStats().totalBytes, stat.size); }
    finally { fs.statSync = oldStat; fs.existsSync = oldExists; }
  });
  await test('folder filters treat underscores and percent signs literally', async () => {
    const literal = path.join(temp, 'a_b%');
    database.upsertTracks([{ path: path.join(literal, 'one.wav'), name: 'one', duration: 1 }, { path: path.join(temp, 'axbX', 'two.wav'), name: 'two', duration: 1 }]);
    assert.equal(database.getTracks({ folderPath: literal }).length, 1);
  });
  await test('classification filters and stats respect type_override over duration and tag presence', async () => {
    const sfxLongFile = path.join(temp, 'ambient_sfx_long.wav');
    fs.writeFileSync(sfxLongFile, wav());
    database.upsertTrack({ path: sfxLongFile, name: 'ambient_sfx_long', duration: 120 });
    const longTrack = database.getTrackByPath(sfxLongFile);
    database.getDatabase().prepare("UPDATE tracks SET type_override = 'SFX' WHERE id = ?").run(longTrack.id);

    const sfxResults = database.getTracks({ audioClassification: 'SFX' });
    const musicResults = database.getTracks({ audioClassification: 'Music' });
    assert.ok(sfxResults.some(t => t.id === longTrack.id));
    assert.ok(!musicResults.some(t => t.id === longTrack.id));

    const stats = database.getLibraryStats();
    assert.ok(stats.totalSfx >= 1);
  });
  const indexer = require('../dist/main/indexer.js');
  const workers = require('../dist/main/waveformService.js');
  await test('real file import parses metadata, stores 80 peaks and indexes edits', async () => {
    const folder = path.join(temp, 'audio'); fs.mkdirSync(folder);
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(folder, `${i}.wav`), wav());
    const result = await indexer.importDroppedPaths([folder]);
    assert.equal(result.imported, 12); assert.equal(result.errors.length, 0);
    const tracks = database.getTracks({ folderPath: folder });
    assert.equal(tracks.length, 12);
    for (const track of tracks) { assert.ok(track.duration > 0); assert.equal(track.peaks_80[79], 0.75); }
    const track = tracks[0]; fs.writeFileSync(track.path, wav({ frames: 960, impulse: 0 }));
    await indexer.indexFile(track.path);
    const fresh = database.getTracks({ folderPath: folder }).find(t => t.id === track.id);
    assert.ok(fresh.content_version > track.content_version); assert.equal(fresh.peaks_80[0], 0.75);
    assert.equal(fresh.peaks_80[79], 0);
  });
  await test('async rescan finds deleted and restored files without sync stats', async () => {
    const track = database.getTrackByPath(file);
    fs.unlinkSync(file);
    const oldExists = fs.existsSync, oldStat = fs.statSync;
    fs.existsSync = fs.statSync = () => { throw Error('Unexpected synchronous stat'); };
    try { await database.checkMissingTracks(); } finally { fs.existsSync = oldExists; fs.statSync = oldStat; }
    assert.equal(database.getTrackByPath(file).is_missing, 1);
    fs.writeFileSync(file, wav()); await indexer.rescanLibrary();
    assert.equal(database.getTrackByPath(file).is_missing, 0);
    assert.ok(database.getTrackByPath(file).content_version > track.content_version);
  });
  await test('disk bounce refuses stale source tokens and tokens preceding a clear', async () => {
    const bounce = require('../dist/main/bouncer.js');
    const check = bounce.isBouncedCached(file);
    bounce.clearBounceCache(); assert.equal(bounce.saveBouncedWav(file, wav(), check.sourceToken), '');
    const next = bounce.isBouncedCached(file);
    fs.writeFileSync(file, wav({ frames: 123 }));
    assert.equal(bounce.saveBouncedWav(file, wav(), next.sourceToken), '');
  });
  await workers.stopWaveformWorkers();
  await indexer.stopLibraryWatcher();
  database.closeDatabase();
  console.log(`\n${passed} regression tests passed. Temporary data: ${temp}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await require('../dist/main/waveformService.js').stopWaveformWorkers(); } catch {}
  try { await require('../dist/main/indexer.js').stopLibraryWatcher(); } catch {}
  try { require('../dist/main/db.js').closeDatabase(); } catch {}
  Module._load = originalLoad;
  // Remove only the uniquely created test directory under the resolved temp root.
  if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith('sfx-regression-')) fs.rmSync(temp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
});
