import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({entryPoints:['src/renderer/src/tauriBridge.ts'],bundle:true,format:'iife',write:false});
const handlers = new Map();
const window = {__TAURI__:{
  core:{invoke:async(command,payload)=>JSON.parse(JSON.stringify({command,...payload}))},
  event:{listen:async(event,fn)=>{handlers.set(event,fn);return ()=>handlers.delete(event);}},
}};
vm.runInNewContext(bundle.outputFiles[0].text,{window,navigator:{platform:'Win32'}});
const api = window.api;
const folderPath = '/presets/titles';
const options = {url:'https://example.org/clip',format:'wav',outputDir:'/downloads'};
for (const [method, args, operation, expected] of [
  ['checkDownloaderStatus', [], 'status', {}],
  ['installDownloader', [], 'install', {ffOnly:false}],
  ['installFfmpeg', [], 'install', {ffOnly:true}],
  ['fetchMediaInfo', [options.url], 'info', {url:options.url}],
  ['startAudioDownload', [options], 'download', options],
  ['cancelAudioDownload', ['job'], 'cancel', {jobId:'job'}],
]) assert.deepEqual(await api[method](...args), {command:'media_call',operation,args:expected});
for (const [operation, args, expected] of [
  ['getPresetsPath',[],{}],['scanPresets',['/presets'],{customPath:'/presets'}],
  ['analyzeFont',[{folderPath}],{folderPath}],['fixFonts',[{folderPath}],{folderPath}],
  ['renamePreset',[folderPath,'Hello'],{folderPath,newName:'Hello'}],
  ...['openFolder','deletePreset','exportPreset'].map(op=>[op,[folderPath],{folderPath}]),
  ['getAssetDataUrl',['cover.png'],{filePath:'cover.png'}],['listProjects',[],{}],
  ['injectPreset',[folderPath,'draft.json',125],{folderPath,target:'draft.json',startTimeMs:125}],
  ['createDraft',[folderPath,'Sample'],{folderPath,customName:'Sample'}],
]) assert.deepEqual(await api.capcut[operation](...args),{command:'capcut_call',operation,args:expected});
for (const [method,event] of [['onDownloadProgress','download-progress'],['onDownloaderInstallProgress','download-install-progress']]){
  const seen=[];const off=api[method](v=>seen.push(v));const handle=handlers.get(event);
  handle({payload:47});off();handle({payload:100});await Promise.resolve();
  assert.deepEqual(seen,[47]);assert.equal(handlers.has(event),false);
}
console.log('PASS downloader and CapCut renderer commands, payloads and event cleanup');
