import {build} from 'esbuild';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:"export {generate} from './lib/providers';export * as D from './lib/domain';export * as V from './lib/voice-direction';export * as S from './lib/soundscape';export {VoiceStudioShell} from './app/voice-studio-shell';"},bundle:true,platform:'node',format:'esm',outfile:'work/tests/hero-ai-audio.mjs',external:['react','react-dom']});
const {generate,D,V,S,VoiceStudioShell}=await import('../work/tests/hero-ai-audio.mjs');
const originalFetch=globalThis.fetch,calls=[];
globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return Response.json(String(url).includes('openai.com')?{id:'test',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'описание'}]}],usage:{input_tokens:10}}:{id:'test',choices:[{message:{content:'описание'}}],usage:{input_tokens:10}});};
try{
 const refs=['data:image/png;base64,aGVybw==','data:image/jpeg;base64,cGhvdG8='];
 const j={kind:'text',model:'gpt-6-astra',prompt:'Герой: сохранить лицо; роль по сценарию',duration:0};
 const result=await generate(j,'mock-key',refs,'16:9');assert.equal(result.text,'описание');assert.deepEqual(calls[0].body.input[0].content,[{type:'input_text',text:j.prompt},...refs.map(image_url=>({type:'input_image',image_url,detail:'high'}))]);
 await generate({...j,model:'grok-4.6'},'mock-key',refs,'16:9');assert.deepEqual(calls[1].body.messages[1].content,[{type:'text',text:j.prompt},...refs.map(url=>({type:'image_url',image_url:{url,detail:'high'}}))]);
 await assert.rejects(generate({...j,model:'MiniMax-M2.7'},'mock-key',refs,'16:9'),/не принимает фотографии/);assert.equal(calls.length,2);
 await generate(j,'mock-key',[],'16:9');assert.equal(calls[2].body.input,j.prompt,'Legacy text-only request is unchanged');
}finally{globalThis.fetch=originalFetch;}
const p=D.newProject('Другой фильм'),before=JSON.stringify(p);
const render=(soundStage)=>renderToStaticMarkup(React.createElement(VoiceStudioShell,{p,soundStage,busy:false,submit:async()=>{throw Error('Viewing must not request API');}}));
assert(render(true).includes('Пропустить создание голосов'));assert(!render(true).includes('Создать варианты голоса'));
assert.equal(JSON.stringify(p),before,'Opening the optional sound stage does not mutate the project');
V.voiceStudio(p).characterAudioMode='design';assert(render(true).includes('Создать варианты голоса'));assert(!render(false).includes('Создать варианты голоса'),'Speech stage uses saved voices; design exists only in Sounds');
assert(S.soundLayerSchema.safeParse({name:'Лягушка',kind:'vocal',scope:{type:'film'},settings:{},promptNotes:'Короткое кваканье, без слов'}).success);
console.log('PASS hero photo transport: two actual provider payloads, text-only compatibility, unsupported model rejects before HTTP. Optional sound modes render without generation; voice design only in Sounds; nonverbal character layer accepted. All HTTP mocked, no paid calls.');
