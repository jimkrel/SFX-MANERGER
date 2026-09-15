const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg', '.caf']);
function isAudioFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

async function scanDirectoryForAudioFiles(dirPath) {
  const audioFiles = [];
  const dirsToScan = [dirPath];

  while (dirsToScan.length > 0) {
    const currentDirs = dirsToScan.splice(0, 16);
    const results = await Promise.allSettled(
      currentDirs.map(async (dir) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const subDirs = [];
        const files = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            subDirs.push(fullPath);
          } else if (entry.isFile() && isAudioFile(fullPath)) {
            files.push(fullPath);
          }
        }
        return { subDirs, files };
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled') {
        dirsToScan.push(...res.value.subDirs);
        audioFiles.push(...res.value.files);
      }
    }
  }

  return audioFiles;
}

async function run() {
  const testDir = '/Volumes/Tài/TÀI NGUYÊN/Sound Effect';
  if (!fs.existsSync(testDir)) {
    console.log('Dir does not exist:', testDir);
    return;
  }
  const t0 = performance.now();
  const files = await scanDirectoryForAudioFiles(testDir);
  const elapsed = performance.now() - t0;
  console.log(`Found ${files.length} audio files in ${elapsed.toFixed(1)}ms!`);
}

run().catch(console.error);
