import { createServer } from 'vite';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function startDev() {
  // 1. Build main and preload once first
  console.log('[Dev] Compiling main & preload...');
  await runCommand('npx', ['tsc', '-p', 'tsconfig.main.json']);
  await runCommand('npx', ['tsc', '-p', 'tsconfig.preload.json']);

  // 2. Start Vite server
  console.log('[Dev] Starting Vite dev server...');
  const server = await createServer({
    configFile: path.resolve(rootDir, 'vite.config.ts'),
    mode: 'development'
  });
  await server.listen();
  console.log('[Dev] Vite server running at http://localhost:5173');

  // 3. Start Electron
  console.log('[Dev] Launching Electron...');
  const electronProcess = spawn('npx', ['electron', '.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:5173'
    }
  });

  electronProcess.on('close', () => {
    server.close();
    process.exit(0);
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${command} failed with exit code ${code}`));
    });
  });
}

startDev().catch((err) => {
  console.error('[Dev] Error starting dev environment:', err);
  process.exit(1);
});
