import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as C from './lib/captions';export * as D from './lib/domain';export * as R from './lib/render';export * as A from './lib/animatic';export * as W from './lib/workflow';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/captions.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,revision)=>{if(state.revision!==revision)throw Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const asset=async()=>({mime:'video/mp4'});`}));}}]});
const {C,D,R,A,W,PATCH}=await import('../work/tests/captions.mjs');
const p=D.newProject('Титры');p.speechMode='plans';
const shots=Array.from({length:10},(_,n)=>({title:'План '+n,description:'Цех',duration:5,camera:'Статичная',continuity:'Склейка',dialogue:'Привет',speechType:'voiceover'}));
for(const i of p.items.filter(i=>i.stage<5)){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
p.items=p.items.filter(i=>![5,6,7].includes(i.stage));
const scriptId=p.items.find(i=>i.stage===4).id;
for(const stage of [5,6,7])for(const [n,s] of shots.entries()){const i={id:D.id(),stage,title:s.title,sourceShot:{scriptId,title:s.title,key:'number:'+n},variants:[]};p.items.push(i);D.addVariant(p,i.id,{kind:stage===5?'image':stage===6?'audio':'video',assetId:D.id(),duration:5,dialogue:'Привет'});D.approve(p,i.id);}
const frame=p.items.find(i=>i.stage===5),video=p.items.find(i=>i.stage===7);
const caption={...C.defaultCaption(frame.id),text:'Завод «Шкода»\nПльзень: 1939; [test]'};
const basis=A.animaticBasis(p),videoDeps=D.dependencies(p,7),finalDeps=D.dependencies(p,8),before=structuredClone(p.items);
globalThis.state=structuredClone(p);
const patch=async(data,revision=state.revision)=>PATCH(new Request('http://test',{method:'PATCH',body:JSON.stringify({action:'saveCaption',revision,data})}),{params:Promise.resolve({id:p.id})});
await patch(caption);assert.deepEqual(state.captions,[caption]);assert.deepEqual(state.items,before);
assert.equal(D.dependencies(state,7),videoDeps);assert.notEqual(D.dependencies(state,8),finalDeps);assert.notEqual(A.animaticBasis(state),basis);
assert.deepEqual(C.captionForPlan(state,video),caption);assert.equal(C.captionForPlan(state,state.items.filter(i=>i.stage===7)[1]),undefined);
assert.equal(C.captionForPlan({...state,captions:undefined},video),undefined);
assert.equal(C.captionForPlan({...state,items:state.items.map(i=>i.id===frame.id?{...i,planArchive:{reason:'removed'}}:i)},video),undefined);
await patch({...caption,text:'Новая надпись'});assert.equal(state.captions.length,1);
await patch({...caption,enabled:false});assert.equal(C.captionForPlan(state,video),undefined);
await patch(caption);
for(const invalid of [{planId:D.id()},{planId:video.id},{font:'malicious'},{size:0},{size:161},{x:-1},{y:101},{text:'x'.repeat(301)}]){const old=structuredClone(state);await assert.rejects(()=>patch({...caption,...invalid}));assert.deepEqual(state,old);}
await assert.rejects(()=>patch(caption,state.revision-1));globalThis.denied=true;await assert.rejects(()=>patch(caption),/Unauthorized/);globalThis.denied=false;
assert.equal(W.nextStage(7),10);assert.equal(W.nextStage(10),8);assert.equal(W.WORKFLOW.length,11);assert(W.workflowReady(p,10));
const calls=[],ctx={clearRect(){},measureText:t=>({width:[...t].length*28}),fillRect(...args){calls.push(['box',...args])},fillText(...args){calls.push(['text',...args])}};
const canvas={getContext:()=>ctx};C.drawCaption(canvas,caption,1920,1080);
assert(calls.some(c=>c[0]==='text'&&c[1]==='Завод «Шкода»'));assert(calls.some(c=>c[0]==='text'&&c[1].includes('[test]')));
const textCalls=calls.filter(c=>c[0]==='text');assert(textCalls.every(c=>c[2]>0&&c[2]<1920&&c[3]>0&&c[3]<1080));
assert.throws(()=>C.drawCaption(canvas,{...caption,text:Array(100).fill('строка').join('\n')},1080,1920),/не помещается/);
const params=R.clipArgs({duration:1,trim:0},0,160,90,true,'title.png');assert(params.includes('-filter_complex'));assert(!params.join(' ').includes(caption.text));
// Real FFmpeg composition: opaque title rectangle over a blue frame, with
// transparent pixels preserving the source. Test both still and video paths.
globalThis.self={location:{href:pathToFileURL(process.cwd()+'/public/ffmpeg/ffmpeg-core.js').href}};
const {default:createCore}=await import('../public/ffmpeg/ffmpeg-core.js');const core=await createCore({wasmBinary:new Uint8Array(await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'))});
let logs=[];core.setLogger(({message})=>logs.push(message));const exec=args=>{core.reset();assert.equal(core.exec(...args),0,logs.slice(-12).join('\n'));};
exec(['-f','lavfi','-i','color=c=blue:s=160x90:r=24','-frames:v','1','-threads','1','frame.png']);
// A deterministic RGBA PNG, matching canvas.toBlob's transparent format.
const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,checksum]);};
const header=Buffer.alloc(13);header.writeUInt32BE(160,0);header.writeUInt32BE(90,4);header[8]=8;header[9]=6;
const rgba=Buffer.alloc((160*4+1)*90);for(let y=20;y<50;y++)for(let x=32;x<128;x++)rgba.fill(255,y*641+1+x*4,y*641+1+x*4+4);
core.FS.writeFile('title.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rgba)),chunk('IEND',Buffer.alloc(0))]));
exec(['-f','lavfi','-i','color=c=blue:s=160x90:r=24','-t','1','-c:v','libx264','-threads','1','source.mp4']);
for(const animatic of [true,false]){
 core.FS.writeFile('in0',core.FS.readFile(animatic?'frame.png':'source.mp4'));
 exec(R.clipArgs({duration:1,trim:0},0,160,90,animatic,'title.png'));
 exec(['-y','-i','clip0.mp4','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pixels']);
 const pixels=core.FS.readFile('pixels'),at=(x,y)=>Array.from(pixels.slice((y*160+x)*3,(y*160+x)*3+3));
 assert(at(60,30).every(n=>n>220),'Title is burned into the MP4: '+JSON.stringify({animatic,pixel:at(60,30),bg:at(5,5),logs:logs.slice(-3)}));
 const bg=at(5,5);assert(bg[2]>200&&bg[0]<30,'Transparent area preserves the original frame');
}
console.log('PASS captions: per-plan persistence, validation/ownership, no paid-stage invalidation, stale assemblies, literal Cyrillic layout, and real PNG overlays in animatic/video MP4.');
