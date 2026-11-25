import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/renderer/src/tauriBridge.ts'], bundle: true, format: 'iife', globalName: 'bridge', write: false });
for (const label of ['main', 'quick-launcher']) {
  const calls = [];
  const handlers = new Map();
  const window = { __TAURI__: {
    webviewWindow: { getCurrentWebviewWindow: () => ({ label }) },
    core: { invoke: async (name, args) => { calls.push([name, args]); } },
    event: { listen: async (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name); } },
  }};
  const ctx = vm.createContext({ window, navigator: { platform: 'MacIntel' } });
  vm.runInContext(bundled.outputFiles[0].text, ctx);
  assert.equal(ctx.bridge.isTauriLauncher, label === 'quick-launcher');
  const api = window.api;
  await api.showQuickLauncher(); await api.toggleQuickLauncher(); await api.hideQuickLauncher();
  assert.deepEqual(calls.map(([name, {action}]) => [name,action]), ['show','toggle','hide'].map(action => ['launcher_window', action]));
  await api.setQuickLauncherHeight(280);
  await api.getQuickLauncherShortcut();
  await api.setQuickLauncherShortcut('Command+Shift+.');
  await api.checkAccessibilityPermission();
  await api.openAccessibilitySettings();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(3))), [
    ['launcher_height',{height:280}],['launcher_shortcut',null],['set_launcher_shortcut',{shortcut:'Command+Shift+.'}],
    ['accessibility',{prompt:false}],['open_accessibility',null],
  ]);
  const seen = [];
  const off = [api.onQuickLauncherShown(() => seen.push('shown')), api.onQuickLauncherHidden(() => seen.push('hidden')), api.onAccessibilityStatusChanged(data => seen.push(data.granted))];
  handlers.get('launcher-shown')({}); handlers.get('launcher-hidden')({}); handlers.get('accessibility-changed')({payload:{granted:true}});
  assert.deepEqual(seen, ['shown','hidden',true]);
  off.forEach(fn => fn()); await Promise.resolve();
  assert.equal(handlers.size, 0);
}
console.log('PASS: main/launcher routing, window commands, shortcut settings and event cleanup');
