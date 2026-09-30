import type { Project,Item,Variant } from './domain';
import type { VersionSource } from './creative-versions';
// Semantic dependencies are used only for newly created production materials.
// Existing snapshots keep their original approval behaviour until reviewed.
function stable(v:any):string{return Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)??'null';}
export function materialBasis(p:Project,item:Item,variant?:Partial<Variant>){
  if(variant?.basisVersion===2)return materialBasisV2(p,item,variant);
  const script=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive),v=script?.variants.find(v=>v.id===script.approvedId);
  let shot:any;
  try{shot=JSON.parse(v?.text??'').shots?.find((s:any)=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));}catch{}
  if(!shot)return '';
  const speech={text:shot.dialogue??'',type:shot.speechType??(shot.dialogue?'voiceover':'none'),speaker:shot.speaker??''};
  if(item.stage===6)return stable({speech});
  const heroes=p.items.filter(i=>i.stage===1&&!i.removedAt&&!i.planArchive).flatMap(i=>{const v=i.variants.find(v=>v.id===i.approvedId);return v&&(!v.character||!shot.cast?.length||shot.cast.includes(v.character.name))?[{text:v.text,character:v.character,asset:v.assetId}]:[];});
  const world=p.items.filter(i=>[2,3].includes(i.stage)&&!i.removedAt&&!i.planArchive).map(i=>{const v=i.variants.find(v=>v.id===i.approvedId);return {text:v?.text,asset:v?.assetId};});
  const frame=p.items.find(i=>i.stage===5&&!i.planArchive&&(item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:i.sourceShot?.title===item.sourceShot?.title));
  return stable({format:p.format,cast:shot.cast,story:shot.description,camera:shot.camera,design:shot.productionDesign,continuity:shot.continuity,heroes,world,
    speech:{type:speech.type,speaker:speech.type==='character'?speech.speaker:''},
    ...(item.stage===7?{duration:shot.duration,frame:frame?.variants.find(v=>v.id===frame.approvedId)?.assetId,lipsync:variant?.lipsync}:{}),
  });
}

const normalize=(s:string)=>s.toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const active=(i:Item)=>!i.removedAt&&!i.planArchive;
const approved=(i:Item)=>i.variants.find(v=>v.id===i.approvedId);
function sourceValue(p:Project,source:VersionSource){
  const item=p.items.find(i=>i.id===source.itemId);
  const v=source.followApproval?(item&&active(item)?approved(item):undefined):
    item?.variants.find(v=>v.id===source.variantId)??p.removedVariants?.find(r=>r.itemId===source.itemId&&r.variant.id===source.variantId)?.variant;
  if(source.itemId&&!v)return {itemId:source.itemId,missing:true};
  if(source.role==='frame'||source.role==='reference'||source.role==='audio')return {itemId:source.itemId,asset:v?.assetId??source.assetId};
  return {itemId:source.itemId,text:v?.character?undefined:v?.text,character:v?.character?{appearance:v.character.appearance,description:v.character.description,instructions:v.character.instructions}:undefined,asset:v?.assetId??source.assetId};
}
function speechIdentity(p:Project,shot:any){
  const type=shot.speechType??(shot.dialogue?'voiceover':'none');
  const hero=type==='character'?p.items.find(i=>i.stage===1&&active(i)&&(
    i.id===shot.speakerId||i.id===shot.speaker||normalize(approved(i)?.character?.name??i.character?.name??i.title)===normalize(shot.speaker??'')
  )):undefined;
  return {type,speaker:type==='none'?'':hero?.id??shot.speaker??''};
}
function shotTimeline(p:Project,shots:any[]){
  const frames=p.items.filter(i=>i.stage===5&&active(i));
  const rank=new Map((p.storyboardOrder?.length?p.storyboardOrder:frames.map(i=>i.id)).map((id,n)=>[id,n]));
  return shots.filter(shot=>!p.items.some(i=>i.stage===5&&i.excludedAt&&(i.sourceShot?.shotId?i.sourceShot.shotId===shot.id:i.sourceShot?.title===shot.title)))
    .map((shot,n)=>({shot,rank:rank.get(frames.find(i=>i.sourceShot?.shotId?i.sourceShot.shotId===shot.id:i.sourceShot?.title===shot.title)?.id??'')??rank.size+n}))
    .sort((a,b)=>a.rank-b.rank).map(row=>row.shot);
}
export function materialBasisV2(p:Project,item:Item,variant:Partial<Variant>={}){
  const script=p.items.find(i=>i.stage===4&&active(i)),v=script&&approved(script);
  let shots:any[]=[];
  try{shots=JSON.parse((v?.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')).shots??[];}catch{}
  const shot=shots.find(s=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));
  if(!shot)return '';
  const speech=speechIdentity(p,shot);
  if(item.stage===6)return 'v2:'+stable({speech:{...speech,text:shot.dialogue??'',delivery:shot.dialogueDelivery??''}});
  const scene=p.directing?.scenes.find(s=>s.id===shot.sceneId);
  const castItems=p.items.filter(i=>i.stage===1&&active(i)&&(!variant.characterIds||variant.characterIds.includes(i.id))&&(
    shot.characterIds?.includes(i.id)||shot.cast?.some((name:string)=>name===i.id||normalize(name)===normalize(approved(i)?.character?.name??i.character?.name??i.title))));
  const castIds=castItems.map(i=>i.id).sort();
  const used=variant.versionInfo?.sources??[];
  const sources=(role:VersionSource['role'],fallback:Item[])=>{
    const saved=used.filter(s=>s.role===role);
    return (saved.length?saved:fallback.flatMap(i=>{const v=approved(i);return v?[{role,itemId:i.id,variantId:v.id,assetId:v.assetId,followApproval:true}]:[];})).map(s=>sourceValue(p,s));
  };
  const locationIds=shot.locationIds??scene?.locationIds;
  const location=normalize(scene?.location??shot.location??'');
  const locations=p.items.filter(i=>i.stage===3&&active(i)&&(locationIds!==undefined?locationIds.includes(i.id):!!location&&normalize(i.title).length>=4&&(` ${location} `).includes(` ${normalize(i.title)} `)));
  const continuity=(shot.sceneContinuity??scene?.continuity)?.filter((c:any)=>castItems.some(i=>c.characterId===i.id||normalize(c.character)===normalize(approved(i)?.character?.name??i.character?.name??i.title)));
  const sceneShot=scene?.shots.find(s=>s.id===shot.id);
  const priorChanges=shot.previousChanges??(scene&&sceneShot?scene.shots.slice(0,scene.shots.indexOf(sceneShot)).filter(s=>s.continuityChanges.trim()&&(
    !s.characterIds?.length||s.characterIds.some(id=>castIds.includes(id))||s.cast.some(name=>castItems.some(i=>name===i.id||normalize(name)===normalize(approved(i)?.character?.name??i.character?.name??i.title)))
  )).map(s=>({id:s.id,changes:s.continuityChanges})):[]);
  const {targetSeconds,...brief}=p.directing?.brief??{};
  const timeline=shotTimeline(p,shots),at=timeline.findIndex(s=>s.id?shot.id===s.id:shot.title===s.title);
  const previous=timeline[at-1],next=timeline[at+1];
  const boundary=(s:any,side:'in'|'out')=>s?{id:s.id??s.title,sceneId:s.sceneId,state:side==='in'?s.stateIn:s.stateOut,
    // Older flat scripts have no dedicated boundary state; retain their exact
    // continuity text until a structured export supplies it.
    legacy:s.stateIn===undefined&&s.stateOut===undefined?s.continuity:undefined}:null;
  const frameSources=used.filter(s=>s.role==='frame');
  const frame=frameSources.length?frameSources.map(s=>sourceValue(p,s)):
    (variant.refs??[]).map(asset=>({asset}));
  return 'v2:'+stable({format:p.format,brief,cast:castIds.length?castIds:shot.characterIds??shot.cast,
    story:shot.description,camera:shot.camera,design:shot.productionDesign,stateIn:shot.stateIn,
    continuity:shot.stateIn===undefined?shot.continuity:undefined,sceneContinuity:continuity,priorChanges,
    heroes:sources('hero',castItems),style:sources('style',p.items.filter(i=>i.stage===2&&active(i))),locations:sources('location',locations),
    speech:{type:speech.type,speaker:speech.type==='character'?speech.speaker:''},
    ...(item.stage===7?{duration:shot.duration,stateOut:shot.stateOut,changes:shot.continuityChanges,
      frames:frame,previous:boundary(previous,'out'),next:boundary(next,'in'),lipsync:variant.lipsync}:{}),
  });
}
