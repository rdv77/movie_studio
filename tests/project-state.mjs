import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/server.ts','lib/domain.ts','lib/project-state.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/project-state',outExtension:{'.js':'.mjs'},plugins:[{name:'runtime',setup(b){b.onResolve({filter:/^\.\/storage$/},()=>({path:'storage',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const runtime=globalThis.storageRuntime;export class StorageError extends Error {}'}));}}]});
const rows=new Map(),objects=new Map(),reads=[],writes=[],bindings=[];
let dbFault='',putFault=false,barrier;
globalThis.storageRuntime={FILES:{async put(key,bytes){writes.push(key);if(putFault)throw new Error('R2 failure');objects.set(key,new Uint8Array(bytes).slice());if(barrier)await barrier();return {key};},async get(key){reads.push(key);const bytes=objects.get(key);return bytes?{size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer}:null;}},DB:{prepare(sql){return {bind(...args){bindings.push(args);return {async first(){const row=rows.get(args[0]);if(!row||row.owner!==args[1])return null;return sql.startsWith('SELECT state')?{state:row.state,revision:row.revision}:{revision:row.revision};},async run(){
  for(const a of args)if(typeof a==='string'&&new TextEncoder().encode(a).length>2_000_000)throw new Error('D1_ERROR: string or blob too big: SQLITE_TOOBIG');
  if(dbFault==='before')throw new Error('D1 unavailable');
  const [state,title,revision,updated,id,owner,expected]=args,row=rows.get(id);
  const changes=!!row&&row.owner===owner&&row.revision===expected?1:0;
  if(changes)rows.set(id,{state,title,revision,updated,owner});
  if(dbFault==='after')throw new Error('D1 response lost after commit');return {meta:{changes}};
}};}};}}};
const S=await import('../work/tests/project-state/server.mjs'),D=await import('../work/tests/project-state/domain.mjs'),C=await import('../work/tests/project-state/project-state.mjs');
const owner='owner',p=D.newProject('Сохранность фильма');
const seed=(p,user=owner)=>rows.set(p.id,{owner:user,title:p.title,state:JSON.stringify(p),revision:p.revision});
seed(p);assert.deepEqual(await S.loadProject(owner,p.id),p);assert.equal(reads.length,0,'Legacy inline load does not touch R2');
const large=structuredClone(p);large.jobs.push({id:D.id(),itemId:p.items[0].id,status:'done',prompt:'Я'.repeat(1_150_000),actual:'123456789',requestId:'paid-receipt'});large.removedVariants=[{itemId:p.items[1].id,variant:{id:D.id(),text:'Удалённый образ',assetId:D.id()},removedAt:D.now()}];
const old=structuredClone(large);await S.saveProject(owner,large,0);assert.equal(large.revision,1);
let pointer=JSON.parse(rows.get(p.id).state);assert.equal(pointer.$kadrProjectState,'r2-v1');assert(rows.get(p.id).state.length<500);assert.equal(pointer.size,new TextEncoder().encode(JSON.stringify({...old,revision:1})).length);
assert.deepEqual(await S.loadProject(owner,p.id),large,'Full large state, assets, approvals and receipts round trip');
const readsBefore=reads.length,writesBefore=writes.length;await assert.rejects(()=>S.loadProject('stranger',p.id),e=>e.status===404);await assert.rejects(()=>S.saveProject('stranger',large,1),e=>e.status===404);assert.equal(reads.length,readsBefore);assert.equal(writes.length,writesBefore);
await assert.rejects(()=>S.saveProject(owner,structuredClone(large),0),e=>e.status===409);assert.equal(writes.length,writesBefore,'Stale caller does not upload a blob');
// Both contenders pass the first read; unique R2 keys ensure the losing save cannot overwrite the winner.
let entered=0,release;const gate=new Promise(r=>release=r);barrier=async()=>{if(++entered===2)release();await gate;};
const a=structuredClone(large),b=structuredClone(large);a.title='Первый';b.title='Второй';
const outcomes=await Promise.allSettled([S.saveProject(owner,a,1),S.saveProject(owner,b,1)]);barrier=undefined;
assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);assert.notEqual(writes.at(-1),writes.at(-2));
const winning=await S.loadProject(owner,p.id);assert.equal(winning.title,outcomes.find(r=>r.status==='fulfilled').value.title);assert.equal(winning.revision,2);
assert(objects.has(pointer.key),'Committed previous snapshot remains available to readers holding its pointer');
// Storage or transport failures never delete committed or possibly committed snapshots.
putFault=true;const rowBefore=structuredClone(rows.get(p.id)),candidate=structuredClone(winning);await assert.rejects(()=>S.saveProject(owner,candidate,2),/Не удалось сохранить/);assert.deepEqual(rows.get(p.id),rowBefore);assert.equal(candidate.revision,2);putFault=false;
dbFault='before';await assert.rejects(()=>S.saveProject(owner,candidate,2),/D1 unavailable/);assert.deepEqual(rows.get(p.id),rowBefore);assert(objects.has(writes.at(-1)));dbFault='';
dbFault='after';await assert.rejects(()=>S.saveProject(owner,candidate,2),/response lost/);dbFault='';assert.equal(candidate.revision,2);assert.equal((await S.loadProject(owner,p.id)).revision,3);assert(objects.has(writes.at(-1)));
const validRow=structuredClone(rows.get(p.id)),validPointer=JSON.parse(validRow.state),originalBytes=objects.get(validPointer.key);
objects.delete(validPointer.key);await assert.rejects(()=>S.loadProject(owner,p.id),/Не удалось прочитать/);objects.set(validPointer.key,originalBytes);
objects.set(validPointer.key,new Uint8Array(originalBytes).fill(32));await assert.rejects(()=>S.loadProject(owner,p.id),/Не удалось прочитать/);objects.set(validPointer.key,originalBytes);
const other=D.newProject('Другой проект');seed(other);const countReads=reads.length;rows.get(other.id).state=validRow.state;rows.get(other.id).revision=validRow.revision;await assert.rejects(()=>S.loadProject(owner,other.id),/Не удалось прочитать/);assert.equal(reads.length,countReads,'Cross-project pointers are rejected before R2 access');
rows.get(p.id).state=JSON.stringify({...validPointer,$kadrProjectState:'r2-v2'});await assert.rejects(()=>S.loadProject(owner,p.id),/Не удалось прочитать/);rows.set(p.id,validRow);
// Russian text crosses the inline threshold by bytes even while the JS character count fits.
const utf=D.newProject('Кириллица');utf.jobs.push({id:D.id(),status:'done',prompt:'Я'.repeat(260000)});assert(JSON.stringify(utf).length<C.PROJECT_STATE_INLINE_BYTES);seed(utf);await S.saveProject(owner,utf,0);assert.equal(JSON.parse(rows.get(utf.id).state).$kadrProjectState,'r2-v1');
await Promise.all([S.mutate(owner,p.id,p=>{p.counter=(p.counter??0)+1}),S.mutate(owner,p.id,p=>{p.counter=(p.counter??0)+1})]);assert.equal((await S.loadProject(owner,p.id)).counter,2,'CAS retry retains both independent mutations');
const small=D.newProject('Малый проект');seed(small);const puts=writes.length;await S.saveProject(owner,small,0);assert.equal(writes.length,puts);assert.deepEqual(await S.loadProject(owner,small.id),small);
assert(bindings.every(args=>args.every(a=>typeof a!=='string'||new TextEncoder().encode(a).length<2_000_000)));
console.log('PASS project snapshots: >2 MB roundtrip, UTF-8 threshold, inline migration, owner isolation, exact revision CAS, concurrent saves/mutations, R2 failures, D1 errors before/after commit, missing/corrupt/foreign snapshots and preserved history. No paid calls.');
