import type { Track, Tag } from '../../../preload';

export interface ClassifiableTrack {
  type_override?: string | null;
  tagList?: Tag[];
  tags?: string;
  duration?: number;
  category?: string;
}

/**
 * Determine if a track is Music or SFX.
 * Hierarchy:
 * 1. Explicit user manual override (`type_override`)
 * 2. Explicit tag in `tagList` ('Music' vs 'SFX')
 * 3. Tag string keyword in `tags`
 * 4. Fallback threshold: duration >= 30 seconds -> Music, otherwise SFX
 */
export function isTrackMusic(track?: ClassifiableTrack | null): boolean {
  if (!track) return false;

  if (track.type_override === 'Music') return true;
  if (track.type_override === 'SFX') return false;

  if (track.tagList && track.tagList.length > 0) {
    const hasMusic = track.tagList.some((t: Tag) => t.name.toLowerCase() === 'music');
    const hasSfx = track.tagList.some((t: Tag) => t.name.toLowerCase() === 'sfx');
    if (hasMusic && !hasSfx) return true;
    if (hasSfx && !hasMusic) return false;
  }

  if (track.tags && typeof track.tags === 'string') {
    const lower = track.tags.toLowerCase();
    const hasMusic = /\bmusic\b/.test(lower);
    const hasSfx = /\bsfx\b/.test(lower);
    if (hasMusic && !hasSfx) return true;
    if (hasSfx && !hasMusic) return false;
  }

  return (track.duration || 0) >= 30;
}

/**
 * Get category display badge information for a track.
 */
export function getTrackDisplayCategory(track: Track): { label: string; isMusic: boolean } {
  const isMusic = isTrackMusic(track);
  if (isMusic) {
    return { label: '🎵 Nhạc nền', isMusic: true };
  }

  const cat =
    track.category && track.category !== 'Khác' && track.category.trim() !== '' ? track.category : 'SFX';
  return { label: cat, isMusic: false };
}
