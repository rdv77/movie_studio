import {build} from 'esbuild';
import {strict as assert} from 'node:assert';

await build({entryPoints:['lib/providers.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/minimax-text.mjs'});
const {generate}=await import('../work/tests/minimax-text.mjs');
const previousFetch=globalThis.fetch, previousTimeout=AbortSignal.timeout;
const job={kind:'text',model:'MiniMax-M2.7',purpose:'directing',prompt:'Верни сценарий в запрошенной JSON-схеме.',duration:0};
let calls=[],timeouts=[],response;
try {
  AbortSignal.timeout=ms=>{timeouts.push(ms);return new AbortController().signal;};
  globalThis.fetch=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body),method:options.method});
    return Response.json(response);
  };
  const run=async(change={},data={id:'text-1',choices:[{finish_reason:'stop',message:{content:'{"text":"Сценарий"}',reasoning_content:'Private reasoning'}}],usage:{prompt_tokens:7353,completion_tokens:10500}})=>{
    calls=[];timeouts=[];response=data;
    return generate({...job,...change},'fake-key',[],'16:9');
  };

  const complete=await run();
  assert.equal(complete.text,'{"text":"Сценарий"}');assert.equal(complete.requestId,'text-1');assert(!complete.error);
  assert.deepEqual(complete.usage,{prompt_tokens:7353,completion_tokens:10500});assert.equal(complete.actual,null);
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.minimax.io/v1/chat/completions');
  assert.equal(calls[0].body.max_tokens,16000);assert.equal(calls[0].body.reasoning_split,true);assert.equal(calls[0].body.stream,false);
  assert(!('reasoning_effort' in calls[0].body));assert(!('thinking' in calls[0].body));assert(!('response_format' in calls[0].body));
  assert(timeouts.length>0&&timeouts.every(ms=>ms===300000));assert(!JSON.stringify(complete).includes('Private reasoning'));

  // The larger budget/timeout are confined to MiniMax directing. Other
  // providers and prompt optimization keep their previous request contract.
  for(const [change,cap,timeout,lowReasoning] of [
    [{purpose:undefined},7000,180000,false],
    [{purpose:'prompt-optimization'},6000,120000,false],
    [{model:'grok-4.6'},7000,180000,false],
    [{model:'grok-4.6',purpose:'prompt-optimization'},6000,120000,true],
  ]) {
    await run(change);
    assert.equal(calls[0].body.max_tokens,cap);assert(timeouts.length>0&&timeouts.every(ms=>ms===timeout));
    assert(!('reasoning_split' in calls[0].body));
    assert.equal(calls[0].body.reasoning_effort,lowReasoning?'low':undefined);
  }

  const exhausted={id:'truncated-1',choices:[{finish_reason:'length',message:{content:'',reasoning_content:'Private reasoning'}}],usage:{prompt_tokens:7353,completion_tokens:16000,completion_tokens_details:{reasoning_tokens:16000}}};
  const empty=await run({},exhausted);
  assert.match(empty.error,/finish_reason=length/);assert.match(empty.error,/16000/);assert.match(empty.error,/7353/);
  assert.match(empty.error,/Лимит включает рассуждения/);assert.match(empty.error,/Итоговый текст не получен/);
  assert.equal(empty.requestId,'truncated-1');assert.deepEqual(empty.usage,exhausted.usage);assert(!empty.text);assert.equal(calls.length,1);
  assert(!JSON.stringify(empty).includes('Private reasoning'));

  const partial=await run({}, {...exhausted,choices:[{finish_reason:'length',message:{content:'<think>Private reasoning</think>{"text":"неполный'}}]});
  assert.equal(partial.text,'{"text":"неполный');assert.match(partial.error,/не применён/);assert.equal(calls.length,1);
  const unclosed=await run({}, {...exhausted,choices:[{finish_reason:'length',message:{content:'<think>Private reasoning'}}]});
  assert(!unclosed.text);assert(!JSON.stringify(unclosed).includes('Private reasoning'));
  const legacy=await run({}, {...exhausted,choices:[{finish_reason:'stop',message:{content:'<think>Private reasoning</think> Готово '}}]});
  assert.equal(legacy.text,'Готово');assert(!legacy.error);
  const noAnswer=await run({}, {...exhausted,choices:[{finish_reason:'stop',message:{content:null}}]});
  assert.match(noAnswer.error,/не вернул итоговый текст/);assert.deepEqual(noAnswer.usage,exhausted.usage);

  // A transport timeout still has an unknown paid outcome. Raising the token
  // budget must not introduce a second POST or label this as a known failure.
  calls=[];timeouts=[];
  globalThis.fetch=async()=>{calls.push('POST');throw new DOMException('timeout','TimeoutError');};
  await assert.rejects(()=>generate(job,'fake-key',[],'16:9'),error=>!error.definite&&!error.notSent&&/300 сек/.test(error.message)&&/не повторяется/.test(error.message));
  assert.equal(calls.length,1);assert(timeouts.length>0&&timeouts.every(ms=>ms===300000));
} finally {globalThis.fetch=previousFetch;AbortSignal.timeout=previousTimeout;}
console.log('PASS MiniMax directing: 16000 inclusive output budget, separate reasoning, bounded 300s timeout, truncation diagnostics/usage/partial answer, unchanged other contracts, no duplicate unknown POST.');
