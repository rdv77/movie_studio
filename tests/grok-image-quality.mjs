import { build } from 'esbuild';
import assert from 'node:assert/strict';

await build({
  entryPoints: ['lib/providers.ts', 'lib/image-quality.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'work/tests/grok-image-quality',
  outExtension: { '.js': '.mjs' },
});
const P = await import('../work/tests/grok-image-quality/providers.mjs');
const I = await import('../work/tests/grok-image-quality/image-quality.mjs');

assert.deepEqual(I.FINAL_IMAGE_SETTINGS, { quality: 'medium', resolution: '2k' });
assert.deepEqual(I.LEGACY_IMAGE_SETTINGS, { quality: 'low', resolution: '1k' });
for (const quality of ['low', 'medium']) {
  for (const resolution of ['1k', '2k']) {
    assert.deepEqual(I.imageSettingsSchema.parse({ quality, resolution }), { quality, resolution });
  }
}
assert.equal(I.imageSettingsSchema.safeParse({ quality: 'high', resolution: '2k' }).success, false);
assert.equal(I.imageSettingsSchema.safeParse({ quality: 'medium', resolution: '4k' }).success, false);

for (const count of [0, 1, 3]) {
  const inputTicks = BigInt(count) * 100000000n;
  assert.equal(I.grokImageEstimate(undefined, count), (800000000n + inputTicks).toString(), 'New estimates use the final mode.');
  assert.equal(I.grokImageEstimate(I.FINAL_IMAGE_SETTINGS, count), (800000000n + inputTicks).toString());
  assert.equal(I.grokImageEstimate(I.LEGACY_IMAGE_SETTINGS, count), (400000000n + inputTicks).toString());
  assert.equal(I.grokImageEstimate({ quality: 'low', resolution: '2k' }, count), (600000000n + inputTicks).toString());
  assert.equal(I.grokImageEstimate({ quality: 'medium', resolution: '1k' }, count), (600000000n + inputTicks).toString());
}
assert.equal(I.grokImageEstimate(), '800000000');

const model = 'grok-imagine-image-2.0';
const key = 'offline-grok-test-secret';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=';
const receiptTicks = '1234567890';
const originalFetch = globalThis.fetch;
let calls = 0;
let expected;
let response;
try {
  globalThis.fetch = async (url, options) => {
    calls++;
    assert(expected, 'Only explicitly expected calls may reach the mock provider.');
    assert.equal(String(url), `https://api.x.ai/v1/images/${expected.refs.length ? 'edits' : 'generations'}`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body);
    assert.equal(body.model, model);
    assert.equal(body.prompt, expected.job.prompt);
    assert.equal(body.n, 1);
    assert.equal(body.quality, expected.settings.quality);
    assert.equal(body.resolution, expected.settings.resolution);
    assert.equal(body.aspect_ratio, expected.format);
    assert.deepEqual(body.image, expected.refs.length === 1 ? { url: expected.refs[0], type: 'image_url' } : undefined);
    assert.deepEqual(body.images, expected.refs.length > 1 ? expected.refs.map(url => ({ url, type: 'image_url' })) : undefined);
    return Response.json(response);
  };

  // Explicit settings cover text-to-image and both single/multiple-reference editing.
  // A missing setting on a persisted job must keep the old, paid-request contract.
  for (const settings of [I.FINAL_IMAGE_SETTINGS, I.LEGACY_IMAGE_SETTINGS, undefined]) {
    for (const count of [0, 1, 3]) {
      const refs = Array.from({ length: count }, () => png);
      const effective = settings ?? I.LEGACY_IMAGE_SETTINGS;
      const estimate = I.grokImageEstimate(effective, count);
      const job = {
        model, kind: 'image', prompt: 'Один анимационный герой у окна, без надписей.',
        refs, estimate, actual: null,
        ...(settings ? { imageSettings: { ...settings } } : {}),
      };
      const before = structuredClone(job);
      expected = { refs, settings: effective, job, format: count === 1 ? '9:16' : '16:9' };
      const usage = { cost_in_usd_ticks: receiptTicks };
      response = { id: `quality-test-${calls + 1}`, data: [{ url: 'https://cdn.example/quality-image.png' }], usage };
      const result = await P.generate(job, key, refs, expected.format);
      assert.equal(result.url, 'https://cdn.example/quality-image.png');
      assert.equal(result.actual, receiptTicks, 'Use the API billing receipt, not the estimate.');
      assert.notEqual(result.actual, estimate);
      assert.deepEqual(result.usage, usage);
      assert.equal(result.requestId, response.id);
      assert.deepEqual(job, before, 'Provider execution cannot silently rewrite the persisted estimate or old settings.');
    }
  }
  assert.equal(calls, 9);

  const beforeInvalid = calls;
  for (const imageSettings of [
    { quality: 'high', resolution: '2k' },
    { quality: 'medium', resolution: '4k' },
  ]) {
    expected = undefined;
    await assert.rejects(() => P.generate({ model, kind: 'image', prompt: 'Герой', imageSettings }, key, [], '16:9'));
  }
  assert.equal(calls, beforeInvalid, 'Invalid quality/resolution must fail before an API call.');

  expected = {
    refs: [], settings: I.FINAL_IMAGE_SETTINGS,
    job: { model, kind: 'image', prompt: 'Герой', imageSettings: I.FINAL_IMAGE_SETTINGS },
    format: '16:9',
  };
  response = { id: 'no-billing-receipt', data: [{ url: 'https://cdn.example/quality-image.png' }] };
  const unknown = await P.generate(expected.job, key, [], expected.format);
  assert.equal(unknown.actual, null, 'Missing billing information is unknown, not zero or a tariff-derived actual.');
  response = {
    id: 'invalid-billing-receipt', data: [{ url: 'https://cdn.example/quality-image.png' }],
    usage: { cost_in_usd_ticks: 'invalid' },
  };
  const invalid = await P.generate(expected.job, key, [], expected.format);
  assert.equal(invalid.actual, null);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS Grok image quality: final and legacy contracts, generation/edit requests, 0/1/3 reference tariffs, preflight rejection, API receipts separated from estimates, missing-cost handling. No paid calls.');

// Exercise real admission and budget logic with an in-memory, project-scoped server.
await build({
  stdin: { resolveDir: process.cwd(), contents: `
    export * as D from './lib/domain';
    export { preparePlanCards } from './lib/storyboard';
    export { POST as generate } from './app/api/projects/[id]/generate/route';
    export { POST as generateStoryboard } from './app/api/projects/[id]/generate-storyboard/route';
    export { PATCH } from './app/api/projects/[id]/route';
  ` },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/grok-image-quality/api.mjs',
  plugins: [{ name: 'offline-grok-quality-server', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/server$/ }, () => ({ path: 'server', namespace: 'grok-quality-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'grok-quality-test' }, () => ({ contents: `
      export const api = fn => async (req, ctx) => {
        try { return await fn(req, ctx); }
        catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 400 }); }
      };
      export const owner = async () => 'owner';
      export const loadProject = async (_, id) => {
        if (id !== globalThis.grokQualityState.id) throw Error('Wrong project');
        return structuredClone(globalThis.grokQualityState);
      };
      export const saveProject = async (_, p, revision) => {
        if (p.id !== globalThis.grokQualityState.id || revision !== globalThis.grokQualityState.revision)
          throw Error('Revision conflict');
        globalThis.grokQualitySaves++;
        p.revision++; globalThis.grokQualityState = structuredClone(p); return p;
      };
      export const getKey = async () => 'offline-test-key';
      export const asset = async (_, id, project) => {
        if (!project || project.id !== globalThis.grokQualityState.id) throw Error('Missing project scope');
        const value = globalThis.grokQualityAssets.get(id);
        if (!value || value.projectId !== project.id) throw Error('Foreign asset');
        return value;
      };
    ` }));
  } }],
});
const A = await import('../work/tests/grok-image-quality/api.mjs');
const D = A.D;
globalThis.grokQualitySaves = 0;
function fixture() {
  const p = D.newProject('Grok quality admission');
  const script = JSON.stringify({ shots: Array.from({ length: 10 }, (_, n) => ({
    title: `Plan ${n + 1}`, description: 'Анимационный герой у окна.', duration: p.seconds / 10,
    camera: 'Средний план', dialogue: '', continuity: 'Прямая склейка', speechType: 'none',
  })) });
  for (const item of p.items.filter(i => i.stage < 5).sort((a, b) => D.stagePosition(a.stage) - D.stagePosition(b.stage))) {
    D.addVariant(p, item.id, { text: item.stage === 4 ? script : 'Утверждённая основа' });
    D.approve(p, item.id);
  }
  A.preparePlanCards(p);
  globalThis.grokQualityAssets = new Map();
  const refs = Array.from({ length: 3 }, () => {
    const id = D.id();
    globalThis.grokQualityAssets.set(id, { id, projectId: p.id, mime: 'image/png', size: 1000 });
    return id;
  });
  globalThis.grokQualityState = structuredClone(p);
  return { p, refs, frames: p.items.filter(i => i.stage === 5 && !i.planArchive).slice(0, 3) };
}
const apiRequest = body => new Request('http://localhost/api/offline-grok-quality', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const apiContext = () => ({ params: Promise.resolve({ id: globalThis.grokQualityState.id }) });
const singleInput = (frame, refs, settings = I.FINAL_IMAGE_SETTINGS) => ({
  revision: globalThis.grokQualityState.revision, batchId: D.id(), itemId: frame.id,
  models: [model], count: 1, prompt: 'Создай кадр по утверждённой постановке.',
  refs, referenceMode: 'selected', dialogue: '', voiceId: '', estimates: { [model]: '1' },
  ...(settings ? { imageSettings: settings } : {}),
});
const batchInput = (frames, refs, settings = I.FINAL_IMAGE_SETTINGS) => ({
  revision: globalThis.grokQualityState.revision, batchId: D.id(), model,
  refs, referenceMode: 'selected', estimate: '1',
  ...(settings ? { imageSettings: settings } : {}),
  plans: frames.map((frame, n) => ({
    itemId: frame.id, prompt: 'Создай кадр по утверждённой постановке.', refs: refs.slice(0, [0, 1, 3][n]),
  })),
});
let forbiddenCalls = 0;
try {
  globalThis.fetch = async () => {
    forbiddenCalls++;
    throw Error('Provider calls are forbidden while admitting API jobs.');
  };

  for (const count of [0, 1, 3]) {
    const { frames, refs } = fixture();
    const expectedTicks = ['800000000', '900000000', '1100000000'][[0, 1, 3].indexOf(count)];
    const response = await A.generate(apiRequest(singleInput(frames[0], refs.slice(0, count))), apiContext());
    assert.equal(response.status, 200, await response.clone().text());
    const [job] = globalThis.grokQualityState.jobs;
    assert.equal(globalThis.grokQualityState.jobs.length, 1);
    assert.deepEqual(job.imageSettings, I.FINAL_IMAGE_SETTINGS);
    assert.deepEqual(job.refs, refs.slice(0, count));
    assert.equal(job.estimate, expectedTicks, 'The server ignores the supplied one-tick Grok estimate.');
    assert.equal(job.actual, null);
    assert.equal(job.status, 'queued');
  }

  {
    const { frames } = fixture();
    const response = await A.generate(apiRequest(singleInput(frames[0], [], null)), apiContext());
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(globalThis.grokQualityState.jobs[0].imageSettings, I.FINAL_IMAGE_SETTINGS, 'New API jobs default to final settings; old persisted jobs retain their legacy contract.');
    assert.equal(globalThis.grokQualityState.jobs[0].estimate, '800000000');
  }

  {
    const { frames, refs } = fixture();
    globalThis.grokQualityState.limit = '2800000000';
    const input = batchInput(frames, refs);
    const response = await A.generateStoryboard(apiRequest(input), apiContext());
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(globalThis.grokQualityState.jobs.map(j => j.estimate), ['800000000', '900000000', '1100000000']);
    assert.equal(D.totals(globalThis.grokQualityState).reserved, '2800000000', 'Reserve the sum of actual per-plan inputs, not a shared maximum or client estimate.');
    for (const [n, job] of globalThis.grokQualityState.jobs.entries()) {
      assert.deepEqual(job.imageSettings, I.FINAL_IMAGE_SETTINGS);
      assert.deepEqual(job.refs, refs.slice(0, [0, 1, 3][n]));
      assert.equal(job.actual, null);
    }
    const beforeRepeat = structuredClone(globalThis.grokQualityState);
    assert.equal((await A.generateStoryboard(apiRequest(input), apiContext())).status, 200);
    assert.deepEqual(globalThis.grokQualityState, beforeRepeat, 'An admission retry does not reserve or enqueue twice.');
  }

  for (const operation of ['single', 'batch']) {
    const { frames, refs } = fixture();
    globalThis.grokQualityState.limit = operation === 'single' ? '799999999' : '2799999999';
    const before = structuredClone(globalThis.grokQualityState);
    const saves = globalThis.grokQualitySaves;
    const input = operation === 'single' ? singleInput(frames[0], []) : batchInput(frames, refs);
    const handler = operation === 'single' ? A.generate : A.generateStoryboard;
    const rejected = await handler(apiRequest(input), apiContext());
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /лимит/);
    assert.deepEqual(globalThis.grokQualityState, before, 'A budget rejection cannot enqueue any job or mutate project state.');
    assert.equal(globalThis.grokQualitySaves, saves);
  }

  {
    const { frames, refs } = fixture();
    const item = globalThis.grokQualityState.items.find(i => i.id === frames[0].id);
    const assetId = refs[0], jobId = D.id();
    const generated = D.makeVariant(globalThis.grokQualityState, item, {
      kind: 'image', assetId, model, jobId, imageSettings: I.FINAL_IMAGE_SETTINGS,
      title: 'Созданное изображение', text: 'Исходная постановка',
    });
    item.variants.push(generated); item.selectedId = generated.id;
    const edited = D.makeVariant(globalThis.grokQualityState, item, {
      kind: 'image', assetId, title: 'Уточнённая постановка', text: 'Изменены только указания камеры.',
    });
    assert.deepEqual(edited.imageSettings, generated.imageSettings);
    assert.equal(edited.model, model);
    assert.equal(edited.jobId, jobId);
    assert.notEqual(edited.id, generated.id);
    const manual = await A.PATCH(apiRequest({
      revision: globalThis.grokQualityState.revision, action: 'addVariant', itemId: item.id,
      data: { kind: 'image', assetId, title: 'Ручные правки', text: 'Та же картинка, новая постановка.', refs: [] },
    }), apiContext());
    assert.equal(manual.status, 200, await manual.clone().text());
    const stored = globalThis.grokQualityState.items.find(i => i.id === item.id).variants.at(-1);
    assert.deepEqual(stored.imageSettings, I.FINAL_IMAGE_SETTINGS);
    assert.equal(stored.model, model);
    assert.equal(stored.jobId, jobId);
    assert.equal(stored.assetId, assetId);
  }

  assert.equal(forbiddenCalls, 0, 'All API tests enqueue or reject locally without any provider call.');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.grokQualityState;
  delete globalThis.grokQualityAssets;
  delete globalThis.grokQualitySaves;
}
console.log('PASS Grok quality API: server-owned estimates, per-plan reference costs, atomic budget rejection, final defaults, persisted settings, same-file edit provenance and idempotency. No paid calls.');
