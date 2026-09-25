import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/render';export * as A from './lib/animatic';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/assembly-cuts.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,revision)=>{if(state.revision!==revision)throw Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const asset=async()=>({mime:'video/mp4'});`}));}}]});
const {D,R,A,PATCH}=await import('../work/tests/assembly-cuts.mjs');
const p=D.newProject('Монтаж');p.speechMode='plans';p.seconds=15;
const shots=Array.from({length:3},(_,n)=>({title:'План '+n,description:'Цех',duration:5,camera:'Статичная',continuity:'Склейка',dialogue:'Привет',speechType:'voiceover'}));
for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
const scriptId=p.items.find(i=>i.stage===4).id;
for(const stage of [5,6,7])for(const [n,s] of shots.entries()){
 const i={id:D.id(),stage,title:s.title,sourceShot:{scriptId,title:s.title,key:'number:'+n},variants:[]};p.items.push(i);
 D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:5,dialogue:'Привет'});D.approve(p,i.id);
}
globalThis.state=structuredClone(p);
const video=p.items.find(i=>i.stage===7),cut={itemId:video.id,variantId:video.approvedId,trim:1,duration:3};
const patch=async(cuts,revision=state.revision)=>PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify({action:'saveAssemblyCuts',revision,data:{cuts}})}),{params:Promise.resolve({id:p.id})});
const basis=A.animaticBasis(p),deps=D.dependencies(p,7),final=D.dependencies(p,8);
await patch([cut]);assert.deepEqual(state.assemblyCuts,[cut]);assert.deepEqual(state.items,p.items);
assert.equal(A.animaticBasis(state),basis);assert.equal(D.dependencies(state,7),deps);assert.notEqual(D.dependencies(state,8),final);
assert(state.items.filter(i=>i.stage===7).every(i=>D.isApproved(state,i)));
let base=R.editPlan(state,false),fit=R.fitFinalPlan(base,[6,6,6],[1,1,1]);
assert.equal(fit.seconds,15);assert.equal(fit.audio[1].offset,3);assert.equal(fit.clips[0].trim,1);
await patch([{...cut,duration:null}]);fit=R.fitFinalPlan(R.editPlan(state,false),[6,6,6],[1,1,1]);assert.equal(fit.seconds,17);
await patch([cut]);
for(const invalid of [{itemId:D.id()},{variantId:D.id()},{trim:-1},{duration:0},{duration:'invalid'},{duration:3601}]){
 const old=structuredClone(state);await assert.rejects(()=>patch([{...cut,...invalid}]));assert.deepEqual(state,old);
}
await assert.rejects(()=>patch([cut,cut]));await assert.rejects(()=>patch([cut],state.revision-1));
globalThis.denied=true;await assert.rejects(()=>patch([cut]),/Unauthorized/);globalThis.denied=false;
const old=structuredClone(state);state.items.find(i=>i.id===video.id).approvedId=undefined;await assert.rejects(()=>patch([cut]),/утверждённый/);state=old;
// A new approved variant must not inherit the old video's cuts.
const i=state.items.find(i=>i.id===video.id);D.addVariant(state,i.id,{kind:'video',assetId:D.id(),duration:5});D.approve(state,i.id);
base=R.editPlan(state,false);assert.equal(base.clips[0].assemblyMode,'full');assert.equal(base.clips[0].trim,0);
// Both the preview and rendering use the same frame-quantised boundaries.
fit=R.fitFinalPlan(base,[6.01,6,6],[1,1,1]);assert.equal(fit.seconds,18);
assert.throws(()=>R.fitFinalPlan(base,[6,6,6],[7,1,1]),/Реплика/);
assert.throws(()=>R.fitFinalPlan(base,[NaN,6,6],[1,1,1]),/доступный участок/);
console.log('PASS montage API: persisted cuts, ownership/revision, invalid payloads, unchanged upstream approvals and animatic, per-variant scope, frame timing and speech bounds.');
