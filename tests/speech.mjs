import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({
  entryPoints: ['lib/speech.ts', 'lib/domain.ts', 'lib/providers.ts', 'lib/spoken-text.ts'],
  bundle: true, format: 'esm', platform: 'node', outdir: 'work/tests/speech',
  outExtension: { '.js': '.mjs' },
});
const D = await import('../work/tests/speech/domain.mjs');
const S = await import('../work/tests/speech/speech.mjs');
const P = await import('../work/tests/speech/providers.mjs');
const { spokenText } = await import('../work/tests/speech/spoken-text.mjs');
const technical = '«КАТЯ, ЗА КАДРОМ: Петя рвался первым. И проверял, смотрим ли мы.»';
const spoken = 'Петя рвался первым. И проверял, смотрим ли мы.';
assert.equal(spokenText(technical), spoken);
for (const input of [
  `КАТЯ (за кадром): «${spoken}»`,
  `Катя [за кадром] — ${spoken}`,
  `Голос за кадром: ${spoken}`,
  `КАТЯ: (шёпотом) ${spoken}`,
]) assert.equal(spokenText(input, ['Катя']), spoken);
assert.equal(spokenText('«КАТЯ: Привет!»\n«ПЕТЯ: Рад тебя видеть!»', ['Катя', 'Петя']), 'Привет!\nРад тебя видеть!');
assert.equal(spokenText('КАТЯ, ЗА КАДРОМ: (пауза)'), '');
for (const text of [
  'Главное: мы вместе.', 'КАТЯ!', 'Катя',
  'Я встретил Катю (в прошлом году).',
  'Катя сказала: «Я вернусь».',
  'Он сказал: «Привет», а я ответил: «Здравствуй».',
  '(laughs) Как хорошо!',
]) assert.equal(spokenText(text, ['Катя']), text);
assert.equal(spokenText(spokenText(technical)), spoken);
const p = D.newProject('Озвучка');
const shots = Array.from({ length: 10 }, (_, n) => ({
  title: `План ${n + 1}`, description: 'Описание действия — не произносить',
  duration: 5, camera: 'Наезд', continuity: 'Склейка',
  dialogue: n === 1 ? technical : n === 4 ? 'Мы ещё вернёмся.' : '',
}));
assert.equal(S.scriptSpeech(p).sources.length, 0);
for (const item of p.items.filter(i => i.stage <= 5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
  D.addVariant(p, item.id, { text: item.stage === 4 ? JSON.stringify({ shots }) : 'Материал' });
  D.approve(p, item.id);
}
const audio = p.items.find(i => i.stage === 6);
const result = S.scriptSpeech(p);
assert.equal(result.sources.length, 3);
assert.equal(result.sources[0].dialogue, spoken + '\n\nМы ещё вернёмся.');
assert.equal(result.sources[1].originalDialogue, technical);
assert.equal(shots[1].dialogue, technical);
assert.equal(result.sources[0].duration, 50);
assert.deepEqual(result.sources.slice(1).map(s => s.offset), [5, 20]);
assert.equal(S.initialSpeech(audio, result.sources).dialogue, result.sources[0].dialogue);
audio.title = 'План 5';
assert.equal(S.initialSpeech(audio, result.sources).dialogue, 'Мы ещё вернёмся.');
D.addVariant(p, audio.id, { text: 'Звуковая дорожка', dialogue: 'Вернёмся обязательно!', offset: 23, duration: 4 });
assert.deepEqual(S.initialSpeech(audio, result.sources), { sourceId: 'current', speechType:'voiceover',speaker:'',dialogue: 'Вернёмся обязательно!' });
const legacyAudio = structuredClone(audio);
legacyAudio.variants.find(v => v.id === legacyAudio.selectedId).dialogue = technical;
assert.equal(S.initialSpeech(legacyAudio, result.sources).dialogue, spoken);
assert.equal(legacyAudio.variants[0].dialogue, technical);
const script = p.items.find(i => i.stage === 4);
D.addVariant(p, script.id, { text: JSON.stringify({ shots: shots.map(s => ({ ...s, dialogue: 'Неутверждённая правка' })) }) });
assert.equal(S.scriptSpeech(p).sources[0].dialogue, result.sources[0].dialogue);
assert.throws(() => S.resolveSpeechSource(p, 'script:missing'));
const silent = structuredClone(p);
silent.items.find(i => i.stage === 4).variants.find(v => v.id === script.approvedId).text = JSON.stringify({ shots: shots.map(s => ({ ...s, dialogue: '' })) });
assert.equal(S.scriptSpeech(silent).sources.length, 0);
const malformed = structuredClone(p);
malformed.items.find(i => i.stage === 4).variants.find(v => v.id === script.approvedId).text = 'Обычный текст с описанием сцен';
assert.equal(S.scriptSpeech(malformed).sources.length, 0);
assert(S.scriptSpeech(malformed).message.includes('Не удалось'));

// Exercise the real generation route without storing credentials or calling a provider.
const projectPlugin = { name: 'in-memory-project', setup(b) {
    b.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: 'server', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const api = fn => fn;
      export const owner = async () => 'test';
      export const loadProject = async () => globalThis.speechProject;
      export const saveProject = async (_, p) => p;
      export const mutate = async (_, id, fn) => { fn(globalThis.speechProject); return globalThis.speechProject; };
      export const getKey = async () => 'test-key';
      export const asset = async () => { throw new Error('Unexpected asset access'); };
      export const imageData = async () => { throw new Error('Unexpected image access'); };
      export const storeAsset = async () => 'test-audio-asset';
      export const runtime = { FILES: { get: async () => { throw new Error('Unexpected media read'); } } };
    ` }));
  } };
await build({
  entryPoints: ['app/api/projects/[id]/generate/route.ts'], bundle: true,
  format: 'esm', platform: 'node', outfile: 'work/tests/speech/route.mjs',
  plugins: [projectPlugin],
});
await build({
  entryPoints: ['app/api/projects/[id]/jobs/[jobId]/route.ts'], bundle: true,
  format: 'esm', platform: 'node', outfile: 'work/tests/speech/dispatch.mjs',
  plugins: [projectPlugin],
});
const route = await import('../work/tests/speech/route.mjs');
const dispatch = await import('../work/tests/speech/dispatch.mjs');
globalThis.speechProject = structuredClone(p);
const payload = {
  revision: p.revision, batchId: crypto.randomUUID(), itemId: audio.id,
  models: ['speech-2.8-hd'], count: 1, prompt: 'Режиссёрская заметка', refs: [],
  dialogue: technical, voiceId: 'test-voice',
  speechSource: result.sources[2].id, estimates: {},
};
const response = await route.POST(new Request('http://localhost/generate', {
  method: 'POST', body: JSON.stringify(payload),
}), { params: Promise.resolve({ id: p.id }) });
const saved = await response.json();
assert.equal(saved.jobs.length, 1);
const job = saved.jobs[0];
assert.equal(job.dialogue, spoken);
assert.equal(job.speechType,'voiceover');
assert.equal(job.offset, 20);
assert.equal(job.duration, 5);
globalThis.speechProject = structuredClone(p);
await assert.rejects(() => route.POST(new Request('http://localhost/generate', {
  method: 'POST', body: JSON.stringify({ ...payload, speechSource: 'script:missing' }),
}), { params: Promise.resolve({ id: p.id }) }), /изменилась/);
assert.equal(globalThis.speechProject.jobs.length, 0);
await assert.rejects(() => route.POST(new Request('http://localhost/generate', {
  method: 'POST', body: JSON.stringify({ ...payload, dialogue: 'КАТЯ, ЗА КАДРОМ: (пауза)' }),
}), { params: Promise.resolve({ id: p.id }) }), /произносимую реплику/);
assert.equal(globalThis.speechProject.jobs.length, 0);
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (url, options) => {
  providerCalls++;
  const body = JSON.parse(options.body);
  assert.equal(body.text, spoken);
  assert(!body.text.includes('Режиссёрская'));
  if (String(url).includes('elevenlabs')) return new Response(new Uint8Array([1, 2]));
  assert.equal(body.voice_setting.voice_id, payload.voiceId);
  return Response.json({ data: { audio: '0102' }, base_resp: { status_code: 0 } });
};
try {
  await P.generate(job, 'test-key', [], '16:9');
  await P.generate({ ...job, model: 'eleven_v3' }, 'test-key', [], '16:9');
  globalThis.speechProject = structuredClone(saved);
  globalThis.speechProject.jobs[0].dialogue = technical; // Already queued by the previous release.
  const params = { params: Promise.resolve({ id: p.id, jobId: job.id }) };
  const completed = await (await dispatch.POST(new Request('http://localhost/job', { method: 'POST' }), params)).json();
  assert.equal(completed.jobs[0].status, 'done');
  assert.equal(completed.jobs[0].dialogue, spoken);
  assert.equal(completed.items.find(i => i.id === audio.id).variants.at(-1).dialogue, spoken);
  assert.equal(completed.items.find(i => i.id === audio.id).variants.at(-1).speechType,'voiceover');
  const sent = providerCalls;
  globalThis.speechProject = structuredClone(saved);
  globalThis.speechProject.jobs[0].dialogue = 'КАТЯ, ЗА КАДРОМ: (пауза)';
  const cancelled = await (await dispatch.POST(new Request('http://localhost/job', { method: 'POST' }), params)).json();
  assert.equal(cancelled.jobs[0].status, 'cancelled');
  assert.equal(cancelled.jobs[0].actual, '0');
  assert.equal(providerCalls, sent);
}
finally { globalThis.fetch = originalFetch; }
D.approve(p, script.id);
assert.throws(() => S.resolveSpeechSource(p, result.sources[2].id));
console.log('PASS speech: exact Katya regression, safe cue removal, preserved spoken punctuation, preview/source history, approved script/timing, director edits, queue cleanup and cancellation, MiniMax/ElevenLabs payloads; no paid calls.');
