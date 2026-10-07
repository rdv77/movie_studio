import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as P from './lib/shot-planning';export * as S from './lib/script-workflow';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/script-response-format.mjs'});
const {D,S,R,P}=await import('../work/tests/script-response-format.mjs');
const {ensureDirecting}=R;
for(const role of S.SCRIPT_ROLES){
  const p=D.newProject('Проверка формата');ensureDirecting(p);
  const item=p.items.find(i=>i.stage===0),source=D.addVariant(p,item.id,{kind:'text',title:'Исходник',text:'Героиня видит препятствие и решает действовать.'});
  const run=S.createScriptWorkflowRun(p,'test-model',[role],source.id),prompt=S.scriptWorkflowPrompt(p,run,run.tasks[0]);
  assert.equal(prompt.split('Формат ответа:\n').length,2,'A single complete primary example per role');
  const format=JSON.parse(prompt.split('Формат ответа:\n')[1].split('\n\n')[0]);
  if(['script-critic','script-control'].includes(role)){
    assert.deepEqual(Object.keys(format),['title','findings']);
    assert(prompt.includes('ответ содержит только title и findings'));
  }else{
    assert.deepEqual(Object.keys(format),['title','text','changes','findings','emotionalArcs']);
    assert.deepEqual(Object.keys(format.emotionalArcs[0]),['character','want','expectation','stakes','emotionStart','emotionEnd','beats']);
    assert.deepEqual(Object.keys(format.emotionalArcs[0].beats[0]),['trigger','meaning','emotionStart','emotionEnd','decision','visibleEvidence']);
    const candidate={...format,findings:[]};assert(S.scriptWorkflowResultSchema.safeParse(candidate).success,'Primary writing example is a complete supported result');
    assert(prompt.includes('все пять корневых полей: title, text, changes, findings, emotionalArcs'));
    assert(prompt.includes('одной записи об обновлении карты в changes недостаточно'));
  }
  assert(!prompt.includes('Также верни emotionalArcs'),'No fragmented second output example');
}
function primaryJSON(prompt,marker){
  const match=prompt.indexOf(marker+'{');
  assert(match>=0,'Primary format marker exists');
  const start=match+marker.length;
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<prompt.length;i++){
    const char=prompt[i];
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&!--depth)return JSON.parse(prompt.slice(start,i+1));
  }
  throw Error('Incomplete primary example');
}
const project=D.newProject('Проверка сцены');ensureDirecting(project);
const run={id:'run',created:D.now(),basis:R.directorBasis(project),model:'test',mode:'scenes',tasks:[],sceneIds:[]};
const scenePrompt=R.directorPrompt(project,run,{id:'scene-task',role:'scenes',requires:[]});
const scenes=primaryJSON(scenePrompt,'Заполни ').scenes;
assert(R.sceneSchema.safeParse(scenes[0]).success,'Scene primary example matches schema');
assert.deepEqual(Object.keys(scenes[0].causalChain[0]),['character','expectation','trigger','meaning','emotionStart','emotionEnd','decision','visibleEvidence']);
project.directing.scenes=scenes;
const storyPrompt=R.directorPrompt(project,run,{id:'story-task',role:'story',sceneId:scenes[0].id,requires:[]});
const story=primaryJSON(storyPrompt,'Верни ').shots[0];
assert(R.directingShotSchema.safeParse(story).success,'Story primary example matches schema');
assert.deepEqual(Object.keys(story.direction.narrativeBeat),['role','character','trigger','meaning','emotionStart','emotionEnd','decision','visibleEvidence']);
assert(!Object.hasOwn(story,'narrativeBeat'),'Story beat belongs inside direction');
for(const policy of ['economy','balanced','detailed']){
  const prompt=P.plannerInstruction(policy),card=primaryJSON(prompt,'Верни ').shots[0];
  assert(P.planSketchSchema.safeParse(card).success,'Planner primary example matches schema');
  assert.deepEqual(Object.keys(card.narrativeBeat),Object.keys(story.direction.narrativeBeat));
  assert(!Object.hasOwn(card,'direction'),'Planner beat is directly on the card');
  assert.equal(prompt.split('"narrativeBeat"').length,2,'No contradictory second schema example');
}
assert.equal(scenePrompt.split('"causalChain"').length,2,'No fragmented scene schema');
console.log('PASS complete primary formats: writer emotionalArcs, readonly findings, scene causalChain, story direction.narrativeBeat, planner narrativeBeat; all examples match their runtime schemas. No API calls.');
