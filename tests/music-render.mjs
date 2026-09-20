import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const plugin={name:'render',setup(b){b.onResolve({filter:/^@ffmpeg\/ffmpeg$/},()=>({path:'ff',namespace:'mock'}));b.onResolve({filter:/^\.\/wasm$/},()=>({path:'wasm',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='ff'?'export const FFmpeg=globalThis.TestFFmpeg':'export const wasmUrl=async()=>""'}));}};
await build({entryPoints:['lib/render.ts','lib/domain.ts','lib/music.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/music-render',outExtension:{'.js':'.mjs'},plugins:[plugin]});
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};globalThis.location={origin:'http://test'};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let logs=[];core.setLogger(({message})=>logs.push(message));
const exec=args=>{core.reset();const code=core.exec(...args);if(code)throw Error(logs.slice(-20).join('\n'));return code;};
exec(['-f','lavfi','-i','color=c=blue:size=160x90:rate=24','-t','4','-c:v','libx264','-threads','1','source.mp4']);
const files=new Map([['video',new Uint8Array(core.FS.readFile('source.mp4'))]]);
for(const [name,freq,seconds] of [['voice',880,2],['music',220,3]]){exec(['-f','lavfi','-i',`sine=frequency=${freq}:duration=${seconds}`,'-c:a','pcm_s16le','-f','wav',name]);files.set(name,new Uint8Array(core.FS.readFile(name)));}
globalThis.TestFFmpeg=class{async load(){}terminate(){}async writeFile(n,b){core.FS.writeFile(n,b)}async readFile(n){return core.FS.readFile(n)}async deleteFile(n){core.FS.unlink(n)}async ffprobe(args){core.reset();return core.ffprobe(...args)}async exec(args){return exec(args.map(x=>x.replace('scale=1920:1080','scale=160:90').replace('pad=1920:1080','pad=160:90')))}};
globalThis.fetch=async url=>{const data=files.get(String(url).split('/').pop());assert(data);return new Response(data)};
const D=await import('../work/tests/music-render/domain.mjs'),R=await import('../work/tests/music-render/render.mjs'),M=await import('../work/tests/music-render/music.mjs');
const p=D.newProject('Музыка и речь');p.speechMode='plans';p.seconds=12;
const shots=Array.from({length:3},(_,n)=>({title:'План '+n,description:'Сцена',duration:4,camera:'Статичная',continuity:'Склейка',dialogue:n===1?'Реплика':'',speechType:n===1?'voiceover':'none'}));
for(const i of p.items.filter(i=>i.stage<5)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id)}
p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
for(const stage of [5,6,7])for(const [n,shot] of shots.entries()){if(stage===6&&n!==1)continue;const i={id:D.id(),stage,title:shot.title,sourceShot:{scriptId:p.items.find(i=>i.stage===4).id,title:shot.title},variants:[]};p.items.push(i);D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:stage===6?'voice':'video',duration:4,speechType:shot.speechType,dialogue:shot.dialogue});D.approve(p,i.id)}
const music=D.makeVariant(p,p.items[0],{kind:'audio',assetId:'music',duration:3});p.music={variants:[music],selectedId:music.id,approvedId:music.id,settings:{...M.DEFAULT_MUSIC,enabled:true,fade:0}};p.music.approvedSettings=JSON.stringify(p.music.settings);
const before=structuredClone(p),result=await R.renderFilm(p,false,()=>{});assert.equal(result.seconds,12);assert.deepEqual(before,p);
const volume=(at,filter='bandpass=f=220:width_type=h:width=30')=>{logs=[];exec(['-v','info','-ss',String(at),'-i','film.mp4','-t','0.3','-af',filter+',volumedetect','-vn','-f','null','-']);const m=logs.map(s=>s.match(/mean_volume: (-?[\d.]+) dB/)).find(Boolean);assert(m);return Number(m[1]);};
const high=volume(1),low=volume(4.8),returned=volume(7);assert(high-low>10,JSON.stringify({high,low}));assert(Math.abs(high-returned)<1,JSON.stringify({high,returned}));assert(volume(4.8,'highpass=f=600')>-35,'Voice remains audible');assert(volume(10)>-45,'Music loops into silent last plan');
await writeFile('work/tests/music-ducking.mp4',new Uint8Array(core.FS.readFile('film.mp4')));
exec(R.audioArgs([],12,{...p.music.settings,loop:false}));assert(volume(1)>-45);assert(volume(8)<-80,'Non-looping music pads with silence without shortening film');
exec(R.audioArgs([],12,{...p.music.settings,loop:true}));assert(volume(10)>-45,'Silent film still has looping music');
core.reset();core.ffprobe('-v','error','-show_entries','format=duration','-of','json','-o','duration.json','film.mp4');assert(Math.abs(Number(JSON.parse(new TextDecoder().decode(core.FS.readFile('duration.json'))).format.duration)-12)<0.05);
console.log('PASS real FFmpeg music render: 12-second uncut film, normalized music, >10 dB ducking for actual voice duration, restored level, audible speech, looping and non-looping music-only films.');
