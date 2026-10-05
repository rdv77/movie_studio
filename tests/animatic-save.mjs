import {build} from 'esbuild';
import assert from 'node:assert/strict';

const server=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};
export const owner=async()=> 'owner';
export const loadProject=async(user,id)=>{if(id!==state.id)throw Error('Not found');return structuredClone(state)};
export const saveProject=async(user,p,revision)=>{if(revision!==state.revision)throw Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const asset=async(user,id,p)=>{globalThis.assetChecks.push(id);const a=assets.get(id);if(!a||a.projectId!==p.id)throw Error('Foreign or missing asset');return a};
`;
await build({stdin:{resolveDir:process.cwd(),contents:`
export * as D from './lib/domain';export * as K from './lib/keyframes';
export * as A from './lib/animatic';export * as M from './lib/animatic-manifest';
export {editPlan} from './lib/render';export {projectAssetIds} from './lib/project-assets';
export {PATCH} from './app/api/projects/[id]/route';
`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/animatic-save.mjs',external:['@ffmpeg/ffmpeg'],plugins:[{name:'server',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:server}));
}}]});
const {D,K,A,M,editPlan,projectAssetIds,PATCH}=await import('../work/tests/animatic-save.mjs');
function fixture(count=10,longDirection=false){
 const p=D.newProject('Сохранение аниматика');p.animaticSettings={sound:'silent',music:false};
 const shots=Array.from({length:count},(_,n)=>({id:D.id(),title:`План ${n+1}`,description:'Лягушка у воды',duration:5,camera:'Наезд',continuity:'Корона на голове',dialogue:'',speechType:'none',direction:{framingStart:'wide',framingEnd:'close-up',startFrame:longDirection?'Начало '.repeat(400):'Общий вид',endFrame:longDirection?'Конец '.repeat(450):'Корона'}}));
 for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{kind:'text',text:stage===4?JSON.stringify({timingMode:'actual',shots}):'Основа'});D.approve(p,item.id);}
 p.items=p.items.filter(i=>i.stage!==5);const scriptId=p.items.find(i=>i.stage===4).id;
 for(const shot of shots){
  const item={id:D.id(),stage:5,title:shot.title,sourceShot:{scriptId,title:shot.title,shotId:shot.id},variants:[]};p.items.push(item);
  const first=D.makeVariant(p,item,{kind:'image',assetId:D.id(),model:'grok-imagine-image-2.0'});item.variants.push(first);item.selectedId=first.id;K.setKeyframeMode(p,item.id,'pair');
  const last=D.makeVariant(p,item,{...K.prepareKeyframeGeneration(p,item.id,'end',{model:first.model}),kind:'image',assetId:D.id()});item.variants.push(last);K.chooseKeyframe(p,item.id,'end',last.id);K.approveKeyframes(p,item.id,{startId:first.id,endId:last.id});
 }
 return p;
}
function setup(p){
 globalThis.state=structuredClone(p);globalThis.assets=new Map();globalThis.assetChecks=[];
 for(const item of p.items)for(const v of item.variants)if(v.assetId)assets.set(v.assetId,{id:v.assetId,projectId:p.id,mime:'image/png'});
 const assetId=D.id();assets.set(assetId,{id:assetId,projectId:p.id,mime:'video/mp4'});
 const basis=A.animaticBasis(state),plan=editPlan(state,true),animaticManifest=M.buildAnimaticManifest(state,plan,basis);
 return {title:'Аниматик',text:'',kind:'video',assetId,duration:plan.seconds,basis,animaticManifest};
}
const patch=(action,data,itemId)=>PATCH(new Request('https://test/api',{method:'PATCH',body:JSON.stringify({revision:state.revision,action,data,itemId})}),{params:Promise.resolve({id:state.id})});
const p=fixture(),legacy=setup(p),refs=M.manifestAssets(legacy.animaticManifest),originalItems=structuredClone(state.items);
assert.equal(refs.length,20,'10 pairs reproduce a film with more than eight source images');
let r=await patch('saveAnimaticPreview',{...legacy,refs});assert.equal(r.status,200,await r.clone().text());
let saved=state.animatic.variants.at(-1);assert.deepEqual(saved.animaticManifest,JSON.parse(JSON.stringify(legacy.animaticManifest)));assert.deepEqual(saved.refs,[]);
assert.deepEqual(state.items,originalItems,'Saving does not change frame/voice choices or approvals');
assert.equal(assetChecks.length,refs.length+1,'Sources repeated in refs and manifest are checked once');
for(const ref of refs)assert(projectAssetIds(state).has(ref));
// The updated browser sends just the manifest; both client generations work.
const modern=setup(p);r=await patch('saveAnimaticPreview',modern);assert.equal(r.status,200,await r.clone().text());
assert.deepEqual(state.animatic.variants.at(-1).animaticManifest,JSON.parse(JSON.stringify(modern.animaticManifest)));
// Long legitimate keyframe/direction snapshots use the manifest's existing bound.
const large=setup(fixture(20,true));assert(large.basis.length>100000);assert(large.basis.length<500000);
r=await patch('saveAnimaticPreview',{...large,refs:M.manifestAssets(large.animaticManifest)});assert.equal(r.status,200,await r.clone().text());
for(const change of [
 data=>{data.animaticManifest.clips[0].frames[0].assetId=D.id()},
 data=>{assets.get(data.animaticManifest.clips[0].frames[0].assetId).projectId=D.id()},
 data=>{data.basis+='stale'},
 data=>{data.animaticManifest.clips[0].frames[0].duration+=1},
 data=>{data.basis='x'.repeat(500001)},
 data=>{data.refs=Array.from({length:M.ANIMATIC_MAX_SOURCE_ASSETS+1},()=>D.id())},
 data=>{assets.get(data.assetId).mime='image/png'},
 data=>{data.location={name:'Место',identity:'',geography:'',permanentProps:'',refs:[D.id()],approvedAngles:[]}},
 data=>{data.location={name:'Место',identity:'',geography:'',permanentProps:'',refs:[],approvedAngles:[{id:D.id(),name:'Ракурс',description:'',refs:[D.id()]}]}},
]){
 const data=setup(p);change(data);const before=structuredClone(state);r=await patch('saveAnimaticPreview',data);assert.equal(r.status,400,await r.clone().text());assert.deepEqual(state,before,'Rejected saves are atomic');
}
// Additional legacy refs must also belong to this project even if the manifest omits them.
const extra=setup(p);r=await patch('saveAnimaticPreview',{...extra,refs:[D.id()]});assert.equal(r.status,400);
// Legacy previews without a manifest still retain their source list.
const old=setup(p);delete old.animaticManifest;r=await patch('saveAnimaticPreview',{...old,refs});assert.equal(r.status,200,await r.clone().text());assert.deepEqual(state.animatic.variants.at(-1).refs,refs);
// The exception is scoped to a whole-film preview, not general generation input.
setup(p);r=await patch('addVariant',{title:'Референсы',text:'',kind:'image',refs:refs.slice(0,9)},state.items.find(i=>i.stage===5).id);assert.equal(r.status,400);
console.log('PASS animatic save: 20 source images, old/new clients, >100K source snapshot, manifest retention, deduplicated ownership checks, foreign/missing files, stale/tampered data, bounded input, unchanged generic refs limit. No rendering or paid calls.');
