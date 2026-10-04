import assert from 'node:assert/strict';
import {build} from 'esbuild';
const server=`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};export const loadProject=async(_,id)=>{if(id!==globalThis.state.id)throw Error('Wrong project');return structuredClone(globalThis.state)};export const saveProject=async(_,p,r)=>{if(globalThis.state.revision!==r||globalThis.conflict)throw Error('CAS conflict');p.revision++;globalThis.state=structuredClone(p);return p};export const asset=async()=>({mime:'image/png',size:10});`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as B from './lib/storyboard-starts';export * as S from './lib/storyboard';export * as Q from './lib/queue-policy';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/storyboard-starts.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'mock-server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,B,S,Q,PATCH}=await import('../work/tests/storyboard-starts.mjs');
const fixture=()=>{
  const p=D.newProject('Пропущенные начала'),first=p.items.find(i=>i.stage===5),second={id:D.id(),title:'Другой план',stage:5,variants:[]};p.items.push(second);
  const shots=[first,second].map(item=>({id:D.id(),title:item.title,description:'Герой ждёт',duration:5,camera:'Статично',continuity:'Склейка',speechType:'none',speaker:'',dialogue:''}));
  for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots}):'Утверждённая основа'});D.approve(p,item.id);}
  const script=p.items.find(i=>i.stage===4);[first,second].forEach((item,n)=>item.sourceShot={scriptId:script.id,title:shots[n].title,shotId:shots[n].id});
  const unknown=item=>({id:D.id(),itemId:item.id,kind:'image',keyframe:'start',status:'unknown',created:D.now(),actual:'123',estimate:'456',requestId:'saved-request',output:{url:'https://provider.example/result'},prompt:'Historical prompt'});
  p.jobs.push(unknown(first),unknown(second));return {p,first,second,unknown};
};
const request=(itemIds,revision=state.revision)=>PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify({revision,action:'allowMissingStoryboardStarts',data:{itemIds}})}),{params:Promise.resolve({id:state.id})});
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Permission must never generate, poll or pay');};
try{
  let f=fixture();globalThis.state=f.p;
  const before=structuredClone(state);assert.equal(B.missingStoryboardStartRetries(state).length,2);assert(S.storyboardBatchPlans(state).every(row=>row.blocked));
  await assert.rejects(()=>request([f.first.id,D.id()]),/уже имеет первый кадр|не участвует/);assert.deepEqual(state,before,'All IDs are validated before permission changes');
  await assert.rejects(()=>request([f.first.id,f.first.id]),/неповторяющийся/);await assert.rejects(()=>request([f.first.id],-1),/Проект изменился/);assert.deepEqual(state,before);
  globalThis.denied=true;await assert.rejects(()=>request([f.first.id]),/Unauthorized/);globalThis.denied=false;
  globalThis.conflict=true;await assert.rejects(()=>request([f.first.id]),/CAS conflict/);globalThis.conflict=false;assert.deepEqual(state,before);
  await request([f.first.id,f.second.id]);assert.equal(state.jobs.length,2);assert(S.storyboardBatchPlans(state).every(row=>!row.hasImage&&!row.blocked),'The initial-image batch honours explicit retry permission');
  for(let n=0;n<2;n++){const job=state.jobs[n],saved=before.jobs[n];assert(job.newSeriesAllowedAt);const {newSeriesAllowedAt,...rest}=job;assert.deepEqual(rest,saved,'Receipt, unknown outcome, prompt and billing remain historical');}
  assert.deepEqual(state.items,before.items,'Viewing/permission never alters choices, variants or approval');assert.equal(B.missingStoryboardStartRetries(state).length,0);
  const dates=state.jobs.map(job=>job.newSeriesAllowedAt);await request([f.first.id,f.second.id]);assert.deepEqual(state.jobs.map(job=>job.newSeriesAllowedAt),dates,'Repeated explicit permission is idempotent');
  f=fixture();globalThis.state=f.p;state.jobs.push({...f.unknown(f.first),id:D.id(),status:'pending'});assert.equal(B.missingStoryboardStartRetries(state).length,1);const active=structuredClone(state);await assert.rejects(()=>request([f.second.id,f.first.id]),/действующая генерация/);assert.deepEqual(state,active);
  f=fixture();globalThis.state=f.p;state.items.find(i=>i.id===f.first.id).variants.push(D.makeVariant(state,f.first,{kind:'image',assetId:D.id()}));assert.equal(B.missingStoryboardStartRetries(state).length,1);await assert.rejects(()=>request([f.first.id]),/уже имеет первый кадр/);
  f=fixture();globalThis.state=f.p;const hero=state.items.find(i=>i.stage===1);state.jobs.push(f.unknown(hero));state.items.push({...f.second,id:D.id(),removedAt:D.now()},{...f.second,id:D.id(),planArchive:{reason:'removed'}});assert.deepEqual(B.missingStoryboardStartRetries(state).map(row=>row.itemId),[f.first.id,f.second.id]);await assert.rejects(()=>request([hero.id]),/не участвует/);
  state.jobs.push({...f.unknown(f.first),id:D.id(),keyframe:'end'});await request([f.first.id]);assert(Q.queueAdmissionIssue(state,f.first.id),'Unrelated unknown endpoint remains protected');assert.equal(state.jobs.at(-1).newSeriesAllowedAt,undefined);
  f=fixture();globalThis.state=f.p;const item=state.items.find(i=>i.id===f.first.id);item.variants.push(D.makeVariant(state,item,{kind:'image',assetId:D.id(),keyframe:'end'}));assert.equal(B.missingStoryboardStartRetries(state).length,2,'An end is not a saved start');await request([f.first.id]);assert.equal(S.storyboardBatchPlans(state).find(row=>row.item.id===f.first.id).hasImage,false);
  console.log('PASS missing storyboard starts: explicit set permission, ownership/revision/CAS, atomic validation, preserved unknown receipts and billing, no generation, idempotence, actual first-frame files, archived/removed/other-stage/active/other-role protection and batch admission.');
}finally{globalThis.fetch=originalFetch;}
