import { encodeAudioBufferToWav } from './wavEncoder';
import { encodeAudioBufferToMp3 } from './mp3Encoder';

export interface ConvertOptions {
  format: 'wav' | 'mp3';
  wavBitDepth: 16 | 24;
  mp3Bitrate: 128 | 192 | 256 | 320;
  sampleRate: 44100 | 48000 | 'original';
  channels: 'mono' | 'stereo' | 'original';
}

/**
 * High-quality hardware-accelerated audio resampling using OfflineAudioContext.
 */
export async function resampleAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  if (audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer;
  }

  const numChannels = audioBuffer.numberOfChannels;
  const targetLength = Math.max(1, Math.round(audioBuffer.duration * targetSampleRate));
  const offlineCtx = new OfflineAudioContext(numChannels, targetLength, targetSampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Adjust channel count to mono or stereo.
 */
export function adjustChannels(
  audioBuffer: AudioBuffer,
  targetMode: 'mono' | 'stereo' | 'original'
): AudioBuffer {
  if (targetMode === 'original') return audioBuffer;

  const currentChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  if (targetMode === 'mono') {
    if (currentChannels === 1) return audioBuffer;

    // Downmix to mono
    const monoBuffer = new AudioBuffer({
      numberOfChannels: 1,
      length,
      sampleRate
    });
    const monoData = monoBuffer.getChannelData(0);
    const weight = 1 / currentChannels;

    for (let c = 0; c < currentChannels; c++) {
      const chData = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        monoData[i] += chData[i] * weight;
      }
    }
    return monoBuffer;
  } else {
    // Stereo target
    if (currentChannels === 2) return audioBuffer;

    const stereoBuffer = new AudioBuffer({
      numberOfChannels: 2,
      length,
      sampleRate
    });

    if (currentChannels === 1) {
      // Duplicate mono to both left and right
      const monoData = audioBuffer.getChannelData(0);
      stereoBuffer.copyToChannel(monoData, 0);
      stereoBuffer.copyToChannel(monoData, 1);
    } else {
      // Downmix >2 channels to stereo
      const left = stereoBuffer.getChannelData(0);
      const right = stereoBuffer.getChannelData(1);
      const weight = 1 / Math.sqrt(currentChannels);
      for (let c = 0; c < currentChannels; c++) {
        const chData = audioBuffer.getChannelData(c);
        if (c % 2 === 0) {
          for (let i = 0; i < length; i++) left[i] += chData[i] * weight;
        } else {
          for (let i = 0; i < length; i++) right[i] += chData[i] * weight;
        }
      }
    }
    return stereoBuffer;
  }
}

/**
 * Main conversion pipeline.
 */
export async function convertAudio(
  sourceBuffer: AudioBuffer,
  options: ConvertOptions
): Promise<{ data: Uint8Array; extension: string; label: string }> {
  let processedBuffer = sourceBuffer;

  // 1. Resample if requested
  if (options.sampleRate !== 'original' && processedBuffer.sampleRate !== options.sampleRate) {
    processedBuffer = await resampleAudioBuffer(processedBuffer, options.sampleRate);
  }

  // 2. Adjust channels if requested
  if (options.channels !== 'original') {
    processedBuffer = adjustChannels(processedBuffer, options.channels);
  }

  // 3. Encode to target format
  if (options.format === 'wav') {
    const bitDepth = options.wavBitDepth || 16;
    const data = encodeAudioBufferToWav(processedBuffer, bitDepth);
    const label = `WAV ${bitDepth}-bit (${processedBuffer.sampleRate}Hz, ${processedBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'})`;
    return {
      data,
      extension: 'wav',
      label
    };
  } else {
    const bitrate = options.mp3Bitrate || 320;
    const data = encodeAudioBufferToMp3(processedBuffer, bitrate);
    const label = `MP3 ${bitrate}kbps (${processedBuffer.sampleRate}Hz, ${processedBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'})`;
    return {
      data,
      extension: 'mp3',
      label
    };
  }
}
