/**
 * Lightweight Zero-Dependency BPM / Tempo Detector for Web Audio API.
 * Uses energy onset flux and autocorrelation in the 60-180 BPM range.
 * Runs in ~5ms for a 30s audio segment.
 */
export function detectBpm(audioBuffer: AudioBuffer): number | null {
  // Reject tracks shorter than 2 seconds (spec v2: no BPM for short SFX)
  if (!audioBuffer || audioBuffer.duration < 2.0) {
    return null;
  }

  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  // Analyze up to 30 seconds
  const maxSamples = Math.min(audioBuffer.length, Math.floor(sampleRate * 30));

  // 1. Downmix to mono float array
  const mono = new Float32Array(maxSamples);
  if (numChannels === 1) {
    mono.set(audioBuffer.getChannelData(0).subarray(0, maxSamples));
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < maxSamples; i++) {
      mono[i] = (ch0[i] + ch1[i]) * 0.5;
    }
  }

  // 2. Compute Energy Envelope at ~200 fps (5ms window)
  const windowSize = Math.max(1, Math.floor(sampleRate / 200));
  const numFrames = Math.floor(maxSamples / windowSize);
  if (numFrames < 200) return null;

  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const start = f * windowSize;
    for (let i = 0; i < windowSize; i++) {
      const s = mono[start + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / windowSize);
  }

  // 3. Spectral/Energy Onset Flux (Half-wave rectified first difference)
  const flux = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const diff = energy[f] - energy[f - 1];
    flux[f] = diff > 0 ? diff : 0;
  }

  // 4. Autocorrelation over BPM range: 60 BPM (1.0s) to 180 BPM (0.333s)
  const fps = sampleRate / windowSize;
  const minLag = Math.floor(fps * (60 / 180)); // ~66 frames at 200 fps
  const maxLag = Math.ceil(fps * (60 / 60));   // ~200 frames at 200 fps

  let bestLag = -1;
  let maxCorr = 0;
  let totalCorr = 0;
  let lagCount = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = numFrames - lag;
    for (let i = 0; i < limit; i++) {
      sum += flux[i] * flux[i + lag];
    }
    totalCorr += sum;
    lagCount++;

    if (sum > maxCorr) {
      maxCorr = sum;
      bestLag = lag;
    }
  }

  if (bestLag === -1 || maxCorr === 0) return null;

  // Confidence check: the peak must stand out significantly above average
  const avgCorr = totalCorr / lagCount;
  const confidence = maxCorr / (avgCorr || 1);
  if (confidence < 1.65) {
    // Unpitched or non-rhythmic audio (e.g. ambient drone, noise, speech)
    return null;
  }

  // Calculate BPM from lag
  const secondsPerBeat = bestLag / fps;
  let bpm = Math.round(60 / secondsPerBeat);

  // Normalize octave ambiguity (keep in reasonable 65-175 range)
  if (bpm < 65) bpm *= 2;
  if (bpm > 175) bpm = Math.round(bpm / 2);

  return bpm;
}
