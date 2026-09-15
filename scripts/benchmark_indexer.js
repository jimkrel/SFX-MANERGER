const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

async function run() {
  const dbPath = path.join(os.homedir(), 'Library/Application Support/sfx-music-manager/library.db');
  const db = new Database(dbPath, { readonly: true });
  const allTracks = db.prepare('SELECT path FROM tracks').all().map(r => r.path).filter(p => fs.existsSync(p));
  console.log('Total valid tracks on disk:', allTracks.length);

  const { readWavPeaks, stopWaveformWorkers } = require('../dist/main/waveformService.js');
  const mm = await import('music-metadata');

  // Test full prepareFile simulation
  const t0 = performance.now();
  let count = 0;
  for (const file of allTracks) {
    const s1 = await fs.promises.stat(file);
    const meta = await mm.parseFile(file, { duration: true, skipCovers: true });
    let peaks = null;
    if (path.extname(file).toLowerCase() === '.wav') {
      peaks = await readWavPeaks(file, 80);
    }
    const s2 = await fs.promises.stat(file);
    count++;
  }
  const elapsed = performance.now() - t0;
  console.log(`Sequential processing ${count} files: ${elapsed.toFixed(1)}ms (${(elapsed / count).toFixed(2)}ms / file)`);

  await stopWaveformWorkers();
}

run().catch(console.error);
