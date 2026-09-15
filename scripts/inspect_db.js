const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'Library/Application Support/sfx-music-manager/library.db');
try {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT path, duration, sample_rate, channels FROM tracks LIMIT 5').all();
  console.log('Sample tracks:', rows);
  const total = db.prepare('SELECT count(*) as total FROM tracks').get();
  console.log('Total tracks:', total);
  const exts = db.prepare('SELECT path FROM tracks').all().map(r => path.extname(r.path).toLowerCase());
  const counts = {};
  for (const ext of exts) counts[ext] = (counts[ext] || 0) + 1;
  console.log('Extension breakdown:', counts);
} catch (e) {
  console.log('Error opening db:', e.message);
}
