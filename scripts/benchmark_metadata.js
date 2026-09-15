const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

async function run() {
  const dbPath = path.join(os.homedir(), 'Library/Application Support/sfx-music-manager/library.db');
  const db = new Database(dbPath, { readonly: true });
  const sampleTracks = db.prepare('SELECT path FROM tracks LIMIT 20').all().map(r => r.path);
  console.log('Sample tracks to test:', sampleTracks.length);

  // Check how many actually exist on disk right now
  const existingTracks = sampleTracks.filter(p => fs.existsSync(p));
  console.log('Existing tracks accessible:', existingTracks.length);

  if (existingTracks.length === 0) {
    console.log('Files on external drive /Volumes/Tài are currently unmounted or not found.');
    return;
  }

  const mm = await import('music-metadata');

  const start = performance.now();
  for (const track of existingTracks) {
    const t0 = performance.now();
    const meta = await mm.parseFile(track, { duration: true, skipCovers: true });
    const elapsed = performance.now() - t0;
    console.log(`[${path.extname(track)}] ${path.basename(track)}: ${elapsed.toFixed(1)}ms | duration: ${meta.format.duration}s`);
  }
  const total = performance.now() - start;
  console.log(`Average time per file: ${(total / existingTracks.length).toFixed(1)}ms | Total: ${total.toFixed(1)}ms`);
}

run().catch(console.error);
