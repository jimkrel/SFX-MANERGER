// Run both production search functions on copies of the same disposable catalog.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, copyFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
import {build} from 'esbuild';

const temp = mkdtempSync(path.join(os.tmpdir(), 'sfx-benchmark-'));
try {
  const snapshot = path.join(temp, 'snapshot.sqlite');
  const rust = JSON.parse(execFileSync('cargo', ['run','--locked','--release',
    '--no-default-features','--manifest-path','src-tauri/Cargo.toml','--example','library_benchmark'],
    {encoding:'utf8', env:{...process.env,SFX_BENCH_SNAPSHOT:snapshot},stdio:['ignore','pipe','inherit']}));
  const {outputFiles} = await build({entryPoints:['src/main/db.ts'],bundle:true,platform:'node',
    external:['electron','better-sqlite3'],format:'cjs',write:false});
  const require = createRequire(import.meta.url);
  const userData = path.join(temp,'electron');
  mkdirSync(userData);
  const module = {exports:{}};
  const localRequire = name => name === 'electron' ? {app:{getPath:()=>userData}} : require(name);
  // Execute in this realm so better-sqlite3 receives ordinary native JS objects.
  vm.compileFunction(outputFiles[0].text,['module','exports','require'])(module,module.exports,localRequire);
  const db = module.exports;
  const samples = [];
  for (let round=0; round<rust.rounds; round++){
    copyFileSync(snapshot,path.join(userData,'library.db'));
    db.initDatabase();
    try {
      for (let n=0; n<100; n++){
        const query = {searchQuery:'Group'+String(n%20).padStart(2,'0'),limit:50};
        const start = performance.now();
        const rows = db.getTracks(query);
        samples.push(performance.now()-start);
        assert.equal(rows.length,50);
      }
    } finally {db.closeDatabase();}
  }
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({rust,electron_database_under_node:{
    queries:samples.length,search_median_ms:samples[Math.floor(samples.length/2)],
    search_p95_ms:samples[Math.ceil(samples.length*0.95)-1],
  }},null,2));
} finally {rmSync(temp,{recursive:true,force:true});}
