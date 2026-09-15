/* tslint:disable */
/* eslint-disable */

/**
 * Đọc metadata từ raw bytes của file audio
 * Được gọi từ Node.js với Buffer.from(fs.readFileSync(path))
 */
export function parse_audio_metadata(data: Uint8Array, extension: string): any;
