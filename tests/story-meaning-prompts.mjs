import {build} from 'esbuild';
import assert from 'node:assert/strict';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export * as O from './lib/prompt-optimization';export * as M from './lib/model-capabilities';export * as J from './lib/prompt-jobs';export * as S from './lib/story-meaning';export {ensureDirecting} from './lib/directing';export {SCENE_SPECIALIST_INSTRUCTIONS} from './lib/directing-specialists';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/story-meaning-prompts.mjs'});
const {D,C,O,M,J,S,ensureDirecting,SCENE_SPECIALIST_INSTRUCTIONS}=await import('../work/tests/story-meaning-prompts.mjs');
const previousFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('Prompt preflight must not call a provider.');};
try{
  const p=D.newProject('Ночной заход'),d=ensureDirecting(p);
  const meaning={id:'meaning-turn',title:'Потеря ориентира',kind:'turn',priority:'required',
    viewerBefore:'Зритель считает посадку безопасной.',viewerAfter:'Пилот лишилась посадочного ориентира.',
    event:'После короткого замыкания огни полосы гаснут впереди самолёта.',stakes:'Без освещённой полосы помощь не доставить вовремя.',
    evidence:['Две светящиеся линии полосы сходятся впереди самолёта.','Обе линии погасли; кабина осталась над тёмной полосой.']};
  const finale={id:'meaning-finale',title:'ЧУЖОЙ_ФИНАЛ',kind:'resolution',priority:'required',viewerBefore:'НЕЗДЕШНЕЕ_ОЖИДАНИЕ',viewerAfter:'НЕЗДЕШНИЙ_РЕЗУЛЬТАТ',event:'НЕЗДЕШНЕЕ_СОБЫТИЕ',stakes:'НЕЗДЕШНЯЯ_СТАВКА',evidence:['НЕЗДЕШНИЙ_ПРИЗНАК']};
  const beat={role:'action-reaction',character:'Лётчица',trigger:'Огни полосы гаснут.',meaning:'Посадка стала опасной.',emotionStart:'Уверенность.',emotionEnd:'Тревожная решимость.',decision:'Искать безопасный заход.',visibleEvidence:'Улыбка исчезает, взгляд на мгновение замирает.'};
  const acting={character:'Лётчица',objective:'Доставить помощь.',subtext:'В темноте сесть нельзя.',emotionStart:beat.emotionStart,emotionEnd:beat.emotionEnd,visibleAction:beat.visibleEvidence};
  const plan={id:'shot-1',sceneId:'scene-1',title:'Заход',duration:6,cast:['Лётчица'],meaningIds:[meaning.id],description:'Лётчица видит, как гаснут огни.',stateIn:meaning.evidence[0],stateOut:meaning.evidence[1],speechType:'none',dialogue:'',direction:{narrativeBeat:beat,performance:[acting],framingStart:'medium',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Плавный наезд к лицу',start:1,end:5},startFrame:'В кабине уверенное лицо, рот закрыт.',endFrame:'В кабине сосредоточенное лицо, рот закрыт.'}};
  const script=p.items.find(i=>i.stage===4),screenplay=p.items.find(i=>i.stage===0),frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7);
  screenplay.variants=[{id:'story-approved',text:'Лётчица доставляет помощь. Перед посадкой гаснут огни.',kind:'text'}];screenplay.approvedId=screenplay.selectedId='story-approved';
  const savePlan=shot=>{script.variants=[{id:'published',text:JSON.stringify({storyMeaningBasis:S.storyMeaningBasis(p),shots:[shot]}),kind:'text'}];script.approvedId=script.selectedId='published';};
  savePlan(plan);
  for(const item of [frame,video])item.sourceShot={scriptId:script.id,sceneId:plan.sceneId,shotId:plan.id,title:plan.title};
  frame.variants=[{id:'start',kind:'image',assetId:'frame-image',text:'Кадр'}];frame.selectedId=frame.approvedId='start';
  d.scenes=[{id:plan.sceneId,title:'Сцена',meaningIds:[meaning.id,finale.id],continuity:[],shots:[{...plan,meaningIds:[finale.id]}]}];
  S.saveStoryMeanings(p,[meaning,finale]);S.approveStoryMeanings(p);savePlan(plan);
  const args={kind:'video',prompt:'',startFrameId:'frame-image',references:['frame-image']};
  const before=JSON.stringify(p),compiled=C.compilePrompt(p,video,'MiniMax-H3',args);
  const protectedMeaning=compiled.sections.find(s=>s.key===`story-meaning.${meaning.id}`);
  assert(protectedMeaning?.required&&protectedMeaning.verbatim,'Viewer meaning must survive optimization as approved text');
  for(const field of ['title','viewerBefore','viewerAfter','event','stakes'])assert(protectedMeaning.text.includes(meaning[field]),field);
  for(const evidence of meaning.evidence)assert(compiled.criticalText.includes(evidence));
  for(const other of Object.values(finale).flat().filter(v=>v.startsWith('НЕЗДЕШН')||v==='ЧУЖОЙ_ФИНАЛ'))assert(!compiled.prompt.includes(other),other);
  assert(!compiled.sections.some(s=>s.key===`story-meaning.${finale.id}`),'Neither the scene-wide map nor a changed draft may replace the exported shot links');
  for(const key of ['performance.0','camera-movement','framing','narrative-beat'])assert(compiled.sections.find(s=>s.key===key)?.verbatim,key);

  const sections=[{key:'action',label:'Действие',text:plan.description,required:true,priority:100},protectedMeaning,...compiled.sections.filter(s=>['performance.0','camera-movement','narrative-beat'].includes(s.key))];
  for(const model of ['MiniMax-H3','grok-imagine-video-1.5']){
    const cap=M.promptCapacity(model,'video');
    assert(O.optimizationTask({kind:'video',model,prompt:'long',promptSections:sections},cap).prompt.includes(meaning.viewerAfter));
    for(const replacements of [[],[{key:protectedMeaning.key,text:'A plane moves; nothing changes.'}]]){
      const final=O.parseOptimizedPrompt(JSON.stringify({sections:[{key:'action',text:'Runway lights go out.'},...replacements]}),sections,cap);
      assert(final.includes(protectedMeaning.text));assert.equal(final.split(protectedMeaning.text).length,2);
      assert(final.includes(meaning.event)&&final.includes(meaning.evidence[0]),'Cause and spatial relationship cannot be generalized away');
      assert(final.includes(acting.objective)&&final.includes(plan.direction.cameraMovement.description));
      assert(!final.includes('nothing changes'));assert(M.fitsPrompt(final,cap));
    }
    assert.throws(()=>O.optimizationTask({kind:'video',model,prompt:'long',promptSections:[sections[0],{...protectedMeaning,text:'Я'.repeat(cap.limit)}]},cap),/не оставляет места.*Запрос генерации не отправлен/,'A large required meaning fails visibly instead of being truncated');
  }

  for(const keyframe of ['start','end']){
    const still=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',keyframe,prompt:''});
    const current=keyframe==='start'?meaning.evidence[0]:meaning.evidence[1],future=keyframe==='start'?meaning.evidence[1]:meaning.evidence[0];
    assert(still.prompt.includes(current));assert(!still.prompt.includes(future),'A still receives only evidence visible in its selected moment');
    assert(!still.sections.some(s=>s.key.startsWith('story-meaning.')));
    for(const field of ['title','viewerBefore','viewerAfter','event','stakes'])assert(!still.prompt.includes(meaning[field]),field);
    for(const key of ['state','keyframe',`meaning-evidence.${meaning.id}`])assert(still.sections.find(s=>s.key===key)?.verbatim,key);
    const protectedStills=still.sections.filter(s=>s.verbatim),cap=M.promptCapacity('gpt-image-2.5-sunburst','image');
    const final=O.parseOptimizedPrompt(JSON.stringify({sections:[]}),protectedStills,cap);
    assert(final.includes(current));assert(!final.includes(future));
  }
  const noDeclaredRole=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',prompt:''});
  assert(noDeclaredRole.prompt.includes('Изобрази только утверждённые'));
  assert(!noDeclaredRole.prompt.includes(meaning.evidence[1]));
  const middle=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',keyframe:'middle',prompt:''});
  assert(!middle.sections.some(s=>/^(story-meaning|meaning-evidence)\./.test(s.key)),'A midpoint does not receive the whole semantic sequence');
  const negative=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',keyframe:'start',prompt:'',plan:{...plan,stateIn:`Ещё нельзя показывать: ${meaning.evidence[1]}`}});
  assert(!negative.sections.some(s=>s.key.startsWith('meaning-evidence.')),'A substring inside a negative instruction is not affirmative visible evidence');
  assert.equal(JSON.stringify(p),before,'Compilation and optimization do not mutate approval state');

  const job=J.compileMediaJob(p,{kind:'video',model:'MiniMax-H3',itemId:video.id,brief:'',prompt:'',refs:['frame-image'],duration:6,estimate:'0'});
  assert(job.promptSections.find(s=>s.key===protectedMeaning.key)?.verbatim,'Later retries retain semantic protection');
  const stillJob=J.compileMediaJob(p,{kind:'image',model:'gpt-image-2.5-sunburst',itemId:frame.id,brief:'',prompt:'',refs:[],estimate:'0'},{keyframe:'start'});
  assert(stillJob.promptSections.find(s=>s.key==='state')?.verbatim);

  const stale=structuredClone(p);stale.directing.storyMeanings[0].viewerAfter='Черновой новый вывод.';
  assert.throws(()=>C.compilePrompt(stale,stale.items.find(i=>i.id===video.id),'MiniMax-H3',args),e=>e.code==='story_meaning');
  S.approveStoryMeanings(stale);
  assert.throws(()=>C.compilePrompt(stale,stale.items.find(i=>i.id===video.id),'MiniMax-H3',args),e=>e.code==='story_meaning','Reapproving a changed map must not inject new meaning into the old detailed publication');
  const staleSource=stale.items.find(i=>i.id===script.id),republished=JSON.parse(staleSource.variants[0].text);republished.storyMeaningBasis=S.storyMeaningBasis(stale);staleSource.variants[0].text=JSON.stringify(republished);
  assert(C.compilePrompt(stale,stale.items.find(i=>i.id===video.id),'MiniMax-H3',args).prompt.includes('Черновой новый вывод.'),'Applying a newly approved detailed publication releases the guard');
  const missing=structuredClone(p);missing.directing.storyMeanings=[finale];S.approveStoryMeanings(missing);
  assert.throws(()=>C.compilePrompt(missing,missing.items.find(i=>i.id===video.id),'MiniMax-H3',args),e=>e.code==='story_meaning');
  const legacy=structuredClone(p);const legacySource=legacy.items.find(i=>i.id===script.id);legacySource.variants[0].text=JSON.stringify({shots:[{...plan,meaningIds:undefined}]});
  const oldPrompt=C.compilePrompt(legacy,legacy.items.find(i=>i.id===video.id),'MiniMax-H3',args);
  delete legacy.directing.storyMeanings;delete legacy.directing.storyMeaningsApproved;
  assert.deepEqual(C.compilePrompt(legacy,legacy.items.find(i=>i.id===video.id),'MiniMax-H3',args),oldPrompt,'An unlinked published plan remains unchanged even when a draft was linked');
  const explicitEmpty=C.compilePrompt(p,video,'MiniMax-H3',{...args,plan:{...plan,meaningIds:[]}});
  assert(!explicitEmpty.sections.some(s=>s.key.startsWith('story-meaning.')));
  for(const instruction of Object.values(SCENE_SPECIALIST_INSTRUCTIONS))for(const name of ['meaningIds','viewerBefore','viewerAfter','evidence'])assert(instruction.includes(name),name);
  console.log('PASS story meaning prompts: scoped approved links, cause/space/reveal protected through optimization, still-only visible evidence, persisted job protection, stale-map preflight, legacy compatibility. No API calls.');
}finally{globalThis.fetch=previousFetch;}
