import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export * as O from './lib/prompt-optimization';export * as J from './lib/prompt-jobs';export * as M from './lib/model-capabilities';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/acting-video-prompts.mjs'});
const {D,C,O,J,M,ensureDirecting}=await import('../work/tests/acting-video-prompts.mjs');
const originalFetch=globalThis.fetch;let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw Error('Acting regression must not call providers');};
try{
 const p=D.newProject('Актёрская дуга'),d=ensureDirecting(p);
 const acting={character:'Царевич',objective:'Метко выстрелить и победить.',subtext:'Я лучший; лес вместо двора означает неизвестность.',emotionStart:'Уверенный азарт.',visibleAction:'После уверенного выпуска замечает стрелу над лесом: взгляд застывает вдали, брови сходятся, плечи опускаются; рот закрыт.',emotionEnd:'Тревожное ожидание.'};
 const plan={id:'shot',sceneId:'scene',title:'Стрела в лес',duration:5,cast:['Царевич'],description:'Стрела улетает к лесу.',stateIn:'Лук натянут',stateOut:'Лук опущен',speechType:'none',dialogue:'',direction:{framingStart:'medium',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Плавный наезд к лицу',start:0,end:4},performance:[acting],startFrame:'Герой уверенно целится',endFrame:'Тревожное лицо'}};
 const script=p.items.find(i=>i.stage===4),frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7);
 const savePlan=shot=>{script.variants=[{id:'approved-script',text:JSON.stringify({shots:[shot]}),kind:'text'}];script.selectedId=script.approvedId='approved-script';};
 savePlan(plan);
 for(const item of [frame,video])item.sourceShot={scriptId:script.id,shotId:plan.id,sceneId:plan.sceneId,title:plan.title};
 frame.variants=[{id:'start',kind:'image',assetId:'start-image',text:'Начальный кадр'}];frame.selectedId=frame.approvedId='start';
 d.scenes=[{id:'scene',title:'Стрела',continuity:[],shots:[{...plan,direction:{...plan.direction,performance:[{...acting,subtext:'UNAPPROVED DRAFT',emotionEnd:'UNAPPROVED SMILE'}]}}]}];
 const args={kind:'video',prompt:'Animate this approved shot.',startFrameId:'start-image',references:['start-image']};
 const compiled=C.compilePrompt(p,video,'grok-imagine-video-1.5',args),performance=compiled.sections.find(s=>s.key==='performance.0');
 assert(performance.required&&performance.verbatim,'Actor task is critical and protected from lossy rewriting');
 for(const value of Object.values(acting)){assert(performance.text.includes(value),value);assert(compiled.criticalText.includes(value),value);}
 assert(!compiled.prompt.includes('UNAPPROVED'),'Unapproved actor edits are never silently substituted for the published script snapshot');
 assert(!compiled.warnings.some(w=>w.includes('актёрск')),'A complete approved task needs no actor warning');
 const savedBefore=JSON.stringify(p);
 for(const keyframe of ['start','end']){
  const still=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{kind:'image',keyframe,prompt:'One still image.'});
  const stillActing=still.sections.find(s=>s.key==='performance.0');
  assert.equal(stillActing.text,`${acting.character}: ${keyframe==='end'?acting.emotionEnd:acting.emotionStart}`);
  assert(!stillActing.verbatim);assert(!stillActing.text.includes(acting.subtext));assert(!stillActing.text.includes(acting.visibleAction),'A still is one emotional instant, not a motion sequence');
 }
 assert.equal(JSON.stringify(p),savedBefore,'Compile does not alter the film or approvals');
 const sections=[{key:'action',label:'Действие',text:'Release arrow toward forest.',required:true,priority:100},performance,...compiled.sections.filter(s=>['camera-movement','framing','facial-expression'].includes(s.key))];
 for(const model of ['grok-imagine-video-1.5','grok-imagine-video-1.5-1080p','fal-kling-3.0-pro']){
  const cap=M.promptCapacity(model,'video'),job={kind:'video',model,prompt:'A long prompt',promptSections:sections};
  const task=O.optimizationTask(job,cap),suffix=sections.slice(1).map(s=>s.verbatim?`${s.label}: ${s.text}`:s.text).join('\n')+'\n';
  assert(task.prompt.includes(`не более ${Math.floor((cap.limit-M.promptSize(suffix,cap))*.8)} символов`),'Acting budget is reserved before a paid optimization call');
  if(cap.maxUtf8Bytes)assert(task.prompt.includes(`${Math.floor((cap.maxUtf8Bytes-M.tokenUpperBound(suffix))*.8)} байт UTF-8`),'Russian acting also reserves its byte budget');
  for(const rewritten of [[],[{key:'performance.0',text:'A relaxed natural face. No emotional change.'}]]){
   const output=O.parseOptimizedPrompt(JSON.stringify({sections:[{key:'action',text:'Release arrow toward forest.'},...rewritten]}),sections,cap);
   assert(output.includes(performance.text),'Even an omitted actor block is restored from the frozen source');
   assert(!output.includes('A relaxed natural face'));
   for(const value of Object.values(acting))assert(output.includes(value),value);
   assert.equal(output.split(performance.text).length,2,'Actor task is added exactly once');
   assert(M.fitsPrompt(output,cap));
  }
  assert.throws(()=>O.parseOptimizedPrompt(JSON.stringify({sections:[]}),sections,cap),/обязательные/,'Other required editable sections still cannot disappear');
  const oversized=[sections[0],{...performance,text:'Я'.repeat(3000)}];
  assert.throws(()=>O.optimizationTask({...job,promptSections:oversized},cap),/актёрским заданием.*Цель, подтекст, смена эмоций.*не отправлен/);
  assert.throws(()=>O.parseOptimizedPrompt(JSON.stringify({sections:[{key:'action',text:'short'}]}),oversized,cap),/актёрским заданием/,'No silent fallback to generic acting when protected data exceeds the budget');
 }
 const job=J.compileMediaJob(p,{kind:'video',model:'grok-imagine-video-1.5',itemId:video.id,brief:args.prompt,prompt:'',refs:['start-image'],duration:5,estimate:'0'});
 assert(job.promptSections.find(s=>s.key==='performance.0').verbatim,'The persisted new request keeps actor protection for later provider-limit/fallback optimization');
 assert(job.prompt.includes(acting.objective)&&job.prompt.includes(acting.subtext));
 savePlan({...plan,direction:{...plan.direction,performance:undefined}});
 const missing=C.compilePrompt(p,video,'grok-imagine-video-1.5',args);
 assert(missing.warnings.some(w=>w.includes('нет отдельного актёрского задания')),'Legacy missing task is visible but nonblocking');
 assert(!missing.sections.some(s=>s.key.startsWith('performance.')),'The compiler never invents an emotional arc');
 savePlan({...plan,direction:{...plan.direction,performance:[{...acting,objective:' ',subtext:''}]}});
 assert(C.compilePrompt(p,video,'grok-imagine-video-1.5',args).warnings.some(w=>w.includes('не заполнены: цель, подтекст')));
 savePlan({...plan,cast:[],direction:{...plan.direction,performance:undefined}});
 assert(!C.compilePrompt(p,video,'grok-imagine-video-1.5',args).warnings.some(w=>w.includes('актёрск')),'Empty scenery does not need invented acting');
 assert.equal(networkCalls,0);
 console.log('PASS actor video prompt: complete approved motivation/subtext/emotional arc, hostile optimizer restoration, exact text and UTF-8 budgets, clear overflow, persisted protection, unchanged stills, missing/incomplete task warnings, no unapproved substitution. No API calls.');
}finally{globalThis.fetch=originalFetch;}
