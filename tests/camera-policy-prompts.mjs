import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export * as O from './lib/prompt-optimization';export * as P from './lib/camera-policy';export * as M from './lib/model-capabilities';export * as B from './lib/material-basis';export * as V from './lib/video-preparation-basis';export * as J from './lib/prompt-jobs';export * as G from './lib/generation-basis';export {ensureDirecting} from './lib/directing';export {creativeFoundationBrief} from './lib/creative-foundation';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/camera-policy-prompts.mjs'});
const {D,C,O,P,M,B,V,J,G,ensureDirecting,creativeFoundationBrief}=await import('../work/tests/camera-policy-prompts.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network calls in camera regression tests');};
try{
 const p=D.newProject('Камера сохраняется'),d=ensureDirecting(p);
 const shot={id:'shot',sceneId:'scene',title:'Находка',duration:5,cast:[],description:'Лист открывает корону.',stateIn:'Лист закрывает корону',stateOut:'Корона видна',speechType:'none',dialogue:'',direction:{framingStart:'medium',framingEnd:'close-up',cameraMovement:{type:'push-in',description:'Наезд к короне',purpose:'Раскрыть находку',from:'От среднего плана',to:'Крупно корона справа',speed:'Плавно',start:1,end:4,keepInFrame:'Корона справа'},startFrame:'Лист закрывает корону',endFrame:'Корона справа крупно'}};
 const script=p.items.find(i=>i.stage===4);script.variants=[{id:'approved-script',text:JSON.stringify({shots:[shot]}),kind:'text'}];script.selectedId=script.approvedId=script.variants[0].id;
 const frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7),voice=p.items.find(i=>i.stage===6);
 for(const item of [frame,video,voice]){item.title=shot.title;item.sourceShot={scriptId:script.id,shotId:shot.id,sceneId:'scene',title:shot.title};}
 frame.variants=[{id:'first',assetId:'first-asset',kind:'image',text:'Начальный кадр'}];frame.selectedId=frame.approvedId='first';
 d.scenes=[{id:'scene',title:'Находка',continuity:[],shots:[{...shot,direction:{...shot.direction,cameraMovement:{type:'orbit',description:'UNAPPROVED ORBIT'}}}]}];
 const args={kind:'video',prompt:'Animate the approved shot.',startFrameId:'first-asset',references:['first-asset']};
 const compile=()=>C.compilePrompt(p,video,'fal-kling-3.0-pro',args);
 const legacy=compile(),imageArgs={kind:'image',prompt:'Create the first frame.'};
 assert(!legacy.sections.some(s=>s.key==='camera-policy'),'Legacy projects gain no implicit camera preference');
 const imageBefore=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',imageArgs);
 const baseline={foundation:creativeFoundationBrief(d.brief),image:B.materialBasis(p,frame,{basisVersion:2}),voice:B.materialBasis(p,voice,{basisVersion:2}),video:B.materialBasis(p,video,{basisVersion:2}),legacyImage:B.materialBasis(p,frame),legacyVideo:B.materialBasis(p,video),preparation:V.preparationShotBasis(p,video),admission:G.generationBasis(p,video.id)};
 for(const mode of P.CAMERA_POLICIES){
  d.brief.cameraPolicy=mode;const compiled=compile(),policy=compiled.sections.find(s=>s.key==='camera-policy'),movement=compiled.sections.find(s=>s.key==='camera-movement'),framing=compiled.sections.find(s=>s.key==='framing');
  assert.equal(policy.text,P.cameraPolicyPrompt(mode));assert(policy.required);assert(compiled.criticalText.includes(policy.text));
  assert(movement.required&&movement.verbatim&&framing.required&&framing.verbatim);
  for(const text of ['Наезд к короне','Раскрыть находку','От среднего плана','Крупно корона справа','Плавно','Начало: 1 сек','Остановка: 4 сек','Корона справа'])assert(movement.text.includes(text),text);
  assert.equal(framing.text,'Средний → Крупный');assert(!compiled.prompt.includes('UNAPPROVED ORBIT'),'Only the approved script snapshot reaches video generation');
  assert.deepEqual(C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',imageArgs),imageBefore,'Global camera preference leaves still-image prompt unchanged');
  assert.deepEqual(creativeFoundationBrief(d.brief),baseline.foundation,'No image/hero/world/script foundation churn');
  assert.equal(B.materialBasis(p,frame,{basisVersion:2}),baseline.image);assert.equal(B.materialBasis(p,frame),baseline.legacyImage);assert.equal(B.materialBasis(p,voice,{basisVersion:2}),baseline.voice);
  assert.notEqual(B.materialBasis(p,video,{basisVersion:2}),baseline.video);assert.notEqual(B.materialBasis(p,video),baseline.legacyVideo);
  assert.notEqual(V.preparationShotBasis(p,video),baseline.preparation);assert.notEqual(G.generationBasis(p,video.id),baseline.admission);
  assert(!O.sameOptimizationInputs({kind:'video',model:'fal-kling-3.0-pro',prompt:legacy.prompt,refs:['first-asset']},{kind:'video',model:'fal-kling-3.0-pro',prompt:compiled.prompt,refs:['first-asset']}));
  const action={key:'action',label:'Действие',text:'A leaf uncovers the crown.',required:true,priority:100};
  const sections=[action,movement,framing,policy],cap=M.promptCapacity('fal-kling-3.0-pro','video');
  const task=O.optimizationTask({kind:'video',model:'fal-kling-3.0-pro',prompt:'Long task',promptSections:sections},cap);
  const suffix=sections.slice(1).map(s=>s.verbatim?`${s.label}: ${s.text}`:s.text).join('\n')+'\n';
  assert(task.prompt.includes(`не более ${Math.floor((cap.limit-M.promptSize(suffix,cap))*.8)} символов`),'Camera reservation is deducted before paid optimization');
  for(const returned of [[action],[action,{key:'camera-movement',text:'Orbit and freeze.'},{key:'framing',text:'Wide forever'},{key:'camera-policy',text:'Invent a new move'}]]){
   const parsed=O.parseOptimizedPrompt(JSON.stringify({sections:returned}),sections,cap);
   for(const s of sections.slice(1)){assert(parsed.includes(s.text));assert.equal(parsed.split(s.text).length,2,'Protected camera facts are restored exactly once');}
   assert(!parsed.includes('Orbit and freeze.'));
  }
  assert.throws(()=>O.parseOptimizedPrompt(JSON.stringify({sections:[]}),sections,cap),/обязательные/);
  assert.throws(()=>O.optimizationTask({kind:'video',model:'fal-kling-3.0-pro',prompt:'Long',promptSections:[...sections,{...movement,text:'x'.repeat(cap.limit)}]},cap),/камеры.*не оставляет/);
  assert.throws(()=>O.parseOptimizedPrompt(JSON.stringify({sections:[{key:'action',text:'x'.repeat(cap.limit)}]}),sections,cap),/превышает/);
  const job=J.compileMediaJob(p,{kind:'video',model:'fal-kling-3.0-pro',itemId:video.id,brief:args.prompt,prompt:'',refs:['first-asset'],duration:5,estimate:'0'});
  assert(job.promptSections.some(s=>s.key==='camera-movement'&&s.verbatim),'The frozen request retains protected sections for provider-limit rechecks');
 }
 delete d.brief.cameraPolicy;
 assert.equal(B.materialBasis(p,video,{basisVersion:2}),baseline.video);assert.equal(B.materialBasis(p,video),baseline.legacyVideo);assert.equal(V.preparationShotBasis(p,video),baseline.preparation,'Removing absent preference restores exact legacy signature');
 const staticShot={...shot,direction:{...shot.direction,cameraMovement:{type:'static',description:'Неподвижно ради точного жеста'}}};
 script.variants[0].text=JSON.stringify({shots:[staticShot]});d.brief.cameraPolicy='dynamic';
 assert.match(compile().sections.find(s=>s.key==='camera-movement').text,/^static: Неподвижно/);assert.match(compile().sections.find(s=>s.key==='camera-policy').text,/Exact approved shot camera.*take priority/);
 console.log('PASS camera prompt policy: approved snapshot, exact movement/framing preservation through hostile/omitted LLM output, all modes, time/direction/budget reservation, no image/voice churn, scoped video and admission/cache invalidation, legacy signatures, static override. No API calls.');
}finally{globalThis.fetch=originalFetch;}
