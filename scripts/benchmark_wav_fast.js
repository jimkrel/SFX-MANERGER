const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

function parseWavHeaderFast(buffer, fileSize) {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let pos = 12;
  let sampleRate = null;
  let channels = null;
  let bitsPerSample = null;
  let dataLength = null;
  let title = null;
  let artist = null;
  let album = null;
  let genre = null;

  const limit = Math.min(buffer.length, fileSize);
  while (pos + 8 <= limit) {
    const chunkId = buffer.toString('ascii', pos, pos + 4);
    const chunkSize = buffer.readUInt32LE(pos + 4);
    const chunkDataPos = pos + 8;

    if (chunkId === 'fmt ' && chunkDataPos + 16 <= limit) {
      const format = buffer.readUInt16LE(chunkDataPos);
      channels = buffer.readUInt16LE(chunkDataPos + 2);
      sampleRate = buffer.readUInt32LE(chunkDataPos + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataPos + 14);
      // Support Extensible format
      if (format === 0xfffe && chunkDataPos + 26 <= limit) {
        // extensible sub-format
      }
    } else if (chunkId === 'data') {
      dataLength = chunkSize;
    } else if (chunkId === 'LIST' && chunkDataPos + 4 <= limit) {
      const listType = buffer.toString('ascii', chunkDataPos, chunkDataPos + 4);
      if (listType === 'INFO') {
        let infoPos = chunkDataPos + 4;
        const infoEnd = Math.min(chunkDataPos + chunkSize, limit);
        while (infoPos + 8 <= infoEnd) {
          const subId = buffer.toString('ascii', infoPos, infoPos + 4);
          const subSize = buffer.readUInt32LE(infoPos + 4);
          const subDataPos = infoPos + 8;
          if (subDataPos + subSize <= limit) {
            const val = buffer.toString('utf8', subDataPos, subDataPos + subSize).replace(/\0+$/, '').trim();
            if (subId === 'INAM') title = val;
            else if (subId === 'IART') artist = val;
            else if (subId === 'IPRD') album = val;
            else if (subId === 'IGNR') genre = val;
          }
          infoPos += 8 + subSize + (subSize & 1);
        }
      }
    }
    pos += 8 + chunkSize + (chunkSize & 1);
  }

  if (sampleRate && channels && bitsPerSample && dataLength) {
    const bytesPerFrame = channels * (bitsPerSample / 8);
    const duration = bytesPerFrame > 0 ? dataLength / (sampleRate * bytesPerFrame) : 0;
    return { duration, sampleRate, channels, title, artist, album, genre };
  }
  return null;
}

async function run() {
  const dbPath = path.join(os.homedir(), 'Library/Application Support/sfx-music-manager/library.db');
  const db = new Database(dbPath, { readonly: true });
  const wavTracks = db.prepare("SELECT path, duration, sample_rate, channels FROM tracks WHERE lower(path) LIKE '%.wav'").all()
    .filter(r => fs.existsSync(r.path));
  console.log('Valid WAV tracks:', wavTracks.length);

  const mm = await import('music-metadata');

  // Benchmark music-metadata
  const t0 = performance.now();
  for (const track of wavTracks) {
    await mm.parseFile(track.path, { duration: true, skipCovers: true });
  }
  const mmTime = performance.now() - t0;
  console.log(`music-metadata on ${wavTracks.length} WAVs: ${mmTime.toFixed(2)}ms (${(mmTime / wavTracks.length).toFixed(3)}ms/file)`);

  // Benchmark fast parser
  const buf = Buffer.alloc(8192);
  const t1 = performance.now();
  let fastSuccess = 0;
  for (const track of wavTracks) {
    const fd = fs.openSync(track.path, 'r');
    const stat = fs.fstatSync(fd);
    const bytesRead = fs.readSync(fd, buf, 0, Math.min(8192, stat.size), 0);
    fs.closeSync(fd);
    const parsed = parseWavHeaderFast(buf.subarray(0, bytesRead), stat.size);
    if (parsed) {
      fastSuccess++;
      // Verify duration accuracy
      const diff = Math.abs(parsed.duration - track.duration);
      if (diff > 0.05) {
        console.warn(`Duration mismatch on ${path.basename(track.path)}: fast=${parsed.duration} vs db=${track.duration}`);
      }
    }
  }
  const fastTime = performance.now() - t1;
  console.log(`Fast parser on ${wavTracks.length} WAVs: ${fastTime.toFixed(2)}ms (${(fastTime / wavTracks.length).toFixed(3)}ms/file) | Success: ${fastSuccess}/${wavTracks.length}`);
  console.log(`🚀 SPEEDUP: ${(mmTime / fastTime).toFixed(1)}x FASTER!`);
}

run().catch(console.error);
