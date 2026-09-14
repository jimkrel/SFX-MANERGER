import { parentPort } from 'worker_threads';
import { extractWavPeaks } from './wavPeaks';

parentPort?.on('message', ({ filePath, resolution }: { filePath: string; resolution: number }) => {
  parentPort!.postMessage(extractWavPeaks(filePath, resolution));
});
