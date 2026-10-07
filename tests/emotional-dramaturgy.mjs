import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/shot-direction';export * as P from './lib/shot-planning';export * as A from './lib/directing-specialists';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/emotional-dramaturgy.mjs',external:['@ffmpeg/ffmpeg']});
const {D,R,S,P,A}=await import('../work/tests/emotional-dramaturgy.mjs');
const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No API calls allowed')};
try{
  const p=D.newProject('Мастерская'),d=R.ensureDirecting(p);
  const link={character:'Мастер',expectation:'Устройство выдержит испытание',trigger:'Индикатор гаснет',meaning:'Его уверенность в успехе была преждевременной',emotionStart:'Уверенность',emotionEnd:'Тревога',decision:'Проверить соединение',visibleEvidence:'Улыбка исчезает, взгляд задерживается на погасшем индикаторе, рука тянется к разъёму'};
  const {expectation,...fields}=link,beat={role:'action-reaction',...fields};
  const actor={character:link.character,objective:link.decision,subtext:link.meaning,emotionStart:link.emotionStart,emotionEnd:link.emotionEnd,visibleAction:link.visibleEvidence};
  const makeShot=id=>({id,title:id,duration:6,cast:['Мастер'],story:'Мастер включает устройство; увидев погасший индикатор, теряет уверенность.',stateIn:'Улыбается перед испытанием',stateOut:'Тревожно проверяет устройство',cinematography:'Крупный план',productionDesign:'Мастерская',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{framingStart:'close-up',framingEnd:'close-up',narrativeBeat:structuredClone(beat),performance:[structuredClone(actor)]}});
  const shot=makeShot('target'),scene={id:'scene',title:'Испытание',purpose:'Проверка уверенности',location:'Мастерская',conflict:'Ожидание против результата',turn:'Тревога вместо уверенности',stateIn:'Ждёт успеха',stateOut:'Решает разобраться',continuity:[],causalChain:[link],shots:[makeShot('previous'),shot,makeShot('next')]};
  d.scenes=[scene];
  assert.deepEqual(R.sceneSchema.parse(scene).causalChain,[link]);
  assert.deepEqual(R.directingShotSchema.parse(shot).direction.narrativeBeat,beat);
  assert.deepEqual(P.planSketchSchema.parse(P.sketchFromShot(shot)).narrativeBeat,beat);
  const legacyScene=structuredClone(scene);delete legacyScene.causalChain;for(const s of legacyScene.shots)delete s.direction.narrativeBeat;
  const oldApproval=R.shotApproval(legacyScene,legacyScene.shots[0]);
  assert(!Object.hasOwn(R.sceneSchema.parse(legacyScene),'causalChain'));
  assert(!Object.hasOwn(S.shotDirectionSchema.parse(legacyScene.shots[0].direction),'narrativeBeat'));
  assert.equal(R.shotApproval(legacyScene,legacyScene.shots[0]),oldApproval,'Optional new fields do not mutate legacy approval data');
  assert(!S.validateScenePlan(scene).some(i=>i.code==='causal_chain_coverage'));
  assert(S.validateScenePlan({...scene,shots:legacyScene.shots}).some(i=>i.code==='causal_chain_coverage'));
  const noActor=structuredClone(shot);delete noActor.direction.performance;
  assert(S.validateShotDirection(noActor).some(i=>i.code==='reaction_performance'&&i.severity==='note'));
  const partial=structuredClone(shot);partial.direction.narrativeBeat.meaning='';
  assert(S.validateShotDirection(partial).some(i=>i.code==='reaction_causality'&&i.severity==='note'));
  assert.match(S.readableShotDirection(shot.direction),/Осознание: Его уверенность/);

  const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',tasks:[],sceneIds:[scene.id]},task=role=>({id:role,role,sceneId:scene.id,shotId:shot.id,requires:[]});
  for(const role of ['story','camera','art','dialogue','performance','compress','shot-planner']){
    const prompt=R.directorPrompt(p,run,task(role)),context=JSON.parse(prompt.split('\nДанные:\n')[1]);
    assert.deepEqual(context.scene.causalChain,[link],role+' keeps target scene cause');
    assert.deepEqual(context.scene.shots[0].direction.narrativeBeat,beat,role+' keeps target beat');
    assert.deepEqual(context.contextOnlyNeighbours[0].narrativeBeat,beat,role+' knows neighbour causality');
  }
  assert.match(R.directorPrompt(p,run,task('scenes')),/не приписывай зрителю знание исходного произведения/i);
  assert.match(R.directorPrompt(p,run,task('story')),/причину, проживание и решение также в story/);
  assert.match(P.plannerInstruction('economy'),/Экономичный монтаж сохраняет важные реакции/);
  for(const role of ['editor','scene-expressive-reviewer'])assert.match(R.directorPrompt(p,run,task(role)),/Проверь фильм как зритель/);
  const camera=A.specialistUpdates({...scene,shots:[shot]},'camera',{shots:[{id:shot.id,cinematography:'Медленный наезд',direction:{narrativeBeat:{...beat,meaning:'Подмена'},cameraMovement:{type:'push-in',description:'Плавно к лицу'},performance:[]}}]},shot.id)[0];
  assert.deepEqual(camera.direction.narrativeBeat,beat,'Concurrent camera answer cannot overwrite narrative meaning');
  assert.deepEqual(camera.direction.performance,[actor]);
  const acted=A.specialistUpdates({...scene,shots:[camera]},'performance',{shots:[{id:shot.id,performance:[actor]}]},shot.id)[0];
  assert.deepEqual(acted.direction.narrativeBeat,beat,'Actor owns performance, not the scene decision');

  const previousOutline=R.sceneOutline(scene),single=structuredClone(scene);single.shots=[shot];d.scenes=[single];
  const card=P.sketchFromShot(shot);P.replacePlanCards(p,single.id,[{...card,purpose:'Показать перелом'}]);
  assert.deepEqual(single.shots[0].direction.narrativeBeat,beat,'Selecting/editing montage cards keeps action/reaction contract');
  const sceneRun={...run,basis:R.directorBasis(p),mode:'scenes'},sceneTask={id:'scenes',role:'scenes',requires:[]};
  R.applyDirectorResult(p,sceneRun,sceneTask,{scenes:[{...previousOutline,shots:[]}]});
  assert.deepEqual(d.scenes[0].causalChain,[link],'Generated scene chain persists through result application');
  assert(sceneTask.applied);
  const script=p.items.find(i=>i.stage===0),arcs=[{character:link.character,want:'Создать рабочий прибор',expectation:link.expectation,stakes:'Доверие к собственному мастерству',emotionStart:link.emotionStart,emotionEnd:link.emotionEnd,beats:[fields]}];
  // Arc beats do not carry the character (it belongs to the enclosing arc).
  delete arcs[0].beats[0].character;
  const variant=D.makeVariant(p,script,{text:'Неизменный текст',versionInfo:{created:D.now(),sources:[],settings:{emotionalArcs:arcs}}});script.variants.push(variant);script.approvedId=variant.id;
  const arcBasis=R.scenesBasis(p);variant.versionInfo.settings.emotionalArcs[0].stakes='Доверие коллег';
  assert.notEqual(R.scenesBasis(p),arcBasis,'Changed approved arc metadata invalidates affected scene basis even when text is identical');
  const strictRun={...sceneRun,basis:R.directorBasis(p)},missingScene={...previousOutline,shots:[]};delete missingScene.causalChain;
  assert.throws(()=>R.applyDirectorResult(p,strictRun,{...sceneTask,result:undefined,applied:undefined},{scenes:[missingScene]}),/не содержит causalChain/);
  const current=d.scenes[0],missingShot=structuredClone(shot);delete missingShot.direction.narrativeBeat;
  assert.throws(()=>R.applyDirectorResult(p,{...strictRun,basis:R.directorBasis(p)},{id:'story',role:'story',sceneId:current.id,requires:[]},{shots:[missingShot]}),/потерял direction.narrativeBeat/);
  const missingCard=P.sketchFromShot(shot);delete missingCard.narrativeBeat;
  assert.throws(()=>P.savePlanningProposal(p,strictRun,{id:'planner',role:'shot-planner',sceneId:current.id,requires:[],inputContentBasis:P.planningInputBasis(p,current)},{shots:[missingCard]}),/не содержит narrativeBeat/);
  console.log('PASS optional causal schema, scene persistence, planner handoff, complete specialist contexts, parallel ownership, viewer checks and legacy approval compatibility. No paid calls.');
}finally{globalThis.fetch=oldFetch;}
