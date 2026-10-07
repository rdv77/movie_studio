import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as P from './lib/directing-specialists';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/acting-specialist-arc.mjs',external:['@ffmpeg/ffmpeg']});
const {D,R,P}=await import('../work/tests/acting-specialist-arc.mjs');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network expected')};
try{
  const p=D.newProject('Реакция на сообщение'),d=R.ensureDirecting(p);
  const actor={character:'Леонид',objective:'Получить подтверждение успеха',subtext:'Ждёт похвалы, но понимает, что результат под угрозой',emotionStart:'Азартная уверенность',emotionEnd:'Сдержанная тревога',visibleAction:'Вначале взгляд открытый, плечи расправлены. Увидев тревожную строку на приборе, задерживает взгляд; брови сходятся, сомкнутые губы напрягаются, дыхание на миг замирает. Рот закрыт.'};
  const makeShot=(id)=>({id,title:id,duration:5,cast:['Леонид'],story:'Читает сообщение и понимает опасность.',stateIn:'Ждёт подтверждения',stateOut:'Осознал риск',cinematography:'Крупный план лица',productionDesign:'Мастерская',dialogue:{speechType:'none',speaker:'',text:'',delivery:''},continuityChanges:'',direction:{framingStart:'close-up',framingEnd:'close-up',cameraMovement:{type:'static',description:'Статичная камера'},performance:[structuredClone(actor)]}});
  const previous=makeShot('previous'),target=makeShot('target'),next=makeShot('next'),boundary=makeShot('boundary');
  previous.direction.performance[0].visibleAction='Предыдущее действие. '.repeat(100);
  target.direction.performance[0].subtext='Актуальный подтекст. '.repeat(100);
  const scene={id:'scene',title:'Сообщение',purpose:'Осознание',location:'Мастерская',conflict:'Ожидание против результата',turn:'Уверенность сменяется тревогой',stateIn:'Ждёт',stateOut:'Решает действовать',continuity:[],shots:[previous,target,next]};
  d.scenes=[scene,{...structuredClone(scene),id:'following',shots:[boundary]}];
  const run={id:'run',created:D.now(),basis:R.directorBasis(p),model:'grok-4.6',mode:'role',tasks:[],sceneIds:[scene.id]};
  const task=role=>({id:role,role,sceneId:scene.id,shotIds:[target.id],requires:[]});
  const before=structuredClone(p);
  for(const role of ['performance','compress']){
    const prompt=R.directorPrompt(p,run,task(role)),context=JSON.parse(prompt.split('\nДанные:\n')[1]);
    assert.deepEqual(context.requestedShotIds,[target.id]);
    assert.deepEqual(context.scene.shots.map(s=>s.id),[target.id]);
    assert.deepEqual(context.scene.shots[0].direction.performance,target.direction.performance,'Requested acting is not truncated');
    assert.equal(context.contextOnlyNeighbours[0].performance[0].emotionEnd,actor.emotionEnd);
    assert.equal(context.contextOnlyNeighbours[0].performance[0].objective,actor.objective);
    assert(context.contextOnlyNeighbours[0].performance[0].visibleAction.length<650,'Only neighbouring context is compacted');
    assert.match(context.contextOnlyNeighbours[0].performance[0].visibleAction,/контекст сокращён/);
    assert.equal(context.sceneBoundaryNeighbours[0].id,boundary.id);
    assert.equal(context.sceneBoundaryNeighbours[0].performance[0].subtext,actor.subtext);
    assert.match(prompt,/contextOnlyNeighbours/);
  }
  const actorPrompt=R.directorPrompt(p,run,task('performance'));
  for(const contract of ['цель → событие или наблюдение → осознание → эмоциональный поворот → видимая реакция','2–4 предложения','герой не знает результата раньше','сдержанность уменьшает амплитуду, но не отменяет эмоциональный поворот','не выдумывай новый конфликт','рты закрыты у всех'])assert(actorPrompt.includes(contract),contract);
  assert.match(actorPrompt,/не превращай objective\/subtext в реплики, закадровый голос, надписи/);
  const compressPrompt=R.directorPrompt(p,run,task('compress'));
  assert.match(compressPrompt,/сохрани objective, subtext, emotionStart → emotionEnd/);
  assert.match(compressPrompt,/Сокращай повторы, а не эмоциональную дугу/);
  assert.match(compressPrompt,/Для imagePrompt передай только соответствующее началу видимое состояние/);
  for(const role of ['editor','scene-expressive-reviewer']){
    const prompt=R.directorPrompt(p,run,task(role));
    assert.match(prompt,/Проверь актёрскую дугу/);
    assert.match(prompt,/сохраняй остальные неизменённые поля, включая performance/);
    assert.match(prompt,/Если эмоционального поворота по сюжету нет, не навязывай его/);
  }
  assert.match(R.directorPrompt(p,run,task('story')),/В direction возвращай ТОЛЬКО narrativeBeat/);
  assert.match(R.directorPrompt(p,run,task('story')),/камера и актёрская задача сохраняются программой/);
  const cameraContext=JSON.parse(R.directorPrompt(p,run,task('camera')).split('\nДанные:\n')[1]);
  assert(!Object.hasOwn(cameraContext.contextOnlyNeighbours[0],'performance'),'Other specialists do not acquire unnecessary neighbour acting dossiers');
  assert.deepEqual(p,before,'Preparing specialist prompts is read-only');

  const updated=P.specialistUpdates(scene,'performance',{shots:[{id:target.id,performance:[actor]}]},target.id)[0];
  assert.deepEqual(updated.direction.performance,[actor]);
  assert.deepEqual(updated.direction.cameraMovement,target.direction.cameraMovement);
  const updatedScene={...scene,shots:[updated]};
  const camera=P.specialistUpdates(updatedScene,'camera',{shots:[{id:target.id,cinematography:'Короткий наезд к реакции',direction:{cameraMovement:{type:'push-in',description:'Медленно к лицу'},performance:[{...actor,subtext:'Неавторизованная подмена'}]}}]},target.id)[0];
  assert.deepEqual(camera.direction.performance,[actor],'Parallel camera updates cannot erase the interior arc');
  for(const [role,fields] of [['art',{productionDesign:'Мягкий свет мастерской'}],['dialogue',{dialogue:{speechType:'none',speaker:'',text:'',delivery:''}}]]){
    assert.deepEqual(P.specialistUpdates(updatedScene,role,{shots:[{id:target.id,...fields}]},target.id)[0].direction.performance,[actor]);
  }
  console.log('PASS actor arc instructions, complete target acting, bounded neighbouring emotional continuity, editor/story/compressor contracts, concurrent specialist field ownership. No API calls.');
}finally{globalThis.fetch=originalFetch;}
