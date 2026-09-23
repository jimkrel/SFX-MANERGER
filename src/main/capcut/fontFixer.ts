import fs from 'fs';
import path from 'path';
import os from 'os';
import { CapCutPreset, CapCutTextLayer } from './scanner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FontSearchResult {
  filename: string;
  originalPath: string;
  foundPath: string | null;
  found: boolean;
}

export interface FontFix {
  filename: string;
  originalPath: string;
  newPath: string;
}

export interface FontFixResult {
  presetId: string;
  totalBroken: number;
  fixed: number;
  stillMissing: string[];
}

// ─── Font Search ──────────────────────────────────────────────────────────────

const FONT_SEARCH_DIRS = [
  path.join('C:\\Windows\\Fonts'),
  path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
];

export function searchFontOnSystem(filename: string): string | null {
  // Search in standard Windows font dirs
  for (const dir of FONT_SEARCH_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const candidates = fs.readdirSync(dir);
      const match = candidates.find(
        (f) => f.toLowerCase() === filename.toLowerCase()
      );
      if (match) return path.join(dir, match);
    } catch {
      continue;
    }
  }

  // Search in CapCut font cache
  const capCutFontCache = path.join(
    os.homedir(),
    'AppData', 'Local', 'CapCut', 'User Data', 'Cache', 'effect'
  );
  if (fs.existsSync(capCutFontCache)) {
    try {
      // Walk 2 levels deep to find font files
      const effectFolders = fs.readdirSync(capCutFontCache, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .slice(0, 200); // limit to prevent freezing

      for (const efFolder of effectFolders) {
        const subFolders = fs.readdirSync(path.join(capCutFontCache, efFolder.name), { withFileTypes: true })
          .filter((e) => e.isDirectory());
        for (const sf of subFolders) {
          const subPath = path.join(capCutFontCache, efFolder.name, sf.name);
          try {
            const files = fs.readdirSync(subPath);
            const match = files.find((f) => f.toLowerCase() === filename.toLowerCase());
            if (match) return path.join(subPath, match);
          } catch {
            continue;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export function analyzePresetFonts(preset: CapCutPreset): FontSearchResult[] {
  const results: FontSearchResult[] = [];
  const seen = new Set<string>();

  for (const text of preset.texts) {
    if (!text.fontPath || !text.isFontBroken) continue;
    if (seen.has(text.fontFilename)) continue;
    seen.add(text.fontFilename);

    const foundPath = searchFontOnSystem(text.fontFilename);
    results.push({
      filename: text.fontFilename,
      originalPath: text.fontPath,
      foundPath,
      found: foundPath !== null,
    });
  }

  return results;
}

// ─── Font Patcher ─────────────────────────────────────────────────────────────

function patchJsonString(jsonStr: string, fixes: FontFix[]): string {
  let result = jsonStr;
  for (const fix of fixes) {
    // Escape for regex - replace all occurrences of the broken path
    const escapedOriginal = fix.originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Also handle forward-slash variant
    const escapedForward = fix.originalPath.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const newPathForwardSlash = fix.newPath.replace(/\\/g, '/');

    result = result.replace(new RegExp(escapedOriginal, 'g'), newPathForwardSlash);
    result = result.replace(new RegExp(escapedForward, 'g'), newPathForwardSlash);
  }
  return result;
}

export async function applyFontFixes(preset: CapCutPreset, fixes: FontFix[]): Promise<FontFixResult> {
  if (fixes.length === 0) {
    return { presetId: preset.id, totalBroken: preset.brokenFontCount, fixed: 0, stillMissing: [] };
  }

  const filesToPatch = [
    path.join(preset.folderPath, 'preset_draft', 'draft_content.json'),
    path.join(preset.folderPath, 'preset_draft', 'template-2.tmp'),
  ];

  let fixed = 0;
  for (const filePath of filesToPatch) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const original = fs.readFileSync(filePath, 'utf8');
      const patched = patchJsonString(original, fixes);
      if (patched !== original) {
        // Backup original
        fs.writeFileSync(filePath + '.bak', original, 'utf8');
        fs.writeFileSync(filePath, patched, 'utf8');
        fixed++;
      }
    } catch {
      continue;
    }
  }

  // Re-analyze to see what's still broken
  const brokenTexts: CapCutTextLayer[] = preset.texts.filter((t) => {
    if (!t.isFontBroken) return false;
    const fix = fixes.find((f) => f.filename === t.fontFilename);
    return !fix; // still broken if no fix was found
  });

  return {
    presetId: preset.id,
    totalBroken: preset.brokenFontCount,
    fixed,
    stillMissing: [...new Set(brokenTexts.map((t) => t.fontFilename))],
  };
}

// ─── Batch Fix ────────────────────────────────────────────────────────────────

export async function fixAllBrokenFontsInPreset(preset: CapCutPreset): Promise<FontFixResult> {
  const searchResults = analyzePresetFonts(preset);
  const fixes: FontFix[] = searchResults
    .filter((r) => r.found && r.foundPath)
    .map((r) => ({
      filename: r.filename,
      originalPath: r.originalPath,
      newPath: r.foundPath!,
    }));

  return applyFontFixes(preset, fixes);
}
