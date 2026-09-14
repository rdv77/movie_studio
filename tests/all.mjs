import {readdir,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
await mkdir('work/tests',{recursive:true});
const skip=new Set(['all.mjs','api.mjs','server-smoke.mjs','container-smoke.mjs','provider-harness.mjs']);
for(const file of (await readdir('tests')).filter(n=>n.endsWith('.mjs')&&!skip.has(n)).sort()){
  console.log('\nTEST '+file);
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['tests/'+file],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(file+' failed: '+code)));});
}
console.log('\nAll local regression tests passed. No paid provider requests.');
