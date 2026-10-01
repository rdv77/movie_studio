import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {strict as assert} from 'node:assert';

// Count calls at the reference-selector boundary, retaining real approval logic.
// A deterministic work bound is safer than a machine-dependent timeout.
globalThis.referenceApprovalCalls=[];
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/plan-references';export {projectAssetIds} from './lib/project-assets';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/storyboard-batch-performance.mjs',plugins:[{name:'count-reference-approvals',setup(b){
 b.onLoad({filter:/[\\/]lib[\\/]plan-references\.ts$/},async args=>{
  let source=await readFile(args.path,'utf8');
  assert(source.includes('import { isApproved, type Project, type Item }'), 'Instrumentation must retain the real domain import');
  source=source.replace('import { isApproved, type Project, type Item }','import { isApproved as realIsApproved, type Project, type Item }');
  source+=`\nfunction isApproved(p:Project,item:Item){globalThis.referenceApprovalCalls.push({id:item.id,stage:item.stage});return realIsApproved(p,item);}\n`;
  return {contents:source,loader:'ts'};
 });
}}]});
const {D,R,projectAssetIds}=await import('../work/tests/storyboard-batch-performance.mjs');
globalThis.fetch=async()=>{throw Error('Performance regression must not call providers')};
const p=D.newProject('Synthetic 38 plans');p.seconds=114;
p.items=p.items.filter(i=>![1,3,5,6,7].includes(i.stage));
const heroes=['Катя','Петя','Рассказчик'].map(name=>({id:D.id(),stage:1,title:name,variants:[],character:{name,appearance:'Постоянная внешность',description:'Постоянный герой',instructions:'',refs:[]}}));
const places=['Пруд','Двор'].map(name=>({id:D.id(),stage:3,title:name,variants:[],location:{name,identity:'Постоянное место',geography:'Вход справа',permanentProps:'Скамья',refs:[D.id()],approvedAngles:[{id:D.id(),name:'Спереди',description:'Первый ракурс',refs:[D.id()]},{id:D.id(),name:'Сзади',description:'Другой ракурс',refs:[D.id()]}]}}));
p.items.push(...heroes,...places);
for(const item of p.items.filter(i=>i.stage<4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
 D.addVariant(p,item.id,item.stage===1?{kind:'image',assetId:D.id(),text:item.title,character:structuredClone(item.character)}:item.stage===3?{kind:'image',assetId:D.id(),text:item.title,location:structuredClone(item.location)}:item.stage===2?{kind:'image',assetId:D.id(),text:'Общий стиль, не автоматический референс'}:{text:'Общий сценарий'});D.approve(p,item.id);
}
// Recoverable removed items still own files; they must not enter frame inputs.
const removedHero=structuredClone(heroes[0]);removedHero.id=D.id();removedHero.title='Удалённый герой';removedHero.removedAt=D.now();removedHero.variants[0].id=D.id();removedHero.variants[0].assetId=D.id();removedHero.selectedId=removedHero.approvedId=removedHero.variants[0].id;
const removedPlace=structuredClone(places[0]);removedPlace.id=D.id();removedPlace.title='Удалённая локация';removedPlace.removedAt=D.now();removedPlace.variants[0].id=D.id();removedPlace.variants[0].assetId=D.id();removedPlace.selectedId=removedPlace.approvedId=removedPlace.variants[0].id;
p.items.push(removedHero,removedPlace);
const script=p.items.find(i=>i.stage===4);
const shots=Array.from({length:38},(_,n)=>{const hero=n%4===0?undefined:heroes[n%heroes.length],place=places[n%places.length],angle=place.location.approvedAngles[n%2];return {id:D.id(),title:`План ${n+1}`,description:hero?`${hero.title} у воды`:'Без персонажей',duration:3,camera:'Общий план',continuity:'В следующем плане появятся Катя и Петя.',dialogue:'',speechType:'none',speaker:'',characterIds:hero?[hero.id]:[],locationIds:[place.id],locationState:{time:'Утро',light:'Мягкий свет',weather:'Ясно',layout:'Без изменений',allowedChanges:'',artDirection:'Сказка',angleIds:[angle.id]}};});
D.addVariant(p,script.id,{text:JSON.stringify({shots})});D.approve(p,script.id);
const frames=shots.map(shot=>{const item={id:D.id(),stage:5,title:shot.title,sourceShot:{scriptId:script.id,shotId:shot.id,title:shot.title},variants:[]};p.items.push(item);const v=D.makeVariant(p,item,{kind:'image',assetId:D.id(),text:'Первый кадр'});item.variants.push(v);item.selectedId=v.id;return item;});
for(const frame of frames){
 for(const stage of [6,7])p.items.push({id:D.id(),stage,title:frame.title,sourceShot:structuredClone(frame.sourceShot),variants:[]});
 const archived={id:D.id(),stage:5,title:frame.title,sourceShot:structuredClone(frame.sourceShot),planArchive:true,variants:[]};archived.variants.push(D.makeVariant(p,archived,{kind:'image',assetId:D.id(),text:'Старая версия плана'}));p.items.push(archived);
}
// Many ordinary non-reference cards reproduce the historical whole-project scan.
for(let n=0;n<180;n++)p.items.push({id:D.id(),stage:[5,6,7,8,9][n%5],title:'Нерелевантный материал '+n,variants:[]});
const deletedAsset=D.id(),deletedVariant=D.makeVariant(p,frames[0],{kind:'image',assetId:deletedAsset,text:'Удалённый вариант'});
p.removedVariants=[{itemId:frames[0].id,variant:deletedVariant,removedAt:D.now()}];
const hiddenHeroAsset=heroes[2].variants[0].assetId,hiddenAngle=places[0].location.approvedAngles[1].refs[0];p.hiddenReferenceIds=[hiddenHeroAsset,hiddenAngle];
assert.equal(D.isApproved(p,script),true,'The wide fixture has a current approved script');
assert(p.items.length>300);assert(projectAssetIds(p).has(deletedAsset));assert(projectAssetIds(p).has(removedHero.variants[0].assetId));
const before=JSON.stringify(p),known=[...projectAssetIds(p)],upload=D.id();
function expected(n){const shot=shots[n],place=places.find(i=>i.id===shot.locationIds[0]),hero=heroes.find(i=>shot.characterIds.includes(i.id));return [hero?.variants[0].assetId,place.variants[0].assetId,...place.location.refs,...place.location.approvedAngles.filter(a=>shot.locationState.angleIds.includes(a.id)).flatMap(a=>a.refs)].filter(id=>id&&!p.hiddenReferenceIds.includes(id));}
let calls=0;
for(const [n,frame] of frames.entries()){
 globalThis.referenceApprovalCalls=[];
 assert.deepEqual(new Set(R.planReferenceIds(p,frame)),new Set(expected(n)),`Only cast, location and its chosen angle for plan ${n+1}`);
 const approvals=referenceApprovalCalls.filter(c=>c.stage!==4);
 assert(approvals.every(c=>[1,3].includes(c.stage)), 'Frame/voice/video/history cards never need approval checks to find references');
 assert(approvals.length<=heroes.length+places.length+2,'Reference checks bounded by hero/location candidates, never by the 38-plan card count');
 // +2 are recoverable removed hero/location cards, whose real approval returns false.
 assert(referenceApprovalCalls.filter(c=>c.stage===4).length<=2,'At most the two existing script lookups');calls+=referenceApprovalCalls.length;
 const selection=R.filterPlanReferences(p,frame,[...known,upload]);
 assert.deepEqual(new Set(selection),new Set([...expected(n),frame.variants[0].assetId,upload]),'Known unrelated/hidden/deleted/history files cannot leak into the selected set; an explicit new upload is allowed');
 assert(!selection.includes(deletedAsset));assert(!selection.includes(removedHero.variants[0].assetId));
}
assert.equal(JSON.stringify(p),before,'Opening and computing a batch never mutates selections, approvals or history');
const small=structuredClone(p);small.items=small.items.filter(i=>i.stage<5||i.id===frames[0].id);
referenceApprovalCalls=[];R.planReferenceIds(small,small.items.find(i=>i.id===frames[0].id));const smallCalls=referenceApprovalCalls.length;
referenceApprovalCalls=[];R.planReferenceIds(p,frames[0]);assert.equal(referenceApprovalCalls.length,smallCalls,'Reference approval work does not grow with 300 unrelated production cards');
assert.deepEqual(R.planCharacterIds(p,frames[0]),[],'An explicit empty cast stays empty despite neighbouring dialogue/continuity');
assert.equal(JSON.stringify(p),before);
console.log(`PASS storyboard batch performance: 38 plans, ${p.items.length} cards, exact cast/location/angle refs, hidden/deleted/archive exclusions, ${calls} direct approval checks with constant per-plan bound; real approval logic, zero providers or mutations.`);
