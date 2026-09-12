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
  tagList?: Tag[];
}

export interface Tag {
  id: number;
  name: string;
  count?: number;
}

export interface SearchFilterOptions {
  searchQuery?: string;
  folderPath?: string;
  tagIds?: number[];
  tagMode?: 'AND' | 'OR';
  onlyAvailable?: boolean;
}

export interface LibraryStats {
  totalSfx: number;
  totalMusic: number;
  newThisWeek: number;
  totalMissing: number;
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

    -- Phase 4: Many-to-Many Tags System
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS track_tags (
      track_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (track_id, tag_id),
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- Phase 4: SQLite FTS5 Full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      track_id UNINDEXED,
      name,
      tags,
      tokenize = 'unicode61'
    );
  `);

  // Seed standard preset tags if empty
  const tagCount = db.prepare('SELECT count(*) as count FROM tags').get() as { count: number };
  if (tagCount.count === 0) {
    const seedStmt = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const presets = ['SFX', 'Music', 'Impact', 'Whoosh', 'Ambience', 'UI', 'Footsteps', 'Transition', 'Cinematic'];
    for (const preset of presets) {
      seedStmt.run(preset);
    }
  }

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

// FTS5 Sync helper
export function syncTrackFts(trackId: number): void {
  const database = getDatabase();
  const track = database.prepare('SELECT name FROM tracks WHERE id = ?').get(trackId) as { name: string } | undefined;
  if (!track) {
    database.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(trackId);
    return;
  }

  const tagRows = database
    .prepare(`
      SELECT t.name FROM tags t
      JOIN track_tags tt ON t.id = tt.tag_id
      WHERE tt.track_id = ?
    `)
    .all(trackId) as { name: string }[];

  const tagsStr = tagRows.map((r) => r.name).join(' ');

  database.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(trackId);
  database.prepare('INSERT INTO tracks_fts (track_id, name, tags) VALUES (?, ?, ?)').run(
    trackId,
    track.name,
    tagsStr
  );
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

  const row = database.prepare('SELECT id FROM tracks WHERE path = ?').get(data.path) as { id: number };
  if (row) {
    // Auto-tag default categories based on folder/duration if no tags assigned yet
    const currentTags = getTrackTags(row.id);
    if (currentTags.length === 0) {
      const lowerPath = data.path.toLowerCase();
      if (lowerPath.includes('/sfx/') || lowerPath.includes('sfx') || data.duration < 30) {
        addTagToTrack(row.id, 'SFX');
      }
      if (lowerPath.includes('/music/') || lowerPath.includes('music') || data.duration >= 30) {
        addTagToTrack(row.id, 'Music');
      }
    }
    syncTrackFts(row.id);
  }
}

export function markTrackMissing(trackPath: string, isMissing: boolean): void {
  const database = getDatabase();
  const stmt = database.prepare('UPDATE tracks SET is_missing = ? WHERE path = ?');
  stmt.run(isMissing ? 1 : 0, trackPath);
}

export function getTrackByPath(trackPath: string): Track | undefined {
  const database = getDatabase();
  return database.prepare('SELECT * FROM tracks WHERE path = ?').get(trackPath) as Track | undefined;
}

// Phase 4: Full-Text Search and Tag Filtering
export function getTracks(options?: SearchFilterOptions): Track[] {
  const database = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  // 1. Missing filter
  if (options?.onlyAvailable) {
    conditions.push('t.is_missing = 0');
  }

  // 2. Folder filter
  if (options?.folderPath) {
    conditions.push('t.path LIKE ?');
    params.push(`${options.folderPath}%`);
  }

  // 3. FTS5 Search by name + tags
  if (options?.searchQuery && options.searchQuery.trim().length > 0) {
    const rawTerms = options.searchQuery.trim().split(/\s+/).filter(Boolean);
    if (rawTerms.length > 0) {
      // Escape double quotes and add prefix match asterisk
      const ftsQuery = rawTerms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ');
      conditions.push(`t.id IN (SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?)`);
      params.push(ftsQuery);
    }
  }

  // 4. Tag Filtering (AND vs OR)
  if (options?.tagIds && options.tagIds.length > 0) {
    const placeholders = options.tagIds.map(() => '?').join(',');
    if (options.tagMode === 'AND') {
      conditions.push(`
        t.id IN (
          SELECT track_id FROM track_tags
          WHERE tag_id IN (${placeholders})
          GROUP BY track_id
          HAVING COUNT(DISTINCT tag_id) = ${options.tagIds.length}
        )
      `);
      params.push(...options.tagIds);
    } else {
      // OR mode
      conditions.push(`
        t.id IN (
          SELECT track_id FROM track_tags
          WHERE tag_id IN (${placeholders})
        )
      `);
      params.push(...options.tagIds);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT t.* FROM tracks t ${whereClause} ORDER BY t.added_at DESC`;

  const tracks = database.prepare(query).all(...params) as Track[];

  // Attach tags to tracks
  const trackTagMap = getTrackTagsBatch(tracks.map((t) => t.id));
  for (const track of tracks) {
    track.tagList = trackTagMap.get(track.id) || [];
  }

  return tracks;
}

// Tag Operations
export function getAllTags(): Tag[] {
  const database = getDatabase();
  return database
    .prepare(`
      SELECT t.id, t.name, COUNT(tt.track_id) AS count
      FROM tags t
      LEFT JOIN track_tags tt ON t.id = tt.tag_id
      GROUP BY t.id
      ORDER BY count DESC, t.name ASC
    `)
    .all() as Tag[];
}

export function getTrackTags(trackId: number): Tag[] {
  const database = getDatabase();
  return database
    .prepare(`
      SELECT t.id, t.name
      FROM tags t
      JOIN track_tags tt ON t.id = tt.tag_id
      WHERE tt.track_id = ?
      ORDER BY t.name ASC
    `)
    .all(trackId) as Tag[];
}

export function getTrackTagsBatch(trackIds: number[]): Map<number, Tag[]> {
  const map = new Map<number, Tag[]>();
  if (trackIds.length === 0) return map;

  const database = getDatabase();
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = database
    .prepare(`
      SELECT tt.track_id, t.id, t.name
      FROM tags t
      JOIN track_tags tt ON t.id = tt.tag_id
      WHERE tt.track_id IN (${placeholders})
      ORDER BY t.name ASC
    `)
    .all(...trackIds) as { track_id: number; id: number; name: string }[];

  for (const row of rows) {
    if (!map.has(row.track_id)) {
      map.set(row.track_id, []);
    }
    map.get(row.track_id)!.push({ id: row.id, name: row.name });
  }

  return map;
}

export function addTagToTrack(trackId: number, tagName: string): Tag {
  const database = getDatabase();
  const trimmed = tagName.trim();
  if (!trimmed) throw new Error('Tag name cannot be empty');

  // Insert tag into tags table if not exists
  database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(trimmed);
  const tag = database.prepare('SELECT id, name FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as Tag;

  // Link to track
  database.prepare('INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(trackId, tag.id);

  // Sync FTS
  syncTrackFts(trackId);

  return tag;
}

export function removeTagFromTrack(trackId: number, tagId: number): void {
  const database = getDatabase();
  database.prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?').run(trackId, tagId);
  syncTrackFts(trackId);
}

// Phase 4: Stat Bar Metrics
export function getLibraryStats(): LibraryStats {
  const database = getDatabase();

  const totalSfxRow = database
    .prepare(`
      SELECT COUNT(DISTINCT t.id) AS count
      FROM tracks t
      LEFT JOIN track_tags tt ON t.id = tt.track_id
      LEFT JOIN tags g ON tt.tag_id = g.id
      WHERE g.name = 'SFX' OR t.path LIKE '%sfx%' OR t.duration < 30
    `)
    .get() as { count: number };

  const totalMusicRow = database
    .prepare(`
      SELECT COUNT(DISTINCT t.id) AS count
      FROM tracks t
      LEFT JOIN track_tags tt ON t.id = tt.track_id
      LEFT JOIN tags g ON tt.tag_id = g.id
      WHERE g.name = 'Music' OR t.path LIKE '%music%' OR t.duration >= 30
    `)
    .get() as { count: number };

  const newThisWeekRow = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM tracks
      WHERE added_at >= datetime('now', '-7 days')
    `)
    .get() as { count: number };

  const totalMissingRow = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM tracks
      WHERE is_missing = 1
    `)
    .get() as { count: number };

  return {
    totalSfx: totalSfxRow?.count || 0,
    totalMusic: totalMusicRow?.count || 0,
    newThisWeek: newThisWeekRow?.count || 0,
    totalMissing: totalMissingRow?.count || 0
  };
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
