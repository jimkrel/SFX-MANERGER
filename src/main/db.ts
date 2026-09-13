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
  rating?: number;
  is_favorite?: number;
  category?: string;
  bpm?: number | null;
  peak_gain?: number | null;
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
  favoriteOnly?: boolean;
  category?: string;
  rating?: number;
  sortBy?: 'newest' | 'duration_desc' | 'rating_desc' | 'name_asc';
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

  const userDataPath =
    app && typeof app.getPath === 'function'
      ? app.getPath('userData')
      : path.join(process.cwd(), '.userData');
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
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rating INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      category TEXT DEFAULT ''
    );`);

  // Migrations for existing DBs
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN added_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN rating INTEGER DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN is_favorite INTEGER DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN category TEXT DEFAULT ''`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN bpm INTEGER DEFAULT NULL`);
  } catch {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN peak_gain REAL DEFAULT NULL`);
  } catch {}

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
    CREATE INDEX IF NOT EXISTS idx_tracks_is_missing ON tracks(is_missing);
    CREATE INDEX IF NOT EXISTS idx_tracks_is_favorite ON tracks(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(rating);

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
      category,
      tokenize = 'unicode61'
    );
  `);

  console.log('[Database] Schema initialized successfully.');

  // Auto-reclassify any existing tracks that are 'Khác', empty, or null with improved rules
  try {
    const unclassified = db.prepare(
      "SELECT id, path, name FROM tracks WHERE category IS NULL OR category = '' OR category = 'Khác'"
    ).all() as { id: number; path: string; name: string }[];

    if (unclassified.length > 0) {
      const updateCatStmt = db.prepare('UPDATE tracks SET category = ? WHERE id = ?');
      const updateTransaction = db.transaction(() => {
        for (const t of unclassified) {
          const inferred = inferCategory(t.path, t.name);
          if (inferred !== 'Khác') {
            updateCatStmt.run(inferred, t.id);
            syncTrackFts(t.id);
          }
        }
      });
      updateTransaction();
      console.log(`[Database] Auto-reclassified ${unclassified.length} tracks with improved keywords.`);
    }
  } catch (err) {
    console.warn('[Database] Auto-reclassify warning:', err);
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
    console.log('[Database] Database connection closed.');
  }
}

export function inferCategory(filePath: string, name: string): string {
  // Normalize string: lowercase, replace underscores, hyphens, dots, slashes with spaces
  const raw = `${filePath} ${name}`.toLowerCase();
  const s = raw.replace(/[_\-./\\]+/g, ' ');

  // 1. Cinematic / Epic / Trailer / Dramatic
  const cinematicKeywords = [
    'cinematic', 'trailer', 'impact', 'hit', 'boom', 'riser', 'whoosh', 'swoosh',
    'downer', 'subdrop', 'braam', 'tension', 'action', 'epic', 'dramatic',
    'hybrid', 'orchestral', 'intro', 'outro', 'brass', 'horn', 'slam',
    'thud', 'punch', 'transition', 'sting', 'stinger', 'tunetank', 'inspiring',
    'heroic', 'suspense', 'dark', 'glitch', 'drop', 'explosion', 'smash', 'crash'
  ];
  for (const kw of cinematicKeywords) {
    if (raw.includes(kw) || s.includes(kw)) return 'Cinematic';
  }

  // 2. Foley / Physical / Everyday Human actions
  const foleyKeywords = [
    'foley', 'footstep', 'footsteps', 'step', 'steps', 'walk', 'run', 'door',
    'cloth', 'clothing', 'wood', 'glass', 'metal', 'paper', 'page', 'creak',
    'chair', 'key', 'keys', 'lock', 'switch', 'handle', 'kitchen', 'coin',
    'coins', 'cup', 'cutlery', 'fabric', 'zipper', 'shoe', 'shoes', 'boot',
    'boots', 'card', 'box', 'slide', 'scrape', 'scratch', 'rustle', 'flesh',
    'bone', 'break', 'shatter', 'applause', 'cheer', 'clap', 'breath', 'cough',
    'human', 'body', 'slap', 'grab', 'drawer', 'cabinet'
  ];
  for (const kw of foleyKeywords) {
    if (raw.includes(kw) || s.includes(kw)) return 'Foley';
  }

  // 3. Ambience / Atmosphere / Background tones
  const ambienceKeywords = [
    'ambience', 'ambient', 'atmos', 'atmosphere', 'drone', 'roomtone', 'room tone',
    'room', 'space', 'wind', 'city', 'street', 'traffic', 'subway', 'train',
    'hall', 'interior', 'exterior', 'reverb', 'night', 'crowd', 'office',
    'market', 'park', 'cafe', 'restaurant', 'background', 'walla', 'air',
    'underwater', 'hum', 'noise', 'suburb', 'harbor', 'airport'
  ];
  for (const kw of ambienceKeywords) {
    if (raw.includes(kw) || s.includes(kw)) return 'Ambience';
  }

  // 4. UI / Digital / Tech / Clicks / Beeps
  const uiKeywords = [
    'ui', 'digital', 'button', 'click', 'pop', 'notification', 'alert', 'beep',
    'interface', 'hud', 'cyber', 'tech', 'electronic', 'game', 'menu', 'select',
    'hover', 'toggle', 'tap', 'ping', 'chime', 'bell', 'error', 'success',
    'cancel', 'confirm', 'swipe', 'scroll', 'sci-fi', 'scifi', 'computer',
    'type', 'keyboard', 'mouse', 'cursor', 'teleport', 'laser', 'synth'
  ];
  for (const kw of uiKeywords) {
    if (raw.includes(kw) || s.includes(kw)) return 'UI / Digital';
  }

  // 5. Nature / Animals / Elements
  const natureKeywords = [
    'nature', 'thunder', 'rain', 'water', 'stream', 'river', 'sea', 'ocean',
    'wave', 'waves', 'forest', 'jungle', 'animal', 'animals', 'bird', 'birds',
    'dog', 'cat', 'insect', 'insects', 'cricket', 'crickets', 'frog', 'frogs',
    'storm', 'lightning', 'fire', 'campfire', 'burn', 'splash', 'waterfall',
    'leaf', 'leaves', 'outdoor', 'windy', 'creek', 'lake', 'woodland'
  ];
  for (const kw of natureKeywords) {
    if (raw.includes(kw) || s.includes(kw)) return 'Nature';
  }

  return 'Khác';
}

// Sync single track into FTS5
export function syncTrackFts(trackId: number): void {
  const database = getDatabase();
  const track = database.prepare('SELECT name, tags, category FROM tracks WHERE id = ?').get(trackId) as
    | { name: string; tags: string; category?: string }
    | undefined;

  if (!track) return;

  const currentTags = getTrackTags(trackId);
  const tagsStr = currentTags.map((t) => t.name).join(' ');
  const categoryStr = track.category || '';

  database.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(trackId);
  try {
    database.prepare('INSERT INTO tracks_fts (track_id, name, tags, category) VALUES (?, ?, ?, ?)').run(
      trackId,
      track.name,
      tagsStr,
      categoryStr
    );
  } catch {
    // Fallback if category column not in fts schema
    database.prepare('INSERT INTO tracks_fts (track_id, name, tags) VALUES (?, ?, ?)').run(
      trackId,
      track.name,
      tagsStr
    );
  }
}

// Track operations
export function upsertTrack(data: {
  path: string;
  name: string;
  duration: number;
  sampleRate?: number | null;
  channels?: number | null;
  category?: string;
}): void {
  const database = getDatabase();
  const normPath = data.path.normalize('NFC');
  const cat = data.category || inferCategory(normPath, data.name);

  const stmt = database.prepare(`
    INSERT INTO tracks (path, name, duration, sample_rate, channels, category, is_missing)
    VALUES (@path, @name, @duration, @sampleRate, @channels, @category, 0)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      duration = excluded.duration,
      sample_rate = excluded.sample_rate,
      channels = excluded.channels,
      category = CASE WHEN tracks.category = '' OR tracks.category = 'Khác' OR tracks.category IS NULL THEN excluded.category ELSE tracks.category END,
      is_missing = 0
  `);

  stmt.run({
    path: normPath,
    name: data.name,
    duration: data.duration,
    sampleRate: data.sampleRate ?? null,
    channels: data.channels ?? null,
    category: cat
  });

  const row = database.prepare('SELECT id FROM tracks WHERE path = ?').get(normPath) as { id: number };
  if (row) {
    const currentTags = getTrackTags(row.id);
    if (currentTags.length === 0) {
      const lowerPath = normPath.toLowerCase();
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

export function updateTrackRating(trackId: number, rating: number): void {
  const database = getDatabase();
  const safeRating = Math.max(0, Math.min(5, Math.round(rating)));
  database.prepare('UPDATE tracks SET rating = ? WHERE id = ?').run(safeRating, trackId);
}

export function toggleTrackFavorite(trackId: number): number {
  const database = getDatabase();
  const current = database.prepare('SELECT is_favorite FROM tracks WHERE id = ?').get(trackId) as
    | { is_favorite: number }
    | undefined;
  const nextVal = current && current.is_favorite === 1 ? 0 : 1;
  database.prepare('UPDATE tracks SET is_favorite = ? WHERE id = ?').run(nextVal, trackId);
  return nextVal;
}

export function updateTrackCategory(trackId: number, category: string): void {
  const database = getDatabase();
  database.prepare('UPDATE tracks SET category = ? WHERE id = ?').run(category, trackId);
  syncTrackFts(trackId);
}

export function updateTrackBpm(trackId: number, bpm: number | null): void {
  const database = getDatabase();
  database.prepare('UPDATE tracks SET bpm = ? WHERE id = ?').run(bpm, trackId);
}

export function updateTrackPeakGain(trackId: number, peakGain: number): void {
  const database = getDatabase();
  database.prepare('UPDATE tracks SET peak_gain = ? WHERE id = ?').run(peakGain, trackId);
}

export function bulkAddTag(trackIds: number[], tagName: string): void {
  for (const id of trackIds) {
    addTagToTrack(id, tagName);
  }
}

export function bulkRemoveTag(trackIds: number[], tagId: number): void {
  for (const id of trackIds) {
    removeTagFromTrack(id, tagId);
  }
}

export function bulkDeleteTracks(trackIds: number[]): void {
  if (!trackIds.length) return;
  const database = getDatabase();
  const placeholders = trackIds.map(() => '?').join(',');
  database.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...trackIds);
}

export function getStorageStats(): { totalBytes: number; totalFiles: number } {
  const database = getDatabase();
  const rows = database.prepare('SELECT path FROM tracks WHERE is_missing = 0').all() as { path: string }[];
  let totalBytes = 0;
  let count = 0;
  for (const r of rows) {
    try {
      if (fs.existsSync(r.path)) {
        totalBytes += fs.statSync(r.path).size;
        count++;
      }
    } catch {}
  }
  return { totalBytes, totalFiles: count };
}

export function markTrackMissing(trackPath: string, isMissing: boolean): void {
  const database = getDatabase();
  const stmt = database.prepare('UPDATE tracks SET is_missing = ? WHERE path = ?');
  stmt.run(isMissing ? 1 : 0, trackPath.normalize('NFC'));
}

export function getTrackByPath(trackPath: string): Track | undefined {
  const database = getDatabase();
  return database.prepare('SELECT * FROM tracks WHERE path = ?').get(trackPath.normalize('NFC')) as Track | undefined;
}

// Phase 4: Full-Text Search, Category, Favorite, Rating and Tag Filtering
export function getTracks(options?: SearchFilterOptions): Track[] {
  const database = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  // 1. Missing filter
  if (options?.onlyAvailable) {
    conditions.push('t.is_missing = 0');
  }

  // 2. Favorite filter
  if (options?.favoriteOnly) {
    conditions.push('t.is_favorite = 1');
  }

  // 3. Category filter
  if (options?.category && options.category !== 'Tất cả') {
    conditions.push('t.category = ?');
    params.push(options.category);
  }

  // 4. Rating filter
  if (options?.rating && options.rating > 0) {
    conditions.push('t.rating >= ?');
    params.push(options.rating);
  }

  // 5. Folder filter
  if (options?.folderPath) {
    conditions.push('t.path LIKE ?');
    params.push(`${options.folderPath.normalize('NFC')}%`);
  }

  // 6. FTS5 Search by name + tags + category
  if (options?.searchQuery && options.searchQuery.trim().length > 0) {
    const rawTerms = options.searchQuery.trim().split(/\s+/).filter(Boolean);
    if (rawTerms.length > 0) {
      const ftsQuery = rawTerms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' ');
      conditions.push(`t.id IN (SELECT track_id FROM tracks_fts WHERE tracks_fts MATCH ?)`);
      params.push(ftsQuery);
    }
  }

  // 7. Tag Filtering (AND vs OR)
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
      conditions.push(`
        t.id IN (
          SELECT track_id FROM track_tags
          WHERE tag_id IN (${placeholders})
        )
      `);
      params.push(...options.tagIds);
    }
  }

  let orderBy = 't.added_at DESC';
  if (options?.sortBy === 'duration_desc') {
    orderBy = 't.duration DESC';
  } else if (options?.sortBy === 'rating_desc') {
    orderBy = 't.rating DESC, t.added_at DESC';
  } else if (options?.sortBy === 'name_asc') {
    orderBy = 't.name COLLATE NOCASE ASC';
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT t.* FROM tracks t ${whereClause} ORDER BY ${orderBy}`;

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
      INNER JOIN track_tags tt ON t.id = tt.tag_id
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
      INNER JOIN track_tags tt ON t.id = tt.tag_id
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

export function addTagToTrack(trackId: number, tagName: string): void {
  const cleanName = tagName.trim().normalize('NFC');
  if (!cleanName) return;

  const database = getDatabase();
  const getOrInsertTag = database.transaction(() => {
    database.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(cleanName);
    const tag = database.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(cleanName) as { id: number };
    database.prepare('INSERT OR IGNORE INTO track_tags (track_id, tag_id) VALUES (?, ?)').run(trackId, tag.id);
  });

  getOrInsertTag();
  syncTrackFts(trackId);
}

export function removeTagFromTrack(trackId: number, tagId: number): void {
  const database = getDatabase();
  database.prepare('DELETE FROM track_tags WHERE track_id = ? AND tag_id = ?').run(trackId, tagId);
  database.prepare(`
    DELETE FROM tags
    WHERE id = ? AND id NOT IN (SELECT DISTINCT tag_id FROM track_tags)
  `).run(tagId);

  syncTrackFts(trackId);
}

// Watched Folders operations
export function addWatchedFolder(folderPath: string): void {
  const database = getDatabase();
  const normPath = folderPath.normalize('NFC');
  const stmt = database.prepare(`
    INSERT INTO watched_folders (path)
    VALUES (?)
    ON CONFLICT(path) DO NOTHING
  `);
  stmt.run(normPath);
}

export function removeWatchedFolder(folderPath: string): void {
  const database = getDatabase();
  const normPath = folderPath.normalize('NFC');
  const stmt = database.prepare('DELETE FROM watched_folders WHERE path = ?');
  stmt.run(normPath);
}

export function getWatchedFolders(): string[] {
  const database = getDatabase();
  const rows = database.prepare('SELECT path FROM watched_folders ORDER BY added_at ASC').all() as { path: string }[];
  return rows.map((r) => r.path);
}

// Library Stats operations
export function getLibraryStats(): LibraryStats {
  const database = getDatabase();

  const totalSfxRow = database
    .prepare(`
      SELECT COUNT(DISTINCT t.id) as count
      FROM tracks t
      LEFT JOIN track_tags tt ON t.id = tt.track_id
      LEFT JOIN tags tag ON tt.tag_id = tag.id
      WHERE (tag.name = 'SFX' OR t.duration < 30) AND t.is_missing = 0
    `)
    .get() as { count: number };

  const totalMusicRow = database
    .prepare(`
      SELECT COUNT(DISTINCT t.id) as count
      FROM tracks t
      LEFT JOIN track_tags tt ON t.id = tt.track_id
      LEFT JOIN tags tag ON tt.tag_id = tag.id
      WHERE (tag.name = 'Music' OR t.duration >= 30) AND t.is_missing = 0
    `)
    .get() as { count: number };

  const newThisWeekRow = database
    .prepare(`
      SELECT COUNT(*) as count
      FROM tracks
      WHERE added_at >= datetime('now', '-7 days') AND is_missing = 0
    `)
    .get() as { count: number };

  const totalMissingRow = database
    .prepare('SELECT COUNT(*) as count FROM tracks WHERE is_missing = 1')
    .get() as { count: number };

  return {
    totalSfx: totalSfxRow ? totalSfxRow.count : 0,
    totalMusic: totalMusicRow ? totalMusicRow.count : 0,
    newThisWeek: newThisWeekRow ? newThisWeekRow.count : 0,
    totalMissing: totalMissingRow ? totalMissingRow.count : 0
  };
}

// Check and mark missing tracks
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
