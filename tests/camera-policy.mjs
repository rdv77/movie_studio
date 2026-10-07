import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as C from './lib/camera-policy';export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/shot-direction';export * as P from './lib/directing-specialists';export * as B from './lib/creative-brief';export * as F from './lib/creative-foundation';export * as ST from './lib/staging-policy';export * as RL from './lib/director-reliability';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/camera-policy.mjs',external:['@ffmpeg/ffmpeg']});
const {C,D,R,S,P,B,F,ST,RL}=await import('../work/tests/camera-policy.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network expected')};
try{
  const brief=R.creativeBriefSchema.parse(R.DEFAULT_BRIEF);
  assert(!Object.hasOwn(brief,'cameraPolicy'),'Saved legacy brief has no invented policy');
  assert.equal(C.cameraPolicyInstructions(), '');
  assert.deepEqual(S.shotDirectionSchema.parse({cameraMovement:{type:'static',description:'Устойчивый план'}}),{cameraMovement:{type:'static',description:'Устойчивый план'}},'Legacy camera object does not gain defaults');
  for(const mode of C.CAMERA_POLICIES){
    assert.equal(R.creativeBriefSchema.parse({...brief,cameraPolicy:mode}).cameraPolicy,mode);
    assert(C.CAMERA_POLICY_LABELS[mode]&&C.CAMERA_POLICY_HELP[mode]);
    assert.match(C.cameraPolicyPrompt(mode),/Exact approved shot camera/);
    assert.match(C.cameraPolicyPrompt(mode),/Do not invent or replace camera moves/);
    assert(C.cameraPolicyPrompt(mode).length<500);
    assert.match(B.renderCreativeInstructions({...brief,cameraPolicy:mode}),/Работа камеры/);
  }
  assert.throws(()=>R.creativeBriefSchema.parse({...brief,cameraPolicy:'random'}));
  assert.deepEqual(F.creativeFoundationBrief({...brief,cameraPolicy:'dynamic'}),brief);
  assert.match(ST.stagingPrompt('readable'),/One simple camera move may accompany simple action/);
  assert.match(ST.stagingInstructions({stagingMode:'readable'}),/readable не означает обязательную статику/);
  const p=D.newProject('Камера'),d=R.ensureDirecting(p);
  const actor={character:'Анна',objective:'Понять находку',subtext:'Не спугнуть',visibleAction:'Приподнимает брови и переводит взгляд, рот закрыт',emotionStart:'Осторожность',emotionEnd:'Любопытство'};
  const shot={id:'one',title:'Находка',duration:5,cast:['Анна'],story:'Замечает письмо',stateIn:'Смотрит на дверь',stateOut:'Смотрит на письмо',cinematography:'Статичная камера',productionDesign:'Комната',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{facialExpression:'natural',performance:[actor]}};
  const scene={id:'scene',title:'Письмо',purpose:'Обнаружение',location:'Комната',conflict:'Ожидание',turn:'Любопытство',stateIn:'Ждёт',stateOut:'Нашла',continuity:[],shots:[shot]};d.scenes=[scene];
  const before=structuredClone(scene),approval=R.directorApprovalBasis(p),scenes=R.scenesBasis(p),foundation=R.shotFoundationBasis(p,scene,shot),runBasis=R.directorBasis(p);
  d.brief.cameraPolicy='dynamic';
  assert.equal(R.directorApprovalBasis(p),approval);assert.equal(R.scenesBasis(p),scenes);assert.equal(R.shotFoundationBasis(p,scene,shot),foundation);
  assert.notEqual(R.directorBasis(p),runBasis,'New requests must use the changed policy');
  assert.deepEqual(scene,before,'Saving policy never silently rewrites approved camera or actor tasks');
  const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',tasks:[],sceneIds:[scene.id]};
  for(const role of ['critic','scenes','shot-planner','story','camera','art','dialogue','performance','editor','scene-expressive-reviewer','compress']){
    const prompt=R.directorPrompt(p,run,{id:'task-'+role,role,sceneId:scene.id,shotIds:[shot.id],requires:[]});
    assert.match(prompt,/Работа камеры — Динамичная/,'Policy reaches '+role);
    const context=JSON.parse(prompt.split('\nДанные:\n')[1]);
    assert.equal(context.cameraPolicy.mode,'dynamic');assert.equal(context.brief.cameraPolicy,'dynamic');
    assert.match(prompt,/Утверждённое операторское решение плана имеет приоритет/);
    if(role==='camera'){assert.match(prompt,/keepInFrame/);assert.match(prompt,/requiresEndFrame=true только если/);}
    if(role==='compress')assert.match(prompt,/Точно перенеси cameraMovement.type/);
    if(role==='editor'||role==='scene-expressive-reviewer')assert.match(prompt,/не вводи квоту движений/);
  }
  const movement={type:'push-in',description:'Медленный наезд к реакции',from:'Средний план',to:'Крупный план',purpose:'Показать перемену ожидания',speed:'медленно, равномерно',start:.5,end:4.5,keepInFrame:'Лицо и взгляд Анны'};
  const direction={framingStart:'medium',framingEnd:'close-up',cameraMovement:movement,endFrame:'Крупное лицо слева, пространство взгляда справа'};
  assert.deepEqual(S.shotDirectionSchema.parse(direction),direction);
  assert(!S.validateShotDirection({...shot,direction}).some(i=>i.severity==='conflict'));
  assert.match(S.readableShotDirection(direction),/задача: Показать перемену ожидания/);
  assert.match(S.readableShotDirection(direction),/начало: 0.5 сек/);
  assert.match(S.readableShotDirection(direction),/удерживать в кадре: Лицо/);
  for(const [invalid,code] of [[{start:4,end:3},'camera_order'],[{start:0,end:6},'camera_fit'],[{start:5,end:5},'camera_fit'],[{start:-1,end:4},'direction_schema'],[{speed:7},'direction_schema'],[{end:Infinity},'direction_schema']]){
    assert(S.validateShotDirection({...shot,direction:{...direction,cameraMovement:{...movement,...invalid}}}).some(i=>i.code===code&&i.severity==='conflict'));
  }
  const update=P.specialistUpdates(scene,'camera',{shots:[{id:shot.id,cinematography:'Наезд к реакции',direction:{...direction,performance:[{...actor,visibleAction:'Подменённая игра'}],facialExpression:'exaggerated'}}]})[0];
  assert.deepEqual(update.direction.cameraMovement,movement);assert.deepEqual(update.direction.performance,[actor]);assert.equal(update.direction.facialExpression,'natural');
  assert.equal(update.story,shot.story);assert.equal(update.duration,shot.duration);assert.deepEqual(update.dialogue,shot.dialogue);assert.deepEqual(scene,before);
  assert.throws(()=>P.specialistUpdates(scene,'camera',{shots:[{id:shot.id,cinematography:'Слишком долгий наезд',direction:{...direction,cameraMovement:{...movement,end:6}}}]}),/длительность/);
  const raw={shots:[{id:shot.id,direction:{cameraMovement:{type:'static',description:'Статика',purpose:null,speed:null,start:null,end:null,keepInFrame:null},actionBeats:[{start:null,end:2,action:'Взгляд'}]}}]};
  const normalized=RL.normalizeDirectorAnswer(p,'camera',scene.id,raw);
  assert.deepEqual(normalized.shots[0].direction.cameraMovement,{type:'static',description:'Статика'});
  assert.equal(normalized.shots[0].direction.actionBeats[0].start,null,'Required action times are not hidden by optional camera cleanup');
  assert(!S.shotDirectionSchema.safeParse(normalized.shots[0].direction).success);
  scene.shots.push({...shot,id:'two',direction:{...direction,positions:[{subject:'Анна',start:'Левая часть кадра',end:'Слева',screenDirection:'static'}]}});
  const neighbourPrompt=R.directorPrompt(p,run,{id:'camera',role:'camera',sceneId:scene.id,shotIds:[shot.id],requires:[]});
  const neighbour=JSON.parse(neighbourPrompt.split('\nДанные:\n')[1]).contextOnlyNeighbours[0];
  assert.equal(neighbour.id,'two');assert.equal(neighbour.framingEnd,'close-up');assert.deepEqual(neighbour.cameraMovement,movement);assert.equal(neighbour.endFrame,direction.endFrame);assert.equal(neighbour.positions[0].end,'Слева');
  console.log('PASS camera policy: optional legacy-compatible schemas; all specialists and compiler input guided; approval foundations stable; exact shot precedence; bounded camera timing; readable simple movement; actor tasks and story preserved. No API calls.');
}finally{globalThis.fetch=originalFetch;}
