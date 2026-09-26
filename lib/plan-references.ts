import { isApproved, type Project, type Item } from './domain';
import { parseShots } from './shots';
import { selectedReferences } from './reference-selection';

// Only the current shot supplies cast. Neighbouring shots, dialogue and
// continuity history can mention people who are not visible in this frame.
export function referenceShot(p:Project,item:Item) {
  const script=p.items.find(i=>i.stage===4&&isApproved(p,i));
  const v=script?.variants.find(v=>v.id===script.approvedId);
  if(!v||item.planArchive||item.removedAt)return undefined;
  try {return parseShots(v.text,p.seconds).find(s=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));}catch{return undefined;}
}
const normalized=(s:string)=>s.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function mentions(text:string,name:string) {
  const n=normalized(name);
  return !!n&&(` ${normalized(text)} `).includes(` ${n} `);
}
export function planCharacterIds(p:Project,item:Item,selected?:string[]) {
  const shot=referenceShot(p,item);
  if(!shot)return [];
  return p.items.filter(i=>i.stage===1&&isApproved(p,i)&&(!selected||selected.includes(i.id))).flatMap(i=>{
    const v=i.variants.find(v=>v.id===i.approvedId),c=v?.character;
    if(!c||!v?.assetId)return [];
    const present=shot.cast!==undefined?shot.cast.some(name=>normalized(name)===normalized(c.name)||name===i.id)
      :!/(?:персонажей|людей|героев)\s+нет|без\s+(?:персонажей|людей|героев)/iu.test(shot.description)
        &&(mentions(shot.description,c.name)||(shot.speechType==='character'&&normalized(shot.speaker??'')===normalized(c.name)));
    return present?[i.id]:[];
  });
}
export function planReferenceIds(p:Project,item:Item) {
  const shot=referenceShot(p,item);if(!shot)return [];
  const heroes=new Set(planCharacterIds(p,item));
  const scene=p.directing?.scenes.find(s=>s.id===shot.sceneId);
  const context=[shot.title,shot.description,shot.productionDesign,scene?.location].filter(Boolean).join('\n');
  const ids=p.items.filter(i=>isApproved(p,i)).flatMap(i=>{
    const v=i.variants.find(v=>v.id===i.approvedId)!;
    if(v.kind!=='image'||!v.assetId)return [];
    if(heroes.has(i.id))return [v.assetId];
    // Generic style boards can contain unrelated people/places: retain their
    // textual style in the prompt, not an automatic image attachment.
    if(i.stage===3&&normalized(i.title).length>=4&&!['образы и локации','референсы','локации'].includes(normalized(i.title))&&mentions(context,i.title))return [v.assetId];
    return [];
  });
  return selectedReferences(p,ids);
}
export function planFrameIds(p:Project,item:Item) {
  return selectedReferences(p,p.items.filter(i=>!i.removedAt&&!i.planArchive&&[5,7].includes(i.stage)&&
    (i.id===item.id||(item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:
      i.sourceShot?.scriptId===item.sourceShot?.scriptId&&(i.sourceShot?.title??i.title)===(item.sourceShot?.title??item.title))))
    .flatMap(i=>i.variants.flatMap(v=>v.kind==='image'&&v.assetId?[v.assetId]:[])));
}
// Explicit per-shot uploads remain a director's choice. Known assets from
// unrelated cards cannot leak back in through an older client/default list.
export function filterPlanReferences(p:Project,item:Item,refs:string[]) {
  if(![5,7].includes(item.stage))return selectedReferences(p,refs);
  const allowed=new Set([...planReferenceIds(p,item),...planFrameIds(p,item)]);
  const known=new Set(p.items.flatMap(i=>[...(i.character?.refs??[]),...i.variants.flatMap(v=>v.assetId?[v.assetId]:[])]));
  return selectedReferences(p,refs).filter(id=>allowed.has(id)||!known.has(id));
}
