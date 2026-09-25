import { chosen, id, type Item, type Project, type Variant } from './domain';

export type ScriptPlan = { id?:string;sceneId?:string;productionDesign?:string;cast?:string[]; title:string; description:string; duration:number; camera:string; dialogue:string; continuity:string; speechType?:'voiceover'|'character'|'none'; speaker?:string };
export type PlanScript = { source:Item; variant:Variant; shots:ScriptPlan[] };

export function planKey(title:string) {
  const normalized=title.normalize('NFKC').toLowerCase().replace(/ё/g,'е').trim();
  const number=/^(?:(?:план|кадр|сцена|shot)\s*№?\s*)?0*(\d+)(?=\s|[.—–\-:)]|$)/u.exec(normalized);
  return number ? `number:${Number(number[1])}` : 'title:'+normalized.replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function planLabel(title:string){return title.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/^(?:(?:план|кадр|сцена|shot)\s*№?\s*)?\d+[.—–\-:\s)]*/u,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function previousDescription(p:Project,item:Item,description:string){
  const source=p.items.find(i=>i.id===item.sourceShot?.scriptId);
  const version=item.sourceShot?.scriptVersion??chosen(item)?.shotSource;
  return source?.variants.filter(v=>!version||v.id===version).some(v=>{
    try {const data=JSON.parse(v.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));return Array.isArray(data.shots)&&data.shots.filter((s:any)=>s.description?.trim()===description.trim()).length===1&&data.shots.some((s:any)=>s.title===(item.sourceShot?.title??item.title)&&s.description?.trim()===description.trim());}
    catch{return false;}
  })??false;
}

// Match numbered plans across title/script revisions. Do not guess by position:
// inserting or removing a plan must not attach another scene's paid media to it.
export function reconcilePlanStage(p:Project,stage:number,script:PlanScript,create=true) {
  const existing=p.items.filter(i=>i.stage===stage&&(stage!==6||i.sourceShot));
  const keys=script.shots.map(s=>planKey(s.title));
  const labels=script.shots.map(s=>planLabel(s.title));
  const used=new Set<string>(), ordered:Item[]=[];
  let changed=false, reorder=false;
  const update=(item:Item,field:'sourceShot'|'planArchive'|'excludedAt',value:any)=>{
    if(JSON.stringify(item[field])!==JSON.stringify(value)){(item as any)[field]=value;changed=true;}
  };
  for(const [index,shot] of script.shots.entries()) {
    const key=keys[index],unique=keys.filter(k=>k===key).length===1;
    const label=labels[index],uniqueLabel=!!label&&labels.filter(l=>l===label).length===1&&new Set(existing.filter(i=>planLabel(i.sourceShot?.title??i.title)===label).map(i=>i.sourceShot?.key??planKey(i.sourceShot?.title??i.title))).size<=1;
    const uniqueDescription=script.shots.filter(s=>s.description.trim()===shot.description.trim()).length===1;
    const candidates=existing.filter(i=>!used.has(i.id)&&(shot.id&&i.sourceShot?.shotId?shot.id===i.sourceShot.shotId:(
      (i.sourceShot?.title??i.title)===shot.title ||
      (uniqueLabel&&planLabel(i.sourceShot?.title??i.title)===label) ||
      (unique&&uniqueDescription&&(i.sourceShot?.key??planKey(i.sourceShot?.title??i.title))===key&&previousDescription(p,i,shot.description)) ||
      (index===0&&!i.sourceShot&&(stage===5&&i.title==='Раскадровка'||stage===7&&!i.variants.length&&i.title==='Видеопланы'))
    )));
    const score=(i:Item)=>Number(!!chosen(i)?.assetId)*32+Number(i.variants.some(v=>v.id===i.approvedId&&v.assetId))*16+Number(i.variants.some(v=>v.assetId))*8+Number(!i.planArchive)*4+Number(i.sourceShot?.scriptId===script.source.id);
    candidates.sort((a,b)=>score(b)-score(a));
    let item=candidates[0];
    if(!item&&create){
      if(p.items.length>=500)throw new Error('В проекте максимум 500 материалов.');
      item={id:id(),stage,title:shot.title,variants:[]};p.items.push(item);changed=true;reorder=true;
    }
    if(!item)continue;
    used.add(item.id);
    if(item.sourceShot?.scriptVersion!==script.variant.id)reorder=true;
    if(!item.sourceShot||item.title===item.sourceShot.title){if(item.title!==shot.title){item.title=shot.title;changed=true;}}
    update(item,'sourceShot',{scriptId:script.source.id,title:shot.title,key:unique?key:'title:'+shot.title,scriptVersion:script.variant.id,...(shot.id?{shotId:shot.id,sceneId:shot.sceneId}:{})});
    const excludedAt=item.excludedAt??p.items.find(f=>f.stage===5&&f.excludedAt&&f.sourceShot?.scriptId===script.source.id&&f.sourceShot.title===shot.title)?.excludedAt;
    if(excludedAt)update(item,'excludedAt',excludedAt);
    update(item,'planArchive',excludedAt?{reason:'excluded'}:undefined);
    if(!excludedAt)ordered.push(item);
    for(const duplicate of candidates.slice(1)){
      used.add(duplicate.id);
      update(duplicate,'planArchive',{reason:'duplicate',replacementId:item.id});
    }
  }
  for(const item of existing)if(!used.has(item.id))update(item,'planArchive',{reason:'removed'});
  if(p.storyboardOrder?.length){
    const rank=new Map(p.storyboardOrder.map((id,n)=>[id,n]));
    const position=(i:Item)=>rank.get(stage===5?i.id:p.items.find(f=>f.stage===5&&!f.planArchive&&!f.removedAt&&f.sourceShot?.scriptId===i.sourceShot?.scriptId&&f.sourceShot?.title===i.sourceShot?.title)?.id??'')??Infinity;
    ordered.sort((a,b)=>position(a)-position(b));
  }
  if(reorder||changed){
    const ids=new Set(ordered.map(i=>i.id));let at=0;
    const next=p.items.map(i=>ids.has(i.id)?ordered[at++]:i);
    if(next.some((i,n)=>i.id!==p.items[n].id)){p.items=next;changed=true;}
  }
  return changed;
}

export function planCardsNeedSync(p:Project,stage:number,script:PlanScript) {
  const active=p.items.filter(i=>i.stage===stage&&!i.planArchive);
  return active.length!==script.shots.length||script.shots.some(s=>
    active.filter(i=>i.sourceShot?.scriptId===script.source.id&&i.sourceShot.title===s.title&&i.sourceShot.scriptVersion===script.variant.id).length!==1);
}
