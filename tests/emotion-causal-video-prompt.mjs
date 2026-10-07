import {build} from 'esbuild';
import assert from 'node:assert/strict';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export * as O from './lib/prompt-optimization';export * as M from './lib/model-capabilities';export * as J from './lib/prompt-jobs';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/emotion-causal-video-prompt.mjs'});
const {D,C,O,M,J,ensureDirecting}=await import('../work/tests/emotion-causal-video-prompt.mjs');
const p=D.newProject('Погасшая полоса'),d=ensureDirecting(p);
const beat={role:'action-reaction',character:'Лётчица',trigger:'Огни полосы гаснут.',meaning:'Посадка стала опасной; помощь может опоздать.',emotionStart:'Уверенность.',emotionEnd:'Тревожная решимость.',decision:'Искать безопасный заход.',visibleEvidence:'Улыбка исчезает, взгляд замирает, затем уверенно переводится на приборы.'};
const acting={character:'Лётчица',objective:'Доставить помощь.',subtext:'В темноте посадить самолёт нельзя.',emotionStart:beat.emotionStart,emotionEnd:beat.emotionEnd,visibleAction:beat.visibleEvidence};
const plan={id:'shot-1',sceneId:'scene-1',title:'Огни',duration:6,cast:['Лётчица'],description:'Гаснут огни посадочной полосы.',stateIn:'Взгляд вперёд',stateOut:'Взгляд на приборы',speechType:'none',dialogue:'',direction:{narrativeBeat:beat,performance:[acting],framingStart:'medium',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Плавный наезд к лицу',start:1,end:5},startFrame:'Уверенное лицо',endFrame:'Сосредоточенное лицо'}};
const script=p.items.find(i=>i.stage===4),frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7);
const savePlan=shot=>{script.variants=[{id:'published',text:JSON.stringify({shots:[shot]}),kind:'text'}];script.approvedId=script.selectedId='published';};
savePlan(plan);
for(const item of [frame,video])item.sourceShot={scriptId:script.id,sceneId:plan.sceneId,shotId:plan.id,title:plan.title};
frame.variants=[{id:'start',kind:'image',assetId:'frame-image',text:'Кадр'}];frame.selectedId=frame.approvedId='start';
d.scenes=[{id:plan.sceneId,title:'Рабочая правка',continuity:[],shots:[{...plan,direction:{...plan.direction,narrativeBeat:{...beat,meaning:'UNAPPROVED CAUSALITY'}}}]}];
const args={kind:'video',prompt:'Animate the approved plan.',startFrameId:'frame-image',references:['frame-image']};
const before=JSON.stringify(p),compiled=C.compilePrompt(p,video,'MiniMax-H3',args),causal=compiled.sections.find(s=>s.key==='narrative-beat');
assert(causal.required&&causal.verbatim);
assert(causal.text.includes('Действие и реакция'));
for(const [key,value] of Object.entries(beat).filter(([key])=>key!=='role')){
  assert(causal.text.includes(value),key);assert(compiled.criticalText.includes(value),key);
}
assert(!compiled.prompt.includes('UNAPPROVED CAUSALITY'));
for(const keyframe of ['start','middle','end']){
  const still=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',keyframe,prompt:'One still.'});
  assert(!still.sections.some(s=>s.key==='narrative-beat'),'A still must not receive the whole temporal causal chain');
  assert(!still.prompt.includes(beat.meaning));
}
assert.equal(JSON.stringify(p),before,'Preflight is read-only');
const performance=compiled.sections.find(s=>s.key==='performance.0');
const sections=[{key:'action',label:'Действие',text:'The runway lights go out.',required:true,priority:100},causal,performance];
for(const model of ['MiniMax-H3','grok-imagine-video-1.5']){
  const cap=M.promptCapacity(model,'video');
  const task=O.optimizationTask({kind:'video',model,prompt:'long',promptSections:sections},cap);
  assert(task.prompt.includes(beat.meaning));
  for(const rewritten of [[],[{key:'narrative-beat',text:'A neutral girl looks ahead.'}]]){
    const final=O.parseOptimizedPrompt(JSON.stringify({sections:[{key:'action',text:'The runway lights go out.'},...rewritten]}),sections,cap);
    assert(final.includes(causal.text));assert(!final.includes('A neutral girl'));
    assert(final.includes(acting.objective));assert.equal(final.split(causal.text).length,2);
    assert(M.fitsPrompt(final,cap));
  }
  assert.throws(()=>O.optimizationTask({kind:'video',model,prompt:'long',promptSections:[sections[0],{...causal,text:'Я'.repeat(cap.limit)}]},cap),/не оставляет места.*Запрос генерации не отправлен/,'Oversized causal meaning cannot silently disappear to meet a provider cap');
}
const job=J.compileMediaJob(p,{kind:'video',model:'MiniMax-H3',itemId:video.id,brief:args.prompt,prompt:'',refs:['frame-image'],duration:6,estimate:'0'});
assert(job.promptSections.find(s=>s.key==='narrative-beat').verbatim,'Persisted job retains protection for later optimization/fallback');
assert(job.prompt.includes(beat.meaning));
savePlan({...plan,direction:{...plan.direction,narrativeBeat:{...beat,role:'reaction'}}});
assert(C.compilePrompt(p,video,'MiniMax-H3',args).prompt.includes('не повторяй событие'));
savePlan({...plan,direction:{...plan.direction,narrativeBeat:undefined}});
assert(!C.compilePrompt(p,video,'MiniMax-H3',args).sections.some(s=>s.key==='narrative-beat'),'Legacy direction is not assigned an invented motive');
console.log('PASS causal video prompt: approved causal fields, immutable optimization/fallback protection, separate actor task, unchanged stills/legacy, reaction continuity. No API calls.');
