import { build } from 'esbuild';
import assert from 'node:assert/strict';

await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export * as D from './lib/domain';
    export * as C from './lib/characters';
    export * as W from './lib/workflow';
    export * as R from './lib/character-removal';
    export { approvalBlockers } from './lib/approval-blockers';
    export { POST as advanceJob } from './app/api/projects/[id]/jobs/[jobId]/route';
  ` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/creative-approval.mjs',
  external: ['@ffmpeg/ffmpeg'],
  plugins: [{ name: 'isolated-creative-approval', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(server|providers|sync-provider)$/ }, (args) => ({ path: args.path, namespace: 'creative-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'creative-test' }, ({ path }) => ({ contents: path.endsWith('/server') ? `
      export const api = fn => async (req, ctx) => { try { return await fn(req, ctx); } catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 400 }); } };
      export const owner = async () => 'owner';
      export const loadProject = async () => structuredClone(globalThis.creativeApprovalState);
      export const mutate = async (_, id, fn) => { const p = structuredClone(globalThis.creativeApprovalState); if (p.id !== id) throw Error('Wrong test project'); fn(p); p.revision++; globalThis.creativeApprovalState = structuredClone(p); return p; };
      export const getKey = async () => 'test-only-placeholder';
      export const imageData = async () => { throw Error('Stale job must not load provider inputs'); };
      export const storeAsset = async () => { throw Error('Stale job must not save a generated file'); };
      export const asset = async () => { throw Error('Stale job must not access media'); };
      export const runtime = {};
    ` : `
      export class ProviderError extends Error {}
      const forbidden = async () => { globalThis.creativeApprovalProviderCalls++; throw Error('No external provider calls are permitted'); };
      export const generate = forbidden, poll = forbidden, retrieve = forbidden, generateSync = forbidden, pollSync = forbidden;
    ` }));
  } }],
});
const { D, C, W, R, approvalBlockers, advanceJob } = await import('../work/tests/creative-approval.mjs');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS creative approval:', name); }

function baseline() {
  const p = D.newProject('Creative decisions and production dependencies');
  const hero = p.items[1];
  hero.character = { name: 'Лена', appearance: 'Рыжие волосы, зелёная куртка', description: 'Любопытная путешественница', instructions: 'Сохранить внешность', refs: [D.id(), D.id()] };
  for (const item of p.items) {
    const media = item.stage === 1 || item.stage === 5 ? 'image' : item.stage === 6 ? 'audio' : item.stage >= 7 ? 'video' : 'text';
    D.addVariant(p, item.id, {
      title: `Approved stage ${item.stage}`, text: item.stage === 4
        ? JSON.stringify({ shots: [{ title: 'План 1', description: 'Лена у ворот', duration: 5, dialogue: 'Мы пришли.', speechType: 'voiceover', speaker: 'Рассказчик' }] })
        : `Approved material ${item.stage}`,
      kind: media, ...(media !== 'text' ? { assetId: D.id() } : {}),
      ...(item.stage === 1 ? { character: structuredClone(hero.character) } : {}),
    });
    D.approve(p, item.id);
  }
  return p;
}

function changeScript(p) {
  D.addVariant(p, p.items[0].id, { text: 'История теперь происходит на станции.' });
  D.approve(p, p.items[0].id);
}

function unchangedRead(p, fn) {
  const before = JSON.stringify(p);
  fn();
  assert.equal(JSON.stringify(p), before, 'Reading approval state must not migrate, duplicate, rewrite deps, or change a director decision.');
}

const snapshots = [];
test('only heroes, style and locations have independent approval', () => {
  for (let stage = 0; stage <= 9; stage++) assert.equal(D.independentApproval(stage), [1, 2, 3].includes(stage));
});

test('legacy approved IDs recover status after script changes without any writes', () => {
  const p = baseline();
  const creativeBefore = JSON.parse(JSON.stringify(p.items.slice(1, 4)));
  changeScript(p);
  const loaded = JSON.parse(JSON.stringify(p));
  unchangedRead(loaded, () => {
    for (const item of loaded.items.slice(1, 4)) {
      const approved = item.variants.find((variant) => variant.id === item.approvedId);
      assert.notEqual(approved.deps, D.dependencies(loaded, item.stage), 'Keep the original generation provenance.');
      assert(D.variantCurrent(loaded, item, approved));
      assert(D.approvalCurrent(loaded, item));
      assert(D.isApproved(loaded, item));
      assert.equal(D.itemStatus(loaded, item), 'Утверждено');
      assert(W.stageComplete(loaded, item.stage));
    }
    assert(D.stageReady(loaded, 4));
    assert.deepEqual(approvalBlockers(loaded, 4), []);
    assert(!D.approvalCurrent(loaded, loaded.items[4]));
    assert(!D.stageReady(loaded, 5));
    assert(!W.stageComplete(loaded, 4));
    assert.deepEqual(approvalBlockers(loaded, 5).map((row) => row.itemId), [loaded.items[4].id]);
  });
  assert.deepEqual(loaded.items.slice(1, 4), creativeBefore);
  snapshots.push(loaded);
});

test('selection and draft profile changes keep the previously approved hero references', () => {
  const p = baseline();
  const hero = p.items[1];
  const old = structuredClone(hero.variants.find((variant) => variant.id === hero.approvedId));
  const productionDeps = D.dependencies(p, 5);
  hero.character = { ...hero.character, name: 'Черновое имя', appearance: 'Синяя куртка', refs: [D.id()] };
  const replacement = D.addVariant(p, hero.id, { kind: 'image', assetId: D.id(), character: structuredClone(hero.character), text: 'Новый кандидат' });
  assert.equal(hero.selectedId, replacement.id);
  assert.equal(hero.approvedId, old.id);
  assert.equal(D.dependencies(p, 5), productionDeps);
  assert.deepEqual(C.approvedCharacters(p).map((record) => [record.variantId, record.assetId, record.profile]), [[old.id, old.assetId, old.character]]);
  assert.deepEqual(C.characterImageRefs(p, p.items[5], []), [old.assetId]);
  assert(D.isApproved(p, p.items[7]), 'Unapproved selection must not invalidate production work.');
  D.approve(p, hero.id);
  assert.deepEqual(C.characterImageRefs(p, p.items[5], []), [replacement.assetId]);
  assert.notEqual(D.dependencies(p, 5), productionDeps);
  for (const stage of [1, 2, 3]) assert(D.isApproved(p, p.items[stage]));
  for (const stage of [4, 5, 6, 7, 8]) assert(!D.isApproved(p, p.items[stage]));
  snapshots.push(p);
});

test('creative completion survives a temporary missing upstream approval, but generation remains gated', () => {
  const p = baseline();
  const script = p.items[0];
  delete script.approvedId;
  unchangedRead(p, () => {
    for (const stage of [1, 2, 3]) {
      assert(D.isApproved(p, p.items[stage]));
      assert(W.stageComplete(p, stage));
      assert(!D.stageReady(p, stage));
      assert.throws(() => D.approve(p, p.items[stage].id), /предыдущие этапы/);
      assert.throws(() => D.addVariant(p, p.items[stage].id, { text: 'Blocked' }), /предыдущие этапы/);
    }
    assert.deepEqual(approvalBlockers(p, 4).map((row) => row.itemId), [script.id]);
    assert(!D.stageReady(p, 4));
  });
  snapshots.push(p);
  const withNewHero = baseline();
  const newHero = { id: D.id(), stage: 1, title: 'Новый герой', variants: [] };
  withNewHero.items.push(newHero);
  assert(!D.stageReady(withNewHero, 2));
  assert(!W.stageComplete(withNewHero, 1));
  assert(W.stageComplete(withNewHero, 2));
  assert(W.stageComplete(withNewHero, 3));
  assert.deepEqual(approvalBlockers(withNewHero, 4).map((row) => row.itemId), [newHero.id]);
  snapshots.push(withNewHero);
});

test('explicitly approving old unapproved creative candidates does not clone or rewrite them', () => {
  for (const stage of [1, 2, 3]) {
    const p = baseline();
    const item = p.items[stage];
    const candidate = D.addVariant(p, item.id, {
      text: 'Проверенный ранее кандидат', kind: stage === 1 ? 'image' : 'text',
      ...(stage === 1 ? { assetId: D.id(), character: structuredClone(item.character) } : {}),
    });
    delete item.approvedId;
    changeScript(p);
    assert.notEqual(candidate.deps, D.dependencies(p, stage));
    assert(D.stageReady(p, stage));
    const before = structuredClone(item);
    D.approve(p, item.id);
    assert.deepEqual(item, { ...before, approvedId: candidate.id });
    assert(D.isApproved(p, item));
    assert(W.stageComplete(p, stage));
    snapshots.push(p);
  }
});

test('detailed script and all derived stages still reject a stale selected variant', () => {
  for (const stage of [4, 5, 6, 7, 8]) {
    const p = baseline();
    const item = p.items[stage];
    const variant = D.chosen(item);
    variant.deps = JSON.stringify(['old-generation-basis']);
    assert(D.stageReady(p, stage));
    assert(!D.variantCurrent(p, item, variant));
    assert(!D.approvalCurrent(p, item));
    assert(!D.isApproved(p, item));
    const before = JSON.stringify(p);
    assert.throws(() => D.approve(p, item.id), /Основа изменилась/);
    assert.equal(JSON.stringify(p), before);
    snapshots.push(p);
  }
});

test('deleting and restoring content never recreates selection or approval', () => {
  const p = baseline();
  const hero = p.items[1];
  const approvedId = hero.approvedId;
  const original = structuredClone(D.chosen(hero));
  D.deleteVariant(p, hero.id, approvedId);
  assert.equal(hero.approvedId, undefined);
  assert.equal(hero.selectedId, undefined);
  assert.equal(D.approvalCurrent(p, hero), false);
  assert.deepEqual(C.approvedCharacters(p), []);
  D.restoreVariant(p, hero.id, approvedId);
  assert.deepEqual(hero.variants, [original]);
  assert.equal(hero.approvedId, undefined);
  assert.equal(hero.selectedId, undefined);
  assert(!W.stageComplete(p, 1));
  assert(!D.stageReady(p, 2));
  snapshots.push(structuredClone(p));
  hero.selectedId = approvedId;
  D.approve(p, hero.id);
  R.removeCharacter(p, hero.id);
  assert(!D.isApproved(p, hero));
  assert.deepEqual(C.approvedCharacters(p), []);
  R.restoreCharacter(p, hero.id);
  assert.equal(hero.approvedId, undefined);
  assert(!D.isApproved(p, hero));
  assert(!D.stageReady(p, 2));
  snapshots.push(p);
});

test('diagnostics and stage gates agree for every transition, without changing stored state', () => {
  for (const p of snapshots) unchangedRead(p, () => {
    for (let stage = 0; stage <= 8; stage++) {
      assert.equal(approvalBlockers(p, stage).length === 0, D.stageReady(p, stage), `Blocker/gate disagreement at stage ${stage}.`);
    }
  });
});

// Exercise the actual dispatch route: independent director approval must not
// make an old queued generation silently use new script/hero inputs.
const p = baseline();
const style = p.items[2];
const oldDeps = D.dependencies(p, style.stage);
const queued = { id: D.id(), batchId: D.id(), itemId: style.id, model: 'gpt-6-astra', kind: 'text', status: 'queued', deps: oldDeps,
  prompt: 'Original generation instructions', brief: '', refs: [], dialogue: '', voiceId: '', duration: 5, camera: '', continuity: '', offset: 0, volume: 1,
  created: D.now(), estimate: '100', actual: null };
const done = { ...queued, id: D.id(), status: 'done', actual: '73', requestId: 'original-provider-receipt' };
p.jobs.push(queued, done);
changeScript(p);
assert(D.isApproved(p, style));
assert(D.stageReady(p, style.stage));
assert.notEqual(queued.deps, D.dependencies(p, style.stage));
globalThis.creativeApprovalState = structuredClone(p);
globalThis.creativeApprovalProviderCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { globalThis.creativeApprovalProviderCalls++; throw Error('Unexpected network call in an offline regression test'); };
try {
  const response = await advanceJob(new Request('http://localhost/api/projects/test/jobs/test', { method: 'POST' }), { params: Promise.resolve({ id: p.id, jobId: queued.id }) });
  assert.equal(response.status, 200, await response.clone().text());
  const updated = await response.json();
  const cancelled = updated.jobs.find((job) => job.id === queued.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.actual, '0');
  assert.equal(cancelled.deps, oldDeps);
  assert.equal(cancelled.prompt, queued.prompt);
  assert.deepEqual(updated.jobs.find((job) => job.id === done.id), done);
  assert.deepEqual(updated.items, JSON.parse(JSON.stringify(p.items)));
  assert.equal(globalThis.creativeApprovalProviderCalls, 0);
  passed++;
  console.log('PASS creative approval: stale queued generation cancels before any provider call, preserving provenance and paid history');
} finally {
  globalThis.fetch = previousFetch;
  delete globalThis.creativeApprovalState;
  delete globalThis.creativeApprovalProviderCalls;
}
console.log(`PASS ${passed} creative approval regressions. No external or paid requests.`);
