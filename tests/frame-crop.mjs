import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('work/tests',{recursive:true});
await build({stdin:{resolveDir:process.cwd(),contents:`export * as C from './lib/frame-crop';export * as D from './lib/domain';export * as A from './lib/animatic';export * as M from './lib/animatic-manifest';export * as V from './lib/video-from-animatic';export {projectAssetIds} from './lib/project-assets';export {videoFrameOptions} from './lib/video';export {editPlan} from './lib/render';export {POST} from './app/api/projects/[id]/video-preparation/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/frame-crop.mjs',plugins:[{name:'private-project',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'owned'}));b.onLoad({filter:/.*/,namespace:'owned'},()=>({contents:`export const api=fn=>async(r,c)=>{try{return await fn(r,c)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.film);export const saveProject=async(_,p,r)=>{if(r!==globalThis.film.revision)throw Error('CAS');p.revision++;globalThis.film=structuredClone(p);return p};export const asset=async(_,id,p)=>{const a=globalThis.assets.get(id);if(!a||a.owner!=='owner'||a.project_id!==p.id)throw Error('foreign asset');return a};`}));}}]});
const {C,D,A,M,V,projectAssetIds,videoFrameOptions,editPlan,POST}=await import('../work/tests/frame-crop.mjs');
const sourceId=D.id(),land=C.fitFrameCrop(1920,1080,'16:9');assert.deepEqual(land,{x:0,y:0,width:1920,height:1080});
const portrait=C.fitFrameCrop(1920,1080,'9:16');assert.deepEqual(portrait,{x:659,y:4,width:603,height:1072});
assert.equal(C.fitFrameCrop(1920,1080,'9:16',1,0,100).x,0);assert.equal(C.fitFrameCrop(1920,1080,'9:16',1,100,100).x,1317);
const zoom=C.fitFrameCrop(1920,1080,'16:9',.75);assert.deepEqual(zoom,{x:240,y:135,width:1440,height:810});
const move=C.resizeFrameCrop(1920,1080,'16:9',zoom,'x',9999);assert.equal(move.x,480);
const resize=C.resizeFrameCrop(1920,1080,'16:9',zoom,'width',800);assert.equal(resize.width,800);assert.equal(resize.height,450);
const wide=C.frameCropTransform(sourceId,4096,2304,'16:9',C.fitFrameCrop(4096,2304,'16:9'));assert.equal(wide.outputWidth,2048);assert.equal(wide.outputHeight,1152);
assert.throws(()=>C.fitFrameCrop(1920,1080,'1:1'));assert.throws(()=>C.fitFrameCrop(1920,1080,'16:9',NaN));
assert.throws(()=>C.frameCropTransformSchema.parse({...wide,rect:{...wide.rect,x:1}}),'outside source');
assert.throws(()=>C.frameCropTransformSchema.parse({...wide,rect:{...wide.rect,width:4095}}),'aspect mismatch');
assert.throws(()=>C.frameCropTransformSchema.parse({...wide,sourceWidth:16,sourceHeight:16,rect:{x:0,y:0,width:16,height:9}}),'no upscaling');
// Pixel fixture exercises the production canvas command against a deterministic
// raster context. Native browser encoding/rendering is verified separately in UI QA.
const pixels=new Uint8ClampedArray(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const n=(y*64+x)*4;pixels.set([x,y,x+y,255],n);}
let result,drawArgs;const raster={width:0,height:0,getContext:()=>({clearRect(){},drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh){drawArgs=[sx,sy,sw,sh,dx,dy,dw,dh];result=new Uint8ClampedArray(dw*dh*4);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const si=(Math.floor(sy+y*sh/dh)*image.width+Math.floor(sx+x*sw/dw))*4;result.set(image.pixels.subarray(si,si+4),(y*dw+x)*4);}}})};
const rasterTransform=C.frameCropTransform(sourceId,64,64,'16:9',{x:16,y:20,width:32,height:18});C.drawFrameCrop(raster,{width:64,height:64,pixels},rasterTransform);
assert.deepEqual(drawArgs,[16,20,32,18,0,0,32,18]);assert.equal(raster.width,32);assert.equal(raster.height,18);assert.deepEqual([...result.slice(0,4)],[16,20,36,255]);assert.deepEqual([...result.slice(-4)],[47,37,84,255]);
assert.throws(()=>C.drawFrameCrop(raster,{width:63,height:64},rasterTransform),/Размер/);
const pngCanvas={...raster,toBlob(callback,mime){assert.equal(mime,'image/png');callback(new Blob([new Uint8Array([1,2,3])],{type:mime}));}};
const blob=await C.frameCropPng(pngCanvas,{width:64,height:64,pixels},rasterTransform);assert.equal(blob.type,'image/png');

const p=D.newProject('Crop fixture');p.productionOrder='video-first';p.speechMode='plans';p.animaticSettings={sound:'silent',music:false,motion:false};globalThis.assets=new Map();
const picture=(mime='image/png')=>{const id=D.id();assets.set(id,{id,owner:'owner',project_id:p.id,mime,size:100});return id;};
for(const stage of [0,2,3,1,4]){const i=p.items.find(i=>i.stage===stage);D.addVariant(p,i.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots:[{id:'s1',title:'Письмо',duration:5,description:'Поднять письмо',speechType:'none',dialogue:'',camera:'Общий',continuity:'Комната'}]}):'Approved'});D.approve(p,i.id);}
const card=p.items.find(i=>i.stage===5);card.title='Письмо';card.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,shotId:'s1',title:card.title};D.addVariant(p,card.id,{kind:'image',assetId:picture(),duration:5});D.approve(p,card.id);
const source=D.chosen(card),plan=editPlan(p,true),basis=A.animaticBasis(p),manifest=M.buildAnimaticManifest(p,plan,basis);A.saveAnimatic(p,{kind:'video',assetId:D.id(),duration:5,animaticManifest:manifest},basis);globalThis.film=structuredClone(p);
const post=body=>POST(new Request('http://localhost/crop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
let response=await post({revision:film.revision,action:'prepare',variantId:film.animatic.selectedId});assert.equal(response.status,200,await response.clone().text());
let video=film.items.find(i=>i.stage===7&&!i.planArchive);const originalAnimatic=structuredClone(film.animatic),originalCard=structuredClone(film.items.find(i=>i.id===card.id));
const transform=C.frameCropTransform(source.assetId,1920,1080,'16:9',zoom),derived=picture();
const crop=()=>({revision:film.revision,action:'crop',itemId:video.id,role:'start',sourceVariantId:source.id,expectedAssetId:video.videoPreparation.startFrame.assetId,assetId:derived,transform});
response=await post(crop());assert.equal(response.status,200,await response.clone().text());video=film.items.find(i=>i.id===video.id);
assert.equal(video.videoPreparation.startFrame.assetId,derived);assert.equal(video.videoPreparation.startFrame.variantId,source.id);assert.deepEqual(video.videoPreparation.startFrame.transform,transform);assert.equal(V.videoPreparationIssue(film,video),'');assert.equal(V.preparedVideoInputs(film,video,'grok-imagine-video-1.5').startFrameId,derived);
assert.deepEqual(film.animatic,originalAnimatic,'No false manifest mutation');assert.deepEqual(film.items.find(i=>i.id===card.id),originalCard,'Original storyboard approval is untouched');assert.equal(film.jobs.length,0,'Crop is never a paid job');
assert(projectAssetIds(film).has(derived));assert(projectAssetIds(film).has(source.assetId));assert(videoFrameOptions(film,video).some(f=>f.assetId===derived&&!f.approved));
let saved=structuredClone(film);response=await post({...crop(),expectedAssetId:source.assetId,assetId:picture()});assert.equal(response.status,400);assert.deepEqual(film,saved,'Stale crop cannot replace current source');
const foreign=picture();assets.get(foreign).project_id='another-project';response=await post({...crop(),assetId:foreign});assert.equal(response.status,400);assert.deepEqual(film,saved,'Foreign derived source rejected atomically');
const wrong=picture('image/jpeg');response=await post({...crop(),assetId:wrong});assert.equal(response.status,400);assert.deepEqual(film,saved,'Derived source must be PNG');
response=await post({...crop(),assetId:picture(),transform:{...transform,sourceAssetId:picture()}});assert.equal(response.status,400);assert.deepEqual(film,saved,'An unrelated image cannot become the transform origin');
response=await post({revision:film.revision,action:'override',itemId:video.id,role:'start',variantId:source.id});assert.equal(response.status,200);video=film.items.find(i=>i.id===video.id);assert.equal(video.videoPreparation.startFrame.assetId,source.assetId);assert(!video.videoPreparation.startFrame.transform);assert(projectAssetIds(film).has(derived),'Restore original retains old derived file');assert(video.videoPreparation.frameHistory.some(h=>h.frame.assetId===derived));
response=await post({...crop(),assetId:picture()});assert.equal(response.status,200);video=film.items.find(i=>i.id===video.id);const secondDerived=video.videoPreparation.startFrame.assetId;
response=await post({revision:film.revision,action:'prepare',variantId:film.animatic.selectedId});assert.equal(response.status,200);video=film.items.find(i=>i.id===video.id);assert.equal(video.videoPreparation.startFrame.assetId,source.assetId);assert(projectAssetIds(film).has(secondDerived),'Preparing the manifest again keeps crop history');
saved=structuredClone(video.videoPreparation);response=await post({revision:film.revision,action:'prepare',variantId:film.animatic.selectedId});assert.equal(response.status,200);assert.deepEqual(film.items.find(i=>i.id===video.id).videoPreparation,saved,'History is idempotent on unchanged preparation');
console.log('PASS crop aspect/source bounds/no upscale, production draw command with pixel fixture, PNG request, owned same-plan explicit transform, history/asset membership, no manifest mutation/payment');
