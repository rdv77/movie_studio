import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({ entryPoints: ['lib/storyboard.ts', 'lib/domain.ts', 'lib/video.ts'], bundle: true,
  format: 'esm', platform: 'node', outdir: 'work/tests/storyboard', outExtension: { '.js': '.mjs' } });
const D = await import('../work/tests/storyboard/domain.mjs');
const S = await import('../work/tests/storyboard/storyboard.mjs');
const V = await import('../work/tests/storyboard/video.mjs');
const p = D.newProject('Existing project');
const durations = [6,4,4,5,4,5,6,4,4,4,4];
const shots = durations.map((duration, n) => ({ title: `План ${n+1}`, duration, description: `Действие ${n+1}`,
  camera: `Камера ${n+1}`, dialogue: `Реплика ${n+1}`, continuity: `Стыковка ${n+1}` }));
for (const item of p.items.filter(i => i.stage <= 4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
  D.addVariant(p, item.id, { text: item.stage === 4 ? JSON.stringify({ shots }) : 'Материал' });
  D.approve(p, item.id);
}
const frame = p.items.find(i => i.stage === 5), audio = p.items.find(i => i.stage === 6);
for (const model of ['flux-2-pro','grok-imagine-image-2.0']) {
  D.addVariant(p, frame.id, { kind: 'image', assetId: D.id(), jobId: D.id(), model, text: 'Предложи самостоятельный вариант для текущего материала.' });
}
D.approve(p, frame.id);
D.addVariant(p, audio.id, { kind: 'audio', assetId: D.id() });
D.approve(p, audio.id);
V.syncVideoPlans(p);
const video = p.items.find(i => i.stage === 7);
D.addVariant(p, video.id, { kind: 'video', assetId: D.id(), jobId: D.id(), model: 'grok-imagine-video-1.5' });
p.jobs.push({ id: D.id(), itemId: frame.id, status: 'done', actual: '500000000' });
const before = structuredClone(p);
assert(S.preparePlanCards(p));
assert.equal(p.items.filter(i => i.stage === 5).length, 11);
assert.equal(p.items.filter(i => i.stage === 7).length, 11);
assert.equal(frame.title, shots[0].title);
assert.deepEqual(frame.variants, before.items.find(i => i.id === frame.id).variants);
assert.equal(frame.approvedId, before.items.find(i => i.id === frame.id).approvedId);
assert.deepEqual(video, before.items.find(i => i.id === video.id));
assert.deepEqual(p.jobs, before.jobs);
assert(!D.isApproved(p, audio), 'New storyboard requirements invalidate downstream approval, preserving media');
assert(D.isApproved(p, frame));
assert(!S.preparePlanCards(p), 'Idempotent on repeated preparation');
assert.equal(V.videoFrame(p, video), frame.variants.find(v => v.id === frame.approvedId).assetId);
const legacy = frame.variants[0];
const fields = S.planFields(p, frame, legacy);
assert.equal(fields.duration, 6);
assert.equal(fields.camera, shots[0].camera);
assert.equal(fields.dialogue, shots[0].dialogue);
assert.equal(fields.continuity, shots[0].continuity);
assert.equal(legacy.camera, 'Статичная камера', 'Viewing editor must not mutate an existing variant');
const edited = { ...legacy, ...fields, camera: 'Статичная камера', continuity: '', dialogue: '' };
assert.equal(S.planFields(p, frame, edited).dialogue, '', 'Preserve an intentional cleared field in an edited version');
assert.equal(S.planFields(p, frame, edited).camera, 'Статичная камера');
frame.title = 'Авторское название';
assert.equal(S.planFields(p, frame, legacy).camera, shots[0].camera);
assert.equal(V.videoFrame(p, video), frame.variants.find(v => v.id === frame.approvedId).assetId);
assert(!S.preparePlanCards(p));
for (const i of p.items.filter(i => i.stage === 5 && i.id !== frame.id)) {
  const v = D.chosen(i), shot = V.videoShot(p, i);
  assert.equal(v.camera, shot.camera);
  assert.equal(v.dialogue, shot.dialogue);
  assert.equal(v.continuity, shot.continuity);
  assert.equal(v.duration, shot.duration);
  assert(S.storyboardPrompt(p, i).includes(shot.description));
}
const plugin = { name: 'storyboard-memory', setup(b) {
  b.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: 'server', namespace: 'test' }));
  b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
    export const api = fn => fn;
    export const owner = async () => 'test';
    export const loadProject = async () => globalThis.storyboardProject;
    export const saveProject = async (_, p) => { p.revision++; return p; };
    export const getKey = async () => 'test-key';
    export const asset = async () => { if (globalThis.storyboardAssetDenied) throw new Error('Asset denied'); return { mime: 'image/png' }; };
  ` }));
} };
await build({ entryPoints: ['app/api/projects/[id]/generate/route.ts'], bundle: true, format: 'esm', platform: 'node',
  outfile: 'work/tests/storyboard/generate.mjs', plugins: [plugin] });
await build({ entryPoints: ['app/api/projects/[id]/route.ts'], bundle: true, format: 'esm', platform: 'node',
  outfile: 'work/tests/storyboard/project.mjs', plugins: [plugin] });
const api = await import('../work/tests/storyboard/project.mjs');
globalThis.storyboardProject = structuredClone(before);
const params = { params: Promise.resolve({ id: p.id }) };
const prepared = await (await api.PATCH(new Request('http://localhost/project', { method: 'PATCH', body: JSON.stringify({ revision: before.revision, action: 'prepareShots' }) }), params)).json();
assert.equal(prepared.items.filter(i => i.stage === 5).length, 11);
assert.deepEqual(prepared.jobs, before.jobs);
const G = await import('../work/tests/storyboard/generate.mjs');
const target = prepared.items.filter(i => i.stage === 5)[1];
const generated = await (await G.POST(new Request('http://localhost/generate', { method: 'POST', body: JSON.stringify({
  revision: prepared.revision, batchId: D.id(), itemId: target.id, models: ['flux-2-pro'], count: 1,
  prompt: S.storyboardPrompt(prepared, target), refs: [], dialogue: '', voiceId: '', estimates: {},
}) }), params)).json();
const job = generated.jobs.at(-1);
assert.equal(job.camera, shots[1].camera);
assert.equal(job.dialogue, shots[1].dialogue);
assert.equal(job.continuity, shots[1].continuity);
assert.equal(job.duration, shots[1].duration);
assert(job.shotSource);
console.log('PASS storyboard: safe 11-card migration, immutable history, current source metadata, explicit edits preserved, stable frame linking, real preparation and image queue routes. No paid calls.');

await build({ entryPoints: ['app/api/projects/[id]/generate-storyboard/route.ts'], bundle: true, format: 'esm', platform: 'node',
  outfile: 'work/tests/storyboard/batch.mjs', plugins: [plugin] });
const B = await import('../work/tests/storyboard/batch.mjs');
const bulk = structuredClone(prepared);
const card = bulk.items.find(i => i.id === target.id);
D.chosen(card).text = 'Авторская правка: ребята стоят у моря.';
D.chosen(card).camera = 'Крупный план руки';
D.chosen(card).continuity = 'Флаг остаётся справа';
assert(S.storyboardPrompt(bulk, card).includes(D.chosen(card).text));
assert(S.storyboardPrompt(bulk, card).includes('Крупный план руки'));
const allFrames = S.storyboardBatchPlans(bulk);
assert.equal(allFrames.length, 11);
assert.equal(allFrames.filter(x => x.hasImage).length, 1);
assert(allFrames.every(x => !x.blocked));
const payload = { revision: bulk.revision, batchId: D.id(), model: 'flux-2-pro', refs: [D.id()], estimate: '500000000',
  plans: allFrames.map(({ item }) => ({ itemId: item.id, prompt: S.storyboardPrompt(bulk, item) })) };
const run = body => B.POST(new Request('http://localhost/generate-storyboard', { method: 'POST', body: JSON.stringify(body) }), params);
globalThis.storyboardProject = structuredClone(bulk);
const queued = await (await run(payload)).json();
assert.equal(queued.jobs.length, bulk.jobs.length + 11);
assert.deepEqual(queued.items, JSON.parse(JSON.stringify(bulk.items)), 'Existing images, selections and approvals must be unchanged after JSON persistence');
assert.deepEqual(queued.jobs.slice(0, bulk.jobs.length), bulk.jobs, 'Keep old cost history');
for (const [index, j] of queued.jobs.slice(bulk.jobs.length).entries()) {
  assert.equal(j.model, 'flux-2-pro');
  assert.equal(j.kind, 'image');
  assert.equal(j.status, 'queued');
  assert.equal(j.itemId, allFrames[index].item.id);
  assert.equal(j.brief, payload.plans[index].prompt);
  assert(j.prompt.includes(payload.plans[index].prompt));
  assert.deepEqual(j.refs, payload.refs);
  assert.equal(j.camera, S.planFields(bulk, allFrames[index].item, D.chosen(allFrames[index].item)).camera);
  assert.equal(j.estimate, payload.estimate);
}
assert.equal((await (await run(payload)).json()).jobs.length, queued.jobs.length, 'Same batch ID must not duplicate the queue');
for (const changes of [
  { revision: -1 }, { model: 'grok-imagine-video-1.5' },
  { plans: [payload.plans[0], payload.plans[0]] },
  { plans: [{ ...payload.plans[0], itemId: bulk.items.find(i => i.stage === 7).id }] },
  { plans: [{ ...payload.plans[0], prompt: '' }] },
  { plans: [{ ...payload.plans[0], prompt: 'x'.repeat(20001) }] },
  { model: 'grok-imagine-image-2.0', refs: Array.from({ length: 6 }, () => D.id()) },
  { refs: [payload.refs[0], payload.refs[0]] },
]) {
  globalThis.storyboardProject = structuredClone(bulk);
  await assert.rejects(() => run({ ...payload, ...changes }));
  assert.equal(globalThis.storyboardProject.jobs.length, bulk.jobs.length);
}
globalThis.storyboardProject = structuredClone(bulk);
globalThis.storyboardAssetDenied = true;
await assert.rejects(() => run(payload), /Asset denied/);
globalThis.storyboardAssetDenied = false;
assert.equal(globalThis.storyboardProject.jobs.length, bulk.jobs.length);
globalThis.storyboardProject = structuredClone(bulk);
globalThis.storyboardProject.limit = '1';
await assert.rejects(() => run(payload), /превысит лимит/);
assert.equal(globalThis.storyboardProject.jobs.length, bulk.jobs.length);
globalThis.storyboardProject = structuredClone(bulk);
globalThis.storyboardProject.jobs.push({ id: D.id(), itemId: card.id, status: 'unknown', actual: null });
assert(S.storyboardBatchPlans(globalThis.storyboardProject).find(x => x.item.id === card.id).blocked);
await assert.rejects(() => run(payload), /неизвестным/);
assert.equal(globalThis.storyboardProject.jobs.length, bulk.jobs.length + 1);
globalThis.storyboardProject = structuredClone(bulk);
D.chosen(globalThis.storyboardProject.items.find(i => i.id === card.id)).deps = 'stale';
await assert.rejects(() => run(payload), /Основа изменилась/);
console.log('PASS storyboard batch: 11 images, single selected model, card edits and references retained, existing results preserved, budget, ownership, stale data and duplicate-submission checks; no paid calls');
