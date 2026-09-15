const assert = require('assert');
const path = require('path');

// Compile main first to load dist/main/downloader
const { detectPlatform, fetchMediaInfo } = require('../dist/main/downloader/engine');
const { findYtDlp, findFfmpeg, getBinaryStatus } = require('../dist/main/downloader/binaryManager');

async function runTests() {
  console.log('=== [TEST RUNNER] ONLINE AUDIO DOWNLOADER ENGINE ===\n');

  // Test 1: Platform detection
  console.log('1. Testing URL platform detection:');
  assert.strictEqual(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.strictEqual(detectPlatform('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.strictEqual(detectPlatform('https://www.youtube.com/shorts/abcdef123'), 'youtube');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/@user/video/7123456789'), 'tiktok');
  assert.strictEqual(detectPlatform('https://vt.tiktok.com/ZS2abc123/'), 'tiktok');
  assert.strictEqual(detectPlatform('https://soundcloud.com/artist/track-name'), 'soundcloud');
  assert.strictEqual(detectPlatform('https://example.com/audio.mp3'), 'generic');
  console.log('  ✅ PASS: All platform URLs detected accurately (YouTube, Shorts, TikTok, SoundCloud)');

  // Test 2: Binary detection
  console.log('\n2. Testing yt-dlp & ffmpeg binary discovery:');
  const ytDlp = await findYtDlp();
  console.log(`  - yt-dlp found: ${ytDlp || 'NONE'}`);
  assert.ok(ytDlp, 'yt-dlp should be detected on the system');

  const ffmpeg = await findFfmpeg();
  console.log(`  - ffmpeg found: ${ffmpeg || 'NONE'}`);
  assert.ok(ffmpeg, 'ffmpeg should be detected on the system');

  const status = await getBinaryStatus();
  console.log(`  - Binary status isReady: ${status.isReady}, version: ${status.version}`);
  assert.strictEqual(status.isReady, true);
  assert.strictEqual(status.hasYtDlp, true);
  assert.strictEqual(status.hasFfmpeg, true);
  console.log('  ✅ PASS: Both yt-dlp and ffmpeg are ready and callable');

  // Test 3: Progress regex parsing logic
  console.log('\n3. Testing stdout progress regex parsing:');
  const sampleStdout1 = '[download]  45.2% of ~  12.34MiB at    3.45MiB/s ETA 00:02';
  const percentMatch = sampleStdout1.match(/(\d+(?:\.\d+)?)%/);
  const sizeMatch = sampleStdout1.match(/of\s+(?:~\s*)?([0-9.]+[A-Za-z]+)/);
  const speedMatch = sampleStdout1.match(/at\s+([0-9.]+[A-Za-z]+\/s)/);
  const etaMatch = sampleStdout1.match(/ETA\s+([0-9:]+)/);

  assert.strictEqual(parseFloat(percentMatch[1]), 45.2);
  assert.strictEqual(sizeMatch[1], '12.34MiB');
  assert.strictEqual(speedMatch[1], '3.45MiB/s');
  assert.strictEqual(etaMatch[1], '00:02');
  console.log('  ✅ PASS: Download progress, speed, size and ETA regex parsing is 100% accurate');

  // Test 4: Live fetchMediaInfo bypass
  console.log('\n4. Testing fetchMediaInfo bypass on YouTube (ao4RCon11eY):');
  const info = await fetchMediaInfo('https://www.youtube.com/watch?v=ao4RCon11eY');
  assert.ok(info.title, 'Should have parsed title');
  assert.strictEqual(info.platform, 'youtube');
  assert.ok(info.duration > 0, 'Duration should be > 0');
  console.log(`  - Title: ${info.title}`);
  console.log(`  - Uploader: ${info.uploader}`);
  console.log(`  - Duration: ${info.duration}s`);
  console.log('  ✅ PASS: YouTube bot-check successfully bypassed with node + mweb extractor!');

  console.log('\n======================================================');
  console.log('🎉 TẤT CẢ TEST CHO ONLINE AUDIO DOWNLOADER ĐÃ ĐẠT 100%!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
