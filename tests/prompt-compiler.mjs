import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('work/tests', { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), contents: `export * as T from './lib/prompt-text';export * as K from './lib/keyframes';export * as S from './lib/storyboard';export * as C from './lib/prompt-compiler';export * as D from './lib/domain';export * as J from './lib/prompt-jobs';export * as A from './lib/prompt-assets';export * as B from './lib/character-bindings';export * as P from './lib/plan-references';export {MODELS} from './lib/models';` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/prompt-compiler.mjs', external: ['@ffmpeg/ffmpeg'] });
let providerCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = () => { providerCalls++; throw Error('Compiler tests must never call providers'); };
try {
  const { T, K, S, C, D, J, A, B, P, MODELS } = await import('../work/tests/prompt-compiler.mjs');
  const visual=T.frameStyleText('# Стиль\n\n**Техника:** 2D акварель\n\n### Палитра и свет\n\nПарадный двор: золотой свет.\n\nТихий лес: синий свет.\n\n### Персонажи и предметы\n\nВ финале герой находит корону.\n\n### Художественное решение\n\nТонкий контур.', ['Парадный двор'], ['Тихий лес']);
  assert(visual.includes('2D акварель') && visual.includes('золотой свет') && visual.includes('Тонкий контур'));
  assert(!visual.includes('синий свет') && !visual.includes('корону'));
  assert.equal(T.frameStyleText('Рисованная анимация без надписей.',[],[]),'Рисованная анимация без надписей.');
  const p = D.newProject('Компилятор только текущего плана');
  const card = (stage, title, id = D.id()) => { const item = { id, stage, title, variants: [] }; p.items.push(item); return item; };
  const approve = (item, data) => { const v = D.makeVariant(p, item, data); item.variants.push(v); item.selectedId = item.approvedId = v.id; return v; };
  const profile = name => ({ name, appearance: `${name}: узкое лицо, зелёные глаза`, description: 'Решительный и внимательный', instructions: 'Сохранять узнаваемость', refs: [D.id()] });
  const anna = card(1, 'Анна'), annaLongName = card(1, 'Анна Мария'), boris = card(1, 'Борис');
  for (const hero of [anna, annaLongName, boris]) { hero.character = profile(hero.title); approve(hero, { kind: 'image', assetId: D.id(), character: hero.character, text: hero.title }); }
  const yard = card(3, 'Двор'), wood = card(3, 'Лес'), style = p.items.find(i => i.stage === 2);
  const location = name => ({ name, identity: `${name}: неизменная каменная арка`, geography: 'Арка слева, выход справа', permanentProps: 'Латунный фонарь слева', refs: [D.id()], approvedAngles: [] });
  yard.location = location('Двор'); wood.location = location('Лес');
  approve(yard, { kind: 'image', assetId: D.id(), text: 'Тёплый двор', location: yard.location });
  approve(wood, { kind: 'image', assetId: D.id(), text: 'Синий лес', location: wood.location });
  approve(style, { text: 'Живописная книжная анимация. Медовый свет.\n\nАкварельные фактуры.', kind: 'text' });
  const source = p.items.find(i => i.stage === 4);
  const current = { id: 'shot-2', sceneId: 'scene', title: 'План 02 — Письмо', duration: 5, cast: ['Анна'], characterIds: [anna.id], locationIds: [yard.id],
    description: 'Анна получает письмо и смотрит на арку', stateIn: 'Анна у фонаря, письмо на столе', stateOut: 'Анна держит письмо в правой руке',
    productionDesign: 'Медовый свет, акварельные тени', camera: 'Плавный наезд', dialogue: 'Я вернусь.', speechType: 'voiceover', speaker: 'Рассказчик',
    continuityChanges: 'Письмо перенесено в правую руку', sceneContinuity: [
      { character: 'Анна', characterId: anna.id, outfit: 'Синий плащ', props: 'Красная сумка в левой руке' },
      { character: 'Борис', characterId: boris.id, outfit: 'Алый плащ', props: 'Серебряный меч' },
    ], previousChanges: [{ id: 'shot-1', changes: 'Фонарь уже зажжён и остаётся слева' }],
    direction: { framingStart: 'wide', framingEnd: 'close-up', composition: 'Анна справа, фонарь слева', attention: { start: 'Письмо на столе', end: 'Глаза Анны' },
      cameraMovement: { type: 'push-in', description: 'К реакции героя', from: 'Общий двор', to: 'Лицо Анны' },
      positions: [{ subject: 'Анна', subjectId: anna.id, start: 'Справа у стола', end: 'Справа, письмо в руке' }],
      actionBeats: [{ start: 0, end: 2, action: 'Берёт письмо' }, { start: 2, end: 4, action: 'Смотрит к арке' }],
      startFrame: 'Стол с письмом; руки Анны ещё пусты', endFrame: 'Крупный план лица; письмо в правой руке' },
  };
  const previous = { ...current, id: 'shot-1', title: 'План 01 — Борис', cast: ['Борис'], characterIds: [boris.id], locationIds: [wood.id], stateOut: 'Борис вышел в лес' };
  const next = { ...current, id: 'shot-3', title: 'План 03 — Анна Мария', cast: ['Анна Мария'], characterIds: [annaLongName.id], stateIn: 'Анна Мария ждёт у ворот' };
  approve(source, { text: JSON.stringify({ timingMode: 'actual', shots: [previous, current, next] }), kind: 'text' });
  const frame = card(5, current.title), otherFrame = card(5, previous.title), video = card(7, current.title);
  for (const target of [frame, video]) target.sourceShot = { scriptId: source.id, shotId: current.id, sceneId: current.sceneId, title: current.title };
  otherFrame.sourceShot = { scriptId: source.id, shotId: previous.id, title: previous.title };
  const first = approve(frame, { kind: 'image', assetId: D.id(), text: 'Первый кадр' }).assetId;
  const end = approve(frame, { kind: 'image', assetId: D.id(), text: 'Конечный кадр' }).assetId;
  frame.approvedId = frame.variants[0].id;
  const unrelatedFrame = approve(otherFrame, { kind: 'image', assetId: D.id(), text: 'Другой план' }).assetId;
  const ids = { anna: anna.variants[0].assetId, boris: boris.variants[0].assetId, long: annaLongName.variants[0].assetId, yard: yard.variants[0].assetId, wood: wood.variants[0].assetId };
  const before = JSON.stringify(p);
  const base = { kind: 'image', prompt: 'Создай выразительный кадр.', references: [ids.boris, ids.wood, unrelatedFrame, ids.long, ids.yard, ids.anna, ids.anna] };
  const result = C.compilePrompt(p, frame, 'grok-imagine-image-2.0', base);
  assert.deepEqual(result.references.map(r => [r.assetId, r.role]), [[ids.anna, 'character'], [ids.yard, 'location']]);
  assert(result.compression.omitted.some(r => r.assetId === ids.boris && r.reason === 'irrelevant'));
  assert(result.compression.omitted.some(r => r.assetId === ids.long && r.reason === 'irrelevant'));
  assert(result.criticalText.includes('Синий плащ') && result.criticalText.includes('Красная сумка в левой руке'));
  assert(result.criticalText.includes('Постоянная идентичность Анна') && result.criticalText.includes('Фонарь уже зажжён'));
  assert(result.criticalText.includes('Узнаваемость лица — обязательное условие'));
  assert(result.criticalText.includes('посадку и расстояние между глазами'));
  assert(result.criticalText.includes('Утверждённый образ героя Анна — основной образец его лица'));
  assert(!result.warnings.some(w=>w.includes('Не прикреплён утверждённый образ')));
  const sourcePhoto=anna.character.refs[0];
  const faceOrder=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{...base,references:[sourcePhoto,ids.yard,ids.anna]});
  assert.deepEqual(faceOrder.references.map(r=>r.assetId),[ids.anna,sourcePhoto,ids.yard]);
  assert(faceOrder.criticalText.includes('Изображение 1: Утверждённый образ героя Анна'));
  assert(faceOrder.criticalText.includes('Изображение 2: Исходный прообраз героя Анна'));
  const noFace=C.compilePrompt(p,frame,'gpt-image-2.5-sunburst',{...base,references:[sourcePhoto,ids.yard]});
  assert(noFace.warnings.some(w=>w.includes('Не прикреплён утверждённый образ героя «Анна»')));
  assert(!noFace.references.some(r=>r.assetId===ids.anna),'An explicitly unchecked face reference is not reattached');
  {
    const aliasFilm=structuredClone(p),aliasSource=aliasFilm.items.find(i=>i.id===source.id),aliasData=JSON.parse(aliasSource.variants.find(v=>v.id===aliasSource.approvedId).text);
    aliasData.shots.forEach(shot=>{shot.continuity??='';});
    aliasData.shots.find(shot=>shot.id===current.id).cast=['Младшая Анна'];aliasData.shots.find(shot=>shot.id===current.id).characterIds=[];
    aliasSource.variants.find(v=>v.id===aliasSource.approvedId).text=JSON.stringify(aliasData);
    for(const item of aliasFilm.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
      if(!item.approvedId){const v=D.makeVariant(aliasFilm,item,{text:'Основа'});item.variants.push(v);item.selectedId=item.approvedId=v.id;}
      item.variants.find(v=>v.id===item.approvedId).deps=D.dependencies(aliasFilm,item.stage);
    }
    const aliasFrame=aliasFilm.items.find(i=>i.id===frame.id);
    assert.deepEqual(P.planCharacterIds(aliasFilm,aliasFrame),[],'Similar names are never guessed');
    B.setCharacterBinding(aliasFilm,'Младшая Анна',anna.id);
    assert.deepEqual(P.planCharacterIds(aliasFilm,aliasFrame),[anna.id]);
    const aliasPrompt=C.compilePrompt(aliasFilm,aliasFrame,'gpt-image-2.5-sunburst',{...base,references:P.planReferenceIds(aliasFilm,aliasFrame)});
    assert(aliasPrompt.criticalText.includes('Младшая Анна — это Анна'));
    assert(aliasPrompt.references.some(ref=>ref.assetId===ids.anna&&ref.role==='character'));
    assert(!aliasPrompt.references.some(ref=>ref.assetId===ids.boris));
    assert.throws(()=>B.setCharacterBinding(aliasFilm,'Несуществующее имя',anna.id));
    assert.throws(()=>B.setCharacterBinding(aliasFilm,'Младшая Анна',D.id()));
    assert.throws(()=>B.setCharacterBinding(aliasFilm,'Борис',anna.id),'Nonempty explicit cast IDs cannot be overridden');
    assert.equal(D.newProject('Другой фильм').characterBindings,undefined);
    B.setCharacterBinding(aliasFilm,'Младшая Анна',null);assert.deepEqual(P.planCharacterIds(aliasFilm,aliasFrame),[]);
  }
  {
    const changed=structuredClone(p),changedHero=changed.items.find(i=>i.id===anna.id),pending=D.makeVariant(changed,changedHero,{kind:'image',assetId:D.id(),text:'Новый образ',character:changedHero.character});changedHero.variants.push(pending);changedHero.selectedId=pending.id;
    const pendingFace=C.compilePrompt(changed,changed.items.find(i=>i.id===frame.id),'gpt-image-2.5-sunburst',base);
    assert(pendingFace.warnings.some(w=>w.includes('ещё не утверждённый вариант')));
    assert(pendingFace.references.some(r=>r.assetId===ids.anna),'Selection does not replace an approved identity');
  }
  assert(!result.criticalText.includes('Алый плащ') && !result.criticalText.includes('Серебряный меч'));
  assert(result.prompt.includes('рты всех персонажей закрыты'));
  assert(!result.prompt.includes('Только для стыковки — выход предыдущего плана'));
  assert(!result.criticalText.includes('Борис вышел в лес'));
  assert.equal(result.budget.compiledCharacters, result.prompt.length);
  assert(result.prompt.length <= result.budget.limit);
  assert.deepEqual(C.compilePrompt(p, frame, 'grok-imagine-image-2.0', base), result, 'Compilation is deterministic');
  const job = {id:D.id(),batchId:D.id(),itemId:frame.id,model:'grok-imagine-image-2.0',kind:'image',refs:base.references,
    brief:base.prompt,prompt:'Старый конструктор не должен попасть в новый запрос',imageSettings:{quality:'medium',resolution:'2k'},
    duration:5,camera:'',continuity:'',dialogue:'',voiceId:'',offset:0,volume:1,deps:'',created:D.now(),status:'queued',estimate:'1',actual:null};
  const compiledJob = J.compileMediaJob(p,job);
  assert.equal(compiledJob.prompt,result.prompt,'API helper and pure preview share the same exact compilation');
  assert.deepEqual(compiledJob.refs,[ids.anna,ids.yard]);
  assert.equal(compiledJob.estimate,'1000000000','Grok reserves only the two relevant reference inputs');
  assert.equal(compiledJob.compilation.budget.compiledCharacters,compiledJob.prompt.length);
  assert.deepEqual(compiledJob.compilation.references,result.references);
  const cardEdit=structuredClone(p),editedCard=cardEdit.items.find(i=>i.id===frame.id),selected=editedCard.variants.find(v=>v.id===editedCard.selectedId);
  const editedScript=cardEdit.items.find(i=>i.id===source.id).variants.find(v=>v.id===source.approvedId),editedShots=JSON.parse(editedScript.text);for(const shot of editedShots.shots)delete shot.direction;editedScript.text=JSON.stringify(editedShots);
  selected.kind='text';selected.text='Авторский момент: Анна придерживает письмо ладонью.';selected.camera='Ручной крупный план';selected.continuity='Письмо остаётся справа';delete selected.planDraft;
  const edited=C.compilePrompt(cardEdit,editedCard,'grok-imagine-image-2.0',{...base,plan:undefined});
  assert(edited.criticalText.includes('Ручной крупный план'),'Current manual card camera edits are mandatory');
  assert(edited.prompt.includes(selected.text),'Current manual action is preserved');
  assert(result.criticalText.includes('Сохранять узнаваемость'),'Approved identity instructions are mandatory in every plan');
  assert.equal(job.prompt,'Старый конструктор не должен попасть в новый запрос','The input job is immutable');
  const lookedUp=[];
  await A.validateCompiledMediaAssets(compiledJob,async id=>{lookedUp.push(id);return {mime:'image/png',size:1000}});
  assert.deepEqual(lookedUp,[ids.anna,ids.yard],'Read only the relevant compiled refs');
  await assert.rejects(()=>A.validateCompiledMediaAssets({...compiledJob,model:'gpt-image-2.5-sunburst'},async()=>({mime:'image/png',size:11*1024*1024})),/до 10 МБ/);
  const compiledVideoJob = J.compileMediaJob(p,{...job,itemId:video.id,kind:'video',model:'grok-imagine-video-1.5',refs:[first],characterRefs:[ids.anna,ids.boris]});
  assert.deepEqual(compiledVideoJob.refs,[first]);
  assert.deepEqual(compiledVideoJob.characterRefs,[ids.anna]);
  assert.equal(compiledVideoJob.estimate,'1','Separate video estimates are not image price calculations');
  const actorProject = structuredClone(p), actorItem = actorProject.items.find(i=>i.id===anna.id);
  actorItem.character = {...actorItem.character,actorProfile:{identity:'Поменять лицо — этот новый текст не должен заменить утверждённую картинку',role:'Главный герой',motivation:'Защитить письмо',contradiction:'Боится довериться',mannerisms:'Прячет дрожь в руках',traits:[{name:'Сдержанность',intensity:8,instruction:'Сначала взгляд, затем короткий жест'}]}};
  const actorCompiled = C.compilePrompt(actorProject,actorProject.items.find(i=>i.id===video.id),'grok-imagine-video-1.5',{kind:'video',prompt:'',startFrameId:first,references:[ids.anna]});
  assert(!actorCompiled.prompt.includes('Защитить письмо') && !actorCompiled.prompt.includes('Сдержанность · 8/10') && !actorCompiled.prompt.includes('Прячет дрожь в руках'),'The full actor biography is not a new action in this video shot');
  assert(!actorCompiled.prompt.includes('Поменять лицо'),'Current actor direction must not replace approved physical identity');
  assert(actorCompiled.criticalText.includes(anna.variants[0].character.appearance));
  assert.deepEqual(actorCompiled.references.map(r=>r.assetId),[first,ids.anna]);

  const finalImage = C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, keyframe: 'end', startFrameId: first, references: [ids.anna] });
  assert.equal(finalImage.references[0].role, 'first-frame');
  assert(finalImage.criticalText.includes(current.stateOut) && finalImage.criticalText.includes(current.direction.endFrame));
  assert(!finalImage.criticalText.includes(current.direction.startFrame));
  // End frames must not inherit the prepared start prompt or global story arc.
  {
    const film=structuredClone(p),card=film.items.find(i=>i.id===frame.id),script=film.items.find(i=>i.id===source.id);
    const sourceVariant=script.variants.find(v=>v.id===script.approvedId),data=JSON.parse(sourceVariant.text),shot=data.shots.find(s=>s.id===current.id);
    data.shots.forEach(s=>s.continuity??='');
    shot.imagePrompt='НАЧАЛЬНЫЙ_ПРОМПТ: Анна ещё не взяла письмо, руки пусты.';
    shot.direction.performance=[{character:'Анна',objective:'Прочитать',subtext:'Сомнение',visibleAction:'ПОСЛЕДОВАТЕЛЬНОСТЬ: берёт письмо и оборачивается',emotionStart:'Ожидание',emotionEnd:'Решимость'}];
    sourceVariant.text=JSON.stringify(data);
    const hero=film.items.find(i=>i.id===anna.id);hero.variants[0].character.description='БИОГРАФИЯ: позднее Анна встречает королеву';
    const styleCard=film.items.find(i=>i.id===style.id);styleCard.variants.find(v=>v.id===styleCard.approvedId).text+='\n\nФИНАЛ_ФИЛЬМА: другой дворец';
    for(const i of film.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
      if(!i.approvedId){const v=D.makeVariant(film,i,{text:'Основа'});i.variants.push(v);i.selectedId=i.approvedId=v.id;}
      i.variants.find(v=>v.id===i.approvedId).deps=D.dependencies(film,i.stage);
    }
    const oldTask=S.storyboardPrompt(film,card),guidance=K.keyframeRoleInstruction(film,card,'end');
    assert(oldTask.includes('НАЧАЛЬНЫЙ_ПРОМПТ'));
    const args={kind:'image',keyframe:'end',keyframeInstruction:guidance,startFrameId:first,references:[ids.anna,ids.yard,first]};
    const oldClient=C.compilePrompt(film,card,'gpt-image-2.5-flare',{...args,prompt:oldTask});
    const preview=C.compilePrompt(film,card,'gpt-image-2.5-flare',{...args,prompt:guidance});
    for(const compiled of [oldClient,preview]){
      for(const marker of ['НАЧАЛЬНЫЙ_ПРОМПТ','БИОГРАФИЯ','ФИНАЛ_ФИЛЬМА','ПОСЛЕДОВАТЕЛЬНОСТЬ',shot.stateIn,shot.direction.startFrame,'Борис вышел в лес','Анна Мария ждёт у ворот'])assert(!compiled.prompt.includes(marker),marker);
      assert(compiled.prompt.includes(shot.stateOut));assert(compiled.prompt.includes(shot.direction.endFrame));
      assert(compiled.prompt.includes('Решимость'));assert(compiled.prompt.includes('Изображение 1: Выбранный первый кадр'));
      assert.equal(compiled.prompt.split(shot.stateOut).length,2,'The role default does not duplicate the state');
      assert.equal(compiled.references[0].assetId,first);
    }
    const api=J.compileMediaJob(film,{...job,model:'gpt-image-2.5-flare',brief:guidance,refs:args.references,sourceFrameVariantId:card.variants[0].id},{keyframe:'end',keyframeInstruction:guidance});
    assert.equal(api.prompt,preview.prompt,'Single/bulk preview and job admission pin the same image and moment');
    assert.deepEqual(api.refs,preview.references.map(r=>r.assetId));
    const start=C.compilePrompt(film,card,'gpt-image-2.5-flare',{kind:'image',prompt:oldTask,references:[ids.anna,ids.yard]});
    assert(start.prompt.includes('НАЧАЛЬНЫЙ_ПРОМПТ') && start.prompt.includes(shot.stateIn));
    const manual=C.compilePrompt(film,card,'gpt-image-2.5-flare',{...args,prompt:'РУЧНАЯ ПРАВКА: письмо ближе к груди.'});
    assert(manual.criticalText.includes('РУЧНАЯ ПРАВКА: письмо ближе к груди.'));
    film.hiddenReferenceIds=[first];
    assert.throws(()=>C.compilePrompt(film,card,'gpt-image-2.5-flare',{...args,prompt:guidance}),e=>e.code==='first_frame');
    // A cyclic action is allowed to finish where it began; no invented difference.
    delete film.hiddenReferenceIds;shot.stateOut=shot.stateIn;shot.direction.endFrame=shot.direction.startFrame;
    sourceVariant.text=JSON.stringify(data);
    const cyclic=C.compilePrompt(film,card,'gpt-image-2.5-flare',{...args,prompt:'Сохранить итоговое состояние.'});
    assert(cyclic.prompt.includes('не придумывай отличий'));
  }
  const middleImage=C.compilePrompt(p,frame,'grok-imagine-image-2.0',{...base,keyframe:'middle',startFrameId:first,keyframeInstruction:'Письмо уже поднято над столом, рука ещё не у груди.'});
  assert(middleImage.criticalText.includes('Один промежуточный момент') && middleImage.criticalText.includes('Письмо уже поднято'));
  assert(!middleImage.criticalText.includes('Самое начало текущего плана') && !middleImage.criticalText.includes('Начальный ключевой кадр'));
  assert(middleImage.criticalText.includes('Промежуточная на пути') && middleImage.criticalText.includes('Одна промежуточная поза'));
  const movie = C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: 'Сохраняй рисунок.', startFrameId: first, endFrameId: end, references: [ids.anna, ids.yard] });
  assert.deepEqual(movie.references.map(r => [r.assetId, r.role]), [[first, 'first-frame'], [end, 'last-frame']]);
  assert(!movie.warnings.some(w => w.includes('не передаёт конечный кадр')));
  assert(!movie.compression.omitted.some(r => r.assetId === end && r.reason === 'unsupported'));
  assert(movie.criticalText.includes(current.stateOut) && movie.criticalText.includes(current.direction.endFrame));
  assert(movie.criticalText.includes('Куда: Лицо Анны') && movie.criticalText.includes('0–2 сек'));
  assert(movie.prompt.includes('Все персонажи держат рты закрытыми весь план'));
  const grokMovie = C.compilePrompt(p, video, 'grok-imagine-video-1.5', { kind: 'video', prompt: 'Сохраняй рисунок.', references: [{ assetId: first, role: 'first-frame' }, ids.anna, ids.boris] });
  assert.deepEqual(grokMovie.references.map(r => r.assetId), [first, ids.anna]);
  const explicitAlternate = C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: 'Движение.', references: [end] });
  assert.equal(explicitAlternate.references[0].assetId, end, 'An explicitly chosen current-plan frame wins over automatic approval');
  const withSpeech = C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: '', startFrameId: first, plan: { ...current, speechType: 'character', speaker: 'Анна' } });
  assert(withSpeech.criticalText.includes('Только этот герой артикулирует речь'));
  assert(withSpeech.criticalText.includes('улыбка с закрытым ртом'));
  assert(withSpeech.criticalText.includes('У всех остальных персонажей рты закрыты'));
  assert(withSpeech.criticalText.includes('Я вернусь.'));
  assert.throws(() => C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: '', startFrameId: first, plan: { ...current, speechType: 'character', speaker: 'Борис' } }), e => e.code === 'speaker');
  assert.throws(() => C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: '', startFrameId: unrelatedFrame }), e => e.code === 'first_frame');
  assert.throws(() => C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: '', duration: 7, startFrameId: first }), e => e.code === 'duration_fit');
  assert.throws(() => C.compilePrompt(p, video, 'MiniMax-H3', { kind: 'video', prompt: '', duration: 1, startFrameId: first }), e => e.code === 'direction_timing');
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, plan: { ...current, characterIds: ['foreign-hero'] } }), e => e.code === 'missing_hero');
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, plan: { ...current, cast: ['Борис'] } }), e => e.code === 'cast_conflict');
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, references: ['data:image/png;base64,aGVsbG8='] }), e => e.code === 'reference_id');
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, references: [{ assetId: ids.anna, role: 'wrong' }] }), e => e.code === 'reference_id');
  assert.throws(() => C.compilePrompt(p, frame, 'image-01', base), e => e.code === 'short_model');
  assert(C.promptModelCapability('image-01'), 'Historical model IDs remain valid registry entries');
  const legacyCard = card(3, 'Статичный эскиз');
  assert(C.compilePrompt(p, legacyCard, 'image-01', { kind: 'image', prompt: 'Небольшой пустой сад', references: [], allowLegacyModel: true }).prompt.length <= 1500);
  assert.throws(() => C.compilePrompt(p, frame, 'fal-qwen-image-edit-2511', { ...base, references: [] }), e => e.code === 'references_required');
  assert.throws(() => C.compilePrompt(p, frame, 'MiniMax-H3', base), e => e.code === 'model_kind');

  const smallLimit = result.criticalText.length + 280;
  const paragraphA = 'НЕОБЯЗАТЕЛЬНЫЙ ПАРАГРАФ А. '.repeat(30), paragraphB = 'НЕОБЯЗАТЕЛЬНЫЙ ПАРАГРАФ Б. '.repeat(30);
  const compressed = C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, prompt: paragraphA + '\n\n' + paragraphB, instruction:'Сохранить письмо на столе.', providerPromptLimit: smallLimit, allowLegacyModel: true });
  for(const extra of [{},{keyframeInstruction:'Создай первый кадр.'}]) {
    const manual=C.compilePrompt(p,frame,'grok-imagine-image-2.0',{...base,prompt:'РУЧНАЯ ПРАВКА '.repeat(1000),providerPromptLimit:5000,...extra});
    assert(manual.budget.needsOptimization);assert(manual.prompt.includes('РУЧНАЯ ПРАВКА '.repeat(1000).trim()),'Preserve raw director text for LLM, never silently cut');
  }
  assert(compressed.budget.needsOptimization);
  assert(compressed.criticalText.includes('Синий плащ') && compressed.criticalText.includes('Красная сумка в левой руке'));
  assert(compressed.prompt.includes(paragraphA.trim())&&compressed.prompt.includes(paragraphB.trim()));
  assert(!compressed.prompt.includes('…'));
  const larger = C.compilePrompt(p, frame, 'gpt-image-2.5-flare', { ...base, instruction: 'ОБЯЗАТЕЛЬНАЯ ФРАЗА '.repeat(1000) });
  assert(larger.criticalText.includes('ОБЯЗАТЕЛЬНАЯ ФРАЗА '.repeat(1000).trim()));
  assert.equal(larger.budget.limit, 32000);
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, providerPromptLimit: 0 }), e => e.code === 'provider_limit');
  assert.equal(C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, providerPromptLimit: 100000 }).budget.limit, 60000);

  // Current target drafts are used for hero generation without stealing profiles from other cards.
  const changed = structuredClone(p); const changedHero = changed.items.find(i => i.id === anna.id);
  changedHero.character.appearance = 'НОВЫЙ ДРАФТ ВНЕШНОСТИ';
  const heroDraft = C.compilePrompt(changed, changedHero, 'grok-imagine-image-2.0', { kind: 'image', prompt: 'Образ Анны', references: [anna.character.refs[0], ids.boris] });
  assert(heroDraft.criticalText.includes('НОВЫЙ ДРАФТ ВНЕШНОСТИ') && !heroDraft.criticalText.includes('Постоянная идентичность Борис'));
  assert.deepEqual(heroDraft.references.map(r => r.assetId), [anna.character.refs[0]]);
  const hidden = structuredClone(p); hidden.hiddenReferenceIds = [ids.anna, first];
  const withoutHidden = C.compilePrompt(hidden, hidden.items.find(i => i.id === frame.id), 'grok-imagine-image-2.0', base);
  assert(!withoutHidden.references.some(r => r.assetId === ids.anna));
  assert(withoutHidden.compression.omitted.some(r => r.reason === 'hidden'));
  assert.throws(() => C.compilePrompt(hidden, hidden.items.find(i => i.id === video.id), 'MiniMax-H3', { kind: 'video', prompt: '', startFrameId: first }), e => e.code === 'first_frame');
  const noOne = C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, plan: { ...current, cast: [], characterIds: [], locationIds: [], sceneContinuity: [] } });
  assert(noOne.criticalText.includes('Персонажей нет') && !noOne.references.some(r => r.role === 'character'));
  for (const m of MODELS.filter(m => m.kind === 'image' || m.kind === 'video')) assert(C.promptModelCapability(m.id).promptLimit > 0);
  assert.equal(C.promptModelCapability('grok-imagine-video-1.5').upstream.lastFrame, true);
  assert.equal(C.promptModelCapability('grok-imagine-video-1.5').adapter.lastFrame, true);
  assert.equal(C.promptModelCapability('MiniMax-H3').promptLimit, 7000);
  assert.equal(C.promptModelCapability('MiniMax-Hailuo-2.3').newDirecting, false);
  const hd=C.compilePrompt(p,video,'grok-imagine-video-1.5-1080p',{kind:'video',prompt:'Движение',startFrameId:first,endFrameId:end,references:[{assetId:ids.anna,role:'character'},{assetId:end,role:'last-frame'}]});
  assert.deepEqual(hd.references.map(r=>r.assetId),[first]);assert(hd.warnings.some(w=>w.includes('только первый')));
  const kling=C.compilePrompt(p,video,'fal-kling-3.0-pro',{kind:'video',prompt:'Движение',startFrameId:first,endFrameId:end});
  assert.deepEqual(kling.references.map(r=>r.assetId),[first,end]);assert.equal(kling.budget.limit,2500);assert.equal(kling.capability.newDirecting,true);
  {
    const film=structuredClone(p),target=film.items.find(i=>i.id===video.id),sourceCard=film.items.find(i=>i.id===source.id);
    const text=sourceCard.variants.find(v=>v.id===sourceCard.approvedId),data=JSON.parse(text.text),shot=data.shots.find(s=>s.id===current.id);
    shot.previousChanges=Array.from({length:35},(_,n)=>({id:`old-${n}`,changes:'СТАРОЕ СОСТОЯНИЕ: герой уже вернулся во дворец. '.repeat(3)}));
    shot.sceneContinuity=[{character:'Анна',characterId:anna.id,outfit:'СТАРАЯ одежда сцены',props:'СТАРЫЙ владелец письма'}];
    shot.continuity='УСТАРЕВШИЙ МОНТАЖ: после клипа вернуться в лес';
    shot.direction.transition={type:'cut',description:'СКЛЕЙКА В ДРУГУЮ ЛОКАЦИЮ: перейти в лес'};
    text.text=JSON.stringify(data);
    const styleCard=film.items.find(i=>i.id===style.id);styleCard.variants.find(v=>v.id===styleCard.approvedId).text+='\n\n### Сюжет\n\nДАЛЬНИЙ ФИНАЛ: герой во дворце\n\n### Свет\n\nЛес: посторонняя голубая сцена.\n\nДвор: золотистый свет.';
    const hero=film.items.find(i=>i.id===anna.id),physical=hero.variants.find(v=>v.id===hero.approvedId).character;
    physical.locked='РОДИНКА слева. '.repeat(25);physical.appearance+='. РОДИНКА слева.';
    const compiled=C.compilePrompt(film,target,'fal-minimax-h3-max',{kind:'video',prompt:'',startFrameId:first,endFrameId:end,references:[ids.anna]});
    for(const unrelated of ['СТАРОЕ СОСТОЯНИЕ','СТАРАЯ одежда','СТАРЫЙ владелец','УСТАРЕВШИЙ МОНТАЖ','СКЛЕЙКА В ДРУГУЮ','ДАЛЬНИЙ ФИНАЛ','посторонняя голубая сцена','Борис вышел в лес','Анна Мария ждёт у ворот'])assert(!compiled.prompt.includes(unrelated),unrelated);
    for(const required of [shot.description,shot.stateIn,shot.stateOut,shot.direction.startFrame,shot.direction.endFrame,'РОДИНКА слева','золотистый свет','Правило речи и рта'])assert(compiled.prompt.includes(required),required);
    assert.equal(compiled.prompt.split('РОДИНКА слева').length,2,'Repeated identity locks are transmitted once');
    assert(compiled.compression.omitted.some(s=>s.key==='prior.old-0'));
    assert(compiled.budget.originalCharacters>compiled.budget.compiledCharacters);
    const manual=C.compilePrompt(film,target,'fal-minimax-h3-max',{kind:'video',prompt:'РУЧНОЕ РЕШЕНИЕ: скрыть письмо до последней секунды.',startFrameId:first});
    assert(manual.criticalText.includes('РУЧНОЕ РЕШЕНИЕ: скрыть письмо до последней секунды.'));
    const legacy=C.compilePrompt(film,target,'fal-minimax-h3-max',{kind:'video',prompt:'',startFrameId:first,plan:{...shot,stateIn:undefined}});
    assert(legacy.prompt.includes('СТАРОЕ СОСТОЯНИЕ'),'Legacy shots without an explicit current state retain the continuity needed to resolve props');
    const secondHero=film.items.find(i=>i.id===boris.id);secondHero.variants.find(v=>v.id===secondHero.approvedId).character.appearance=physical.appearance;
    const twoHeroes=C.compilePrompt(film,target,'fal-minimax-h3-max',{kind:'video',prompt:'',startFrameId:first,plan:{...shot,cast:['Анна','Борис'],characterIds:[anna.id,boris.id]}});
    assert(twoHeroes.sections.find(s=>s.key===`hero.${boris.id}`)?.text.includes('РОДИНКА слева'),'Matching traits of two different heroes must not be deduplicated across identities');
  }
  assert.equal(providerCalls, 0);
  // The only fixture mutation after this snapshot was explicitly creating the legacy target card.
  assert.equal(JSON.stringify({ ...p, items: p.items.filter(i => i.id !== legacyCard.id) }), before, 'Compilation never mutates a project, selection, versions or approvals');
  console.log('PASS prompt compiler: exact plan IDs/refs, mandatory identity/costume/props/mouth, start/end states, whole-paragraph compression, preflight errors, capability provenance; no API calls');
} finally { globalThis.fetch = previousFetch; }
