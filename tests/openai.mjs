import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({ entryPoints: ['lib/providers.ts'], bundle: true, format: 'esm', platform: 'node', outfile: 'work/tests/openai-providers.mjs' });
const { generate } = await import('../work/tests/openai-providers.mjs');
const nativeFetch = globalThis.fetch;
const job = { kind: 'text', model: 'gpt-6-astra', prompt: 'Доработай выбранный сценарий, сохрани героев.' };
const usage = { input_tokens: 900, output_tokens: 1800, output_tokens_details: { reasoning_tokens: 500 } };
try {
  let call;
  globalThis.fetch = async (url, opts) => {
    call = { url, opts, body: JSON.parse(opts.body) };
    return Response.json({ id: 'response-test', status: 'completed', usage, output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Private reasoning' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Начало.' }, { type: 'output_text', text: 'Финал.' }] },
    ] });
  };
  const result = await generate(job, 'test-key', [], '16:9');
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.opts.headers.Authorization, 'Bearer test-key');
  assert.equal(call.opts.redirect, 'manual');
  assert.equal(call.body.model, 'gpt-6-astra');
  assert.equal(call.body.input, job.prompt);
  assert.equal(call.body.store, false);
  assert.equal(call.body.service_tier, 'default');
  assert.equal(call.body.max_output_tokens, 12000);
  assert.deepEqual(call.body.reasoning, { effort: 'medium' });
  assert.equal(call.body.temperature, undefined);
  assert.equal(result.text, 'Начало.\nФинал.');
  assert.equal(result.requestId, 'response-test');
  assert.deepEqual(result.usage, usage);
  assert.equal(result.actual, null);
  for (const status of ['incomplete', 'failed']) {
    globalThis.fetch = async () => Response.json({ id: 'partial-test', status, usage, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Оборванный сценарий' }] }] });
    const partial = await generate(job, 'test-key', [], '16:9');
    assert(partial.error);
    assert.equal(partial.text, undefined);
    assert.equal(partial.requestId, 'partial-test');
    assert.deepEqual(partial.usage, usage);
  }
  globalThis.fetch = async () => Response.json({ id: 'refusal-test', status: 'completed', usage, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Refused' }] }] });
  assert((await generate(job, 'test-key', [], '16:9')).error);
  globalThis.fetch = async () => Response.json({ error: { message: 'Do not expose provider internals' } }, { status: 401 });
  await assert.rejects(() => generate(job, 'test-key', [], '16:9'), e => e.definite && e.message.includes('401') && !e.message.includes('internals'));
  console.log('PASS OpenAI: authenticated routing, supported parameters, text extraction, usage retention, incomplete/refusal handling and safe API errors. No paid requests.');
} finally { globalThis.fetch = nativeFetch; }
