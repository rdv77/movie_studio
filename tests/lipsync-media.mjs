import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
await build({entryPoints:['lib/lipsync-media.ts','lib/domain.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/lipsync-media',outExtension:{'.js':'.mjs'},plugins:[{name:'local-media',setup(b){
 b.onResolve({filter:/^@ffmpeg\/ffmpeg$/},()=>({path:'ff',namespace:'test'}));
 b.onResolve({filter:/^\.\/wasm$/},()=>({path:'wasm',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='ff'?'export const FFmpeg=globalThis.TestFFmpeg;':'export const wasmUrl=async()=>"";'}));
}}]});
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};
globalThis.location={origin:'http://localhost'};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');
const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let logs=[];core.setLogger(({message})=>logs.push(message));
const exec=args=>{core.reset();const code=core.exec(...args);if(code)throw new Error(logs.slice(-15).join('\n'));return code};
exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=24','-t','6','-c:v','libx264','-preset','ultrafast','-threads','1','source.mp4']);
exec(['-f','lavfi','-i','sine=frequency=440:duration=5.2','-c:a','pcm_s16le','source.wav']);
const files=new Map([['v',new Uint8Array(core.FS.readFile('source.mp4'))],['a',new Uint8Array(core.FS.readFile('source.wav'))]]);
globalThis.fetch=async url=>{assert(String(url).startsWith('/api/assets/'));return new Response(files.get(String(url).split('/').pop()))};
globalThis.TestFFmpeg=class{
 async load(){} terminate(){}
 async writeFile(n,data){core.FS.writeFile(n,data)}
 async readFile(n){return core.FS.readFile(n)}
 async exec(args){return exec(args)}
 async ffprobe(args){core.reset();return core.ffprobe(...args)}
};
const {prepareLipsyncMedia,prepareLipsyncImage}=await import('../work/tests/lipsync-media/lipsync-media.mjs');
const D=await import('../work/tests/lipsync-media/domain.mjs');const p=D.newProject('Test');
const video=D.makeVariant(p,p.items[7],{kind:'video',assetId:'v',duration:4,trim:1});
const audio=D.makeVariant(p,p.items[6],{kind:'audio',assetId:'a',duration:4,trim:.6,volume:.7});
const out=await prepareLipsyncMedia(video,audio,()=>{});
assert.equal(out.seconds,4.625);assert.equal(out.video.type,'video/mp4');assert.equal(out.audio.type,'audio/wav');
for(const name of ['prepared.mp4','prepared.wav']){
 core.reset();assert(core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,r_frame_rate','-of','json','-o','check.json',name)<=0);
 const info=JSON.parse(new TextDecoder().decode(core.FS.readFile('check.json')));assert(Math.abs(Number(info.format.duration)-4.625)<.001);
 if(name.endsWith('mp4')){assert.equal(info.streams[0].r_frame_rate,'24/1');assert(!info.streams.some(s=>s.codec_type==='audio'))}
}
for(const start of [0,4.5]){logs=[];exec(['-v','info','-ss',String(start),'-i','prepared.wav','-t','0.08','-af','volumedetect','-vn','-f','null','-']);
 assert(logs.some(s=>/max_volume: -?[12]?\d\./.test(s)),'Speech beginning and full tail must be audible');}
await assert.rejects(()=>prepareLipsyncMedia({...video,trim:2},audio,()=>{}),/Не хватает/);
// MP3 container metadata can differ from HTMLMediaElement.duration. Pricing now
// uses the one duration returned with these exact prepared files.
exec(['-y','-i','source.wav','-c:a','libmp3lame','-b:a','128k','-ar','32000','source.mp3']);
files.set('mp3',new Uint8Array(core.FS.readFile('source.mp3')));
const mp3=await prepareLipsyncMedia(video,{...audio,assetId:'mp3'},()=>{});
assert(mp3.seconds>=4.6);assert(Number.isInteger(mp3.seconds*24));
for(const name of ['prepared.mp4','prepared.wav']){
 core.reset();core.ffprobe('-v','error','-show_entries','format=duration','-of','json','-o','mp3-check.json',name);
 const info=JSON.parse(new TextDecoder().decode(core.FS.readFile('mp3-check.json')));
 assert(Math.abs(Number(info.format.duration)-mp3.seconds)<.001,'Cost duration equals the files sent for processing');
}
console.log('PASS real WASM sync preparation: full speech retained with trims, equal MP4+WAV duration, MP3-derived duration matches prepared files and estimate, 24 fps, original audio removed, insufficient video rejected. No provider calls.');
exec(['-y','-f','lavfi','-i','color=c=blue:size=320x180','-frames:v','1','-threads','1','source.png']);
files.set('image',new Uint8Array(core.FS.readFile('source.png')));
const image=D.makeVariant(p,p.items[5],{kind:'image',assetId:'image',duration:4});
let imageCommands=[];globalThis.TestFFmpeg.prototype.exec=async function(args){imageCommands.push(args);return exec(args);};
const talking=await prepareLipsyncImage(image,audio,6,()=>{});
assert.equal(talking.seconds,6);assert.equal(talking.image.type,'image/png');assert.equal(talking.audio.type,'audio/wav');
assert.equal(talking.width,320);assert.equal(talking.height,180);
assert(!imageCommands.some(a=>a.includes('prepared.mp4')||a.includes('libx264')),'Direct image mode never creates intermediate video');
core.reset();core.ffprobe('-v','error','-show_entries','format=duration','-of','json','-o','image-audio.json','prepared.wav');
assert.equal(Number(JSON.parse(new TextDecoder().decode(core.FS.readFile('image-audio.json'))).format.duration),6);
logs=[];exec(['-v','info','-ss','4.5','-i','prepared.wav','-t','0.08','-af','volumedetect','-vn','-f','null','-']);
assert(logs.some(s=>/max_volume: -?[12]?\d\./.test(s)),'Image mode keeps the complete trimmed speech');
logs=[];exec(['-v','info','-ss','5.8','-i','prepared.wav','-t','0.08','-af','volumedetect','-vn','-f','null','-']);
assert(logs.some(s=>/max_volume: -91/.test(s)),'The end of the longer plan is padded with silence');
const extended=await prepareLipsyncImage(image,audio,4,()=>{});assert.equal(extended.seconds,4.625);
await assert.rejects(()=>prepareLipsyncImage(image,audio,16,()=>{}),/до 15/);
console.log('PASS real WASM image-to-video inputs: PNG + complete trimmed WAV, native pixel dimensions, exact speech-based timing, silence padding, no intermediate video or provider call.');
