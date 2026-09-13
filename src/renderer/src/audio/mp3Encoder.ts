import lamejs from 'lamejs';

function floatToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Transcode an AudioBuffer to an MP3 Uint8Array (320kbps).
 */
export function encodeAudioBufferToMp3(audioBuffer: AudioBuffer, kbps = 320): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;

  // LameJS only supports 1 (mono) or 2 (stereo). Downmix if > 2 channels
  const targetChannels = numChannels === 1 ? 1 : 2;
  const mp3encoder = new lamejs.Mp3Encoder(targetChannels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];

  let leftFloats: Float32Array;
  let rightFloats: Float32Array | undefined;

  if (numChannels <= 2) {
    leftFloats = audioBuffer.getChannelData(0);
    rightFloats = numChannels === 2 ? audioBuffer.getChannelData(1) : undefined;
  } else {
    // Downmix surround/ambisonics to stereo with sqrt normalization to avoid clipping
    leftFloats = new Float32Array(numSamples);
    rightFloats = new Float32Array(numSamples);
    const weight = 1 / Math.sqrt(numChannels);
    for (let c = 0; c < numChannels; c++) {
      const chData = audioBuffer.getChannelData(c);
      if (c % 2 === 0) {
        for (let i = 0; i < numSamples; i++) {
          leftFloats[i] += chData[i] * weight;
        }
      } else {
        for (let i = 0; i < numSamples; i++) {
          rightFloats[i] += chData[i] * weight;
        }
      }
    }
  }

  const sampleBlockSize = 1152;
  const left = floatToInt16(leftFloats);
  const right = rightFloats ? floatToInt16(rightFloats) : undefined;

  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right ? right.subarray(i, i + sampleBlockSize) : undefined;
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.byteLength));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.byteLength));
  }

  // Combine chunks
  const totalLength = mp3Data.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
