import { build } from 'esbuild';
import { ProviderHarness } from './provider-harness.mjs';
import { strict as assert } from 'node:assert';

const bundled = await build({
  stdin: { resolveDir: process.cwd(), contents: `
    import { generate, retrieve } from './lib/providers';
    import { newProject, repairLegacyTransportFailures } from './lib/domain';
    export default { async fetch(req) {
      const input = await req.json();
      try {
        if (input.repair) {
          const project = newProject('Test'); project.jobs = input.jobs;
          const changed = repairLegacyTransportFailures(project);
          return Response.json({ changed, repeated: repairLegacyTransportFailures(project), jobs: project.jobs });
        }
        if (input.retrieve) {
          const file = await retrieve(input.retrieve);
          return Response.json({ size: file.bytes.length, mime: file.mime });
        }
        const result = await generate(input.job, input.key ?? 'test-key', ['data:image/png;base64,AA=='], '16:9');
        return Response.json(result);
      } catch(e) { return Response.json({ error: e.message, definite: e.definite, notSent: e.notSent }); }
    }};
  ` },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
});
let mode = 'success';
let calls = [];
let destination = '', redirectStatus = 302;
const mf = new ProviderHarness({
  modules: true, compatibilityDate: '2026-05-15', script: bundled.outputFiles[0].text,
  outboundService: async req => {
    const u = new URL(req.url);
    calls.push({ url: req.url, authorization: req.headers.get('authorization'), key: req.headers.get('x-key'), apiKey: req.headers.get('x-api-key'), cookie: req.headers.get('cookie') });
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://unexpected.invalid/' } });
    if (mode === 'chain') return new Response(null, { status: 302, headers: { location: '/hop-' + calls.length } });
    if (mode === 'media-redirect' && calls.length === 1) return new Response(null, { status: redirectStatus, headers: { location: destination } });
    if (mode === 'media-redirect') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    if (u.pathname.endsWith('/responses')) return Response.json({ id: 'openai-id', status: 'completed', usage: { input_tokens: 20, output_tokens: 30 }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Сценарий' }] }] });
    if (u.pathname.endsWith('/chat/completions')) return Response.json({ id: 'chat-id', choices: [{ message: { content: 'Сценарий' } }], base_resp: { status_code: 0 } });
    if (u.pathname.includes('/images/')) return Response.json({ id: 'image-id', data: [{ url: 'https://assets.example/result.png' }] });
    if (u.pathname.endsWith('/flux-2-pro')) return Response.json({ id: 'flux-id', polling_url: 'https://api.bfl.ai/v1/get_result?id=flux-id' });
    if (u.pathname.endsWith('/videos/generations')) return Response.json({ request_id: 'video-id' });
    if (u.pathname.endsWith('/video_generation')) return Response.json({ task_id: 'minimax-video-id' });
    if (u.pathname.endsWith('/t2a_v2')) return Response.json({ data: { audio: '0001' }, base_resp: { status_code: 0 } });
    if (u.hostname === 'api.elevenlabs.io') return new Response(new Uint8Array([0, 1]), { headers: { 'content-type': 'audio/mpeg' } });
    if (u.hostname === 'assets.example') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    throw new Error('Unexpected outbound test request: ' + u.origin + u.pathname);
  },
});
async function run(input) {
  return (await mf.dispatchFetch('http://test/', { method: 'POST', body: JSON.stringify(input) })).json();
}
try {
  for (const [model, kind] of [
    ['gpt-6-astra', 'text'], ['grok-4.6', 'text'], ['MiniMax-M2.7', 'text'],
    ['grok-imagine-image-2.0', 'image'], ['flux-2-pro', 'image'],
    ['grok-imagine-video-1.5', 'video'], ['MiniMax-Hailuo-2.3', 'video'],
    ['speech-2.8-hd', 'audio'], ['eleven_v3', 'audio'],
  ]) {
    calls = [];
    const result = await run({ job: { model, kind, prompt: 'Доработай', dialogue: 'Привет', voiceId: 'test-voice', duration: 6 } });
    assert(!result.error, model + ': ' + result.error);
    assert.equal(calls.length, 1, model + ' reaches transport once');
    if (kind === 'text') assert.equal(result.text, 'Сценарий');
  }
  assert.deepEqual(await run({ retrieve: 'https://assets.example/result.png' }), { size: 4, mime: 'image/png' });
  const job = { model: 'grok-4.6', kind: 'text', prompt: 'Доработай' };
  mode = 'redirect'; calls = [];
  const redirect = await run({ job });
  assert(redirect.definite && redirect.error.includes('перенаправил'));
  assert.equal(calls.length, 1, 'No credential forwarding to redirect target');
  calls = [];
  assert((await run({ retrieve: 'https://assets.example/result.png' })).error.includes('зациклена'));
  assert.equal(calls.length, 2);
  mode = 'media-redirect';
  for (const status of [301, 302, 303, 307, 308]) {
    redirectStatus = status; destination = 'https://cdn.example/signed.mp4?signature=test'; calls = [];
    assert.deepEqual(await run({ retrieve: 'https://assets.example/result.png' }), { size: 4, mime: 'image/png' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, destination);
    assert(calls.every(c => !c.authorization && !c.key && !c.apiKey && !c.cookie), 'Media redirects never carry provider credentials or cookies');
  }
  destination = '/relative.mp4'; calls = [];
  assert.equal((await run({ retrieve: 'https://assets.example/result.png' })).size, 4);
  assert.equal(calls[1].url, 'https://assets.example/relative.mp4');
  for (const target of ['http://cdn.example/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a', 'https://localhost./a', 'https://box.local/a', 'https://metadata.internal/a', 'https://user:secret@cdn.example/a', 'https://cdn.example:8080/a']) {
    destination = target; calls = [];
    assert((await run({ retrieve: 'https://assets.example/result.png' })).error.includes('Недопустимый'));
    assert.equal(calls.length, 1, 'Invalid redirect destination is rejected before fetching it');
  }
  mode = 'chain'; calls = [];
  assert((await run({ retrieve: 'https://assets.example/result.png' })).error.includes('Слишком много'));
  assert.equal(calls.length, 6);
  mode = 'success'; calls = [];
  const invalid = await run({ job, key: 'invalid\nheader' });
  assert(invalid.definite && invalid.notSent);
  assert.equal(calls.length, 0, 'Invalid request is not sent');
  const legacy = { id: 'legacy', status: 'unknown', started: '2026-09-08T18:53:32Z', actual: null,
    error: 'Связь с провайдером прервалась. Исход запроса неизвестен; автоматического повтора не будет.' };
  const cases = [legacy, { ...legacy, id: 'new', transportVersion: 2 }, { ...legacy, id: 'receipt', requestId: 'known' },
    { ...legacy, id: 'cost', actual: '12' }, { ...legacy, id: 'late', started: '2026-09-09T00:00:00Z' },
    { ...legacy, id: 'other', error: 'Different error' }, { ...legacy, id: 'usage', usage: { input_tokens: 1 } }];
  const repaired = await run({ repair: true, jobs: cases });
  assert(repaired.changed && !repaired.repeated);
  assert.equal(repaired.jobs[0].status, 'failed');
  assert.equal(repaired.jobs[0].actual, '0');
  for (let i = 1; i < cases.length; i++) assert.deepEqual(repaired.jobs[i], cases[i]);
  console.log('PASS workerd: all 9 model adapters, bounded validated media redirects, credential isolation, preflight not-sent classification and narrow idempotent legacy repair. All provider responses mocked; zero paid requests.');
} finally { await mf.dispose(); }
