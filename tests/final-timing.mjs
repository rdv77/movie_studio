import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
// Exercise renderFilm's final-video branch with the real local WASM engine.
const plugin={name:'local-render',setup(b){
 b.onResolve({filter:/^@ffmpeg\/ffmpeg$/},()=>({path:'ff',namespace:'test'}));
 b.onResolve({filter:/^\.\/wasm$/},()=>({path:'wasm',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='ff'?'export const FFmpeg=globalThis.TestFFmpeg;':'export const wasmUrl=async()=>"";'}));
}};
await build({entryPoints:['lib/render.ts','lib/domain.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/final-timing',outExtension:{'.js':'.mjs'},plugins:[plugin]});
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};
globalThis.location={origin:'http://localhost'};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');
const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let logs=[];core.setLogger(({message})=>logs.push(message));
const exec=args=>{core.reset();const code=core.exec(...args);if(code!==0)throw new Error(logs.slice(-15).join('\n'));return code;};
exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=24','-t','6','-c:v','libx264','-preset','ultrafast','-threads','1','source.mp4']);
const files=new Map([['video',new Uint8Array(core.FS.readFile('source.mp4'))]]);
for(const [name,duration] of [['voice-a',4.6],['voice-b',1]]){
 exec(['-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-c:a','pcm_s16le','-f','wav',name]);
 files.set(name,new Uint8Array(core.FS.readFile(name)));
}
let commands=[];
let simulatedLargeOutput=false;
globalThis.TestFFmpeg=class {
 async load(){} terminate(){}
 async writeFile(n,data){core.FS.writeFile(n,data);}
 async readFile(n){
   if(n==='film.mp4'&&!simulatedLargeOutput){simulatedLargeOutput=true;const bytes=new Uint8Array(50*1024*1024+1);bytes.set(core.FS.readFile(n));return bytes;}
   return core.FS.readFile(n);
 }
 async deleteFile(n){core.FS.unlink(n);}
 async exec(args){commands.push(args);return exec(args);}
 async ffprobe(args){core.reset();return core.ffprobe(...args);}
};
globalThis.fetch=async url=>{const bytes=files.get(String(url).split('/').pop());assert(bytes,'Unexpected external request');return new Response(bytes);};
const D=await import('../work/tests/final-timing/domain.mjs'),R=await import('../work/tests/final-timing/render.mjs');
const p=D.newProject('Финальный монтаж');p.speechMode='plans';p.seconds=49;
const shots=Array.from({length:10},(_,n)=>({title:`План ${n+1}`,description:'Дети идут',duration:n===1?4:5,camera:'Статичная',continuity:'Прямая склейка',dialogue:n===1||n===2?'КАТЯ: Привет.':''}));
for(const i of p.items.filter(i=>i.stage<5)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
for(const stage of [5,6,7])for(const [n,shot] of shots.entries()){
 if(stage===6&&!shot.dialogue)continue;
 const item={id:D.id(),stage,title:shot.title,sourceShot:{scriptId:p.items.find(i=>i.stage===4).id,title:shot.title},variants:[]};p.items.push(item);
 D.addVariant(p,item.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:stage===6?(n===1?'voice-a':'voice-b'):'video',duration:shot.duration,trim:0});D.approve(p,item.id);
}
const before=structuredClone(p);
const needed=R.fitPlanToSpeech(R.editPlan(p,false),[4.6,1]);
assert.equal(needed.clips[1].duration,4.625);assert.equal(needed.audio[1].offset,9.625);assert.equal(needed.seconds,49.625);
R.validateVideoDuration(needed.clips[1],6,'План 2');
assert.throws(()=>R.validateVideoDuration({...needed.clips[1],trim:2},6,'План 2'),/доступно 4.00/);
assert.throws(()=>R.validateVideoDuration(needed.clips[1],NaN,'План 2'),/определить длительность/);
// Small output size keeps this integration test fast; production dimensions are unchanged.
globalThis.TestFFmpeg.prototype.exec=async function(args){
 const adapted=args.map(x=>typeof x==='string'?x.replace('scale=1920:1080','scale=160:90').replace('pad=1920:1080','pad=160:90'):x);
 commands.push(adapted);return exec(adapted);
};
const result=await R.renderFilm(p,false,()=>{});
assert(simulatedLargeOutput);assert(!commands.some(a=>a.includes('compact.mp4')));
assert.equal(result.blob.size,50*1024*1024+1,'Oversized output is returned without an extra compression pass');
assert.deepEqual(new Uint8Array(await result.blob.slice(0,core.FS.readFile('film.mp4').length).arrayBuffer()),core.FS.readFile('film.mp4'));
assert.equal(result.seconds,49.625);assert.match(result.timing,/2\. 4.625 сек/);assert.deepEqual(p,before);
assert(commands.some(a=>a.includes('clip1.mp4')&&a.includes('4.625')));
assert(commands.some(a=>a.join(' ').includes('adelay=9625')));
core.reset();core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json','-o','final-probe.json','film.mp4');
const info=JSON.parse(new TextDecoder().decode(core.FS.readFile('final-probe.json')));
assert(Math.abs(Number(info.format.duration)-49.625)<0.05);assert(info.streams.some(s=>s.codec_type==='audio'));
assert.equal(info.streams.find(s=>s.codec_type==='video').width,160);
assert.equal(info.streams.find(s=>s.codec_type==='video').height,90);
for(const start of [9.2,9.8]){logs=[];exec(['-v','info','-ss',String(start),'-i','film.mp4','-t','0.15','-af','volumedetect','-vn','-f','null','-']);
 const volume=logs.map(s=>s.match(/max_volume: (-?[\d.]+) dB/)).find(Boolean);assert(volume&&Number(volume[1])>-40,'Full tail and next voice must be audible');}
await writeFile('work/tests/final-timing.mp4',core.FS.readFile('film.mp4'));
const short=structuredClone(p);D.chosen(short.items.filter(i=>i.stage===7)[1]).trim=2;
await assert.rejects(()=>R.renderFilm(short,false,()=>{}),/доступно 4.00/);
// A sync result may end one frame before its requested, frame-aligned duration.
// Render the actual short media: the missing frame must be cloned and the separate
// approved voice must still sound through its original end, beyond the source video.
exec(['-f','lavfi','-i','testsrc2=size=160x90:rate=24','-frames:v','110','-c:v','libx264','-preset','ultrafast','-threads','1','sync-short.mp4']);
files.set('sync-short',new Uint8Array(core.FS.readFile('sync-short.mp4')));
const sync=structuredClone(p);
const syncClip=D.chosen(sync.items.filter(i=>i.stage===7)[1]);
const voice=sync.items.find(i=>i.stage===6);
syncClip.assetId='sync-short';
syncClip.lipsync={inputType:'image',imageVariantId:'approved-image',imageItemId:'storyboard',audioVariantId:voice.approvedId,audioItemId:voice.id,speaker:{x:0.5,y:0.5},prompt:'Speak naturally.'};
const syncNeeded=R.fitPlanToSpeech(R.editPlan(sync,false),[4.6,1]);
R.validateVideoDuration(syncNeeded.clips[1],110/24,'План 2');
assert.throws(()=>R.validateVideoDuration({...syncNeeded.clips[1],lipsync:undefined},110/24,'План 2'),/доступно/);
assert.throws(()=>R.validateVideoDuration(syncNeeded.clips[1],109/24,'План 2'),/доступно/);
const syncBefore=structuredClone(sync);
const syncResult=await R.renderFilm(sync,false,()=>{});
assert.equal(syncResult.seconds,49.625);assert.deepEqual(sync,syncBefore);
core.reset();assert(core.ffprobe('-v','error','-count_frames','-show_entries','stream=codec_type,duration,nb_read_frames','-of','json','-o','sync-clip-probe.json','clip1.mp4')<=0);
const syncInfo=JSON.parse(new TextDecoder().decode(core.FS.readFile('sync-clip-probe.json'))).streams.find(s=>s.codec_type==='video');
assert.equal(Number(syncInfo.nb_read_frames),111,'Exactly one missing frame is restored');
assert(Math.abs(Number(syncInfo.duration)-4.625)<0.001);
// Compare before lossy H.264 encoding, which may encode identical frames differently.
const paddedArgs=R.clipArgs(syncNeeded.clips[1],1,160,90,false);
const paddedFilter=paddedArgs[paddedArgs.indexOf('-vf')+1];
exec(['-i','sync-short.mp4','-t','4.625','-vf',paddedFilter+',select=gte(n\\,109)','-fps_mode','passthrough','-f','framemd5','sync-tail.md5']);
const tail=new TextDecoder().decode(core.FS.readFile('sync-tail.md5')).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
assert.equal(tail.length,2);assert.equal(tail[0],tail[1],'The added frame is a clone of the last source frame');
logs=[];exec(['-v','info','-ss','9.585','-i','film.mp4','-t','0.012','-af','volumedetect','-vn','-f','null','-']);
const tailVolume=logs.map(s=>s.match(/max_volume: (-?[\d.]+) dB/)).find(Boolean);
assert(tailVolume&&Number(tailVolume[1])>-40,'Speech remains audible after the short source video ends at 9.5833s');
const ordinaryShort=structuredClone(sync);delete D.chosen(ordinaryShort.items.filter(i=>i.stage===7)[1]).lipsync;
await assert.rejects(()=>R.renderFilm(ordinaryShort,false,()=>{}),/доступно/);
const syncTooShort=structuredClone(sync);D.chosen(syncTooShort.items.filter(i=>i.stage===7)[1]).trim=1/24;
await assert.rejects(()=>R.renderFilm(syncTooShort,false,()=>{}),/доступно/);
console.log('PASS real final render: complete speech, shifted cuts, 49.625s MP4, oversized output preserved, one-frame sync shortfall cloned with audible speech tail, ordinary and more-than-one-frame shortfalls rejected.');
