const fs = require('fs');
const path = require('path');

function parseWavHeaderFast(buf, fileSize, baseName) {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;

  let pos = 12;
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  let dataLength = null;
  let title = null;
  let artist = null;
  let album = null;
  let genre = null;
  let formatCode = 1;

  const limit = Math.min(buf.length, fileSize);
  while (pos + 8 <= limit) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    const chunkDataPos = pos + 8;

    if (chunkId === 'fmt ' && chunkDataPos + 16 <= limit) {
      formatCode = buf.readUInt16LE(chunkDataPos);
      channels = buf.readUInt16LE(chunkDataPos + 2);
      sampleRate = buf.readUInt32LE(chunkDataPos + 4);
      bitsPerSample = buf.readUInt16LE(chunkDataPos + 14);
      if (formatCode === 0xfffe && chunkDataPos + 26 <= limit) {
        formatCode = buf.readUInt16LE(chunkDataPos + 24);
      }
    } else if (chunkId === 'data') {
      dataLength = chunkSize;
    } else if (chunkId === 'LIST' && chunkDataPos + 4 <= limit) {
      const listType = buf.toString('ascii', chunkDataPos, chunkDataPos + 4);
      if (listType === 'INFO') {
        let infoPos = chunkDataPos + 4;
        const infoEnd = Math.min(chunkDataPos + chunkSize, limit);
        while (infoPos + 8 <= infoEnd) {
          const subId = buf.toString('ascii', infoPos, infoPos + 4);
          const subSize = buf.readUInt32LE(infoPos + 4);
          const subDataPos = infoPos + 8;
          if (subDataPos + subSize <= limit) {
            const val = buf.toString('utf8', subDataPos, subDataPos + subSize).replace(/\0+$/, '').trim();
            if (subId === 'INAM' && val) title = val;
            else if (subId === 'IART' && val) artist = val;
            else if (subId === 'IPRD' && val) album = val;
            else if (subId === 'IGNR' && val) genre = val;
          }
          infoPos += 8 + subSize + (subSize & 1);
        }
      }
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }

  if (sampleRate && channels && bitsPerSample && dataLength !== null) {
    const bytesPerFrame = channels * (bitsPerSample / 8);
    const duration = bytesPerFrame > 0 ? dataLength / (sampleRate * bytesPerFrame) : 0;
    return {
      name: title || baseName,
      duration,
      sampleRate,
      channels,
      artist: artist || null,
      album: album || null,
      genre: genre || null,
      bpm: null
    };
  }
  return null;
}

module.exports = { parseWavHeaderFast };
console.log('test_wav_parser module ready');
