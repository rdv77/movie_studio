import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({ entryPoints: ['lib/video.ts', 'lib/domain.ts', 'lib/providers.ts'], bundle: true,
  format: 'esm', platform: 'node', outdir: 'work/tests/video', outExtension: { '.js': '.mjs' } });
const D = await import('../work/tests/video/domain.mjs');
const V = await import('../work/tests/video/video.mjs');
const P = await import('../work/tests/video/providers.mjs');
const p = D.newProject('Планы');
const durations = [6,4,4,5,4,5,6,4,4,4,4];
const shots = durations.map((duration, n) => ({ title: `План ${n+1}`, duration,
  description: `Действие ${n+1}: ` + 'Дети идут по горной тропе. '.repeat(15), camera: 'Камера следует слева направо.',
  continuity: 'Сохрани флаг в правой руке.', dialogue: 'КАТЯ: Привет!' }));
for (const item of p.items.filter(i => i.stage <= 6).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
  D.addVariant(p, item.id, { text: item.stage === 4 ? JSON.stringify({ shots }) : 'Лишний контекст. '.repeat(3000) });
  D.approve(p, item.id);
}
const legacy = p.items.find(i => i.stage === 7);
p.jobs.push({ id: D.id(), itemId: legacy.id, status: 'failed', prompt: 'x'.repeat(32685), actual: null, error: 'Original error' });
const history = structuredClone(p.jobs);
assert(V.syncVideoPlans(p));
assert.equal(p.items.filter(i => i.stage === 7).length, 11);
assert.equal(p.items.find(i => i.stage === 7).id, legacy.id);
assert.deepEqual(p.jobs, history);
assert(!V.syncVideoPlans(p));
assert.equal(p.items.filter(i => i.stage === 7).reduce((s, i) => s + V.videoShot(p, i).duration, 0), 50);
assert.equal(V.videoFrame(p, legacy), undefined, 'Do not reuse an unrelated storyboard for every plan');
for (const item of p.items.filter(i => i.stage === 7)) {
  const prompt = V.videoPrompt(p, item);
  assert(prompt.length <= 2000);
  assert(prompt.includes(V.videoShot(p, item).description));
  assert(!prompt.includes('Лишний контекст'));
  assert(!prompt.includes('КАТЯ: Привет!'));
}
legacy.title = 'Название режиссёра';
assert.equal(V.videoShot(p, legacy).title, 'План 1');
assert(!V.syncVideoPlans(p));
D.addVariant(p, legacy.id, { kind: 'video', assetId: D.id(), text: 'Сохранить результат', duration: 6 });
D.approve(p, legacy.id);
const existing = structuredClone(legacy);
assert(!V.syncVideoPlans(p));
assert.deepEqual(legacy, existing);
const stale = structuredClone(p);
stale.items.find(i => i.stage === 4).approvedId = undefined;
assert.throws(() => V.syncVideoPlans(stale), /Утвердите/);
const active = structuredClone(p);
active.jobs.push({ status: 'pending' });
assert.throws(() => V.syncVideoPlans(active), /Дождитесь/);
const removed = structuredClone(p);
removed.items.find(i => i.stage === 4).variants[0].text = JSON.stringify({ shots: shots.map((s, n) => ({ ...s, title: n === 0 ? 'Новый план' : s.title })) });
assert.equal(V.videoShot(removed, removed.items.find(i => i.id === legacy.id)), undefined);

const plugin = { name: 'video-memory', setup(b) {
  b.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: 'server', namespace: 'test' }));
  b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
    export const api = fn => fn;
    export const owner = async () => 'test';
    export const loadProject = async () => globalThis.videoProject;
    export const saveProject = async (_, p) => { p.revision++; return p; };
    export const getKey = async () => 'test-secret-key';
    export const asset = async () => { if (globalThis.videoAssetDenied) throw new Error('Asset denied'); return { mime: 'image/png', size: 1024 }; };
  ` }));
} };
await build({ entryPoints: ['app/api/projects/[id]/generate/route.ts'], bundle: true, format: 'esm',
  platform: 'node', outfile: 'work/tests/video/route.mjs', plugins: [plugin] });
const route = await import('../work/tests/video/route.mjs');
const payload = { revision: p.revision, batchId: D.id(), itemId: p.items.filter(i => i.stage === 7)[1].id,
  models: ['MiniMax-Hailuo-2.3', 'grok-imagine-video-1.5'], count: 2, prompt: 'Короткое точное действие.',
  refs: [D.id()], dialogue: '', voiceId: '', estimates: {} };
const run = body => route.POST(new Request('http://localhost/generate', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: p.id }) });
globalThis.videoProject = structuredClone(p);
const saved = await (await run(payload)).json();
const jobs = saved.jobs.slice(1);
assert.equal(jobs.length, 4);
for (const job of jobs) {
  assert(job.prompt.startsWith(payload.prompt),'Preserve the reviewed action');
  assert.match(job.prompt,/Все персонажи держат рты закрытыми/,'The server adds the speech rule to custom prompts');
  assert.equal(job.speechType,'voiceover');
  assert.equal(job.duration, 4, 'Timeline duration from screenplay, not fixed six seconds');
  assert.equal(job.camera, shots[1].camera);
}
for (const changes of [{ prompt: 'x'.repeat(2001) }, { refs: [] }]) {
  globalThis.videoProject = structuredClone(p);
  await assert.rejects(() => run({ ...payload, ...changes }));
  assert.equal(globalThis.videoProject.jobs.length, 1, 'Invalid input must not enqueue paid work');
}
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.prompt, jobs[0].prompt);
    assert.equal(body.duration, 6);
    return Response.json(String(url).includes('minimax') ? { task_id: 'test' } : { request_id: 'test' });
  };
  for (const job of [jobs[0], jobs[2]]) await P.generate(job, 'test-secret-key', ['data:image/png;base64,AA=='], '16:9');
  assert.equal(calls, 2);
  await assert.rejects(() => P.generate({ ...jobs[0], prompt: 'x'.repeat(32685) }, 'test-secret-key', [], '16:9'), e => e.notSent && e.definite);
  assert.equal(calls, 2);
  globalThis.fetch = async () => Response.json({ error: { message: 'Invalid image: test-secret-key' } }, { status: 400 });
  await assert.rejects(() => P.generate(jobs[2], 'test-secret-key', [], '16:9'), e =>
    e.definite && e.message.includes('HTTP 400') && e.message.includes('Invalid image') && !e.message.includes('test-secret-key'));
  globalThis.fetch = async () => new Response('not JSON', { status: 401 });
  await assert.rejects(() => P.generate(jobs[2], 'test-secret-key', [], '16:9'), /API-ключ/);
} finally { globalThis.fetch = originalFetch; }
console.log('PASS video: 11-plan migration, approvals/history, bounded exact prompts, timing, preflight and provider errors');

await build({ entryPoints: ['app/api/projects/[id]/generate-remaining/route.ts'], bundle: true, format: 'esm',
  platform: 'node', outfile: 'work/tests/video/remaining-route.mjs', plugins: [plugin] });
const remainingRoute = await import('../work/tests/video/remaining-route.mjs');
const bulk = structuredClone(p);
const source = bulk.items.find(i => i.id === legacy.id);
D.chosen(source).model = 'grok-imagine-video-1.5';
// A stale example can supply a model without being approved or reused as content.
D.chosen(source).deps = 'old-storyboard-and-voice';
assert.equal(D.isApproved(bulk, source), false);
const videoItems = bulk.items.filter(i => i.stage === 7);
D.addVariant(bulk, videoItems[2].id, { kind: 'video', assetId: D.id(), model: 'MiniMax-Hailuo-2.3' });
bulk.jobs.push({ id: D.id(), itemId: videoItems[3].id, status: 'unknown', actual: null });
bulk.jobs.push({ id: D.id(), itemId: videoItems[4].id, status: 'failed', actual: null });
assert.equal(V.selectedVideoModel(bulk, source).id, 'grok-imagine-video-1.5');
const targets = V.remainingVideoPlans(bulk);
assert.equal(targets.length, 8);
assert(targets.some(i => i.id === videoItems[4].id), 'A definite failed attempt can be retried with director review');
assert(!targets.some(i => i.id === videoItems[2].id || i.id === videoItems[3].id), 'Skip existing video and unknown outcomes');
const bulkPayload = { revision: bulk.revision, batchId: D.id(), sourceItemId: source.id, sourceVariantId: D.chosen(source).id,
  estimate: '8500000000', plans: targets.map(i => ({ itemId: i.id, ref: D.id(), prompt: V.videoPrompt(bulk, i) })) };
const runBulk = body => remainingRoute.POST(new Request('http://localhost/generate-remaining', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: bulk.id }) });
globalThis.videoProject = structuredClone(bulk);
const beforeBulk = structuredClone(bulk);
const completedBulk = await (await runBulk(bulkPayload)).json();
assert.deepEqual(completedBulk.items, JSON.parse(JSON.stringify(beforeBulk.items)), 'No implicit selection/approval or overwriting after JSON persistence');
assert.deepEqual(completedBulk.jobs.slice(0, bulk.jobs.length), bulk.jobs, 'Preserve all earlier costs and attempts');
const newJobs = completedBulk.jobs.slice(bulk.jobs.length);
assert.equal(newJobs.length, 8);
newJobs.forEach((j, n) => {
  assert.equal(j.model, 'grok-imagine-video-1.5');
  assert.equal(j.status, 'queued');
  assert.equal(j.duration, V.videoShot(bulk, targets[n]).duration);
  assert(j.prompt.startsWith(bulkPayload.plans[n].prompt));
  assert.match(j.prompt,/рты закрытыми/);
  assert.deepEqual(j.refs, [bulkPayload.plans[n].ref]);
  assert.equal(j.deps, D.dependencies(bulk, 7));
});
const repeated = await (await runBulk(bulkPayload)).json();
assert.equal(repeated.jobs.length, completedBulk.jobs.length, 'Retry with same batch ID is idempotent even after revision changes');
const unready = structuredClone(bulk);
unready.items.find(i => i.stage === 6).approvedId = undefined;
globalThis.videoProject = unready;
await assert.rejects(() => runBulk(bulkPayload), /Утвердите предыдущие/);
assert.equal(globalThis.videoProject.jobs.length, bulk.jobs.length);
for (const change of [{kind:'image'}, {assetId:undefined}, {model:'unknown-model'}]) {
  const invalid = structuredClone(source);
  Object.assign(D.chosen(invalid), change);
  assert.equal(V.selectedVideoModel(bulk, invalid), undefined);
}
for (const changes of [
  { revision: -1 }, { sourceVariantId: D.id() },
  { plans: [bulkPayload.plans[0], bulkPayload.plans[0]] },
  { plans: [{ ...bulkPayload.plans[0], itemId: source.id }] },
  { plans: [{ ...bulkPayload.plans[0], itemId: videoItems[3].id }] },
  { plans: [{ ...bulkPayload.plans[0], prompt: 'x'.repeat(2001) }] },
  { plans: [{ ...bulkPayload.plans[0], ref: '' }] },
]) {
  globalThis.videoProject = structuredClone(bulk);
  await assert.rejects(() => runBulk({ ...bulkPayload, ...changes }));
  assert.deepEqual(globalThis.videoProject.jobs, bulk.jobs);
}
globalThis.videoProject = structuredClone(bulk);
globalThis.videoAssetDenied = true;
await assert.rejects(() => runBulk(bulkPayload), /Asset denied/);
assert.deepEqual(globalThis.videoProject.jobs, bulk.jobs);
globalThis.videoAssetDenied = false;
globalThis.videoProject = structuredClone(bulk);
globalThis.videoProject.limit = '1';
globalThis.videoProject.jobs.forEach(j => j.actual = '0');
await assert.rejects(() => runBulk(bulkPayload), /превысит лимит/);
assert.equal(globalThis.videoProject.jobs.length, bulk.jobs.length);
globalThis.videoProject = structuredClone(bulk);
globalThis.videoProject.jobs.push({ status: 'pending' });
await assert.rejects(() => runBulk(bulkPayload), /Дождитесь/);
console.log('PASS remaining video batch: same chosen model, per-plan inputs, no overwrites, uncertain attempts skipped, idempotency, atomic validation and budget cap; no paid calls');
globalThis.videoProject=structuredClone(p);
const h3Single=await(await run({...payload,models:['MiniMax-H3'],count:1,estimates:{'MiniMax-H3':'4800000000'}})).json();
assert.equal(h3Single.jobs.at(-1).model,'MiniMax-H3');assert.equal(h3Single.jobs.at(-1).estimate,'4800000000');
globalThis.videoProject=structuredClone(bulk);
D.chosen(videoProject.items.find(i=>i.id===source.id)).model='MiniMax-H3';
const h3Batch=await(await runBulk({...bulkPayload,estimate:'4800000000'})).json();
assert.equal(h3Batch.jobs.length,bulk.jobs.length+8);
assert(h3Batch.jobs.slice(bulk.jobs.length).every(j=>j.model==='MiniMax-H3'&&j.estimate==='4800000000'&&j.refs.length===1&&!j.characterRefs));
const gallery = structuredClone(p);
for(const [model,estimate] of [['fal-minimax-h3-max','4800000000'],['fal-wan-2.2-a14b','4900000000']]) {
  globalThis.videoProject=structuredClone(p);
  const single=await(await run({...payload,models:[model],count:1,estimates:{[model]:estimate}})).json();
  assert.equal(single.jobs.at(-1).model,model);assert.equal(single.jobs.at(-1).estimate,estimate);
  globalThis.videoProject=structuredClone(bulk);
  D.chosen(videoProject.items.find(i=>i.id===source.id)).model=model;
  const result=await(await runBulk({...bulkPayload,estimate})).json();
  assert.equal(result.jobs.length,bulk.jobs.length+8);
  assert(result.jobs.slice(bulk.jobs.length).every(j=>j.model===model&&j.estimate===estimate&&j.actual===null&&j.refs.length===1));
  const again=await(await runBulk({...bulkPayload,estimate})).json();
  assert.equal(again.jobs.length,result.jobs.length);
}
console.log('PASS fal video: single and remaining batch use selected model, frame, budget estimate; batch retries are idempotent.');
globalThis.videoProject=structuredClone(bulk);
D.chosen(videoProject.items.find(i=>i.id===source.id)).model='zencreator:video:kling@2.6';
const zenBatch=await(await runBulk({...bulkPayload,estimate:null})).json();
assert.equal(zenBatch.jobs.length,bulk.jobs.length+8);
assert(zenBatch.jobs.slice(bulk.jobs.length).every(j=>j.model==='zencreator:video:kling@2.6'&&j.zenCreditsEstimate===10&&j.actual===null&&j.estimate===null&&j.refs.length===1&&!j.characterRefs));
const target = gallery.items.find(i => i.stage === 7);
const board = gallery.items.find(i => i.stage === 5);
board.sourceShot = {...target.sourceShot};
board.title = 'Переименованная карточка раскадровки';
board.variants = [D.makeVariant(gallery,board,{kind:'image',assetId:D.id(),title:'Grok вариант',model:'grok'}),D.makeVariant(gallery,board,{kind:'image',assetId:D.id(),title:'FLUX вариант',model:'flux'})];
board.approvedId = board.variants[0].id;
board.selectedId = board.variants[1].id;
board.variants.push({...board.variants[0],id:D.id(),deps:'old'}); // Same file is shown once.
board.variants.push(D.makeVariant(gallery,board,{kind:'text',text:'Описание без картинки'}));
const foreign={...board,id:D.id(),sourceShot:{...board.sourceShot,scriptId:D.id()},variants:[D.makeVariant(gallery,board,{kind:'image',assetId:D.id()})]};
gallery.items.push(foreign);
const options=V.videoFrameOptions(gallery,target);
assert.equal(options.length,2);
assert.equal(options[0].approved,true);
assert.equal(options[1].approved,false);
assert.equal(V.videoFrame(gallery,target),options[0].assetId);
assert.deepEqual(options.map(o=>o.model),['grok','flux']);
assert(!options.some(o=>o.assetId===foreign.variants[0].assetId));
assert.equal(V.videoFrameOptions(gallery,gallery.items.filter(i=>i.stage===7)[1]).length,0);
board.sourceShot=undefined;board.title=target.sourceShot.title;
assert.equal(V.videoFrameOptions(gallery,target).length,2); // Legacy title match.
console.log('PASS per-plan frame gallery: all variants, exact scene linkage, renamed and legacy cards, selected default, approved badge, deduplicated files, unrelated images excluded.');
