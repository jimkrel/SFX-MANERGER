// Exercise the production bridge with the same invoke and event contracts as the main webview.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const calls = [];
const listeners = new Map();
const window = { __TAURI__: {
  core: { invoke: async (name, fields) => {
    calls.push([name, fields]);
    if (name === 'open_folder_dialog') return null;
    if (name === 'open_files_dialog') return ['A.flac'];
    return { imported: 1, errors: [] };
  } },
  event: { listen: async (name, handler, options) => {
    listeners.set(name, { handler, options });
    return () => listeners.delete(name);
  } },
} };
const source = fs.readFileSync(new URL('../src/renderer/src/tauriBridge.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
vm.runInNewContext(compiled.outputText, { window, navigator: { platform: 'Win32' }, exports: {} });
const api = window.api;
assert.equal(await api.openFolderDialog(), null);
assert.deepEqual(await api.openFilesDialog(), ['A.flac']);
assert.equal((await api.importDroppedPaths(['A.flac'])).imported, 1);
assert.deepEqual(calls.map(([name]) => name), ['open_folder_dialog', 'open_files_dialog', 'import_paths']);
assert.deepEqual(calls[2][1].paths, ['A.flac']);
const dragged = [];
const stopDrag = api.onNativeFileDrag((paths, hovering) => dragged.push([paths, hovering]));
for (const [name, payload] of [['enter', {}], ['leave', {}], ['drop', { paths: ['C:/Tiếng gió.wav'] }]]) {
  const listener = listeners.get('tauri://drag-' + name);
  assert.equal(listener.options.target.kind, 'WebviewWindow');
  assert.equal(listener.options.target.label, 'main');
  listener.handler({ payload });
}
assert.deepEqual(dragged, [[null, true], [null, false], [['C:/Tiếng gió.wav'], false]]);
let updates = 0;
const stopUpdates = api.onLibraryUpdated(() => updates++);
const handle = listeners.get('library-updated').handler;
handle({});
stopUpdates();
handle({});
stopDrag();
await new Promise(resolve => setImmediate(resolve));
assert.equal(updates, 1);
assert.equal(listeners.size, 0);
console.log('PASS: Tauri import bridge, targeted drop events, library updates and cleanup');
