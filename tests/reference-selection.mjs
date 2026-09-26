import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock={name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p,revision)=>{if(revision!==state.revision)throw Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const getKey=async()=> 'unused';export const asset=async(_,id)=>{if(globalThis.foreign)throw Error('Foreign asset');return {id,mime:'image/png',size:100}};`}));}};
await build({entryPoints:['lib/domain.ts','lib/reference-selection.ts','lib/storyboard.ts','app/api/projects/[id]/route.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-storyboard/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/reference-selection',outExtension:{'.js':'.mjs'},plugins:[mock]});
const root='../work/tests/reference-selection/',D=await import(root+'lib/domain.mjs'),R=await import(root+'lib/reference-selection.mjs'),S=await import(root+'lib/storyboard.mjs'),A=await import(root+'app/api/projects/[id]/route.mjs'),G=await import(root+'app/api/projects/[id]/generate/route.mjs'),B=await import(root+'app/api/projects/[id]/generate-storyboard/route.mjs');
const p=D.newProject('References'),hero=D.id(),extra=D.id(),deleted=D.id();
const script=JSON.stringify({shots:Array.from({length:10},(_,n)=>({title:'Plan '+n,description:'Герой у окна',duration:5,camera:'Общий план',dialogue:'',continuity:'Прямая склейка',speechType:'none'}))});
for(const item of p.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,item.id,item.stage===1?{kind:'image',assetId:hero,character:{name:'Герой',appearance:'Рыжий',description:'Смелый',instructions:'',refs:[]}}:{text:item.stage===4?script:'Основа'});D.approve(p,item.id);}
S.preparePlanCards(p);const frame=p.items.find(i=>i.stage===5&&!i.planArchive);
const dead=D.addVariant(p,frame.id,{kind:'image',assetId:deleted,text:'Удалённый вариант'});D.deleteVariant(p,frame.id,dead.id);frame.selectedId=frame.variants[0].id;
assert(R.hiddenReferences(p).has(deleted));assert(!R.hiddenReferences(p).has(hero));
const reused=structuredClone(p);reused.items[3].variants.push(D.makeVariant(reused,reused.items[3],{kind:'image',assetId:deleted}));assert(!R.hiddenReferences(reused).has(deleted),'Keep files also used by a surviving variant');
const single={revision:p.revision,batchId:D.id(),itemId:frame.id,models:['grok-imagine-image-2.0'],count:1,prompt:'Кадр',refs:[extra],referenceMode:'selected',dialogue:'',voiceId:'',estimates:{'grok-imagine-image-2.0':'100'}};
const bulk={revision:p.revision,batchId:D.id(),model:single.models[0],refs:[extra],referenceMode:'selected',estimate:'100',plans:[{itemId:frame.id,prompt:'Кадр'}]};
const ctx={params:Promise.resolve({id:p.id})},req=body=>new Request('http://test',{method:'POST',body:JSON.stringify(body)});
for(const [route,input] of [[G,single],[B,bulk]]) {
 for(const refs of [[extra],[],[extra,hero]]) {
  globalThis.state=structuredClone(p);await route.POST(req({...input,refs}),ctx);assert.deepEqual(state.jobs.at(-1).refs,refs,'Unchecked heroes never reappear server-side');
  if(!refs.includes(hero))assert(!state.jobs.at(-1).prompt.includes('Изображение 1: Герой'));
 }
 state=structuredClone(p);await route.POST(req({...input,referenceMode:'auto'}),ctx);assert.deepEqual(state.jobs.at(-1).refs,[hero,extra],'Legacy automatic mode preserved');
 for(const refs of [[deleted],[extra,extra]]){state=structuredClone(p);await assert.rejects(()=>route.POST(req({...input,refs}),ctx),/референсов/);assert.equal(state.jobs.length,0);}
 state=structuredClone(p);state.hiddenReferenceIds=[hero];await assert.rejects(()=>route.POST(req({...input,refs:[hero]}),ctx),/референсов/);assert.equal(state.jobs.length,0);
}
state=structuredClone(p);const snapshots=structuredClone(p.items),jobs=structuredClone(p.jobs);
for(const stage of [1,2,3]) {
 const item=p.items.find(i=>i.stage===stage);
 for(const refs of [[],[extra]]) {
  state=structuredClone(p);state.hiddenReferenceIds=[hero];
  await G.POST(req({...single,itemId:item.id,refs}),ctx);
  assert.deepEqual(state.jobs.at(-1).refs,refs,'Hidden references must stay removed in hero, style and location generation');
 }
}
state=structuredClone(p);
await A.PATCH(req({revision:state.revision,action:'hideReference',data:{assetId:hero}}),ctx);
assert.deepEqual(state.hiddenReferenceIds,[hero]);assert.deepEqual(state.items,snapshots);assert.deepEqual(state.jobs,jobs);
assert.deepEqual(R.selectedReferences(state,[hero,extra,deleted]),[extra]);
await A.PATCH(req({revision:state.revision,action:'restoreReference',data:{assetId:hero}}),ctx);assert.deepEqual(state.hiddenReferenceIds,[]);
const second=D.newProject('Другой фильм');assert(!R.hiddenReferences(second).has(hero));
for(const flag of ['denied','foreign']){state=structuredClone(p);globalThis[flag]=true;await assert.rejects(()=>A.PATCH(req({revision:p.revision,action:'hideReference',data:{assetId:hero}}),ctx));assert.deepEqual(state,p);globalThis[flag]=false;}
console.log('PASS reference selection: no forced images in single/batch, explicit empty selection, legacy compatibility, deleted/hidden filtering, ownership, restore, project isolation, unchanged approved assets and costs.');

// Each batch row has its own cast, including an explicitly empty cast.
const scoped=structuredClone(p),otherAsset=D.id();
const other={id:D.id(),stage:1,title:'Второй',variants:[]};scoped.items.push(other);
D.addVariant(scoped,other.id,{kind:'image',assetId:otherAsset,character:{name:'Второй',appearance:'Синий плащ',description:'Другой герой',instructions:'',refs:[]}});D.approve(scoped,other.id);
const source=scoped.items.find(i=>i.stage===4),data=JSON.parse(D.chosen(source).text);
data.shots.forEach((shot,n)=>{shot.cast=n===0?['Герой']:n===1?['Второй']:[];shot.continuity='В соседнем плане Герой и Второй';shot.dialogue='Рассказчик упоминает Героя';shot.speechType='voiceover';shot.speaker='Герой';});
D.chosen(source).text=JSON.stringify(data);
for(const card of scoped.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage)))D.chosen(card).deps=D.dependencies(scoped,card.stage);
S.preparePlanCards(scoped);const frames=scoped.items.filter(i=>i.stage===5&&!i.planArchive).slice(0,3);
for(const card of frames)D.chosen(card).deps=D.dependencies(scoped,5);
state=structuredClone(scoped);
await B.POST(req({...bulk,revision:state.revision,batchId:D.id(),refs:[],plans:frames.map(i=>({itemId:i.id,prompt:'Кадр',refs:[hero,otherAsset]}))}),ctx);
assert.deepEqual(state.jobs.map(j=>j.refs),[[hero],[otherAsset],[]],'Different cast in adjacent shots and no narrator portrait in an empty shot');
assert(!state.jobs[0].prompt.includes('Синий плащ'));
assert(!state.jobs[2].prompt.includes('Изображение 1:'));
state=structuredClone(scoped);await B.POST(req({...bulk,revision:state.revision,batchId:D.id(),refs:[hero,otherAsset],plans:frames.map(i=>({itemId:i.id,prompt:'Кадр',refs:[]}))}),ctx);
assert(state.jobs.every(j=>j.refs.length===0),'Explicit per-shot empty selection wins over common references');
for(const [index,expected] of [[0,[hero]],[1,[otherAsset]],[2,[]]]){
 state=structuredClone(scoped);await G.POST(req({...single,revision:state.revision,batchId:D.id(),itemId:frames[index].id,refs:[hero,otherAsset]}),ctx);assert.deepEqual(state.jobs[0].refs,expected);
}
console.log('PASS per-plan cast isolation: single and batch requests, empty cast, voiceover, neighbouring continuity, scoped prompts, per-plan deselection.');
