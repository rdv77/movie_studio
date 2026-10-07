import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as C from './lib/prompt-compiler';export * as O from './lib/prompt-optimization';export * as F from './lib/facial-expression';export * as M from './lib/model-capabilities';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/facial-expression-prompts.mjs'});
const {D,C,O,F,M,ensureDirecting}=await import('../work/tests/facial-expression-prompts.mjs');
const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network expected')};
try{
 const p=D.newProject('Мимика в существующем плане'),d=ensureDirecting(p);d.brief.facialExpression='cartoon';
 const plan={id:'shot-1',sceneId:'scene',title:'Реакция',duration:6,cast:['Иван'],description:'Иван замечает корону.',stateIn:'Сосредоточен',stateOut:'Заинтересован',speechType:'voiceover',speaker:'Рассказчик',dialogue:'Он заметил находку.',direction:{framingStart:'medium',framingEnd:'close-up',performance:[{character:'Иван',objective:'Рассмотреть',subtext:'Не верит',visibleAction:'Брови поднимаются, взгляд замирает.',emotionStart:'Сосредоточенность',emotionEnd:'Любопытство'}]}};
 const frame={id:D.id(),stage:5,title:plan.title,sourceShot:{scriptId:'script',shotId:plan.id,title:plan.title},variants:[{id:'first-version',kind:'image',assetId:'first-frame',text:'Первый кадр'}],approvedId:'first-version',selectedId:'first-version'};
 const video={id:D.id(),stage:7,title:plan.title,sourceShot:frame.sourceShot,variants:[]};p.items.push(frame,video);
 const args={kind:'video',prompt:'LEGACY PREPARED PROMPT: restrained generic acting.',plan,startFrameId:'first-frame',references:['first-frame']};
 const compiled=C.compilePrompt(p,video,'fal-kling-3.0-pro',args),block=compiled.sections.find(s=>s.key==='facial-expression');
 assert.equal(block.text,F.facialExpressionPrompt('cartoon'));assert.equal(block.required,true);assert(compiled.criticalText.includes(block.text));assert(compiled.prompt.includes('LEGACY PREPARED PROMPT'));
 assert(compiled.sections.find(s=>s.key==='performance.0').required,'Shot-specific acting cannot be dropped as optional decoration');
 assert(compiled.criticalText.includes('Любопытство')&&compiled.criticalText.includes('Брови поднимаются'));
 assert(compiled.prompt.indexOf(block.text)>compiled.prompt.indexOf('LEGACY PREPARED PROMPT'),'Current intensity is explicit after the old prepared prompt');
 const before=JSON.stringify(p);
 d.scenes=[{id:'scene',location:'Берег',shots:[{...plan,direction:{...plan.direction,facialExpression:'exaggerated'}}],continuity:[]}];
 assert.equal(C.compilePrompt(p,video,'fal-kling-3.0-pro',args).sections.find(s=>s.key==='facial-expression').text,block.text,'Unapproved local edits are not substituted for the approved source plan');
 for(const mode of F.FACIAL_EXPRESSION_MODES){
   const local=C.compilePrompt(p,video,'fal-kling-3.0-pro',{...args,plan:{...plan,direction:{...plan.direction,facialExpression:mode}}});
   assert.equal(local.sections.find(s=>s.key==='facial-expression').text,F.facialExpressionPrompt(mode));
 }
 const still=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{...args,kind:'image',keyframe:'end',plan,prompt:'Конечный кадр'});
 assert(still.sections.find(s=>s.key==='facial-expression').required);assert(still.criticalText.includes('Любопытство'));assert(!still.criticalText.includes('Брови поднимаются'),'A final still depicts the final emotion, not the entire facial movement');
 const empty=C.compilePrompt(p,video,'fal-kling-3.0-pro',{...args,plan:{...plan,cast:[],direction:{}}});assert(!empty.sections.some(s=>s.key==='facial-expression'),'Empty scenery must not acquire a face');
 d.scenes=[];assert.equal(JSON.stringify(p),before,'Compiling cannot change the existing plan, approvals or variants');
 delete d.brief.facialExpression;
 assert.equal(C.compilePrompt(p,video,'fal-kling-3.0-pro',args).sections.find(s=>s.key==='facial-expression').text,F.facialExpressionPrompt('auto'),'Legacy film has a defined inheritance default');

 const sections=[{key:'action',label:'Действие',text:'Keep the camera still. Notice the crown.',required:true,priority:100},{key:'performance.0',label:'Игра Ивана',text:'Ivan: raised eyebrows, attention turns to curiosity.',required:true,priority:90},block];
 const cap=M.promptCapacity('fal-kling-3.0-pro','video'),job={kind:'video',model:'fal-kling-3.0-pro',prompt:'Long input',promptSections:sections};
 const task=O.optimizationTask(job,cap),reserved=Array.from(block.text+'\n').length;
 assert(task.prompt.includes(`не более ${Math.floor((cap.limit-reserved)*.8)} символов`));assert(task.prompt.includes('добавлена программой дословно'));
 const editable=sections.filter(s=>s.key!=='facial-expression').map(({key,text})=>({key,text}));
 const response=rows=>JSON.stringify({sections:rows});
 const parsed=O.parseOptimizedPrompt(response(editable),sections,cap);
 assert(parsed.endsWith(block.text),'Omitted protected settings are restored verbatim');
 assert.equal(O.parseOptimizedPrompt(response([...editable,{key:'facial-expression',text:'Wrong: freeze all faces.'}]),sections,cap),parsed,'An LLM rewrite cannot weaken the mode');
 assert.equal(parsed.split(block.text).length,2,'The protected block is included exactly once');
 assert.throws(()=>O.parseOptimizedPrompt(response(editable.filter(s=>s.key!=='performance.0')),sections,cap),/обязательные/,'Acting cannot disappear during optimization');
 assert.throws(()=>O.parseOptimizedPrompt(response([{key:'action',text:'x'.repeat(2000)},{key:'performance.0',text:'x'.repeat(400)}]),sections,cap),/превышает/,'Validate the complete prompt after protected text is restored');
 const oversized=[{...block,text:'x'.repeat(2500)},sections[0]];
 assert.throws(()=>O.optimizationTask({...job,promptSections:oversized},cap),/Защищённый блок мимики/);
 assert.throws(()=>O.parseOptimizedPrompt(response([{key:'action',text:'short'}]),oversized,cap),/Защищённый блок мимики/);
 const utfBlock={...block,text:'я'.repeat(1000)},grok=M.promptCapacity('grok-imagine-video-1.5','video');
 const utfTask=O.optimizationTask({...job,promptSections:[sections[0],utfBlock]},grok);
 assert(utfTask.prompt.includes(`${Math.floor((grok.maxUtf8Bytes-2001)*.8)} байт UTF-8`),'Reserve UTF-8 bytes separately from characters');
 const changed=[...sections.slice(0,-1),{...block,text:F.facialExpressionPrompt('natural')}];
 assert.notEqual(O.optimizationTask({...job,promptSections:changed},cap).prompt,task.prompt,'A different mode invalidates the persisted optimizer task cache');
 console.log('PASS film/shot facial intensity in legacy prompts and stills, no unapproved override, required acting, verbatim protected compression, precise budget reservation and cache invalidation. No API calls.');
}finally{globalThis.fetch=original}
