import path from 'path';

export interface AudioClassificationInput {
  filePath: string;
  name: string;
  duration: number;
  sampleRate?: number | null;
  channels?: number | null;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  bpm?: number | null;
}

export type AudioType = 'SFX' | 'Music';

/**
 * Bỏ dấu tiếng Việt và chuẩn hóa chuỗi để so khớp từ khóa chính xác
 */
export function removeVietnameseAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Chuẩn hóa chuỗi văn bản: chữ thường, bỏ dấu tiếng Việt, thay ký tự đặc biệt bằng khoảng trắng
 */
export function normalizeText(str: string): string {
  if (!str) return '';
  const noAccents = removeVietnameseAccents(str.toLowerCase());
  return noAccents.replace(/[^a-z0-9]+/g, ' ').trim();
}

// 1. Từ khóa thể loại âm nhạc và hiệu ứng trong thẻ Genre
const SFX_GENRES = new Set([
  'sound effect', 'sound effects', 'sfx', 'foley', 'noise', 'field recording',
  'ambience', 'fx', 'sound design', 'cinematic sfx', 'impact', 'whoosh'
]);

const MUSIC_GENRES = new Set([
  'pop', 'rock', 'hip hop', 'hip-hop', 'rap', 'electronic', 'dance', 'edm',
  'house', 'techno', 'classical', 'soundtrack', 'score', 'ambient', 'lo-fi',
  'lofi', 'ballad', 'jazz', 'blues', 'r&b', 'soul', 'country', 'folk',
  'metal', 'indie', 'instrumental', 'acoustic', 'disco', 'funk', 'reggae',
  'soundtrack / ost', 'ost', 'bgm', 'piano', 'cinematic music', 'trailer music'
]);

// 2. Từ khóa nhận diện Tên File (Lexical Analysis)
// 2. Từ khóa nhận diện Tên File (Lexical Analysis)
const MUSIC_KEYWORDS = [
  'nhac', 'bai hat', 'ca khuc', 'song', 'music', 'beat', 'melody', 'giai dieu',
  'piano', 'pinano', 'guitar', 'remix', 'cover', 'instrumental', 'acoustic',
  'theme', 'ost', 'bgm', 'karaoke', 'lofi', 'ballad', 'prod by', 'prod.',
  'feat', 'ft', 'vocal', 'synthwave', 'orchestra', 'orchestral', 'symphony',
  'audio track', 'soundtrack', 'backing track', 'music track', 'chill', 'hiphop', 'trap'
];

const SFX_KEYWORDS = [
  'tieng', 'sound', 'sfx', 'foley', 'whoosh', 'swoosh', 'impact', 'hit', 'cang',
  'tieng cuoi', 'cuoi lon', 'rung rang', 'buoc chan', 'click', 'ting',
  'tieng no', 'bom no', 'phao no', 'no tung', 'explosion', 'vo tay',
  'applause', 'tieng sam', 'sam set', 'sam chop', 'thunder',
  'tieng mua', 'mua roi', 'mua rao', 'mua bao', 'rain',
  'tieng coi', 'coi xe', 'coi hu', 'coi bao dong', 'whistle', 'horn',
  'tieng ren', 'ren ri', 'groan',
  'cho sua', 'tieng sua', 'tieng cho sua', 'bark', 'dog bark',
  'tieng dong', 'hieu ung',
  'punch', 'kick drum', 'snare', 'riser', 'downer', 'subdrop', 'braam', 'creak',
  'slam', 'shatter', 'splash', 'gun', 'shot', 'laser', 'beep', 'notification',
  'alert', 'thud', 'glitch', 'swish', 'scratch', 'door', 'footstep', 'cheer'
];

/**
 * Thuật toán phân loại đa tầng xác định đâu là SFX, đâu là Music
 */
export function classifyTrackAudio(input: AudioClassificationInput): AudioType {
  const { filePath, name, duration, artist, album, genre, bpm } = input;
  const fileNameNorm = normalizeText(name);
  const pathNorm = normalizeText(filePath);

  // --- LỚP 1: KIỂM TRA THẺ GENRE (NẾU CÓ THỂ LOẠI RÕ RÀNG) ---
  if (genre) {
    const genreLower = genre.toLowerCase().trim();
    for (const g of SFX_GENRES) {
      if (genreLower.includes(g)) return 'SFX';
    }
    for (const g of MUSIC_GENRES) {
      if (genreLower.includes(g)) return 'Music';
    }
  }

  // --- LỚP 2: KIỂM TRA TỪ KHÓA TÊN FILE (LEXICAL MATCHING) ---
  // Ưu tiên TRƯỚC Artist/Album để tránh tác giả/nhà sản xuất SFX đè lên tên file SFX rõ ràng
  const hasMusicWord = MUSIC_KEYWORDS.some((kw) => {
    // So khớp theo ranh giới từ hoặc cụm từ (\b hoặc khoảng trắng)
    const regex = new RegExp(`(^|\\s)${kw}(\\s|$)`, 'i');
    return regex.test(fileNameNorm);
  });

  const hasSfxWord = SFX_KEYWORDS.some((kw) => {
    const regex = new RegExp(`(^|\\s)${kw}(\\s|$)`, 'i');
    return regex.test(fileNameNorm);
  });

  // Tên file có từ khóa Nhạc rõ ràng (VD: "Nhạc gây cấn", "Nhạc pinano", "Piano solo", "Song 01")
  if (hasMusicWord && !hasSfxWord) {
    return 'Music';
  }

  // Tên file có từ khóa SFX rõ ràng (VD: "Tiếng cười", "Sound căng thẳng", "Whoosh 02")
  if (hasSfxWord && !hasMusicWord) {
    return 'SFX';
  }

  // Nếu tên file chứa cả 2 từ khóa (VD: "Tiếng đàn piano"): ưu tiên thời lượng
  if (hasMusicWord && hasSfxWord) {
    if (duration >= 30) return 'Music';
    return 'SFX';
  }

  // --- LỚP 3: KIỂM TRA METADATA ARTIST / ALBUM ---
  // Chỉ dùng khi tên file hoàn toàn không có từ khóa rõ ràng nào cả (không hasMusicWord, không hasSfxWord)
  if (artist && artist.trim().length > 0) {
    const artNorm = normalizeText(artist);
    if (!artNorm.includes('sound ideas') && !artNorm.includes('boom library') && !artNorm.includes('sfx')) {
      return 'Music';
    }
  }

  if (album && album.trim().length > 0) {
    const albNorm = normalizeText(album);
    if (!albNorm.includes('sfx') && !albNorm.includes('sound effect') && !albNorm.includes('foley')) {
      return 'Music';
    }
  }

  // --- LỚP 4: KIỂM TRA THƯ MỤC CHỨA FILE (FOLDER PATH HEURISTIC) ---
  // Lấy tên thư mục cha trực tiếp
  const dirName = path.dirname(filePath);
  const directFolder = path.basename(dirName).toLowerCase();

  if (
    directFolder.includes('music') || directFolder.includes('nhac') ||
    directFolder.includes('song') || directFolder.includes('beat') ||
    directFolder.includes('bgm') || directFolder.includes('soundtrack') ||
    directFolder.includes('ost') || directFolder.includes('nhạc')
  ) {
    return 'Music';
  }

  if (
    directFolder.includes('sfx') || directFolder.includes('sound effect') ||
    directFolder.includes('tieng dong') || directFolder.includes('foley') ||
    directFolder.includes('stinger') || directFolder.includes('hieu ung')
  ) {
    // Chỉ quy là SFX theo thư mục nếu thời lượng không quá dài (dưới 60s)
    if (duration < 60) return 'SFX';
  }

  // --- LỚP 5: PHÂN TÍCH TÍN HIỆU & THỜI LƯỢNG (ACOUSTIC & DURATION FALLBACK) ---
  // File có chu kỳ nhịp điệu rõ ràng (BPM ổn định) và độ dài bài hát
  if (bpm && bpm > 0 && duration >= 30) {
    return 'Music';
  }

  // Âm thanh ngắn dưới 25s: 99% là SFX/Foley
  if (duration < 25) {
    return 'SFX';
  }

  // Âm thanh dài trên 60s (1 phút trở lên): phần lớn là Music hoặc BGM
  if (duration >= 60) {
    return 'Music';
  }

  // Mặc định khoảng giữa (25s - 60s)
  return 'SFX';
}
