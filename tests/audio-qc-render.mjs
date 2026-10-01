import {build} from 'esbuild';
import A from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as Q from './lib/audio-qc';export {measureFilmAudio} from './lib/audio-qc-browser';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/audio-qc-render.mjs',plugins:[{name:'actual-local-ffmpeg',setup(b){b.onResolve({filter:/^@ffmpeg\/ffmpeg$/},()=>({path:'ff',namespace:'local'}));b.onResolve({filter:/^\.\/wasm$/},()=>({path:'wasm',namespace:'local'}));b.onLoad({filter:/.*/,namespace:'local'},a=>({contents:a.path==='ff'?'export const FFmpeg=globalThis.AudioQcFFmpeg':'export const wasmUrl=async()=>URL.createObjectURL(new Blob([]))'}));}}]});
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};globalThis.location={origin:'http://local'};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js'),core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});let logs=[];core.setLogger(({message})=>logs.push(message));
const exec=args=>{core.reset();const code=core.exec(...args);if(code)throw Error(logs.slice(-30).join('\n'));return code;};
exec(['-y','-f','lavfi','-i','color=c=blue:size=160x90:rate=24','-t','6','-c:v','libx264','-threads','1','no-audio.mp4']);
exec(['-y','-f','lavfi','-i',"aevalsrc='if(between(t,1,3)+between(t,4,5),0.2*sin(2*PI*440*t),0)':s=44100:d=6",'-c:a','pcm_f32le','sequence.wav']);
exec(['-y','-i','no-audio.mp4','-i','sequence.wav','-c:v','copy','-c:a','aac','-t','6','qc-film.mp4']);
const data=new Uint8Array(core.FS.readFile('qc-film.mp4')),noAudio=new Uint8Array(core.FS.readFile('no-audio.mp4'));await writeFile('work/tests/audio-qc-film.mp4',data);
let analysisCalls=0,terminations=0;
globalThis.AudioQcFFmpeg=class{
 listeners=new Set();async load(){}terminate(){terminations++;this.listeners.clear();}on(type,fn){if(type==='log')this.listeners.add(fn)}off(type,fn){this.listeners.delete(fn)}
 async writeFile(name,bytes){core.FS.writeFile(name,bytes)}async readFile(name){return core.FS.readFile(name)}async ffprobe(args){core.reset();return core.ffprobe(...args)}
 async exec(args){analysisCalls++;logs=[];core.setLogger(({message})=>{logs.push(message);for(const fn of this.listeners)fn({message});});return exec(args)}
};
const {D,Q,measureFilmAudio}=await import('../work/tests/audio-qc-render.mjs'),p=D.newProject('Реальная звуковая проверка'),film=p.items.find(i=>i.stage===8),v=D.makeVariant(p,film,{kind:'video',assetId:D.id(),duration:6});film.variants.push(v);film.selectedId=v.id;const before=structuredClone(p),loadAsset=async id=>{A.equal(id,v.assetId);return new Blob([data],{type:'video/mp4'})};
globalThis.fetch=async()=>{throw Error('No network or model request permitted');};
const report=await measureFilmAudio(p,film.id,v.id,{loadAsset});A(report.measurement.hasAudio);A(Math.abs(report.measurement.seconds-6)<.03);A(Math.abs(report.measurement.audioSeconds-6)<.05);A(report.measurement.peakDb<-10&&report.measurement.peakDb>-16,JSON.stringify(report.measurement));A(report.measurement.rmsDb<-16&&report.measurement.rmsDb>-24);A.equal(report.measurement.silence.length,3,JSON.stringify(report.measurement.silence));A(report.measurement.silence.every(s=>s.duration>.8));A(report.measurement.silence.some(s=>Math.abs(s.start-3)<.05&&Math.abs(s.end-4)<.05));A(report.evidence.some(line=>line.includes('Peak level dB')));A.equal(analysisCalls,1);A.equal(terminations,1);A.deepEqual(p,before);Q.assertAudioQcReportSource(p,report);
const absent=await measureFilmAudio(p,film.id,v.id,{loadAsset:async()=>new Blob([noAudio],{type:'video/mp4'})});A.equal(absent.measurement.hasAudio,false);A.equal(analysisCalls,1,'Missing track is measured, never guessed or run through an absent stream');A.equal(terminations,2);
await A.rejects(()=>measureFilmAudio(p,film.id,v.id,{loadAsset,settings:{maxSeconds:3}}),/всего более длинного фильма/);A.equal(analysisCalls,1);await A.rejects(()=>measureFilmAudio(p,film.id,v.id,{loadAsset:async()=>({size:Q.AUDIO_QC_MAX_BYTES+1})}),/256 МиБ/);A.equal(analysisCalls,1);const abort=new AbortController();abort.abort();await A.rejects(()=>measureFilmAudio(p,film.id,v.id,{loadAsset,signal:abort.signal}),e=>e.name==='AbortError');A.equal(analysisCalls,1);A.deepEqual(p,before);
console.log('PASS real audio QC: original 6-second final MP4 decoded by FFmpeg, actual peak/RMS, three measured silence intervals, audio duration, missing-track report, complete-file limits, abort/cleanup, immutable project and zero network/provider requests.');
