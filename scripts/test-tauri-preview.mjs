// Renderer contract test. The Rust integration test exercises real file IO and WAV peaks.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: `import './src/renderer/src/tauriBridge';
    export { audioPlayer } from './src/renderer/src/audio/player';
    export { getOrComputePeaks } from './src/renderer/src/audio/waveform';`, resolveDir: process.cwd() },
  bundle: true, format: 'iife', globalName: 'testApi', write: false,
});
let reads = 0;
const samples = new Float32Array([0, -1, 0, 0.25]);
class AudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} }; }
  async decodeAudioData(bytes) {
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
    return { length: 4, duration: 1, numberOfChannels: 1, getChannelData: () => samples };
  }
}
const invoke = async (name, args) => {
  if (name === 'read_audio_buffer') {
    assert.equal(args.trackId, 7);
    ++reads;
    return Uint8Array.of(1, 2, 3).buffer;
  }
  if (name === 'waveform_peaks') return null;
  if (name === 'library_write') return true;
  throw Error(name);
};
const scope = vm.createContext({ window: { AudioContext, __TAURI__: { core: { invoke } } },
  navigator: { platform: 'Win32' }, console, setTimeout, Uint8Array });
vm.runInContext(bundle.outputFiles[0].text, scope);
const { audioPlayer: player, getOrComputePeaks } = scope.testApi;
const track = { id: 7, path: 'tone.flac', duration: 1, content_version: 0 };
await player.play(track);
assert.equal(player.getState().isPlaying, true);
player.pause();
assert.equal(player.getState().isPlaying, false);
await player.seek(0.25);
await player.resume();
assert.equal(player.getCurrentTime(), 0.25);
player.setLooping(true);
player.setVolume(0.4);
assert.equal(player.getState().isLooping, true);
assert.equal(player.getState().volume, 0.4);
assert.deepEqual([...await getOrComputePeaks(track, 4)], [0, 1, 0, 0.25]);
assert.equal(reads, 1);
player.refreshTracks([{ ...track, content_version: 1 }]);
assert.equal(player.getState().isPlaying, false);
console.log('PASS: binary IPC, transport controls, waveform fallback, cache and version invalidation');
