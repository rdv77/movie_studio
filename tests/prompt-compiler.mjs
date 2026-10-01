import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('work/tests', { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), contents: `export * as C from './lib/prompt-compiler';export * as D from './lib/domain';export * as J from './lib/prompt-jobs';export * as A from './lib/prompt-assets';export {MODELS} from './lib/models';` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/prompt-compiler.mjs', external: ['@ffmpeg/ffmpeg'] });
let providerCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = () => { providerCalls++; throw Error('Compiler tests must never call providers'); };
try {
  const { C, D, J, A, MODELS } = await import('../work/tests/prompt-compiler.mjs');
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
  assert(!result.criticalText.includes('Алый плащ') && !result.criticalText.includes('Серебряный меч'));
  assert(result.prompt.includes('рты всех персонажей закрыты'));
  assert(result.prompt.includes('Только для стыковки — выход предыдущего плана'));
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
  assert(actorCompiled.prompt.includes('Защитить письмо') && actorCompiled.prompt.includes('Сдержанность · 8/10') && actorCompiled.prompt.includes('Прячет дрожь в руках'));
  assert(!actorCompiled.prompt.includes('Поменять лицо'),'Current actor direction must not replace approved physical identity');
  assert(actorCompiled.criticalText.includes(anna.variants[0].character.appearance));
  assert.deepEqual(actorCompiled.references.map(r=>r.assetId),[first,ids.anna]);

  const finalImage = C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, keyframe: 'end', startFrameId: first, references: [ids.anna] });
  assert.equal(finalImage.references[0].role, 'first-frame');
  assert(finalImage.criticalText.includes(current.stateOut) && finalImage.criticalText.includes(current.direction.endFrame));
  assert(!finalImage.criticalText.includes(current.direction.startFrame));
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
  assert(withSpeech.criticalText.includes('Только этот герой естественно двигает губами'));
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
  assert.throws(() => C.compilePrompt(p,frame,'grok-imagine-image-2.0',{...base,prompt:'РУЧНАЯ ПРАВКА '.repeat(1000)}),e=>e.code==='critical_too_long','Manual director text must never disappear as optional context');
  assert.throws(() => C.compilePrompt(p,frame,'grok-imagine-image-2.0',{...base,prompt:'РУЧНАЯ ПРАВКА '.repeat(1000),keyframeInstruction:'Создай первый кадр.'}),e=>e.code==='critical_too_long','Generated keyframe guidance is not a director delta and must not make manual text optional');
  assert(compressed.compression.shortened && compressed.compression.omitted.some(r => r.reason === 'budget'));
  assert(compressed.criticalText.includes('Синий плащ') && compressed.criticalText.includes('Красная сумка в левой руке'));
  for (const paragraph of [paragraphA.trim(), paragraphB.trim()]) assert(!compressed.prompt.includes(paragraph.split(' ').slice(0, 4).join(' ')) || compressed.prompt.includes(paragraph), 'Optional paragraphs are included whole or omitted, not sentence-cut');
  assert(!compressed.prompt.includes('…'));
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, instruction: 'ОБЯЗАТЕЛЬНАЯ ФРАЗА '.repeat(1000) }), e => e.code === 'critical_too_long' && e.details.requiredCharacters > e.details.limit && e.message.includes('не обрезаны'));
  const larger = C.compilePrompt(p, frame, 'gpt-image-2.5-flare', { ...base, instruction: 'ОБЯЗАТЕЛЬНАЯ ФРАЗА '.repeat(1000) });
  assert(larger.criticalText.includes('ОБЯЗАТЕЛЬНАЯ ФРАЗА '.repeat(1000).trim()));
  assert.equal(larger.budget.limit, 32000);
  assert.throws(() => C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, providerPromptLimit: 0 }), e => e.code === 'provider_limit');
  assert.equal(C.compilePrompt(p, frame, 'grok-imagine-image-2.0', { ...base, providerPromptLimit: 100000 }).budget.limit, 5000);

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
  assert.equal(providerCalls, 0);
  // The only fixture mutation after this snapshot was explicitly creating the legacy target card.
  assert.equal(JSON.stringify({ ...p, items: p.items.filter(i => i.id !== legacyCard.id) }), before, 'Compilation never mutates a project, selection, versions or approvals');
  console.log('PASS prompt compiler: exact plan IDs/refs, mandatory identity/costume/props/mouth, start/end states, whole-paragraph compression, preflight errors, capability provenance; no API calls');
} finally { globalThis.fetch = previousFetch; }
