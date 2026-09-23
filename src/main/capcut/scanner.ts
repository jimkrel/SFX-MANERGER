import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapCutTextLayer {
  id: string;
  parsedText: string;
  fontPath: string;
  fontFilename: string;
  fontSize: number;
  color: number[]; // [r, g, b] normalized 0-1
  bold: boolean;
  isFontBroken: boolean;
}

export interface CapCutEffect {
  id: string;
  name: string;
  type: string;
  resourceId: string;
  effectPath: string;
}

export interface CapCutAnimMaterial {
  id: string;
  type: string; // 'sticker_animation'
}

export interface CapCutPreset {
  id: string;
  name: string;
  folderPath: string;
  thumbnailPath: string;
  createdAt: number; // Unix ms
  draftVersion: string;
  type: string;
  texts: CapCutTextLayer[];
  effects: CapCutEffect[];
  animations: CapCutAnimMaterial[];
  hasBrokenFonts: boolean;
  brokenFontCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseTextContent(rawContent: string): { text: string; color: number[]; bold: boolean } {
  try {
    const obj = JSON.parse(rawContent);
    const text = obj.text || '';
    let color = [1, 1, 1];
    let bold = false;
    if (obj.styles && obj.styles.length > 0) {
      const style = obj.styles[0];
      if (style.fill?.content?.solid?.color) {
        color = style.fill.content.solid.color;
      }
      if (style.bold) bold = true;
    }
    return { text, color, bold };
  } catch {
    return { text: rawContent, color: [1, 1, 1], bold: false };
  }
}

function isFontPathBroken(fontPath: string): boolean {
  if (!fontPath || fontPath.trim() === '') return false;
  // Check if path references a different user
  const currentUser = os.userInfo().username;
  const normalizedPath = fontPath.replace(/\\/g, '/');
  // If it's an absolute path to a different user's folder, it's broken
  const userPathMatch = normalizedPath.match(/\/Users\/([^/]+)\//i);
  if (userPathMatch && userPathMatch[1].toLowerCase() !== currentUser.toLowerCase()) {
    return true;
  }
  // Check if file actually exists
  try {
    return !fs.existsSync(fontPath);
  } catch {
    return true;
  }
}

// Recursively find all text segments and their material IDs from deeply nested tracks
function findTextMaterialIds(obj: unknown, results: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach((item) => findTextMaterialIds(item, results));
    return results;
  }
  const record = obj as Record<string, unknown>;
  if (record.tracks && Array.isArray(record.tracks)) {
    (record.tracks as Record<string, unknown>[]).forEach((track) => {
      if (track.type === 'text' && Array.isArray(track.segments)) {
        (track.segments as Record<string, unknown>[]).forEach((seg) => {
          if (seg.material_id) results.push(seg.material_id as string);
        });
      }
      findTextMaterialIds(track, results);
    });
  }
  Object.values(record).forEach((v) => {
    if (v && typeof v === 'object') findTextMaterialIds(v, results);
  });
  return results;
}

// Find a material by ID anywhere in the JSON tree
function findMaterialById(obj: unknown, id: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findMaterialById(item, id);
      if (r) return r;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  if (record.id === id) return record;
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object') {
      const r = findMaterialById(v, id);
      if (r) return r;
    }
  }
  return null;
}

// Find all material_animations anywhere in tree
function findAllMaterialAnimations(obj: unknown, results: CapCutAnimMaterial[] = []): CapCutAnimMaterial[] {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach((item) => findAllMaterialAnimations(item, results));
    return results;
  }
  const record = obj as Record<string, unknown>;
  if (record.material_animations && Array.isArray(record.material_animations)) {
    (record.material_animations as Record<string, unknown>[]).forEach((anim) => {
      if (anim.id) {
        results.push({ id: anim.id as string, type: (anim.type as string) || 'sticker_animation' });
      }
    });
  }
  Object.values(record).forEach((v) => {
    if (v && typeof v === 'object') findAllMaterialAnimations(v, results);
  });
  return results;
}

// Find all effects with resource_id
function findAllEffects(obj: unknown, results: CapCutEffect[] = []): CapCutEffect[] {
  if (!obj || typeof obj !== 'object') return results;
  if (Array.isArray(obj)) {
    obj.forEach((item) => findAllEffects(item, results));
    return results;
  }
  const record = obj as Record<string, unknown>;
  if (record.resource_id && record.name && typeof record.type === 'string') {
    results.push({
      id: (record.id as string) || '',
      name: (record.name as string) || '',
      type: record.type as string,
      resourceId: record.resource_id as string,
      effectPath: (record.path as string) || '',
    });
  }
  Object.values(record).forEach((v) => {
    if (v && typeof v === 'object') findAllEffects(v, results);
  });
  return results;
}

// ─── Main Scanner ─────────────────────────────────────────────────────────────

export async function scanCapCutPresets(presetsDir: string): Promise<CapCutPreset[]> {
  const presets: CapCutPreset[] = [];

  if (!fs.existsSync(presetsDir)) return presets;

  const entries = fs.readdirSync(presetsDir, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory());

  for (const folder of folders) {
    const folderPath = path.join(presetsDir, folder.name);

    try {
      // Find metadata JSON
      const jsonFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith('.json'));
      if (jsonFiles.length === 0) continue;

      const metaPath = path.join(folderPath, jsonFiles[0]);
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      // Find thumbnail
      const jpegFiles = fs.readdirSync(folderPath).filter((f) => f.endsWith('.jpeg') || f.endsWith('.jpg') || f.endsWith('.png'));
      const thumbnailPath = jpegFiles.length > 0 ? path.join(folderPath, jpegFiles[0]) : '';

      // Parse draft_content.json for texts/effects/animations
      const draftContentPath = path.join(folderPath, 'preset_draft', 'draft_content.json');
      let texts: CapCutTextLayer[] = [];
      let effects: CapCutEffect[] = [];
      let animations: CapCutAnimMaterial[] = [];

      if (fs.existsSync(draftContentPath)) {
        const draftContent = JSON.parse(fs.readFileSync(draftContentPath, 'utf8'));

        // Find all text material IDs from nested tracks
        const textMatIds = findTextMaterialIds(draftContent);
        const seenIds = new Set<string>();

        for (const matId of textMatIds) {
          if (seenIds.has(matId)) continue;
          seenIds.add(matId);

          const mat = findMaterialById(draftContent, matId);
          if (!mat) continue;

          const fontPath = (mat.font_path as string) || '';
          const content = (mat.content as string) || '';
          const { text, color, bold } = parseTextContent(content);

          texts.push({
            id: matId,
            parsedText: text,
            fontPath,
            fontFilename: fontPath ? path.basename(fontPath) : '',
            fontSize: (mat.font_size as number) || 15,
            color,
            bold,
            isFontBroken: isFontPathBroken(fontPath),
          });
        }

        // Find effects
        const allEffects = findAllEffects(draftContent);
        // Deduplicate by resourceId
        const effectIds = new Set<string>();
        effects = allEffects.filter((e) => {
          if (!e.resourceId || effectIds.has(e.resourceId)) return false;
          effectIds.add(e.resourceId);
          return true;
        });

        // Find animations
        animations = findAllMaterialAnimations(draftContent);
      }

      const brokenFonts = texts.filter((t) => t.fontPath && t.isFontBroken);

      presets.push({
        id: meta.id || folder.name,
        name: meta.name || folder.name,
        folderPath,
        thumbnailPath,
        createdAt: meta.import_time_ms || 0,
        draftVersion: meta.draft_version || '',
        type: meta.type || 'video',
        texts,
        effects,
        animations,
        hasBrokenFonts: brokenFonts.length > 0,
        brokenFontCount: brokenFonts.length,
      });
    } catch {
      // Skip malformed preset folders silently
      continue;
    }
  }

  // Sort by createdAt desc (newest first)
  presets.sort((a, b) => b.createdAt - a.createdAt);
  return presets;
}

// ─── Default Presets Path ─────────────────────────────────────────────────────

export function getDefaultCapCutPresetsPath(): string {
  const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(appData, 'CapCut', 'User Data', 'Presets', 'Combination', 'Presets');
}
