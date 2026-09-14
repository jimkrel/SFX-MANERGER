import fs from 'fs';

// Called only in a worker. Scan all frames in bounded buffers; sampling just the
// first few frames of each bin loses short transients and quiet/right-only SFX.
export function extractWavPeaks(filePath: string, resolution: number): number[] | null {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 10000) return null;
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (position: number, length: number) => {
      const data = Buffer.alloc(length);
      if (fs.readSync(fd!, data, 0, length, position) !== length) throw new Error('Truncated WAV');
      return data;
    };
    const riff = read(0, 12);
    if (riff.toString('ascii', 0, 4) !== 'RIFF' || riff.toString('ascii', 8, 12) !== 'WAVE') return null;
    const limit = riff.readUInt32LE(4) + 8;
    if (limit > size || limit < 12) return null;
    let format = 0, channels = 0, bits = 0, align = 0;
    let dataStart = 0, dataLength = 0;
    for (let pos = 12; pos + 8 <= limit;) {
      const header = read(pos, 8);
      const length = header.readUInt32LE(4);
      const name = header.toString('ascii', 0, 4);
      if (pos + 8 + length > limit) return null;
      if (name === 'fmt ') {
        if (length < 16) return null;
        const fmt = read(pos + 8, Math.min(length, 40));
        format = fmt.readUInt16LE(0);
        channels = fmt.readUInt16LE(2);
        align = fmt.readUInt16LE(12);
        bits = fmt.readUInt16LE(14);
        if (format === 0xfffe) {
          if (length < 40 || fmt.readUInt16LE(16) < 22) return null;
          if (fmt.subarray(28, 40).toString('hex') !== '00001000800000aa00389b71') return null;
          format = fmt.readUInt32LE(24);
        }
      } else if (name === 'data') {
        dataStart = pos + 8;
        dataLength = length;
      }
      pos += 8 + length + (length & 1);
    }
    if (!dataStart || !channels || channels > 64 || !align) return null;
    if (format === 1 ? ![8, 16, 24, 32].includes(bits) : format !== 3 || ![32, 64].includes(bits)) return null;
    const bytes = bits / 8;
    if (align !== channels * bytes || dataLength % align !== 0) return null;
    const frames = dataLength / align;
    const peaks = new Array<number>(resolution).fill(0);
    const chunkFrames = Math.max(1, Math.floor(65536 / align));
    for (let frame = 0; frame < frames; frame += chunkFrames) {
      const count = Math.min(chunkFrames, frames - frame);
      const data = read(dataStart + frame * align, count * align);
      for (let i = 0; i < count; i++) {
        const bin = Math.min(resolution - 1, Math.floor((frame + i) * resolution / frames));
        for (let c = 0; c < channels; c++) {
          const offset = i * align + c * bytes;
          const value = format === 3
            ? (bits === 32 ? data.readFloatLE(offset) : data.readDoubleLE(offset))
            : bits === 8 ? (data[offset] - 128) / 128 : data.readIntLE(offset, bytes) / (2 ** (bits - 1));
          if (!Number.isFinite(value)) return null;
          peaks[bin] = Math.max(peaks[bin], Math.min(1, Math.abs(value)));
        }
      }
    }
    return peaks.map(p => Number(p.toFixed(4)));
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
