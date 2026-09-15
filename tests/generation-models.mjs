import { build } from 'esbuild';
import assert from 'node:assert/strict';

await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export * as D from './lib/domain';
    export { MODELS } from './lib/models';
    export { PATCH } from './app/api/projects/[id]/route';
    export { POST as generate } from './app/api/projects/[id]/generate/route';
  ` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/generation-models.mjs',
  plugins: [{ name: 'offline-generation-server', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: 'server', namespace: 'generation-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'generation-test' }, () => ({ contents: `
      export const api = fn => async (req, ctx) => { try { return await fn(req, ctx); } catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 400 }); } };
      export const owner = async req => { if (req.headers.get('test-owner') !== 'owner') throw Object.assign(Error('Unauthorized'), { status: 401 }); return 'owner'; };
      export const loadProject = async (_, id) => { if (id !== globalThis.generationState.id) throw Error('Wrong project'); return structuredClone(globalThis.generationState); };
      export const saveProject = async (_, p, revision) => {
        if (p.id !== globalThis.generationState.id || revision !== globalThis.generationState.revision) throw Error('Revision conflict');
        p.revision++; globalThis.generationState = structuredClone(p); return p;
      };
      export const getKey = async (_, provider) => { globalThis.generationKeyLookups.push(provider); return 'offline-test-key'; };
      export const asset = async (_, id, project) => {
        if (!project || project.id !== globalThis.generationState.id) throw Error('Project scope is required for every reference');
        globalThis.generationAssetLookups.push(id);
        const result = globalThis.generationAssets.get(id);
        if (!result || result.projectId !== project.id) throw Error('Foreign asset');
        return result;
      };
    ` }));
  } }],
});
const { D, MODELS, PATCH, generate } = await import('../work/tests/generation-models.mjs');
const imageModels = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'grok-imagine-image-2.0', 'flux-2-pro'];
assert(imageModels.every((id) => MODELS.some((model) => model.id === id && model.kind === 'image')), 'Use real image models from the existing catalogue.');
globalThis.generationState = D.newProject('Four models, five hero photos');
globalThis.generationAssets = new Map();
globalThis.generationKeyLookups = [];
globalThis.generationAssetLookups = [];
let networkCalls = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { networkCalls++; throw Error('Provider calls are forbidden in this offline regression test'); };
const request = (body, owner = 'owner') => new Request('http://localhost/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json', 'test-owner': owner }, body: JSON.stringify(body),
});
const context = () => ({ params: Promise.resolve({ id: globalThis.generationState.id }) });
function image(projectId = globalThis.generationState.id) {
  const id = D.id();
  globalThis.generationAssets.set(id, { id, projectId, mime: 'image/png', size: 1000 });
  return id;
}
const photos = Array.from({ length: 6 }, () => image());
const profile = { name: 'Лена', appearance: 'Рыжие волосы и веснушки', description: 'Один герой, разные ракурсы', instructions: 'Сохранить лицо со всех фотографий', refs: photos.slice(0, 5) };
const save = (nextProfile, itemId) => PATCH(request({ revision: globalThis.generationState.revision, action: 'saveCharacter', ...(itemId ? { itemId } : {}), data: { profile: nextProfile } }), context());
try {
  const response = await save(profile);
  assert.equal(response.status, 200, await response.clone().text());
  let hero = globalThis.generationState.items.find((item) => item.stage === 1 && item.character);
  assert(hero);
  assert.equal(globalThis.generationState.items.length, 9, 'Reuse the empty hero placeholder.');
  assert.deepEqual(hero.character, profile);
  assert.equal(hero.approvedId, undefined);
  assert.equal(hero.variants.length, 0, 'Saving source photos does not invent or approve an output portrait.');
  assert.deepEqual(globalThis.generationAssetLookups, profile.refs, 'All five references require project-scoped asset validation.');
  const beforeRejectedProfile = structuredClone(globalThis.generationState);
  assert.equal((await save({ ...profile, refs: photos }, hero.id)).status, 400, 'Six source photos must be rejected.');
  assert.deepEqual(globalThis.generationState, beforeRejectedProfile);
  assert.equal((await save({ ...profile, refs: [image(D.id())] }, hero.id)).status, 400, 'An image from another project is not a local hero reference.');
  assert.deepEqual(globalThis.generationState, beforeRejectedProfile);
  console.log('PASS generation models: save five scoped hero photos, reject six/foreign photos, preserve state without autoapproval');

  const script = globalThis.generationState.items[0];
  D.addVariant(globalThis.generationState, script.id, { text: 'Лена ищет дорогу домой.' });
  D.approve(globalThis.generationState, script.id);
  const ready = structuredClone(globalThis.generationState);
  const input = (models = imageModels, count = 2) => ({
    revision: globalThis.generationState.revision, batchId: D.id(), itemId: hero.id, models, count,
    prompt: 'Сопоставь все фотографии, сохрани внешность героя.', refs: [], dialogue: '', voiceId: '', estimates: {},
  });
  globalThis.generationKeyLookups.length = 0;
  globalThis.generationAssetLookups.length = 0;
  const payload = input();
  const comparison = await generate(request(payload), context());
  assert.equal(comparison.status, 200, await comparison.clone().text());
  assert.equal(globalThis.generationState.jobs.length, 8);
  for (const model of imageModels) assert.equal(globalThis.generationState.jobs.filter((job) => job.model === model).length, 2);
  assert.deepEqual(new Set(globalThis.generationKeyLookups), new Set(['openai', 'xai', 'bfl']));
  assert.deepEqual(globalThis.generationAssetLookups, profile.refs);
  for (const job of globalThis.generationState.jobs) {
    assert.equal(job.status, 'queued');
    assert.equal(job.kind, 'image');
    assert.equal(job.batchId, payload.batchId);
    assert.equal(job.actual, null);
    assert.deepEqual(job.refs, profile.refs);
    assert.deepEqual(job.character, profile);
    assert.equal(job.deps, D.dependencies(ready, 1));
    assert(job.prompt.includes(profile.instructions));
  }
  const jobsBefore = structuredClone(globalThis.generationState.jobs);
  const storedRevision = globalThis.generationState.revision;
  assert.equal((await generate(request(payload), context())).status, 200, 'The same batch is an idempotent read even with the original revision.');
  assert.equal(globalThis.generationState.revision, storedRevision);
  assert.deepEqual(globalThis.generationState.jobs, jobsBefore);
  assert.equal((await save({ ...profile, name: 'Черновое имя', refs: [photos[5]], instructions: 'Новая задача для будущих запусков' }, hero.id)).status, 200);
  assert.deepEqual(globalThis.generationState.jobs, jobsBefore, 'Later draft photo/name/instruction edits must not rewrite existing jobs.');
  assert.equal(globalThis.generationState.items.find((item) => item.id === hero.id).approvedId, undefined);
  console.log('PASS generation models: four image models create eight queued jobs with frozen five-photo inputs and profile snapshots; batch retry adds no jobs');

  globalThis.generationState = structuredClone(ready);
  globalThis.generationKeyLookups.length = 0;
  const beforeFive = structuredClone(globalThis.generationState);
  // The catalogue has exactly four image models. Repeating a valid fifth entry
  // isolates the payload-count limit from unknown-model or mixed-kind checks.
  const five = await generate(request(input([...imageModels, imageModels[0]])), context());
  assert.equal(five.status, 400, 'Five model entries exceed the comparison limit.');
  assert.deepEqual(globalThis.generationState, beforeFive);
  assert.deepEqual(globalThis.generationKeyLookups, [], 'Reject the invalid comparison before looking up provider credentials.');
  const overReferenceLimit = await generate(request({ ...input(), refs: [photos[5]] }), context());
  assert.equal(overReferenceLimit.status, 400, 'Grok in a comparison still limits the merged input to five references.');
  assert.deepEqual(globalThis.generationState, beforeFive, 'A per-model limit rejects the whole comparison before any job is saved.');
  assert.equal(networkCalls, 0);
  console.log('PASS generation models: five-model payload and six merged references are rejected atomically. No external or paid requests.');
} finally {
  globalThis.fetch = previousFetch;
  delete globalThis.generationState;
  delete globalThis.generationAssets;
  delete globalThis.generationKeyLookups;
  delete globalThis.generationAssetLookups;
}
