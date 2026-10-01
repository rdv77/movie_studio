import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir('work/tests',{recursive:true});
const server=`export class HttpError extends Error{};export const loadProject=async()=>structuredClone(globalThis.film);export const saveProject=async(_,p)=>{p.revision++;globalThis.film=structuredClone(p);return p};export const mutate=async(_,id,fn)=>{const p=structuredClone(globalThis.film);fn(p);p.revision++;globalThis.film=p;return structuredClone(p)};export const getKey=async()=> 'offline-key';export const imageData=async()=>{globalThis.imageReads++;throw Error('No media reads before stale cancellation')};export const asset=async()=>{throw Error('No asset reads')};export const storeAsset=async()=>{throw Error('No output stores')};export const runtime={FILES:{head:async()=>false,get:async()=>null}};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as A from './lib/animatic';export * as M from './lib/animatic-manifest';export * as V from './lib/video-from-animatic';export * as B from './lib/video-preparation-basis';export * as C from './lib/creative-versions';export * as J from './lib/prompt-jobs';export {ensureDirecting} from './lib/directing';export {editPlan} from './lib/render';export {executeMediaJob} from './lib/media-job-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/video-preparation-basis.mjs',plugins:[{name:'offline-private-runtime',setup(b){b.onResolve({filter:/^(?:@\/lib\/server|\.\/server)$/},()=>({path:'server',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:server}));}}]});
const {D,A,M,V,B,C,J,ensureDirecting,editPlan,executeMediaJob}=await import('../work/tests/video-preparation-basis.mjs');
const previousFetch=globalThis.fetch;let network=0;globalThis.imageReads=0;
globalThis.fetch=async()=>{network++;throw Error('Provider calls forbidden in offline dependency test')};
const p=D.newProject('Четыре независимых плана');p.productionOrder='video-first';p.speechMode='plans';p.animaticSettings={sound:'silent',music:false,motion:false};ensureDirecting(p);
const shots=Array.from({length:4},(_,n)=>({id:'shot-'+n,title:'План '+(n+1),duration:5,description:'Герой замечает письмо '+n,camera:'Средний план',productionDesign:'Мягкий свет',stateIn:'Письмо на столе '+n,stateOut:'Письмо в руке '+n,continuityChanges:'Письмо поднято',continuity:'Прямая склейка',speechType:'none',dialogue:'',cast:[]}));
function approved(item,data){const v=D.makeVariant(p,item,data);item.variants.push(v);item.selectedId=item.approvedId=v.id;return v;}
for(const stage of [0,2,3,1])approved(p.items.find(i=>i.stage===stage),{text:'Утверждено'});
const script=p.items.find(i=>i.stage===4);approved(script,{text:JSON.stringify({timingMode:'actual',shots})});
const frames=shots.map((shot,n)=>{const i=n?{id:D.id(),stage:5,title:shot.title,variants:[]}:p.items.find(i=>i.stage===5);if(n)p.items.push(i);i.title=shot.title;i.sourceShot={scriptId:script.id,shotId:shot.id,title:shot.title};approved(i,{kind:'image',assetId:D.id(),duration:5});return i;});p.storyboardOrder=frames.map(i=>i.id);
function render(){const plan=editPlan(p,true),basis=A.animaticBasis(p),manifest=M.buildAnimaticManifest(p,plan,basis);return A.saveAnimatic(p,{kind:'video',assetId:D.id(),duration:20,animaticManifest:manifest},basis);}
const first=render();V.prepareVideosFromAnimatic(p,first.id);const videos=shots.map(s=>p.items.find(i=>i.stage===7&&i.sourceShot?.shotId===s.id));
// Emulate the complete pre-hotfix preparation object and already approved output.
for(const i of videos){delete i.videoPreparation.shotBasis;delete i.videoPreparation.sourceFrames;delete i.videoPreparation.sourceDuration;}
const legacy=videos.map((item,n)=>approved(item,{kind:'video',model:'grok-imagine-video-1.5',assetId:D.id(),duration:5,refs:[item.videoPreparation.startFrame.assetId],videoPreparationBasis:C.versionSignature(item.videoPreparation)}));
assert(legacy.every((v,n)=>D.variantCurrent(p,videos[n],v)));
const legacyBases=legacy.map(v=>v.videoPreparationBasis),oldAnimatic=first.id,second=render();assert.notEqual(second.id,oldAnimatic);
V.prepareVideosFromAnimatic(p,second.id);
assert(videos.every((item,n)=>item.videoPreparation.legacyBases.includes(legacyBases[n])),'Only proven equivalent full-object legacy hashes remain accepted');
assert(videos.every(item=>D.approvalCurrent(p,item)),'Identical rerender retains all previously approved paid videos');
const unneededHistory={role:'start',frame:{variantId:D.id(),assetId:D.id()},created:'2026-10-01T00:00:00.000Z'};
videos[0].videoPreparation.frameHistory=[unneededHistory];
assert(D.approvalCurrent(p,videos[0]),'History alone cannot change a compatible legacy approval');
function compiled(item,model='grok-imagine-video-1.5',extra={}){const prepared=V.preparedVideoInputs(p,item,model,extra.refs?.[0]);const job={id:D.id(),itemId:item.id,model,kind:'video',brief:'Показать движение героя. Рот закрыт.',prompt:'',refs:[prepared.startFrameId],endFrameAssetId:prepared.endFrameId,videoPreparationBasis:prepared.basis,duration:5,status:'queued',deps:D.dependencies(p,7),estimate:'8500000000',...extra};const output=J.compileMediaJob(p,job,{duration:item.videoPreparation.duration,...(model==='MiniMax-Hailuo-2.3'?{allowLegacyModel:true}:{})});C.stampGenerationVersions(p,[output]);return output;}
const fresh=videos.map(item=>{const job=compiled(item);return approved(item,{...job,assetId:D.id(),jobId:job.id});});
assert(fresh.every(v=>v.videoPreparationBasis.startsWith('vp2:')));
assert(fresh.every((v,n)=>D.variantCurrent(p,videos[n],v)));
const firstBasis=fresh[0].videoPreparationBasis,prep=videos[0].videoPreparation;
prep.animaticVariantId='removed-provenance-only';prep.manifestBasis='history-only';prep.frameHistory.push({...unneededHistory,created:'tomorrow'});prep.overriddenRoles=['start'];
assert.equal(fresh[0].videoPreparationBasis,firstBasis);assert(D.variantCurrent(p,videos[0],fresh[0]));assert.equal(V.videoPreparationIssue(p,videos[0]),'','A material snapshot is independent of old animatic provenance');
assert.equal(V.videoPreparationIssue(p,videos[3]),'');
// An unrelated global soundtrack/title/target update does not touch video pixels.
p.animaticSettings.motion=true;p.captions=[{itemId:videos[3].id,text:'Новый титр',font:'sans',size:50,position:'bottom'}];p.seconds=120;
assert(fresh.every((v,n)=>D.variantCurrent(p,videos[n],v)));assert.equal(V.videoPreparationIssue(p,videos[3]),'');
assert.throws(()=>V.prepareVideosFromAnimatic(p,second.id),'A NEW preparation still validates the whole current manifest');
p.animaticSettings.motion=false;p.captions=[];p.seconds=50;prep.animaticVariantId=second.id;prep.manifestBasis=C.versionSignature(second.animaticManifest);
const edit=fn=>{const data=JSON.parse(script.variants.find(v=>v.id===script.approvedId).text);fn(data.shots);script.variants.find(v=>v.id===script.approvedId).text=JSON.stringify(data);};
edit(s=>s[1].stateOut='Письмо спрятано');
assert.deepEqual(fresh.map((v,n)=>D.variantCurrent(p,videos[n],v)),[true,false,false,true],'Only the changed shot and necessary following join become stale');
assert.equal(V.videoPreparationIssue(p,videos[0]),'');assert.equal(V.videoPreparationIssue(p,videos[3]),'');assert(V.videoPreparationIssue(p,videos[1]));
edit(s=>{s[1].stateOut=shots[1].stateOut;s[1].stateIn='Письмо уже поднято'});
assert.deepEqual(fresh.map((v,n)=>D.variantCurrent(p,videos[n],v)),[false,false,true,true],'An entry change touches the previous join, not the whole film');
edit(s=>s[1].stateIn=shots[1].stateIn);
edit(s=>s[1].videoPrompt='Герой резко оборачивается вместо спокойного движения');assert(!D.variantCurrent(p,videos[1],fresh[1]),'A changed actual video task is material even with unchanged camera and states');assert(D.variantCurrent(p,videos[0],fresh[0]));edit(s=>delete s[1].videoPrompt);
edit(s=>s[1].imagePrompt='Другой текст для будущих картинок');assert(D.variantCurrent(p,videos[1],fresh[1]),'An unused future image prompt does not change these already selected video pixels');edit(s=>delete s[1].imagePrompt);
const localScriptBasis=B.preparationShotBasis(p,videos[0]),otherScript={id:D.id(),stage:4,title:'Другой сценарий',variants:[]};otherScript.variants=[D.makeVariant(p,otherScript,{text:JSON.stringify({shots:[{...shots[0],description:'Чужая сцена'}]})})];otherScript.approvedId=otherScript.variants[0].id;p.items.unshift(otherScript);
assert.equal(B.preparationShotBasis(p,videos[0]),localScriptBasis,'The explicit sourceScript ID wins over another active stage-4 card');p.items.shift();script.planArchive={reason:'removed'};assert(!D.variantCurrent(p,videos[0],fresh[0]));assert(V.videoPreparationIssue(p,videos[0]));delete script.planArchive;
const baseline=structuredClone(videos[0].videoPreparation);
for(const change of [v=>v.startFrame.assetId=D.id(),v=>v.startFrame.transform={sourceAssetId:v.startFrame.assetId,sourceWidth:1920,sourceHeight:1080,rect:{x:100,y:0,width:1600,height:900},format:'16:9',outputWidth:1600,outputHeight:900},v=>v.duration=5.5]){
  change(videos[0].videoPreparation);assert(!D.variantCurrent(p,videos[0],fresh[0]),'Actual source, crop and target duration changes invalidate existing output');videos[0].videoPreparation=structuredClone(baseline);
}
// End references are meaningful only for models that actually send them.
const ending=D.makeVariant(p,frames[0],{kind:'image',assetId:D.id(),keyframe:'end'});frames[0].variants.push(ending);frames[0].keyframeSelection={startId:frames[0].approvedId,endId:ending.id};
videos[0].videoPreparation.endFrame={variantId:ending.id,assetId:ending.assetId};videos[0].videoPreparation.sourceFrames.endFrame={variantId:ending.id,assetId:ending.assetId};
const supported=compiled(videos[0]);const unsupported=compiled(videos[0],'MiniMax-Hailuo-2.3');
assert.equal(supported.endFrameAssetId,ending.assetId);assert.equal(unsupported.endFrameAssetId,undefined);assert(B.videoBasisUsesEnd(supported));assert(!B.videoBasisUsesEnd(unsupported));
assert(D.jobCurrent(p,videos[0],supported));assert(D.jobCurrent(p,videos[0],unsupported));
const differentEnd=D.makeVariant(p,frames[0],{kind:'image',assetId:D.id(),keyframe:'end'});frames[0].variants.push(differentEnd);frames[0].keyframeSelection.endId=differentEnd.id;videos[0].videoPreparation.endFrame={variantId:differentEnd.id,assetId:differentEnd.assetId};
assert(!D.jobCurrent(p,videos[0],supported));assert(D.jobCurrent(p,videos[0],unsupported),'An unsupported unsent endpoint does not invalidate first-only output');assert.equal(V.videoPreparationIssue(p,videos[0],unsupported),'');
frames[0].keyframeSelection.endId=ending.id;videos[0].videoPreparation=structuredClone(baseline);delete frames[0].keyframeSelection;
// An explicitly supplied alternate stays pinned; changing the default does not
// imply that the alternate file itself was changed or silently substituted.
const alternate=D.makeVariant(p,frames[0],{kind:'image',assetId:D.id()});frames[0].variants.push(alternate);
const pinned=compiled(videos[0],'grok-imagine-video-1.5',{refs:[alternate.assetId]});assert(!B.videoBasisFollowsFrame(pinned,'start'));assert(D.jobCurrent(p,videos[0],pinned));
videos[0].videoPreparation.startFrame={variantId:alternate.id,assetId:alternate.assetId};assert(D.jobCurrent(p,videos[0],pinned));assert.equal(V.videoPreparationIssue(p,videos[0],pinned),'');videos[0].videoPreparation=structuredClone(baseline);
const tampered=structuredClone(pinned);tampered.refs=[D.id()];assert(!D.jobCurrent(p,videos[0],tampered),'A frozen request cannot substitute its actual files');
// No legacy alias is carried across an actual image change.
V.overridePreparedVideoFrame(p,videos[0].id,'start',alternate.id);assert(!videos[0].videoPreparation.legacyBases?.includes(legacyBases[0]));assert(!D.variantCurrent(p,videos[0],legacy[0]));videos[0].videoPreparation=structuredClone(baseline);
// Dispatch rechecks the local basis immediately before the paid provider call.
const queued=compiled(videos[0]);p.jobs=[queued];V.overridePreparedVideoFrame(p,videos[0].id,'start',alternate.id);globalThis.film=structuredClone(p);
try{const result=await executeMediaJob('owner',p.id,queued.id);const cancelled=result.jobs.find(j=>j.id===queued.id);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.actual,'0');assert.equal(network,0);assert.equal(globalThis.imageReads,0);}
finally{globalThis.fetch=previousFetch;}
console.log('PASS local video basis: legacy identical rerender/history, independent animatic provenance/global sound, selective adjoining joins, actual pixels/crop/duration, supported endpoints, pinned overrides and frozen pre-payment cancellation');
