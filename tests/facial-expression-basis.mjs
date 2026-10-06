import {build} from 'esbuild';
import assert from 'node:assert/strict';
const server=`export const owner=async()=> 'owner';export const imageData=async()=>{throw Error('No media reads')};export const getKey=async()=>{throw Error('No API calls')};export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(u,p,revision)=>{if(revision!==globalThis.state.revision)throw Error('Revision');p.revision++;globalThis.state=p;return p;};export const mutate=async()=>{throw Error('No generation')};export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as C from './lib/creative-versions';export * as P from './lib/shot-planning';export * as K from './lib/keyframes';export * as A from './lib/animatic';export * as G from './lib/generation-basis';export * as B from './lib/material-basis';export * as O from './lib/prompt-optimization';export * as CP from './lib/prompt-compiler';export * as F from './lib/facial-expression';export * as SW from './lib/script-workflow';export * as DS from './lib/directing-solutions';export {scenePlanBasis} from './lib/shot-direction';export {POST} from './app/api/projects/[id]/directing/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/facial-expression-basis.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'mock',setup(b){b.onResolve({filter:/^(?:@\/lib|\.)\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const {D,R,C,P,K,A,G,B,O,CP,F,SW,DS,scenePlanBasis,POST}=await import('../work/tests/facial-expression-basis.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('This regression suite must not make network calls')};
try{
 const p=D.newProject('Мимика без повторного утверждения'),d=R.ensureDirecting(p);
 const approve=(item,data)=>{const v=JSON.parse(JSON.stringify(D.makeVariant(p,item,data)));item.variants.push(v);item.selectedId=item.approvedId=v.id;return v};
 const card=(stage,title)=>{const i={id:D.id(),stage,title,variants:[]};p.items.push(i);return i};
 approve(p.items.find(i=>i.stage===0),{text:'Анна замечает письмо, затем осматривает корону.'});
 const hero=p.items.find(i=>i.stage===1);hero.title='Анна';hero.character={name:'Анна',appearance:'Зелёные глаза',description:'Внимательная',instructions:'Сохранить внешность',refs:[]};
 approve(hero,{kind:'image',assetId:D.id(),text:'Анна',character:structuredClone(hero.character)});
 approve(p.items.find(i=>i.stage===2),{text:'Акварель, тёплый свет.'});
 const place=p.items.find(i=>i.stage===3);place.title='Двор';approve(place,{kind:'image',assetId:D.id(),text:'Двор с каменной аркой.'});
 const shot=n=>({id:D.id(),title:'План '+n,duration:5,cast:['Анна'],characterIds:[hero.id],locationIds:[place.id],story:n===1?'Анна замечает письмо.':'Анна осматривает корону.',stateIn:'Стоит у стола',stateOut:'Наклонила голову',cinematography:'Средний план',productionDesign:'Тёплый свет',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{framingStart:'medium',startFrame:'Голова прямо',endFrame:'Голова наклонена'},...(n===1?{approvalVersion:2}:{})});
 const scene={id:D.id(),title:'Находка',purpose:'Заметить загадку',location:'Двор',locationIds:[place.id],conflict:'Сомнение',turn:'Любопытство',stateIn:'Анна у стола',stateOut:'Рассматривает находку',continuity:[],shots:[shot(1),shot(2)]};d.scenes=[scene];d.scenesApproved=R.scenesBasis(p);
 P.ensureShotPlanning(p);P.approvePlanSets(p,[scene.id]);
 for(const s of scene.shots){s.approved=R.shotApproval(scene,s);s.approvedFoundation=s.approvalVersion===2?R.shotFoundationBasis(p,scene,s):R.directorBasis(p);s.imagePrompt='PREPARED IMAGE: hero notices the clue.';s.videoPrompt='PREPARED VIDEO: subtle generic acting.';s.promptBasis=R.shotPromptBasis(p,scene,s)}
 d.editorBasis=R.editorBasis(p);d.patchesBasis=d.editorBasis;
 d.sceneReviews=[{sceneId:scene.id,basis:scenePlanBasis(scene),foundation:R.directorBasis(p),issues:[],patches:[],montageOperations:[]}];
 assert.equal(R.directorApprovalBasis(p),R.directorBasis(p),'Legacy approval signatures exactly match the old full-brief signature');
 const exportBefore=R.directorExport(p),script=p.items.find(i=>i.stage===4);approve(script,{text:JSON.stringify(exportBefore)});
 const frames=scene.shots.map((s,n)=>{const item=n?card(5,s.title):p.items.find(i=>i.stage===5);item.title=s.title;item.sourceShot={scriptId:script.id,scriptVersion:script.approvedId,shotId:s.id,sceneId:scene.id,title:s.title};
   const first=approve(item,{kind:'image',assetId:D.id(),text:'Первый кадр',model:'grok-imagine-image-2.0',imageSettings:{quality:'medium',resolution:'2k'}});
   K.setKeyframeMode(p,item.id,'pair');const request=K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model});
   const last=JSON.parse(JSON.stringify(D.makeVariant(p,item,{...request,kind:'image',assetId:D.id(),text:'Конечный кадр'})));item.variants.push(last);K.chooseKeyframe(p,item.id,'end',last.id);K.approveKeyframes(p,item.id);return item;
 });
 p.storyboardOrder=frames.map(i=>i.id);
 const video=p.items.find(i=>i.stage===7);video.title=frames[0].title;video.sourceShot={...frames[0].sourceShot};approve(video,{kind:'video',assetId:D.id(),refs:[frames[0].variants[0].assetId],text:'Готовое видео'});
 p.animaticSettings={sound:'silent',music:false,motion:true};const preview=A.saveAnimatic(p,{kind:'video',assetId:D.id(),title:'Готовый аниматик'},A.animaticBasis(p));A.approveAnimatic(p,preview.id);
 const queued={id:D.id(),itemId:video.id,kind:'video',model:'fal-kling-3.0-pro',prompt:'FROZEN PAID REQUEST',status:'queued',deps:D.dependencies(p,7),refs:[frames[0].variants[0].assetId],duration:5};C.stampGenerationVersions(p,[queued]);p.jobs.push(queued);
 // Work with the persisted shape, just as the real API does.
 globalThis.state=JSON.parse(JSON.stringify(p));
 assert(state.items.filter(i=>i.stage===5).every(i=>D.isApproved(state,i)),JSON.stringify(state.items.filter(i=>i.stage===5).map(i=>({issues:K.keyframeIssues(state,i),keyApproved:K.keyframesApproved(state,i),ready:D.stageReady(state,5)}))));
 const original=structuredClone(state),originalItems=JSON.stringify(state.items),originalJobs=JSON.stringify(state.jobs),baselineGeneration=G.generationBasis(state,frames[0].id);
 const basis=film=>({scenes:R.scenesBasis(film),planning:P.planSetBasis(film,film.directing.scenes[0]),editor:R.editorBasis(film),prompt:film.directing.scenes[0].shots.map(s=>R.shotPromptBasis(film,film.directing.scenes[0],s)),material:film.items.filter(i=>[5,7].includes(i.stage)).map(i=>B.materialBasis(film,i,i.variants.find(v=>v.id===i.approvedId))),keys:film.items.filter(i=>i.stage===5).map(i=>K.keyframeApprovalBasis(film,i)),animatic:A.animaticBasis(film)});
 const originalBasis=basis(state),baselineExport=R.directorExport(state);
 const request=async(action,data)=>POST(new Request('http://localhost/api/directing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,revision:state.revision,data})}),{params:Promise.resolve({id:state.id})});
 const compiled=film=>{const item=film.items.find(i=>i.id===video.id);return CP.compilePrompt(film,item,'fal-kling-3.0-pro',{kind:'video',prompt:baselineExport.shots[0].videoPrompt,startFrameId:frames[0].variants[0].assetId,references:[frames[0].variants[0].assetId]})};
 const firstPrompt=compiled(state),jobFor=c=>({...queued,prompt:c.prompt,promptSections:c.sections});
 for(const mode of F.FACIAL_EXPRESSION_MODES){
   const response=await request('brief',{brief:{...state.directing.brief,facialExpression:mode}});assert.equal(response.status,200,await response.clone().text());
   assert.equal(state.directing.brief.facialExpression,mode);assert.deepEqual(basis(state),originalBasis,'Global acting does not alter approved content: '+mode);
   assert.equal(state.directing.editorBasis,original.directing.editorBasis);assert.equal(state.directing.patchesBasis,original.directing.patchesBasis);
   assert(P.allPlanSetsApproved(state));assert(state.directing.scenes[0].shots.every(s=>R.shotApproved(state.directing.scenes[0],s,state)),'Both legacy and v2 shots remain approved');
   assert(state.items.filter(i=>[5,7].includes(i.stage)).every(i=>D.isApproved(state,i)));assert(A.animaticApproved(state));assert.equal(DS.currentSceneReviews(state).length,1);
   assert.deepEqual(R.directorExport(state),baselineExport,'Ready export and prepared prompts stay available');
   assert.equal(JSON.stringify(state.items),originalItems,'Saving the preference neither creates variants nor rewrites paid material');assert.equal(JSON.stringify(state.jobs),originalJobs,'Already queued prompt/provenance stays frozen');
   assert.notEqual(G.generationBasis(state,frames[0].id),baselineGeneration,'Open generation forms must recheck current preferences');
   const next=compiled(state);assert.equal(next.sections.find(s=>s.key==='facial-expression').text,F.facialExpressionPrompt(mode));
   if(mode!=='auto')assert(!O.sameOptimizationInputs(jobFor(firstPrompt),jobFor(next)),'Different acting invalidates prompt optimization reuse');
   const frozen=SW.createScriptWorkflowRun(structuredClone(state),'grok-4.6',['script-critic'],state.items.find(i=>i.stage===0).approvedId);
   assert.equal(frozen.scriptInput.brief.facialExpression,mode,'Strict workflow snapshot accepts and preserves the optional preference');
 }
 // Stale director answers are still rejected, although finished approvals stay usable.
 const pending=structuredClone(original),run=R.newDirectorRun(pending,'grok-4.6','critic'),task=run.tasks[0],oldRunBasis=R.directorRunBasis(pending,run);
 pending.directing.brief.facialExpression='restrained';assert.notEqual(R.directorRunBasis(pending,run),oldRunBasis);
 R.applyDirectorResult(pending,run,task,{review:'Поздний ответ',alternatives:[]});assert.match(task.error,/Основа изменилась/);assert(!task.applied);assert.equal(pending.directing.critic,undefined);assert.equal(task.result.review,'Поздний ответ');
 // Ordinary brief edits retain their previous invalidation semantics.
 for(const update of [{genre:'Хоррор'},{director:'Хичкок'},{locked:'Другой финал'},{effect:'Напугать'}]){
   const changed=structuredClone(state);Object.assign(changed.directing.brief,update);assert.notEqual(R.scenesBasis(changed),originalBasis.scenes);assert.notEqual(P.planSetBasis(changed,changed.directing.scenes[0]),originalBasis.planning);assert.notEqual(R.editorBasis(changed),originalBasis.editor);
   assert(changed.directing.scenes[0].shots.every(s=>!R.shotApproved(changed.directing.scenes[0],s,changed)));assert(!D.isApproved(changed,changed.items.find(i=>i.id===frames[0].id)));
 }
 // A local override is a normal edit, scoped to that plan's actual content.
 const local=structuredClone(state),first=local.directing.scenes[0].shots[0],sibling=local.directing.scenes[0].shots[1];first.direction.facialExpression='natural';
 assert(!R.shotApproved(local.directing.scenes[0],first,local));assert(R.shotApproved(local.directing.scenes[0],sibling,local));assert.notEqual(R.shotPromptBasis(local,local.directing.scenes[0],first),originalBasis.prompt[0]);
 const localScript=local.items.find(i=>i.stage===4),payload=JSON.parse(localScript.variants[0].text);payload.shots[0].direction.facialExpression='natural';localScript.variants[0].text=JSON.stringify(payload);
 assert(!D.isApproved(local,local.items.find(i=>i.id===frames[0].id)));assert(D.isApproved(local,local.items.find(i=>i.id===frames[1].id)),'Another plan does not inherit a local edit');
 for(const mode of ['auto','restrained',undefined]){
   const planned=structuredClone(original),s=planned.directing.scenes[0],target=s.shots[0];
   if(mode!==undefined)target.direction.facialExpression=mode;
   const cards=P.planningScene(planned,s).cards.map(c=>({...c}));cards[0].action+=' Более точное действие.';P.replacePlanCards(planned,s.id,cards);
   assert.equal(s.shots[0].direction.facialExpression,mode,'Editing a montage card preserves its user preference');assert.equal(s.shots[0].direction.endFrame,undefined,'Generated staging resets normally');
   for(const after of [{framingStart:'wide'},{framingStart:'wide',facialExpression:'exaggerated'},null]){
     const edited=structuredClone(original),es=edited.directing.scenes[0],selected=es.shots[0];if(mode!==undefined)selected.direction.facialExpression=mode;
     const report=DS.prepareDirectorReview(edited,{issues:[],patches:[{shotId:selected.id,section:'direction',after:JSON.stringify(after),reason:'Уточнить крупность'}]});
     assert.equal(JSON.parse(report.patches[0].after)?.facialExpression,mode,'The proposed patch shows the preserved preference');
     DS.storeWholeReview(edited,report);
     // A saved older proposal must not bypass this protection either.
     edited.directing.patches[0].after=JSON.stringify(after);DS.applyEditorSolutions(edited,[report.patches[0].id]);
     assert.equal(edited.directing.scenes[0].shots[0].direction?.facialExpression,mode);
   }
   const merged=structuredClone(original),ms=merged.directing.scenes[0],keep=ms.shots[0];if(mode!==undefined)keep.direction.facialExpression=mode;
   const after={...R.directingShotSchema.parse(keep),duration:10,direction:{framingStart:'wide',facialExpression:'exaggerated'}};
   const review=DS.prepareDirectorReview(merged,{issues:[],patches:[],montageOperations:[{type:'merge',sceneId:ms.id,shotIds:ms.shots.map(v=>v.id),keepShotId:keep.id,after,reason:'Объединить непрерывное действие'}]});
   assert.equal(review.montageOperations[0].after.direction.facialExpression,mode,'Merge preview inherits the retained plan preference');
   DS.storeWholeReview(merged,review);merged.directing.montageOperations[0].after.direction.facialExpression='exaggerated';DS.applyEditorSolutions(merged,[],[review.montageOperations[0].id]);
   assert.equal(merged.directing.scenes[0].shots[0].direction.facialExpression,mode,'Merge application also protects old saved proposals');
 }
 globalThis.state=structuredClone(original);const manualScene=state.directing.scenes[0],manualShot=R.directingShotSchema.parse(manualScene.shots[0]);manualShot.direction.facialExpression='restrained';
 let response=await request('saveShot',{sceneId:manualScene.id,shot:manualShot});assert.equal(response.status,200,await response.clone().text());assert.equal(state.directing.scenes[0].shots[0].direction.facialExpression,'restrained','A manual edit may intentionally change the mode');
 globalThis.state=structuredClone(original);const importCard=state.items.find(i=>i.stage===4),imported=JSON.parse(importCard.variants[0].text);imported.shots.forEach((s,n)=>s.direction.facialExpression=n?'restrained':'auto');importCard.variants[0].text=JSON.stringify(imported);state.directing.scenes=[];
 response=await request('importScript',{});assert.equal(response.status,200,await response.clone().text());assert.deepEqual(state.directing.scenes[0].shots.map(s=>s.direction.facialExpression),['auto','restrained'],'Actual import route retains structured user preferences');
 assert(!Object.hasOwn(R.creativeBriefSchema.parse(R.DEFAULT_BRIEF),'facialExpression'));
 console.log('PASS facial preference: real brief save retains legacy/v2 shots, scene/plan/editor reviews, keyframes, video and animatic; future prompt/admission/cache changes; queued work frozen; late director replies rejected; story and local edits still invalidate. No paid calls.');
}finally{globalThis.fetch=originalFetch}
