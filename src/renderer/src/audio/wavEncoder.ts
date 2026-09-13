/**
 * Transcode an AudioBuffer to standard 16-bit PCM RIFF WAV (Uint8Array).
 * Generates canonical 44-byte RIFF WAVE header followed by interleaved 16-bit little-endian samples.
 */
export function encodeAudioBufferToWav(audioBuffer: AudioBuffer): Uint8Array {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM
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
  view.setUint32(28, byteRate, true); // ByteRate = SampleRate * NumChannels * 2
  view.setUint16(32, blockAlign, true); // BlockAlign = NumChannels * 2
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)

  // 3. "data" Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true); // Subchunk2Size

  // Extract channel sample data
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  // Interleave channels and write 16-bit signed PCM samples (-32768 to 32767)
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      // Convert float [-1.0, 1.0] to signed 16-bit int [-32768, 32767]
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, s, true);
      offset += 2;
    }
  }

  return new Uint8Array(arrayBuffer);
}
