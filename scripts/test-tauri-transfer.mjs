import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const result = await build({stdin:{contents:`import './src/renderer/src/tauriBridge'; export {convertAudio} from './src/renderer/src/audio/audioConverter';`,resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'audio',write:false});
const calls=[];
let prepared=['A.mp3','B.wav'];
const invoke=async(name,args,options)=>{
  calls.push({name,args,options});
  if(name==='prepare_drag')return prepared;
  if(name==='export_audio')return null;
  if(name==='plugin:drag|start_drag')return;
  return '';
};
const window={__TAURI__:{core:{invoke,Channel:class{}},event:{}}};
const ctx=vm.createContext({window,navigator:{platform:'Win32'},console,Uint8Array,ArrayBuffer});
vm.runInContext(result.outputFiles[0].text,ctx);
const api=window.api;
const track={length:44100,sampleRate:44100,numberOfChannels:1,getChannelData:()=>Float32Array.from({length:44100},(_,i)=>.3*Math.sin(i*.1))};
for(const bits of [16,24]){
  const {data}=await ctx.audio.convertAudio(track,{format:'wav',sampleRate:'original',channels:'original',wavBitDepth:bits});
  const buf=Buffer.from(data);
  assert.equal(buf.toString('ascii',0,4),'RIFF');assert.equal(buf.readUInt16LE(34),bits);
  assert.equal(data.length,44+44100*bits/8);
  assert.equal(await api.saveExportedFile({format:'wav',defaultName:'Đêm.wav',buffer:data}),null);
  assert.equal(calls.at(-1).args,data);assert.equal(decodeURIComponent(calls.at(-1).options.headers['x-audio-name']),'Đêm.wav');
}
for(const rate of [128,192,256,320]){
  const {data}=await ctx.audio.convertAudio(track,{format:'mp3',sampleRate:'original',channels:'original',mp3Bitrate:rate});
  assert.equal(data[0],255);assert.ok(data.length>=rate*125);
}
const slice=Uint8Array.of(0,1,2,3).subarray(1,3);
await api.saveBouncedWav('D:/Tiếng gió.mp3',slice,'1:abc');
assert.equal(calls.at(-1).args,slice);assert.equal(decodeURIComponent(calls.at(-1).options.headers['x-source-path']),'D:/Tiếng gió.mp3');
let ended=0;
const unsubscribe=api.onDragEnded(()=>ended++);
await api.startDrag(prepared);
const drag=calls.at(-1);
assert.equal(drag.name,'plugin:drag|start_drag');assert.deepEqual(drag.args.item,prepared);assert.equal(drag.args.options.mode,'copy');
assert.equal(ended,0);drag.args.onEvent.onmessage({result:'Cancel'});assert.equal(ended,1);
prepared=[];await api.startDrag('missing');assert.equal(ended,2);
unsubscribe();
console.log('PASS: PCM WAV, four MP3 bitrates, binary export, bounce token and native drag IPC lifecycle');
