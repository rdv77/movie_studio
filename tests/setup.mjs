import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {parseEnv} from 'node:util';
import {build} from 'esbuild';
await build({entryPoints:['lib/auth.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/setup-auth.mjs'});
const {getAuthConfig,verifyCredentials}=await import('../work/tests/setup-auth.mjs');
const parent=resolve('work/tests'),temp=await mkdtemp(parent+'/setup-'),script=resolve('scripts/setup.mjs');
try{
  const run=(...args)=>spawnSync(process.execPath,[script,...args],{cwd:temp,encoding:'utf8'});
  assert.notEqual(run('--origin=http://public.example').status,0);
  const created=run('--origin=https://studio.example.com','--username=director');
  assert.equal(created.status,0);
  const contents=await readFile(temp+'/.env','utf8'),env=parseEnv(contents),config=getAuthConfig(env);
  assert(config,'Generated env must be accepted by actual authentication');
  const password=created.stdout.match(/Password \(shown once\): ([^\r\n]+)/)?.[1];
  assert(password);assert(await verifyCredentials('director',password,config));
  assert.equal(Buffer.from(env.VAULT_KEY,'base64').length,32);assert(!contents.includes(password));
  assert.notEqual(run().status,0);assert.equal(await readFile(temp+'/.env','utf8'),contents,'Setup cannot overwrite installed secrets');
  console.log('PASS setup: real generated credentials accepted, remote HTTPS enforced, existing secrets preserved.');
}finally{
  const rel=relative(parent,resolve(temp));if(!rel||rel.startsWith('..'))throw Error('Unsafe cleanup');
  await rm(temp,{recursive:true,force:true});
}
