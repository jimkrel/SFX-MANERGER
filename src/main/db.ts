import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface Track {
  id: number;
  path: string;
  name: string;
  duration: number;
  sample_rate: number | null;
  channels: number | null;
  tags: string;
  is_missing: number;
  added_at: string;
}

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  const dbPath = path.join(userDataPath, 'library.db');
  console.log('[Database] Opening SQLite database at:', dbPath);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      duration REAL NOT NULL DEFAULT 0,
      sample_rate INTEGER,
      channels INTEGER,
      tags TEXT DEFAULT '',
      is_missing INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_is_missing ON tracks(is_missing);

    CREATE TABLE IF NOT EXISTS watched_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS waveform_cache (
      track_id INTEGER NOT NULL,
      resolution INTEGER NOT NULL,
      peaks TEXT NOT NULL,
      PRIMARY KEY (track_id, resolution),
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
  `);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Closed database connection.');
  }
}

// Track operations
export function upsertTrack(data: {
  path: string;
  name: string;
  duration: number;
  sampleRate?: number | null;
  channels?: number | null;
}): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO tracks (path, name, duration, sample_rate, channels, is_missing)
    VALUES (@path, @name, @duration, @sampleRate, @channels, 0)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      duration = excluded.duration,
      sample_rate = excluded.sample_rate,
      channels = excluded.channels,
      is_missing = 0
  `);

  stmt.run({
    path: data.path,
    name: data.name,
    duration: data.duration,
    sampleRate: data.sampleRate ?? null,
    channels: data.channels ?? null
  });
}

export function markTrackMissing(trackPath: string, isMissing: boolean): void {
  const database = getDatabase();
  const stmt = database.prepare('UPDATE tracks SET is_missing = ? WHERE path = ?');
  stmt.run(isMissing ? 1 : 0, trackPath);
}

export function getTracks(options?: { onlyAvailable?: boolean }): Track[] {
  const database = getDatabase();
  if (options?.onlyAvailable) {
    return database.prepare('SELECT * FROM tracks WHERE is_missing = 0 ORDER BY added_at DESC').all() as Track[];
  }
  return database.prepare('SELECT * FROM tracks ORDER BY added_at DESC').all() as Track[];
}

export function getTrackByPath(trackPath: string): Track | undefined {
  const database = getDatabase();
  return database.prepare('SELECT * FROM tracks WHERE path = ?').get(trackPath) as Track | undefined;
}

// Watched Folders operations
export function addWatchedFolder(folderPath: string): void {
  const database = getDatabase();
  const stmt = database.prepare('INSERT OR IGNORE INTO watched_folders (path) VALUES (?)');
  stmt.run(folderPath);
}

export function removeWatchedFolder(folderPath: string): void {
  const database = getDatabase();
  database.prepare('DELETE FROM watched_folders WHERE path = ?').run(folderPath);
}

export function getWatchedFolders(): string[] {
  const database = getDatabase();
  const rows = database.prepare('SELECT path FROM watched_folders ORDER BY id ASC').all() as { path: string }[];
  return rows.map((r) => r.path);
}

// Check missing tracks against disk
export function checkMissingTracks(): { checked: number; missing: number; recovered: number } {
  const database = getDatabase();
  const tracks = database.prepare('SELECT id, path, is_missing FROM tracks').all() as {
    id: number;
    path: string;
    is_missing: number;
  }[];

  let missingCount = 0;
  let recoveredCount = 0;

  const updateStmt = database.prepare('UPDATE tracks SET is_missing = ? WHERE id = ?');
  const transaction = database.transaction(() => {
    for (const track of tracks) {
      const exists = fs.existsSync(track.path);
      if (!exists && track.is_missing === 0) {
        updateStmt.run(1, track.id);
        missingCount++;
      } else if (exists && track.is_missing === 1) {
        updateStmt.run(0, track.id);
        recoveredCount++;
      }
    }
  });

  transaction();

  return {
    checked: tracks.length,
    missing: missingCount,
    recovered: recoveredCount
  };
}

// Waveform Cache operations
export function getWaveformPeaks(trackId: number, resolution: number): number[] | null {
  const database = getDatabase();
  const row = database
    .prepare('SELECT peaks FROM waveform_cache WHERE track_id = ? AND resolution = ?')
    .get(trackId, resolution) as { peaks: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.peaks);
  } catch {
    return null;
  }
}

export function saveWaveformPeaks(trackId: number, resolution: number, peaks: number[]): void {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO waveform_cache (track_id, resolution, peaks)
    VALUES (?, ?, ?)
    ON CONFLICT(track_id, resolution) DO UPDATE SET
      peaks = excluded.peaks
  `);
  stmt.run(trackId, resolution, JSON.stringify(peaks));
}

