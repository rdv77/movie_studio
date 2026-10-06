import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as F from './lib/facial-expression';export * as D from './lib/domain';export * as R from './lib/directing';export * as S from './lib/shot-direction';export * as P from './lib/directing-specialists';export * as M from './lib/speech-mode';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/facial-expression.mjs',external:['@ffmpeg/ffmpeg']});
const {F,D,R,S,P,M}=await import('../work/tests/facial-expression.mjs');

assert.equal(F.effectiveFacialExpression(),'auto');
assert.equal(F.effectiveFacialExpression('restrained'),'restrained');
assert.equal(F.effectiveFacialExpression('restrained','auto'),'auto','Explicit auto overrides the film');
assert.equal(F.effectiveFacialExpression('cartoon','natural'),'natural');
assert(!Object.hasOwn(R.creativeBriefSchema.parse(R.DEFAULT_BRIEF),'facialExpression'),'Legacy brief stays byte-shape compatible');
assert.deepEqual(S.shotDirectionSchema.parse({}),{},'No default is persisted into legacy direction');
for(const mode of F.FACIAL_EXPRESSION_MODES){
  assert.equal(R.creativeBriefSchema.parse({...R.DEFAULT_BRIEF,facialExpression:mode}).facialExpression,mode);
  assert.equal(S.shotDirectionSchema.parse({facialExpression:mode}).facialExpression,mode);
  assert(F.FACIAL_EXPRESSION_LABELS[mode]);assert(F.FACIAL_EXPRESSION_HELP[mode]);
  const prompt=F.facialExpressionPrompt(mode);assert(prompt.length<350,'Mandatory prompt fits small provider budgets');
  assert.match(prompt,/facial identity and anatomy/);assert.match(prompt,/closed-mouth rules/);
  assert.match(S.readableShotDirection({facialExpression:mode}),/^Мимика:/);
}
assert.throws(()=>R.creativeBriefSchema.parse({...R.DEFAULT_BRIEF,facialExpression:'loud'}));
assert.throws(()=>S.shotDirectionSchema.parse({facialExpression:null}));

const p=D.newProject('Мимика'),d=R.ensureDirecting(p);d.brief.facialExpression='cartoon';
const shot=(id,mode)=>({id,title:id,duration:5,cast:['Анна'],story:'Анна замечает письмо.',stateIn:'Стоит',stateOut:'Смотрит на письмо',cinematography:'Средний план',productionDesign:'Комната',dialogue:{speechType:'voiceover',speaker:'Рассказчик',text:'Она нашла письмо.',delivery:''},continuityChanges:'',...(mode!==undefined?{direction:{facialExpression:mode}}:{})});
const scene={id:'scene-1',title:'Письмо',purpose:'Находка',location:'Комната',conflict:'Сомнение',turn:'Решение',stateIn:'Стоит',stateOut:'Решилась',continuity:[],shots:[shot('inherit'),shot('local-auto','auto'),shot('local-restrained','restrained')]};d.scenes=[scene];
const task={id:'task',role:'performance',sceneId:scene.id,shotIds:['inherit','local-auto'],requires:[]};
const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',tasks:[task],sceneIds:[scene.id]};
const prompt=R.directorPrompt(p,run,task),context=JSON.parse(prompt.split('\nДанные:\n')[1]);
assert.deepEqual(context.facialActing.shots,[{shotId:'inherit',mode:'cartoon'},{shotId:'local-auto',mode:'auto'}]);
assert.equal(context.facialActing.filmInstruction,F.facialExpressionPrompt('cartoon'));
assert.equal(context.facialActing.instructions.auto,F.facialExpressionPrompt('auto'));
assert(!prompt.includes('local-restrained\",\"mode'),'Unrequested facial modes do not expand specialist context');
assert.match(prompt,/Не меняй и не возвращай direction.facialExpression/);
assert.match(prompt,/причину реакции с конкретным изменением лица/);
assert.match(prompt,/как начинается и завершается реакция/);

const actor={character:'Анна',objective:'Понять',subtext:'Не бояться',visibleAction:'Приподнимает бровь, рот закрыт.',emotionStart:'Тревога',emotionEnd:'Решимость'};
const camera=P.specialistUpdates(scene,'camera',{shots:scene.shots.map(s=>({id:s.id,cinematography:'Наезд',direction:{facialExpression:'exaggerated',framingStart:'medium'}}))});
assert.equal(camera[0].direction.facialExpression,undefined);assert.equal(camera[1].direction.facialExpression,'auto');assert.equal(camera[2].direction.facialExpression,'restrained');
const performance=P.specialistUpdates(scene,'performance',{shots:scene.shots.map(s=>({id:s.id,performance:[actor],direction:{facialExpression:'exaggerated'}}))});
assert.equal(performance[1].direction.facialExpression,'auto');assert.equal(performance[2].direction.facialExpression,'restrained');

const storyTask={id:'story-task',role:'story',sceneId:scene.id,requires:[]};
const storyRun={...run,id:'story-run',tasks:[storyTask]};
R.applyDirectorResult(p,storyRun,storyTask,{shots:scene.shots.map(s=>({...s,direction:{facialExpression:'exaggerated',framingStart:'medium'}}))});
assert.equal(scene.shots[0].direction.facialExpression,undefined,'Agent cannot materialize an inherited user setting');
assert.equal(scene.shots[1].direction.facialExpression,'auto');assert.equal(scene.shots[2].direction.facialExpression,'restrained');
for(const speechType of ['voiceover','none','character']){
  const instruction=M.speechDirection({speechType,speaker:'Анна'});
  assert.match(instruction,/закрыт/);assert.match(instruction,/не означает неподвижное лицо/);
  assert.match(instruction,/речевой артикуляции/);assert.match(instruction,/глаз и бровей/);
  assert.doesNotMatch(instruction,/без артикуляции, движения губ|без артикуляции, шевеления губ/,'Facial expression is not forbidden together with speech');
}
console.log('PASS facial expression: optional schemas without migration; film inheritance and explicit auto; bounded identity-safe prompts; relevant specialist context; user setting survives camera, actor and story agents; closed mouths retain expressive faces. No paid APIs.');
