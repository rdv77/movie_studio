import {build} from 'esbuild';
import assert from 'node:assert/strict';

// Exercise the real enqueue/HTTP response paths. No provider or file transfer is allowed.
const server=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=f=>async(req,ctx)=>{try{return await f(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-owner')!=='owner')throw new HttpError('Unauthorized',401);return 'owner'};
export const loadProject=async(user,id)=>{if(user!=='owner'||id!==state.id)throw new HttpError('Not found',404);return structuredClone(state)};
export const saveProject=async(user,p,revision)=>{await Promise.resolve();if(globalThis.beforeSave){const fn=globalThis.beforeSave;globalThis.beforeSave=undefined;fn();}if(user!=='owner'||p.id!==state.id)throw new HttpError('Not found',404);if(revision!==state.revision)throw new HttpError('CAS conflict',409);p.revision=revision+1;globalThis.state=structuredClone(p);globalThis.writes++;return p};
export const getKey=async()=>{globalThis.keys++;return 'offline-key'};
export const asset=async(_,id)=>{if(!globalThis.assets.has(id))throw Error('Foreign asset');return {id,mime:'image/png',size:100}};
export const imageData=async()=>{throw Error('Enqueue must not read media')};
export const storeAsset=async()=>{throw Error('Enqueue must not write media')};
export const runtime={FILES:{}};
`;
const executor=`export async function executeMediaJob(user,id,jobId){if(user!=='owner'||id!==state.id)throw Error('Unauthorized executor');if(!state.jobs.some(j=>j.id===jobId))throw Error('Missing job');globalThis.executions++;return structuredClone(state)};`;
await build({stdin:{resolveDir:process.cwd(),contents:`
export * as D from './lib/domain';export * as K from './lib/keyframes';
export * as G from './lib/generation-basis';export * as P from './lib/job-progress';
export {POST as generate} from './app/api/projects/[id]/generate/route';
export {POST as remaining} from './app/api/projects/[id]/generate-remaining/route';
export {POST as tick} from './app/api/projects/[id]/jobs/[jobId]/route';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/generation-admission-progress.mjs',plugins:[{name:'owned-cas-store',setup(b){
 b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'offline'}));
 b.onResolve({filter:/^@\/lib\/(?:hosted-media-job|media-job-runner)$/},()=>({path:'executor',namespace:'offline'}));
 b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path==='server'?server:executor}));
}}]});
const {D,K,G,P,generate,remaining,tick}=await import('../work/tests/generation-admission-progress.mjs');
globalThis.fetch=async()=>{throw Error('Network and paid calls forbidden')};
globalThis.assets=new Set();globalThis.writes=0;globalThis.keys=0;globalThis.executions=0;

function fixture(){
 const p=D.newProject('Independent video series');p.productionOrder='video-first';
 const shots=Array.from({length:3},(_,n)=>({id:D.id(),title:'План '+(n+1),description:'Герой поднимает письмо со стола.',duration:5,camera:'Средний план',continuity:'Прямая склейка',dialogue:'',speechType:'none',stateIn:'Письмо на столе',stateOut:'Письмо в руке'}));
 for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots}):'Утверждённая основа'});D.approve(p,i.id);}
 const script=p.items.find(i=>i.stage===4);p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
 const frames=[],videos=[];
 for(const shot of shots){
  const sourceShot={scriptId:script.id,shotId:shot.id,title:shot.title};
  const frame={id:D.id(),stage:5,title:shot.title,sourceShot,variants:[],keyframeMode:'pair'};p.items.push(frame);frames.push(frame);
  const start=D.makeVariant(p,frame,{kind:'image',assetId:D.id(),model:'grok-imagine-image-2.0',keyframe:'start',pairId:D.id()});
  start.keyframeReviewBasis=K.keyframeFoundationBasis(p,frame,'start',start);frame.variants.push(start);K.chooseKeyframe(p,frame.id,'start',start.id);
  const prep=K.prepareKeyframeGeneration(p,frame.id,'end',{model:start.model});
  const end=D.makeVariant(p,frame,{...prep,kind:'image',assetId:D.id()});end.keyframeReviewBasis=K.keyframeFoundationBasis(p,frame,'end',end);frame.variants.push(end);K.chooseKeyframe(p,frame.id,'end',end.id);K.approveKeyframes(p,frame.id);
  const video={id:D.id(),stage:7,title:shot.title,sourceShot,variants:[]};p.items.push(video);videos.push(video);
 }
 D.addVariant(p,videos[0].id,{kind:'video',assetId:D.id(),model:'grok-imagine-video-1.5',duration:5,text:'Ready source video'});
 for(const f of frames)for(const v of f.variants)assets.add(v.assetId);
 assert(D.stageReady(p,7),'Fixture must have approved image pairs');
 return {p,shots,scriptId:script.id,frameIds:frames.map(i=>i.id),videoIds:videos.map(i=>i.id)};
}
const base=fixture();
const reset=()=>{globalThis.state=structuredClone(base.p);globalThis.writes=0;globalThis.keys=0;globalThis.executions=0;};
const item=id=>D.getItem(state,id),frame=n=>item(base.frameIds[n]),video=n=>item(base.videoIds[n]);
const request=(body,owner='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'content-type':'application/json','test-owner':owner},body:JSON.stringify(body)});
const send=(route,body,owner='owner',projectId=state.id,jobId)=>route(request(body,owner),{params:Promise.resolve({id:projectId,jobId})});
async function expectStatus(route,body,status,pattern,owner='owner'){
 const response=await send(route,body,owner),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(pattern)assert.match(data.error,pattern);return data;
}
const input=(n=1)=>({revision:state.revision,basis:G.generationBasis(state,base.videoIds[n]),batchId:D.id(),itemId:base.videoIds[n],models:['grok-imagine-video-1.5'],count:1,prompt:'Герой поднимает письмо. Камера неподвижна.',refs:[K.selectedKeyframe(frame(n),'start').assetId],characterIds:[],dialogue:'',voiceId:'',estimates:{'grok-imagine-video-1.5':'100'}});
const batch=()=>({revision:state.revision,basis:D.dependencies(state,7),sourceBasis:G.generationBasis(state,video(0).id),batchId:D.id(),sourceItemId:video(0).id,sourceVariantId:D.chosen(video(0)).id,estimate:'100',characterIds:[],plans:[1,2].map(n=>({itemId:video(n).id,basis:G.generationBasis(state,video(n).id),ref:K.selectedKeyframe(frame(n),'start').assetId,prompt:'Герой поднимает письмо.'}))});
function unrelatedProgress(){state.jobs.push({id:D.id(),batchId:D.id(),itemId:video(0).id,kind:'video',model:'grok-imagine-video-1.5',created:D.now(),status:'pending',requestId:'already-paid',prompt:'PRIVATE PROMPT',estimate:'0',actual:'0'});state.jobs[0].pollRetry={attempts:1};state.revision++;}
function alternateEnd(n=1){
 const f=frame(n),old=K.selectedKeyframe(f,'end'),next={...structuredClone(old),id:D.id(),assetId:D.id()};assets.add(next.assetId);f.variants.push(next);K.chooseKeyframe(state,f.id,'end',next.id);K.approveKeyframes(state,f.id);return next;
}

// The modal's semantic token tolerates polling/billing/history but not material edits.
reset();const body=input(),snapshot=structuredClone(state);unrelatedProgress();state.jobs[0].actual='12';
assert.equal(G.generationBasis(state,body.itemId),body.basis);
await expectStatus(generate,body,200);assert.equal(state.jobs.length,2);assert.equal(state.jobs[0].requestId,'already-paid');assert.equal(state.jobs[1].status,'queued');assert.deepEqual(state.items,snapshot.items,'Enqueue must not select/approve');
const saved=structuredClone(state),keyCount=keys;state.configVersion++;await expectStatus(generate,body,200);assert.equal(state.jobs.length,saved.jobs.length);assert.equal(keys,keyCount,'Same batch returns before another key lookup or reservation');

reset();const oldRevision=input();delete oldRevision.basis;unrelatedProgress();await expectStatus(generate,oldRevision,400,/Основа|измен/);assert.equal(writes,0,'Legacy callers still require matching revision');
const changes=[
 ['foundation',()=>{state.configVersion++;}],
 ['approved visual style',()=>{D.chosen(item(state.items.find(i=>i.stage===2).id)).text='Другой визуальный стиль';}],
 ['actual shot duration',()=>{const v=D.chosen(item(base.scriptId)),doc=JSON.parse(v.text);doc.shots[1].duration=8;v.text=JSON.stringify(doc);} ],
 ['selected destination variant',()=>{D.addVariant(state,video(1).id,{kind:'video',assetId:D.id(),model:'grok-imagine-video-1.5',duration:5});}],
 ['selected ending, reapproved pair',()=>{alternateEnd();assert(D.stageReady(state,7),'End change remains fully approved, so readiness alone cannot detect it');}],
 ['same ending ID, different image file',()=>{const ending=K.selectedKeyframe(frame(1),'end');ending.assetId=D.id();assets.add(ending.assetId);K.approveKeyframes(state,frame(1).id);} ],
 ['hidden references',()=>{state.hiddenReferenceIds=[K.selectedKeyframe(frame(1),'start').assetId];}],
];
for(const [name,change] of changes){reset();const value=input();change();state.revision++;const before=structuredClone(state);assert.notEqual(G.generationBasis(state,value.itemId),value.basis,name);await expectStatus(generate,value,400,/Основа|измен/);assert.deepEqual(state,before,name+' cannot partially reserve');assert.equal(keys,0);}

// End selection matters to the storyboard modal too. Unselected new candidates do not.
reset();const frameBasis=G.generationBasis(state,frame(1).id),videoBasis=G.generationBasis(state,video(1).id);
frame(1).variants.push({...structuredClone(K.selectedKeyframe(frame(1),'end')),id:D.id(),assetId:D.id()});
assert.equal(G.generationBasis(state,frame(1).id),frameBasis);assert.equal(G.generationBasis(state,video(1).id),videoBasis);
alternateEnd();assert.notEqual(G.generationBasis(state,frame(1).id),frameBasis);assert.notEqual(G.generationBasis(state,video(1).id),videoBasis);

// Multi-plan route validates source selection and every target, then merges queue-only revisions.
reset();const remainingBody=batch();unrelatedProgress();await expectStatus(remaining,remainingBody,200);assert.equal(state.jobs.length,3);const remainingSaved=structuredClone(state);await expectStatus(remaining,remainingBody,200);assert.deepEqual(state,remainingSaved);
for(const [name,change] of [['target ending',()=>alternateEnd(2)],['source selected video',()=>D.addVariant(state,video(0).id,{kind:'video',model:'grok-imagine-video-1.5',assetId:D.id()})],['script duration',()=>{const v=D.chosen(item(base.scriptId)),d=JSON.parse(v.text);d.shots[2].duration=8;v.text=JSON.stringify(d);} ]]){
 reset();const value=batch();change();state.revision++;const before=structuredClone(state);await expectStatus(remaining,value,400,/Основа|измен|Выберите/);assert.deepEqual(state,before,name);assert.equal(keys,0);
}

// Concurrent independent plans may share a stale modal revision, never a stale budget.
reset();state.limit='150';const first=input(1),second=input(2);const races=await Promise.all([send(generate,first),send(generate,second)]);const statuses=races.map(r=>r.status);assert.equal(statuses.filter(s=>s===200).length,1);assert.equal(statuses.filter(s=>s===400).length,1);assert.equal(state.jobs.length,1);assert.equal(writes,1);const rejected=await races.find(r=>r.status===400).json();assert.match(rejected.error,/лимит/);
reset();const duplicate=input(1);const duplicates=await Promise.all([send(generate,duplicate),send(generate,duplicate)]);assert(duplicates.every(r=>r.status===200));assert.equal(state.jobs.length,1);assert.equal(writes,1,'Identical concurrent batch reserves exactly once');
reset();const denied=input();await expectStatus(generate,denied,401,/Unauthorized/,'stranger');assert.equal(writes,0);assert.equal(keys,0);
reset();const racedEnd=input();globalThis.beforeSave=()=>{alternateEnd();state.revision++;};await expectStatus(generate,racedEnd,400,/Основа|референсы/);assert.equal(state.jobs.length,0);assert.equal(writes,0,'CAS retry must recheck approved ending, not just initial admission');

// Unchanged-only compact replies carry no job/prompt data and do not claim a newer full revision.
reset();unrelatedProgress();state.privateArchive='PRIVATE ARCHIVE '.repeat(10000);const pollId=state.jobs[0].id,beforePoll=structuredClone(state);
const compactResponse=await send(tick,{compact:true,revision:state.revision},'owner',state.id,pollId),compactText=await compactResponse.text(),compact=JSON.parse(compactText);
assert.equal(compactResponse.status,200);assert.deepEqual(compact,{kind:'job-progress',projectId:state.id,revision:state.revision,unchanged:true});assert(compactText.length<200);assert(!compactText.includes('PRIVATE'));assert(P.isUnchangedJobProgress(compact));assert.deepEqual(state,beforePoll);assert.equal(writes,0);
for(const revision of [state.revision-1,state.revision+1,undefined,'1',NaN])assert.equal(P.unchangedJobProgress(state,revision),undefined);
const full=await (await send(tick,{compact:true,revision:state.revision-1},'owner',state.id,pollId)).json();assert.equal(full.revision,state.revision);assert.deepEqual(full.jobs,state.jobs);assert.equal(full.privateArchive,state.privateArchive,'Different revision requires a complete snapshot, not partial jobs');
const legacy=await (await send(tick,{},'owner',state.id,pollId)).json();assert.deepEqual(legacy,JSON.parse(JSON.stringify(state)),'Old callers receive the full JSON project');
const executionCount=executions;const unauthorized=await send(tick,{compact:true,revision:state.revision},'stranger',state.id,pollId);assert.equal(unauthorized.status,401);assert.equal(executions,executionCount);
console.log('PASS generation admission/progress: queue-only revisions, approved endpoint/source/duration changes, per-row remaining checks, idempotent duplicate/CAS budget, ownership, compact unchanged-only no prompt leaks/no revision advance, legacy full response. No paid calls.');
