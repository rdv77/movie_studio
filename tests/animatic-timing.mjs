import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
await build({stdin:{resolveDir:process.cwd(),contents:"export * from './lib/render'; export * as D from './lib/domain';"},bundle:true,platform:'node',format:'esm',outfile:'work/tests/animatic-timing.mjs',external:['@ffmpeg/ffmpeg']});
const R=await import('../work/tests/animatic-timing.mjs');
const voice=(id,trim=0)=>({id,title:id,trim,volume:1,duration:5,offset:0});
const base={clips:[{id:'first',duration:5},{id:'silent',duration:20},{id:'last',duration:24}],audio:[voice('a'),voice('b',1)],audioClipIndexes:[0,2],seconds:49,width:160,height:90};
const snapshot=structuredClone(base);
const fitted=R.fitAnimaticToSpeech(base,[5.11,3]);
assert.equal(fitted.clips[0].duration,5.125);assert.equal(fitted.audio[0].duration,5.11);
assert.equal(fitted.clips[1].duration,20);assert.equal(fitted.audio[1].duration,2);
assert.equal(fitted.audio[1].offset,25.125);assert.equal(fitted.seconds,49.125);assert.deepEqual(base,snapshot);
// Multiple extended plans, fractional frame durations and reordered voice tracks.
const reordered={...base,clips:[{duration:5.01},{duration:5},{duration:39}],audio:[voice('last'),voice('first')],audioClipIndexes:[2,0]};
const r=R.fitAnimaticToSpeech(reordered,[39.3,5.11]);
assert.equal(r.audio[0].offset,10.125);assert.equal(r.audio[1].offset,0);assert.equal(Math.round(r.seconds*24),1187);
assert.throws(()=>R.fitAnimaticToSpeech(base,[NaN,3]),/звучащий участок/);
assert.throws(()=>R.fitAnimaticToSpeech(base,[5,0.5]),/звучащий участок/);
assert.throws(()=>R.fitAnimaticToSpeech(base,[5]),/всех реплик/);
assert.equal(R.fitAnimaticToSpeech(base,[17,3]).seconds,61);
assert.throws(()=>R.fitAnimaticToSpeech({...base,audioClipIndexes:[-1,2]},[5,3]),/Не найден кадр/);
// Exactly 60 seconds must not become 60.25 solely from per-clip ceil rounding.
const exactMinute={...base,clips:[...Array.from({length:10},()=>({duration:5.6})),{duration:4}],audio:Array.from({length:11},(_,n)=>voice('short-'+n)),audioClipIndexes:Array.from({length:11},(_,n)=>n),seconds:60};
const roundedMinute=R.fitAnimaticToSpeech(exactMinute,Array(11).fill(1));
assert.equal(roundedMinute.seconds,60);assert.equal(roundedMinute.clips.reduce((s,v)=>s+Math.round(v.duration*24),0),1440);
assert(roundedMinute.clips.every((v,n)=>Math.abs(v.duration-exactMinute.clips[n].duration)<1/24+1e-8));
assert(roundedMinute.audio.every((v,n)=>v.duration<=roundedMinute.clips[n].duration));
assert.equal(R.fitAnimaticToSpeech(exactMinute,[...Array(10).fill(5.6),4]).seconds,60.25,'Keep all frames needed by speech');
assert(R.fitAnimaticToSpeech(exactMinute,[6,...Array(10).fill(1)]).seconds>60,'Extra speech extends runtime');
// Exercise the full preflight path, including its early runtime validation.
function project(durations){
 const D=R.D,p=D.newProject('Проверка длительности');p.speechMode='plans';
 const shots=durations.map((_,n)=>({title:'План '+(n+1),description:'Море',duration:p.seconds/durations.length,camera:'Статичная камера',continuity:'Склейка',dialogue:'Привет!',speechType:'voiceover',speaker:'Катя'}));
 for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
 p.items=p.items.filter(i=>![5,7].includes(i.stage));const scriptId=p.items.find(i=>i.stage===4).id;
 for(const stage of [5,6])for(const [n,shot] of shots.entries()){const i={id:D.id(),stage,title:shot.title,sourceShot:{scriptId,title:shot.title},variants:[]};p.items.push(i);D.addVariant(p,i.id,{kind:stage===5?'image':'audio',assetId:D.id(),duration:durations[n],text:'Вариант',dialogue:shot.dialogue});D.approve(p,i.id);}
 return p;
}
const shortProject=project([4,10,10,10,10]);
assert.equal(R.fitPlanToSpeech(R.editPlan(shortProject,true),[10,1,1,1,1]).seconds,50,'Actual speech can make a 44-second storyboard valid');
assert.equal(R.fitPlanToSpeech(R.editPlan(shortProject,true),[1,1,1,1,1]).seconds,44);
shortProject.speechMode='track';
const track=shortProject.items.find(i=>i.stage===6&&!i.sourceShot);
R.D.addVariant(shortProject,track.id,{kind:'audio',assetId:R.D.id(),duration:44});R.D.approve(shortProject,track.id);
assert.equal(R.editPlan(shortProject,true).seconds,44);
const minuteProject=project([...Array(10).fill(5.6),4]);
assert.equal(R.fitPlanToSpeech(R.editPlan(minuteProject,true),Array(11).fill(1)).seconds,60,'Floating-point addition must reach the measured timing check');
assert.equal(R.editPlan(project([15,15,15,15.01]),true).seconds,60.01);
const tight={...base,clips:[{duration:40.51},{duration:19.49}],audio:[voice('tight-a'),voice('tight-b')],audioClipIndexes:[0,1]};
assert.equal(R.fitPlanToSpeech(tight,[40.51,19.49]).seconds,1441/24);
const longer=R.fitPlanToSpeech({...base,clips:[{duration:4},{duration:46}],audio:[voice('long')],audioClipIndexes:[0],seconds:50},[18.16]);
assert.equal(longer.seconds.toFixed(2),'64.17');
assert.equal(longer.audio[0].duration,18.16);
assert.throws(()=>R.fitPlanToSpeech({...base,clips:[{duration:NaN}]},[1,1]),/положительную/);
assert.throws(()=>R.fittedSpeechDuration(voice('video'),5.11),/Увеличьте/); // Video clips are not silently stretched.
assert.match(R.audioArgs(fitted.audio,fitted.seconds).join(' '),/adelay=25125/);

// Verify real FFmpeg output, including fractional cut time and the second voice.
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');
const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let log=[];core.setLogger(({message})=>log.push(message));
const exec=args=>{core.reset();if(core.exec(...args)!==0)throw new Error(log.slice(-15).join('\n'));};
const probe=(file,entries)=>{core.reset();core.ffprobe('-v','error','-show_entries',entries,'-of','json','-o','probe.json',file);return JSON.parse(new TextDecoder().decode(core.FS.readFile('probe.json')));};
const p=R.fitAnimaticToSpeech({clips:[{duration:5},{duration:59}],audio:[voice('one'),voice('two')],audioClipIndexes:[0,1],seconds:64,width:160,height:90},[5.11,2]);
for(let n=0;n<2;n++){
 exec(['-f','lavfi','-i',`color=c=${n?'blue':'red'}:s=160x90`,'-frames:v','1','-threads','1',`frame${n}.png`]);
 core.FS.writeFile('in'+n,core.FS.readFile(`frame${n}.png`));
 exec(R.clipArgs(p.clips[n],n,160,90,true));
 assert(Math.abs(Number(probe(`clip${n}.mp4`,'format=duration').format.duration)-p.clips[n].duration)<0.002);
 exec(['-f','lavfi','-i',`sine=frequency=${n?880:440}:duration=${n?2:5.11}`,'-c:a','pcm_s16le','-f','wav','audio'+n]);
}
core.FS.writeFile('list.txt',new TextEncoder().encode("file 'clip0.mp4'\nfile 'clip1.mp4'"));
exec(['-f','concat','-safe','0','-i','list.txt','-c','copy','silent.mp4']);
exec(R.audioArgs(p.audio,p.seconds));
const info=probe('film.mp4','format=duration:stream=codec_type');
assert(Math.abs(Number(info.format.duration)-64.125)<0.05);assert(info.streams.some(s=>s.codec_type==='audio'));
// The later voice remains audible after the newly extended first scene.
log=[];exec(['-v','info','-ss','5.2','-i','film.mp4','-t','1','-af','volumedetect','-vn','-f','null','-']);
assert(log.some(s=>/max_volume: -?\d+(\.\d+)? dB/.test(s)));
await writeFile('work/tests/animatic-timing.mp4',core.FS.readFile('film.mp4'));
console.log('PASS automatic speech timing: complete speech, shifted cuts and voices, 24fps rounding, trim, silent scenes, immutable approvals, no runtime cap, real 64.125-second MP4 with audible second voice.');
