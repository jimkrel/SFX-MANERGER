import path from 'path';
import fs from 'fs';
import { Worker } from 'worker_threads';
import { getDatabase, getWaveformPeaks, saveWaveformPeaks, Track } from './db';

type Job = { filePath: string; resolution: number; resolve: (peaks: number[] | null) => void };
const queue: Job[] = [];
type Slot = { worker: Worker; job: Job | null };
const workers = new Set<Slot>();
let closed = false;

function createSlot(): Slot {
  const worker = new Worker(path.join(__dirname, 'wavPeaksWorker.js'));
  const slot: Slot = { worker, job: null };
  workers.add(slot);
  worker.on('message', (peaks: number[] | null) => {
    const job = slot.job;
    slot.job = null;
    worker.unref();
    job?.resolve(peaks);
    pump();
  });
  const fail = () => {
    if (!workers.delete(slot)) return;
    slot.job?.resolve(null);
    slot.job = null;
    void worker.terminate();
    pump();
  };
  worker.once('error', fail);
  worker.once('exit', fail);
  worker.unref();
  return slot;
}

function pump(): void {
  while (!closed && queue.length) {
    let slot = [...workers].find(worker => !worker.job);
    if (!slot && workers.size >= 2) return;
    try { slot ??= createSlot(); }
    catch { queue.shift()!.resolve(null); continue; }
    slot.job = queue.shift()!;
    slot.worker.ref();
    slot.worker.postMessage({ filePath: slot.job.filePath, resolution: slot.job.resolution });
  }
}

export function readWavPeaks(filePath: string, resolution: number): Promise<number[] | null> {
  if (closed || path.extname(filePath).toLowerCase() !== '.wav') return Promise.resolve(null);
  return new Promise(resolve => { queue.push({ filePath, resolution, resolve }); pump(); });
}

const pending = new Map<string, Promise<number[] | null>>();
export async function getOrCreateWaveform(trackId: number, resolution: number, version?: number): Promise<number[] | null> {
  if (closed || !Number.isInteger(resolution) || resolution < 1 || resolution > 10000) return null;
  const database = getDatabase();
  const track = database.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as Track | undefined;
  if (!track || track.is_missing || (version !== undefined && track.content_version !== version)) return null;
  const cached = getWaveformPeaks(trackId, resolution);
  if (cached) return cached;
  const key = `${trackId}:${track.content_version}:${resolution}`;
  if (pending.has(key)) return pending.get(key)!;
  const job = (async () => {
    const peaks = await readWavPeaks(track.path, resolution);
    if (!peaks || closed) return null;
    try {
      const stat = await fs.promises.stat(track.path);
      if (stat.size !== track.file_size || stat.mtimeMs !== track.file_mtime) return null;
      saveWaveformPeaks(track.id, resolution, peaks, track.content_version);
      return peaks;
    } catch { return null; }
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

export async function stopWaveformWorkers(): Promise<void> {
  closed = true;
  for (const job of queue.splice(0)) job.resolve(null);
  for (const slot of workers) { slot.job?.resolve(null); slot.job = null; }
  await Promise.all([...workers].map(slot => slot.worker.terminate()));
  workers.clear();
}
