import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

async function load(entry, context) {
  const {outputFiles} = await build({entryPoints:[entry], bundle:true, format:'iife',
    external:['electron'], write:false});
  vm.runInNewContext(outputFiles[0].text, context);
}
let electron;
await load('src/preload/index.ts', {process, require: () => ({
  contextBridge: {exposeInMainWorld: (_, value) => { electron = value; }},
})});
const calls = [];
const window = {__TAURI__:{core:{invoke: async name => {
  calls.push(name);
  if (name === 'app_info') return {isElevated:true};
}},event:{}}};
await load('src/renderer/src/tauriBridge.ts',{window,navigator:{platform:'Win32'}});
function compare(reference, actual) {
  for (const key of Object.keys(reference)) {
    assert.ok(Object.hasOwn(actual,key), 'Missing explicit Tauri mapping for '+key);
    assert.equal(typeof actual[key],typeof reference[key],key);
    if (typeof reference[key] === 'object') compare(reference[key],actual[key]);
  }
}
compare(electron,window.api);
assert.equal(await window.api.checkIsElevated(),true);
await window.api.quitApp();
assert.deepEqual(calls,['app_info','quit_app']);
console.log('PASS Electron preload API surface, elevation and quit routing');
