/**
 * Transcode an AudioBuffer to standard 16-bit or 24-bit PCM RIFF WAV (Uint8Array).
 * Generates canonical 44-byte RIFF WAVE header followed by interleaved little-endian samples.
 */
export function encodeAudioBufferToWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 = 16): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = bitDepth === 24 ? 3 : 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // Helper to write 4-byte ASCII tags
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // 1. RIFF Header Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // Size of entire file minus 8 bytes
  writeString(8, 'WAVE');

  // 2. "fmt " Sub-chunk Descriptor (16 bytes for PCM)
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels (1 = Mono, 2 = Stereo, etc.)
  view.setUint32(24, sampleRate, true); // SampleRate (e.g. 44100, 48000)
  view.setUint32(28, byteRate, true); // ByteRate = SampleRate * NumChannels * bytesPerSample
  view.setUint16(32, blockAlign, true); // BlockAlign = NumChannels * bytesPerSample
  view.setUint16(34, bitDepth, true); // BitsPerSample (16 or 24)

  // 3. "data" Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Extract channel sample data
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  let offset = 44;
  if (bitDepth === 24) {
    // 24-bit signed PCM samples (-8388608 to 8388607)
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channelData[c][i]));
        const s = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, s & 0xff);
        view.setUint8(offset + 1, (s >> 8) & 0xff);
        view.setUint8(offset + 2, (s >> 16) & 0xff);
        offset += 3;
      }
    }
  } else {
    // 16-bit signed PCM samples (-32768 to 32767)
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = Math.max(-1, Math.min(1, channelData[c][i]));
        const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
  }

  return new Uint8Array(arrayBuffer);
}
