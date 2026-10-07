import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as S from './lib/staging-policy';export * as D from './lib/domain';export * as R from './lib/directing';export * as SD from './lib/shot-direction';export * as P from './lib/directing-specialists';export * as C from './lib/creative-brief';export * as F from './lib/creative-foundation';export * as SW from './lib/script-workflow';export * as SG from './lib/scenario-generation';export * as DS from './lib/directing-solutions';export * as SP from './lib/shot-planning';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/staging-policy.mjs',external:['@ffmpeg/ffmpeg']});
const {S,D,R,SD,P,C,F,SW,SG,DS,SP}=await import('../work/tests/staging-policy.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network expected')};
try{
  assert.equal(S.effectiveStagingMode(),undefined);
  assert.equal(S.effectiveStagingMode('readable','balanced'),'balanced');
  const legacy=R.creativeBriefSchema.parse(R.DEFAULT_BRIEF);
  assert(!Object.hasOwn(legacy,'stagingMode'));assert(!Object.hasOwn(legacy,'framePolicy'));
  assert.deepEqual(SD.shotDirectionSchema.parse({}),{});assert.equal(S.stagingInstructions({}),'');
  for(const mode of S.STAGING_MODES){
    assert.equal(R.creativeBriefSchema.parse({...legacy,stagingMode:mode}).stagingMode,mode);
    assert.equal(SD.shotDirectionSchema.parse({stagingMode:mode}).stagingMode,mode);
    assert(S.STAGING_MODE_LABELS[mode]&&S.STAGING_MODE_HELP[mode]);
    assert(S.stagingPrompt(mode).length<500);
    assert.match(S.stagingPrompt(mode),/Preserve approved events/);
    assert.match(S.stagingPrompt(mode,'image'),/only the requested instant/);
  }
  for(const mode of S.FRAME_POLICIES)assert.equal(R.creativeBriefSchema.parse({...legacy,framePolicy:mode}).framePolicy,mode);
  assert.throws(()=>R.creativeBriefSchema.parse({...legacy,stagingMode:'fast'}));
  assert.throws(()=>SD.shotDirectionSchema.parse({requiresEndFrame:'true'}));
  assert.deepEqual(F.creativeFoundationBrief({...legacy,facialExpression:'natural',stagingMode:'readable',framePolicy:'auto'}),legacy);
  assert.match(C.renderCreativeInstructions({...legacy,stagingMode:'readable',framePolicy:'auto'}),/одно главное наблюдаемое действие/);
  assert.match(C.renderCreativeInstructions({...legacy,stagingMode:'readable'}),/Замена событий, объединение или удаление планов — только отдельное предложение/);
  const p=D.newProject('Читаемая постановка'),d=R.ensureDirecting(p);
  const initialApproval=R.directorApprovalBasis(p),initialRun=R.directorBasis(p);
  Object.assign(d.brief,{stagingMode:'readable',framePolicy:'auto'});
  assert.equal(R.directorApprovalBasis(p),initialApproval);assert.notEqual(R.directorBasis(p),initialRun);
  assert.match(SG.scenarioGenerationInstruction(p),/Простые и ясно читаемые действия/);
  const shot=(id,mode)=>({id,title:id,duration:5,cast:['Анна'],story:'Анна поворачивает голову к письму.',stateIn:'Смотрит на дверь',stateOut:'Смотрит на письмо',cinematography:'Средний план',productionDesign:'Комната',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{framingStart:'medium',...(mode?{stagingMode:mode}:{}),facialExpression:'natural'}});
  const scene={id:'scene-1',title:'Письмо',purpose:'Заметить письмо',location:'Комната',conflict:'Ожидание',turn:'Любопытство',stateIn:'Смотрит на дверь',stateOut:'Нашла письмо',continuity:[],shots:[shot('one'),shot('two','balanced')]};d.scenes=[scene];
  const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',tasks:[],sceneIds:[scene.id]};
  for(const role of ['critic','scenes','shot-planner','story','camera','art','dialogue','performance','editor','scene-expressive-reviewer','compress']){
    const task={id:'task-'+role,role,sceneId:scene.id,shotIds:['one','two'],requires:[]};
    const prompt=R.directorPrompt(p,run,task);assert.match(prompt,/одно главное наблюдаемое действие/,'Policy reaches '+role);
    const context=JSON.parse(prompt.split('\nДанные:\n')[1]);
    assert.deepEqual(context.staging.shots,[{shotId:'one',mode:'readable'},{shotId:'two',mode:'balanced'}]);
    assert.match(context.staging.instructions.balanced,/Сбалансированная/);
    assert.match(prompt,/Не меняй и не возвращай direction.stagingMode/);
    if(role==='camera')assert.match(prompt,/requiresEndFrame=true только если необходима конкретная точная конечная композиция/);
  }
  const updates=P.specialistUpdates(scene,'camera',{shots:scene.shots.map(s=>({id:s.id,cinematography:'Плавный наезд',direction:{stagingMode:'expressive',requiresEndFrame:false,framingStart:'medium'}}))});
  assert.equal(updates[0].direction.stagingMode,undefined);assert.equal(updates[1].direction.stagingMode,'balanced');
  assert.equal(updates[0].direction.requiresEndFrame,false);
  const task={id:'story',role:'story',sceneId:scene.id,requires:[]};run.tasks=[task];
  R.applyDirectorResult(p,run,task,{shots:scene.shots.map(s=>({...s,direction:{stagingMode:'expressive',framingStart:'medium'}}))});
  assert.equal(scene.shots[0].direction.stagingMode,undefined);assert.equal(scene.shots[1].direction.stagingMode,'balanced');
  const target=scene.shots[1];
  for(const after of [{stagingMode:'expressive',framingStart:'wide'},null]){
    const review=DS.prepareDirectorReview(p,{issues:[],patches:[{shotId:target.id,section:'direction',after:JSON.stringify(after),reason:'Проверка'}]});
    assert.equal(JSON.parse(review.patches[0].after).stagingMode,'balanced','Editor cannot change user mode');
  }
  const cards=SP.planningScene(p,scene).cards.map(c=>({...c}));cards[1].action+=' Короткая реакция.';
  SP.replacePlanCards(p,scene.id,cards);assert.equal(scene.shots[1].direction.stagingMode,'balanced');
  const scenario=p.items.find(i=>i.stage===0),variant=D.makeVariant(p,scenario,{text:'Анна ждёт письма и замечает его на столе.'});scenario.variants.push(variant);scenario.selectedId=scenario.approvedId=variant.id;
  const workflow=SW.createScriptWorkflowRun(p,'grok-4.6',['script-critic'],variant.id);
  assert.equal(workflow.scriptInput.brief.stagingMode,'readable');assert.equal(workflow.scriptInput.brief.framePolicy,'auto');
  assert.match(SW.scriptWorkflowPrompt(p,workflow,workflow.tasks[0]),/одно главное наблюдаемое действие/);
  console.log('PASS staging policy: optional compatible schemas; global/shot inheritance; approved basis stable, new run basis changed; every specialist and frozen workflow; camera recommendation; user preferences survive story, editor and plan-card edits. No network.');
}finally{globalThis.fetch=originalFetch}
