import {build} from 'esbuild';
import A from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as V from './lib/voice-direction';export * as W from './lib/voice-design';export * as T from './lib/voice-tts';export {VoiceStudioEditor} from './app/voice-studio-editor';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/voice-tts.mjs',external:['react','react-dom','@ffmpeg/ffmpeg']});
const {D,V,W,T,VoiceStudioEditor}=await import('../work/tests/voice-tts.mjs');
let groups=0;async function test(name,fn){await fn();groups++;console.log('PASS voice TTS:',name);}
function fixture(){const p=D.newProject('Постановка голоса'),item=p.items.find(i=>i.stage===6);const j={id:D.id(),itemId:item.id,batchId:D.id(),model:'speech-2.8-hd',kind:'audio',voiceId:'old-voice',dialogue:'Я увидел корону. Теперь помогу тебе.',status:'queued',prompt:'Исходный текст',refs:[],brief:'Реплика',camera:'',continuity:'',duration:5,offset:0,volume:1,deps:'legacy',created:D.now(),estimate:null,actual:null};return {p,item,j};}
await test('legacy jobs and read-only aggregate UI preserve project and do not call APIs',async()=>{
 const {p,j}=fixture(),before=structuredClone(j);T.freezeVoiceJob(p,j);A.deepEqual(j,before);let calls=0;
 global.fetch=async()=>{calls++;throw Error('No call expected');};A.equal(await T.generateDirectedSpeech(j,'secret','minimax'),undefined);
 const original=structuredClone(p),html=renderToString(React.createElement(VoiceStudioEditor,{p,model:'grok-4.6',busy:false,submit:async()=>{calls++;}}));A(html.includes('Студия голосов'));A(html.includes('План для постановки реплики'));A.equal(calls,0);A.deepEqual(p,original);
});
await test('explicit profile and per-plan performance are frozen atomically without changing recordings',async()=>{
 const {p,item,j}=fixture(),audio=D.makeVariant(p,item,{kind:'audio',assetId:'existing-audio',dialogue:j.dialogue,voiceId:'old-voice',model:j.model});item.variants.push(audio);item.selectedId=audio.id;item.approvedId=audio.id;
 const profile=W.saveVoiceProfile(p,{name:'Младший',description:'Ясный голос',provider:'minimax',voiceId:'new-voice',delivery:{emotion:'happy',speed:1.1}});
 V.saveVoiceDelivery(p,item.id,{emotion:'fearful',speed:.9,intention:'Скрывает волнение',targetSeconds:5,pauses:[{after:'корону.',seconds:.4}]});
 T.freezeVoiceJob(p,j,{profileId:profile.id});const frozen=structuredClone(j);A.equal(j.voiceId,'new-voice');A.equal(j.voiceProfileId,profile.id);A.equal(j.voiceDelivery.emotion,'fearful');A(j.ttsRequestText.includes('<#0.40#>'));A.equal(j.dialogue,audio.dialogue);A(!JSON.stringify(T.frozenVoiceRequest(j,'minimax').body).includes('Скрывает волнение'));
 profile.voiceId='later';p.voiceStudio.deliveries[item.id].speed=1.2;A.deepEqual(j,frozen);A.equal(T.frozenVoiceRequest(j,'minimax').body.voice_setting.voice_id,'new-voice');A.equal(item.selectedId,audio.id);A.equal(item.approvedId,audio.id);
 const before=structuredClone(j);A.throws(()=>T.freezeVoiceJob(p,j,{profileId:D.id()}),/не найден/);A.deepEqual(j,before);
 const bad={...j,voiceDelivery:{pauses:[{after:'несуществующие слова',seconds:.5}]}};A.throws(()=>T.freezeVoiceJob(p,bad,{delivery:bad.voiceDelivery}),/Уточните место паузы/);A.equal(bad.ttsRequestText,j.ttsRequestText);
});
await test('a selected profile for another voice does not silently replace a job; tests require explicit delivery',async()=>{
 const {p,item,j}=fixture(),profile=W.saveVoiceProfile(p,{name:'Другой',description:'',provider:'minimax',voiceId:'another',delivery:{speed:1.2}});W.chooseVoiceProfile(p,profile.id);T.freezeVoiceJob(p,j);A.equal(j.voiceDelivery,undefined);A.equal(j.voiceId,'old-voice');
 V.saveVoiceDelivery(p,item.id,{speed:1.1});j.purpose='voice-test';T.freezeVoiceJob(p,j);A.equal(j.voiceDelivery,undefined);T.freezeVoiceJob(p,j,{delivery:{speed:.8}});A.equal(j.voiceDelivery.speed,.8);
});
await test('explicit row casting wins, saved plan casting precedes batch fallback, and voice tests ignore plan casting',async()=>{
 const {p,item,j}=fixture();const plan=W.saveVoiceProfile(p,{name:'План',description:'',provider:'minimax',voiceId:'plan-voice',delivery:{speed:.9}}),common=W.saveVoiceProfile(p,{name:'Общий',description:'',provider:'minimax',voiceId:'batch-voice',delivery:{speed:1.1}});
 W.assignVoiceProfile(p,item.id,plan.id);const row=structuredClone(j),testJob={...structuredClone(j),purpose:'voice-test'};T.freezeVoiceJob(p,j,{fallbackProfileId:common.id});A.equal(j.voiceId,'plan-voice');A.equal(j.voiceDelivery.speed,.9);T.freezeVoiceJob(p,row,{profileId:common.id});A.equal(row.voiceId,'batch-voice');T.freezeVoiceJob(p,testJob,{fallbackProfileId:common.id});A.equal(testJob.voiceId,'batch-voice');W.assignVoiceProfile(p,item.id);const cleared={...structuredClone(row),voiceId:'old-voice'};T.freezeVoiceJob(p,cleared,{fallbackProfileId:common.id});A.equal(cleared.voiceId,'batch-voice');
});
await test('MiniMax gets supported settings, distinct speech text, one real mocked request and receipt',async()=>{
 const {p,j}=fixture();T.freezeVoiceJob(p,j,{delivery:{emotion:'happy',speed:1.1,intention:'Не произносить эту задачу',targetSeconds:4,pauses:[{after:'корону.',seconds:.4}]}});let calls=0;
 global.fetch=async(url,init)=>{calls++;A.equal(url,'https://api.minimax.io/v1/t2a_v2');const body=JSON.parse(init.body);A.equal(body.voice_setting.emotion,'happy');A.equal(body.voice_setting.speed,1.1);A.equal(body.text,j.ttsRequestText);A(!init.body.includes('Не произносить'));A.equal(body.targetSeconds,undefined);A.equal(init.headers.Authorization,'Bearer private-secret');return Response.json({base_resp:{status_code:0},data:{audio:'494433'},trace_id:'mm-receipt',usage:{cost_in_usd_ticks:'43'},extra_info:{audio_length:5200}});};
 const result=await T.generateDirectedSpeech(j,'private-secret','minimax');A.equal(calls,1);A.deepEqual([...result.bytes],[73,68,51]);A.equal(result.actual,'43');A.equal(result.requestId,'mm-receipt');A.equal(j.dialogue,'Я увидел корону. Теперь помогу тебе.');
});
await test('ElevenLabs receives correct tags/settings and has no invented duration parameter',async()=>{
 const {p,j}=fixture();j.model='eleven_v3';j.voiceId='eleven-id';T.freezeVoiceJob(p,j,{delivery:{emotion:'sad',speed:.85,stability:0,targetSeconds:4,pauses:[{after:'корону.',seconds:2}]}});let calls=0;
 global.fetch=async(url,init)=>{calls++;A(url.includes('/v1/text-to-speech/eleven-id?'));const body=JSON.parse(init.body);A(body.text.startsWith('[sad]'));A(body.text.includes('[long pause]'));A.equal(body.voice_settings.stability,0);A.equal(body.voice_settings.speed,.85);A.equal(body.language_code,'ru');A.equal(body.duration,undefined);A.equal(init.headers['xi-api-key'],'private-secret');return new Response(new Uint8Array([73,68,51]),{headers:{'request-id':'el-receipt'}});};
 const result=await T.generateDirectedSpeech(j,'private-secret','elevenlabs');A.equal(calls,1);A.equal(result.actual,null);A.equal(result.requestId,'el-receipt');A.equal(result.mime,'audio/mpeg');
});
await test('local mismatch rejects before any paid dispatch; malformed paid response retains receipt',async()=>{
 const {p,j}=fixture();T.freezeVoiceJob(p,j,{delivery:{speed:1}});let calls=0;global.fetch=async()=>{calls++;return Response.json({base_resp:{status_code:0},data:{audio:'invalid'},trace_id:'paid',usage:{cost_in_usd_ticks:'19'}});};
 const bad={...j,ttsRequestText:'Changed after queue'};await A.rejects(()=>T.generateDirectedSpeech(bad,'private-secret','minimax'),e=>e.notSent===true);A.equal(calls,0);
 await A.rejects(()=>T.generateDirectedSpeech(j,'private-secret','minimax'),e=>e.definite===true&&e.receipt.actual==='19'&&e.receipt.requestId==='paid');A.equal(calls,1);
});
await test('transport unknown stays unknown and never retries',async()=>{
 const {p,j}=fixture();T.freezeVoiceJob(p,j,{delivery:{speed:1}});let calls=0;global.fetch=async()=>{calls++;throw Error('Transport');};await A.rejects(()=>T.generateDirectedSpeech(j,'private-secret','minimax'),e=>e.definite===false&&e.notSent===false);A.equal(calls,1);
});
console.log(`PASS ${groups} voice TTS/aggregate UI mock groups. No paid requests.`);
