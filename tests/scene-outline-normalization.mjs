import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`export const loadProject=async()=>structuredClone(globalThis.sceneTestProject);export const getKey=async()=> 'mock';export const imageData=async()=>{throw Error('Unexpected image request');};export async function mutate(user,id,fn){const p=structuredClone(globalThis.sceneTestProject);await fn(p);p.revision++;globalThis.sceneTestProject=p;return p;}`;
const provider=`export const generate=async job=>{globalThis.sceneTestCalls.push(structuredClone(job));return {text:JSON.stringify(globalThis.sceneTestResponse),actual:'17',requestId:'scene-receipt'};};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as E from './lib/director-reliability';export * as M from './lib/story-meaning';export {runDirectorStep} from './lib/director-runner';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/scene-outline-normalization.mjs',plugins:[{name:'mock-provider',setup(b){
  b.onResolve({filter:/^\.\/(server|providers)$/},a=>({path:a.path.endsWith('server')?'server':'providers',namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server'?server:provider}));
}}]});
const {D,R,E,M,runDirectorStep}=await import('../work/tests/scene-outline-normalization.mjs');
const meaning={id:'destination',title:'Unexpected destination',kind:'turn',priority:'required',viewerBefore:'The arrow will land nearby',viewerAfter:'The arrow is heading into the forest',event:'It passes the final roof',stakes:'The hero must leave familiar ground',evidence:['The last roof is behind the arrow and the forest is ahead']};
const cause={character:'Hero',expectation:'The arrow lands nearby',trigger:'It passes the last roof',meaning:'It will land outside the village',emotionStart:'Hope',emotionEnd:'Anxiety',decision:'Follow the arrow',visibleEvidence:'His smile fades as he looks toward the forest'};
const {character,expectation,...beat}=cause;
const arc={character,want:'A familiar destination',expectation,stakes:meaning.stakes,emotionStart:cause.emotionStart,emotionEnd:cause.emotionEnd,beats:[beat]};
const outline={id:'courtyard',title:'Courtyard and rooftops',purpose:'Reveal the changed destination',location:'Village courtyard and adjoining rooftops',conflict:'Expectation versus the arrow trajectory',turn:'Hope becomes anxiety',stateIn:'The hero expects the arrow to land nearby',stateOut:'He must follow it beyond the village',continuity:[],causalChain:[cause],meaningIds:['destination']};
const base=D.newProject('Scene normalization');base.limit=null;
const script=base.items.find(i=>i.stage===0),scriptVariant=D.addVariant(base,script.id,{text:'The hero releases the arrow; it passes the last roof toward the forest.'});
scriptVariant.versionInfo.settings={emotionalArcs:[arc],storyMeanings:[meaning]};D.approve(base,script.id);
R.ensureDirecting(base);M.saveStoryMeanings(base,[meaning]);M.approveStoryMeanings(base);

const response={scenes:[structuredClone(outline),{...structuredClone(outline),id:'forest',title:'Forest',shots:[]}]},before=structuredClone(response);
const cleaned=E.normalizeDirectorAnswer(base,'scenes',undefined,response);
assert.deepEqual(cleaned,{scenes:response.scenes.map(s=>({...s,shots:[]}))});assert.deepEqual(response,before,'The original paid response remains intact');
assert.deepEqual(cleaned.scenes[0].causalChain,[cause]);assert.deepEqual(cleaned.scenes[0].meaningIds,['destination']);
assert.deepEqual(E.normalizeDirectorAnswer(base,'story',undefined,response),response,'Other roles must not acquire scene defaults');
for(const malformed of [null,[],{scenes:null},{scenes:[null,[],4,'scene']}])assert.deepEqual(E.normalizeDirectorAnswer(base,'scenes',undefined,malformed),malformed);

// The actual dispatch/apply path accepts an outline after a single provider call.
globalThis.sceneTestProject=structuredClone(base);globalThis.sceneTestCalls=[];globalThis.sceneTestResponse={scenes:[outline]};
let run=R.newDirectorRun(sceneTestProject,'grok-4.6','scenes');run.execution={fallbackModel:'gpt-6-astra'};
const prompt=R.directorPrompt(sceneTestProject,run,run.tasks[0]);
assert.match(prompt,/непрерывное действие в едином пространстве и времени/);assert.match(prompt,/Не создавай отдельную сцену для каждого будущего плана/);assert.match(prompt,/shots всегда пустой массив/);
await runDirectorStep('owner',base.id);await runDirectorStep('owner',base.id);
assert.equal(sceneTestCalls.length,1);assert.equal(sceneTestProject.jobs.length,1);assert.equal(sceneTestProject.jobs[0].status,'done');
assert.equal(sceneTestProject.jobs[0].actual,'17');assert.equal(sceneTestProject.jobs[0].requestId,'scene-receipt');
assert.deepEqual(JSON.parse(sceneTestProject.jobs[0].output.text),{scenes:[outline]},'Saved provider output is never rewritten by normalization');
const task=sceneTestProject.directing.runs[0].tasks[0];assert(task.applied);assert.equal(task.fallbackFromJobId,undefined);assert.equal(task.previousJobIds,undefined);
assert.deepEqual(sceneTestProject.directing.scenes[0].shots,[]);assert.deepEqual(sceneTestProject.directing.scenes[0].causalChain,[cause]);assert.deepEqual(sceneTestProject.directing.scenes[0].meaningIds,['destination']);
assert.equal(sceneTestProject.directing.scenesApproved,undefined,'Generated outline still requires director approval');

function applyOnCopy(answer){const p=structuredClone(base),r=R.newDirectorRun(p,'grok-4.6','scenes');R.applyDirectorResult(p,r,r.tasks[0],E.normalizeDirectorAnswer(p,'scenes',undefined,answer));return p;}
const validShot={id:'shot',title:'Shot',duration:6,cast:['Hero'],story:'He watches the arrow',stateIn:'Hopeful',stateOut:'Anxious',cinematography:'Close-up',productionDesign:'Courtyard',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:''};
// Only absence is repaired; no invalid values, real plans, missing facts or IDs disappear.
for(const shots of [null,{},'[]',0,undefined,[validShot]]){
  const bad={scenes:[{...outline,shots}]},normalized=E.normalizeDirectorAnswer(base,'scenes',undefined,bad);
  assert.deepEqual(normalized,bad);assert.throws(()=>applyOnCopy(bad));
}
for(const patch of [{causalChain:undefined},{causalChain:null},{meaningIds:['unknown']},{stateIn:undefined},{id:''}])assert.throws(()=>applyOnCopy({scenes:[{...outline,...patch}]}));
assert.throws(()=>applyOnCopy({scenes:[outline,outline]}),/ID/);
assert(R.sceneSchema.safeParse({...outline,shots:[validShot]}).success,'The complete manual scene schema continues to allow plans');

// Scoped outline refinement keeps existing plans and unrequested scenes untouched.
const scoped=structuredClone(base),original={...structuredClone(outline),shots:[validShot]},other={...structuredClone(original),id:'other',title:'Unchanged',shots:[{...validShot,id:'other-shot'}]};
scoped.directing.scenes=[original,other];run=R.newDirectorRun(scoped,'grok-4.6','scenes');run.selection={scope:'selected',sceneIds:[original.id]};run.sceneIds=[original.id];
const unrequestedBefore=structuredClone(other),plansBefore=structuredClone(original.shots);
R.applyDirectorResult(scoped,run,run.tasks[0],E.normalizeDirectorAnswer(scoped,'scenes',undefined,{scenes:[{...outline,purpose:'Revised outline purpose'}]}));
assert.deepEqual(scoped.directing.scenes[0].shots,plansBefore);assert.deepEqual(scoped.directing.scenes[1],unrequestedBefore);
assert.equal(scoped.directing.scenes[0].purpose,'Revised outline purpose');
console.log('PASS scene outlines: omitted-only plan defaults, retained meaning and causality, one mocked provider receipt without fallback, invalid data rejected, scoped plans preserved, and continuous-scene prompting.');
