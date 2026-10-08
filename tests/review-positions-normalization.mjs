import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const server=`export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.reviewRepairProject);export const saveProject=async(user,p,revision)=>{if(revision!==globalThis.reviewRepairProject.revision)throw Error('Revision');p.revision++;globalThis.reviewRepairProject=p;return p;};export const getKey=async()=>{throw Error('Paid calls forbidden')};export const imageData=async()=>{throw Error('Images forbidden')};export const mutate=async()=>{throw Error('Generation forbidden')};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as E from './lib/director-reliability';export * as S from './lib/directing-solutions';export * as SD from './lib/shot-direction';export {POST} from './app/api/projects/[id]/directing/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/review-positions-normalization.mjs',plugins:[{name:'mock-store',setup(b){
  b.onResolve({filter:/^(?:@\/lib|\.)\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));
}}]});
const {D,R,E,S,SD,POST}=await import('../work/tests/review-positions-normalization.mjs');
const p=D.newProject('Position review repair'),script=p.items.find(i=>i.stage===0);D.addVariant(p,script.id,{text:'A hero watches an arrow leave the village.'});D.approve(p,script.id);
const oldPositions=[{subject:'Hero',start:'Left',end:'Left',screenDirection:'right-to-left'}],newPositions=[{subject:'Hero',start:'Left',end:'Left, looking right',screenDirection:'left-to-right'}];
const direction={framingStart:'medium',framingEnd:'close-up',composition:'Hero left, destination right',cameraMovement:{type:'push-in',description:'Slow',start:0,end:5},timing:{revealAt:2},actionBeats:[{start:0,end:5,action:'Hero notices the distant arrow'}],positions:oldPositions,performance:[{character:'Hero',objective:'Understand',subtext:'Unexpected',visibleAction:'Smile fades',emotionStart:'Hope',emotionEnd:'Anxiety'}],sound:{silence:true},startFrame:'Hero expecting success',endFrame:'Hero concerned'};
const shot={id:D.id(),title:'Reaction',duration:6,cast:['Hero'],story:'Smile fades',stateIn:'Hopeful',stateOut:'Anxious',cinematography:'Push-in',productionDesign:'Village',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction};
const scene={id:D.id(),title:'Village',purpose:'A changed expectation',location:'Village',conflict:'Unexpected destination',turn:'Anxiety',stateIn:'Hope',stateOut:'Anxiety',continuity:[],shots:[shot]},other={...structuredClone(scene),id:D.id(),title:'Other scene',shots:[{...structuredClone(shot),id:D.id()}]};
R.ensureDirecting(p).scenes=[scene,other];
const patch={issueId:'axis',shotId:shot.id,section:'direction.positions',after:newPositions,reason:'Keep the established screen axis'};
const answer={issues:[{id:'axis',sceneId:scene.id,shotId:shot.id,severity:'note',message:'Screen axis disagrees',solution:'Correct the direction'}],patches:[patch],montageOperations:[]};
const before=structuredClone(p),rawBefore=structuredClone(answer),normalized=E.normalizeDirectorAnswer(p,'scene-expressive-reviewer',scene.id,answer);
assert.deepEqual(p,before);assert.deepEqual(answer,rawBefore);assert.equal(normalized.patches[0].section,'direction');
assert.deepEqual(JSON.parse(normalized.patches[0].after),{...direction,positions:newPositions});
assert.deepEqual(E.normalizeDirectorAnswer(p,'editor',undefined,answer),normalized);
assert.deepEqual(E.normalizeDirectorAnswer(p,'camera',scene.id,answer),answer,'Other specialists do not acquire review aliases');
const review=S.prepareDirectorReview(p,normalized,scene.id),prepared=review.patches[0];
assert.equal(prepared.before,JSON.stringify(direction),'Precondition covers the complete parent direction');
S.storeSceneReview(p,scene.id,review);assert.deepEqual(p.directing.scenes,before.directing.scenes,'Review remains a proposal');
const stale=structuredClone(p);stale.directing.scenes[0].shots[0].direction.composition='Changed after review';stale.directing.patchesBasis=undefined;
assert.throws(()=>S.applyEditorSolutions(stale,[prepared.id]),/Раздел уже изменился/,'Even without global basis, exact parent precondition protects unrelated direction fields');
S.applyEditorSolutions(p,[prepared.id]);assert.deepEqual(p.directing.scenes[0].shots[0].direction,{...direction,positions:newPositions});assert.deepEqual(p.directing.scenes[1],other);

const invalidPatches=[{...patch,section:'direction.cameraMovement.end',after:6},{...patch,section:'direction.__proto__.polluted',after:[]},{...patch,shotId:'unknown'},{...patch,shotId:other.shots[0].id},{...patch,after:null},{...patch,after:JSON.stringify(newPositions)},{...patch,after:[{...newPositions[0],screenDirection:'toward-forest'}]},{...patch,after:[{...newPositions[0],malicious:true}]},{...patch,after:[{subject:'Hero'}]}];
for(const invalid of invalidPatches){const input={...answer,patches:[invalid]},clean=E.normalizeDirectorAnswer(before,'scene-expressive-reviewer',scene.id,input);assert.deepEqual(clean,input);assert.throws(()=>S.prepareDirectorReview(before,clean,scene.id));}
assert.equal({}.polluted,undefined);
const conflict={...answer,patches:[patch,{...patch,section:'direction',after:JSON.stringify(direction)}]};
assert.throws(()=>S.prepareDirectorReview(before,E.normalizeDirectorAnswer(before,'editor',undefined,conflict)),/повторные правки/);

// The approved repair endpoint reuses the receipt and stores proposals without dispatch.
const saved=structuredClone(before),run=R.newDirectorRun(saved,'grok-4.6','editor'),task=run.tasks[0];task.role='scene-expressive-reviewer';task.sceneId=scene.id;task.inputContentBasis=SD.scenePlanBasis(saved.directing.scenes[0]);task.error='Wrong section';
const receipt={id:D.id(),batchId:run.id,status:'failed',actual:'19',requestId:'original-receipt',output:{text:JSON.stringify(answer)}};task.jobId=receipt.id;saved.jobs.push(receipt);
globalThis.reviewRepairProject=structuredClone(saved);
const repair=()=>POST(new Request('http://local.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'repairSavedAnswer',revision:reviewRepairProject.revision,data:{runId:run.id,taskId:task.id}})}),{params:Promise.resolve({id:saved.id})});
let response=await repair();assert.equal(response.status,200,await response.clone().text());
assert.deepEqual(reviewRepairProject.directing.scenes,saved.directing.scenes);assert.equal(reviewRepairProject.jobs.length,1);assert.equal(reviewRepairProject.jobs[0].status,'done');assert.equal(reviewRepairProject.jobs[0].actual,'19');assert.equal(reviewRepairProject.jobs[0].requestId,'original-receipt');assert.deepEqual(reviewRepairProject.jobs[0].output,receipt.output);assert(reviewRepairProject.directing.runs[0].tasks[0].applied);
globalThis.reviewRepairProject=structuredClone(saved);reviewRepairProject.directing.scenes[0].shots[0].direction.composition='New composition after dispatch';const staleSaved=structuredClone(reviewRepairProject);
response=await repair();assert.equal(response.status,400);assert.deepEqual(reviewRepairProject,staleSaved,'A saved stale response cannot borrow a new parent direction');

// Optional saved incident stays private. Validate the exact already-paid response locally.
const path='../work/meaning-film/current-project.json';
if(existsSync(path)){
  const film=JSON.parse(readFileSync(path,'utf8')),job=film.jobs.find(j=>j.id==='388294eb-fc49-428a-909c-905b5059523d'),incidentRun=film.directing.runs.find(r=>r.tasks.some(t=>t.jobId===job?.id)),incidentTask=incidentRun?.tasks.find(t=>t.jobId===job?.id);
  if(job?.output?.text&&incidentTask){
    const raw=R.parseDirectorJSON(job.output.text),clean=E.normalizeDirectorAnswer(film,incidentTask.role,incidentTask.sceneId,raw),result=S.prepareDirectorReview(film,clean,incidentTask.sceneId);
    assert.equal(result.patches.length,4);for(const [index,entry] of result.patches.entries()){
      const source=film.directing.scenes.flatMap(s=>s.shots).find(s=>s.id===entry.shotId);
      assert.deepEqual(JSON.parse(entry.after),{...source.direction,positions:raw.patches[index].after});assert.equal(entry.before,JSON.stringify(source.direction));
    }
    console.log('PASS private saved reviewer incident: four positions proposals normalized without changing other direction fields or the explicitly proposed static value.');
  }
}
console.log('PASS literal positions review repair: strict path/value/scope guards, parent preservation and preconditions, no implicit application or paid call, saved receipt retention and stale-answer rejection.');
