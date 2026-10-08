import {build} from 'esbuild';
import {strict as A} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as M from './lib/story-meaning';export * as P from './lib/shot-planning';export * as W from './lib/script-workflow';export * as C from './lib/creative-versions';export * as RD from './lib/directing-workflow';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/story-meaning.mjs',external:['@ffmpeg/ffmpeg']});
const {D,R,M,P,W,C,RD}=await import('../work/tests/story-meaning.mjs');
const meaning={id:'truth',title:'Письмо меняет решение',kind:'turn',priority:'required',viewerBefore:'Анна считает, что её бросили.',viewerAfter:'Анна понимает, что её пытались защитить.',event:'Анна читает дату в письме.',stakes:'Можно отказаться от мести и вернуться домой.',evidence:['Дата написана до исчезновения.', 'Анна опускает оружие и берёт ключ от дома.']};
const shot={id:'shot',title:'Дата',duration:5,cast:['Анна'],story:'Анна видит дату и опускает оружие.',stateIn:'Оружие поднято',stateOut:'Оружие опущено',cinematography:'Дата читаема в крупном плане',productionDesign:'Старое письмо',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'Оружие опущено',direction:{narrativeBeat:{role:'action-reaction',character:'Анна',trigger:'Дата до исчезновения',meaning:'Её защищали',emotionStart:'Гнев',emotionEnd:'Облегчение',decision:'Вернуться домой',visibleEvidence:'Анна медленно опускает оружие и берёт ключ.'}}};
const scene={id:'scene',title:'Письмо',purpose:'Открыть правду',location:'Комната',conflict:'Месть или доверие',turn:'Анна решает вернуться',stateIn:'Анна сердится',stateOut:'Анна уходит домой',continuity:[],shots:[structuredClone(shot)]};
const p=D.newProject('Смысл');const item=p.items.find(i=>i.stage===0);D.addVariant(p,item.id,{text:'Анна читает старую дату письма, понимает правду и возвращается домой.'});D.approve(p,item.id);const d=R.ensureDirecting(p);
// Extraction is possible before scenes and assets exist; it never approves itself.
const run=R.newDirectorRun(p,'grok-4.6','role',undefined,'story-meaning');
A.equal(run.tasks.length,1);A.equal(run.tasks[0].sceneId,undefined);A.deepEqual(run.sceneIds,[]);
A.match(R.directorPrompt(p,run,run.tasks[0]),/не обязан заполнять все роли/);
R.applyDirectorResult(p,run,run.tasks[0],{meanings:[meaning]});
A.deepEqual(d.storyMeanings,[meaning]);A.equal(R.directorRunBasis(p,run),run.basis,'The extraction result does not mark its completed run stale');A.equal(M.storyMeaningsApproved(p),false);A.equal(d.storyMeaningsApproved,undefined);
d.scenes=[structuredClone(scene)];
// A first draft does not invalidate legacy content or invent links.
delete d.storyMeanings;const before=R.scenesBasis(p),foundationBefore=R.shotFoundationBasis(p,d.scenes[0],d.scenes[0].shots[0]);
M.saveStoryMeanings(p,[meaning]);A.equal(R.scenesBasis(p),before);A.equal(R.shotFoundationBasis(p,d.scenes[0],d.scenes[0].shots[0]),foundationBefore);A.doesNotThrow(()=>M.assertStoryMeaningCoverage(p));
A.equal(M.storyMeaningsForShot(p,shot).length,0);d.scenes[0].meaningIds=['truth'];A.equal(M.storyMeaningsForShot(p,shot).length,0,'Scene meaning is never injected into every clip');
M.approveStoryMeanings(p);A(M.storyMeaningsApproved(p));A.throws(()=>M.assertStoryMeaningCoverage(p),/обязательный смысл/);
d.scenes[0].shots[0].meaningIds=['truth'];A.equal(M.meaningCoverage(p).covered,1);A.doesNotThrow(()=>M.assertStoryMeaningCoverage(p));
A.deepEqual(M.storyMeaningsForShot(p,{id:'shot'}),[meaning]);A.deepEqual(M.storyMeaningsForShot(p,{id:'shot',meaningIds:[]}),[],'An exported empty list is authoritative');
d.scenes[0].shots[0].direction.narrativeBeat.visibleEvidence='';A.throws(()=>M.assertStoryMeaningCoverage(p),/экранное подтверждение/);d.scenes[0].shots[0].direction=structuredClone(shot.direction);
const approved=M.storyMeaningBasis(p);item.variants.find(v=>v.id===item.approvedId).text+=' Иная развязка.';A.notEqual(M.storyMeaningBasis(p),approved);A(!M.storyMeaningsApproved(p));A.throws(()=>M.assertStoryMeaningCoverage(p),/снова утвердите/);M.approveStoryMeanings(p);
M.saveStoryMeanings(p,[]);A(d.storyMeaningsApproved,'Editing cannot disable the opted-in gate');A.throws(()=>M.assertStoryMeaningCoverage(p),/снова утвердите/);M.saveStoryMeanings(p,[meaning]);M.approveStoryMeanings(p);
A.throws(()=>M.storyMeaningsSchema.parse([meaning,meaning]),/уникальные/);A.throws(()=>M.assertMeaningLinks(p,['missing']),/отсутствует/);
// Story role cannot accidentally erase links by omitting this optional legacy field.
const storyRun={id:'story-run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',sceneIds:['scene'],tasks:[]};const task={id:'story-task',role:'story',sceneId:'scene',shotId:'shot',requires:[]};storyRun.tasks.push(task);
R.applyDirectorResult(p,storyRun,task,{shots:[structuredClone(shot)]});A.deepEqual(d.scenes[0].shots[0].meaningIds,['truth']);
const cameraRun={...storyRun,id:'camera-run',basis:R.directorBasis(p),tasks:[]},cameraTask={id:'camera-task',role:'camera',sceneId:'scene',shotId:'shot',requires:[]};cameraRun.tasks.push(cameraTask);
R.applyDirectorResult(p,cameraRun,cameraTask,{shots:[{id:'shot',cinematography:'Читаемая дата в крупном плане',meaningIds:[]}]});A.deepEqual(d.scenes[0].shots[0].meaningIds,['truth']);
const card=P.sketchFromShot(d.scenes[0].shots[0]);A.deepEqual(card.meaningIds,['truth']);delete card.meaningIds;card.action+=' Затем взгляд на дверь.';P.replacePlanCards(p,'scene',[card]);A.deepEqual(d.scenes[0].shots[0].meaningIds,['truth']);A.deepEqual(P.planningScene(p,d.scenes[0]).cards[0].meaningIds,['truth']);
// Meaning metadata is carried by script candidates, while reviewers cannot rewrite it.
const p2=D.newProject('Кандидаты');R.ensureDirecting(p2);const inputItem=p2.items.find(i=>i.stage===0);D.addVariant(p2,inputItem.id,{text:'Исходная история.'});
const chain=W.createScriptWorkflowRun(p2,'grok-4.6',['script-adaptation','script-critic','script-dramaturg'],inputItem.selectedId);
W.applyScriptWorkflowResult(p2,chain,chain.tasks[0],{title:'Кандидат',text:'Новая история с датой.',changes:[],findings:[],storyMeanings:[meaning]});
W.applyScriptWorkflowResult(p2,chain,chain.tasks[1],{title:'Рецензия',findings:[],storyMeanings:[{...meaning,event:'Непрошеное изменение'}]});
A.deepEqual(chain.tasks[1].result.storyMeanings,[meaning]);A.match(chain.tasks[1].processingWarning,/смыслы истории/);
A.throws(()=>W.applyScriptWorkflowResult(p2,chain,chain.tasks[2],{title:'Ошибка',text:'Текст.',changes:[],findings:[]}),/потеряны смыслы/);
const imported=W.importScriptWorkflowCandidate(p2,chain.id,chain.tasks[0].id);A.deepEqual(M.variantStoryMeanings(imported),[meaning]);A.equal(p2.directing.storyMeanings,undefined);
// A new live map cannot silently change production based on an old detailed script.
A.equal(M.storyMeaningPublicationCurrent(p),false);const detail=p.items.find(i=>i.stage===4);const v=D.makeVariant(p,detail,{kind:'text',text:JSON.stringify({storyMeaningBasis:M.storyMeaningBasis(p),shots:[]})});detail.variants.push(v);detail.approvedId=v.id;A.equal(M.storyMeaningPublicationCurrent(p),true);M.saveStoryMeanings(p,[{...meaning,stakes:'Меняются ставки.'}]);M.approveStoryMeanings(p);A.equal(M.storyMeaningPublicationCurrent(p),false);
// Whole-history restores recover the reviewed map and its exact shot links;
// restoring a scene alone keeps the current film-wide map and reveals bad links.
const history=D.newProject('История карты'),hd=R.ensureDirecting(history),hs=history.items.find(i=>i.stage===0);D.addVariant(history,hs.id,{text:'Анна читает письмо.'});D.approve(history,hs.id);hd.scenes=[structuredClone(scene)];
const legacy=C.recordCreativeVersion(history,'Без карты');
M.saveStoryMeanings(history,[meaning]);M.approveStoryMeanings(history);hd.scenes[0].meaningIds=['truth'];hd.scenes[0].shots[0].meaningIds=['truth'];
const reviewedMap=C.recordCreativeVersion(history,'Карта и постановка');
const ready=hd.scenes[0].shots[0];A.equal(RD.directingShotReadiness(history,hd.scenes[0],ready).status,'ready');ready.approvalVersion=2;ready.approved=R.shotApproval(hd.scenes[0],ready);ready.approvedFoundation=R.shotFoundationBasis(history,hd.scenes[0],ready);A.equal(RD.directingShotReadiness(history,hd.scenes[0],ready).status,'approved');
// Even a structurally approved shot cannot bypass required meaning evidence.
ready.direction.narrativeBeat.visibleEvidence='';ready.approved=R.shotApproval(hd.scenes[0],ready);A.equal(RD.directingShotReadiness(history,hd.scenes[0],ready).status,'conflict');A.throws(()=>RD.assertDirectingShotReady(history,hd.scenes[0],ready),/экранное подтверждение/);
M.saveStoryMeanings(history,[{...meaning,id:'other',title:'Иной смысл'}]);M.approveStoryMeanings(history);C.restoreSceneVersion(history,reviewedMap.id,'scene');A.equal(hd.storyMeanings[0].id,'other');A(M.meaningCoverage(history).issues.some(i=>/неизвестный смысл/.test(i.message)));
C.restoreCreativeVersion(history,reviewedMap.id);A.deepEqual(hd.storyMeanings,[meaning]);A.deepEqual(hd.scenes[0].meaningIds,['truth']);A.deepEqual(hd.scenes[0].shots[0].meaningIds,['truth']);A(M.storyMeaningsApproved(history));A.doesNotThrow(()=>M.assertStoryMeaningCoverage(history));
hs.variants.find(v=>v.id===hs.approvedId).text+=' Сценарий теперь иной.';C.restoreCreativeVersion(history,reviewedMap.id);A(!M.storyMeaningsApproved(history),'Restoration cannot approve a map for a changed screenplay');A.throws(()=>M.assertStoryMeaningCoverage(history),/снова утвердите/);
C.restoreCreativeVersion(history,legacy.id);A.equal(hd.storyMeanings,undefined);A.equal(hd.storyMeaningsApproved,undefined);A.doesNotThrow(()=>M.assertStoryMeaningCoverage(history));
console.log('PASS meaning extraction, explicit approval, source binding, legacy compatibility, required screen coverage, role/planner retention, script candidate provenance and publication freshness.');
