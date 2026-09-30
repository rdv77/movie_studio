import type { CharacterBrief, Item, Job, Project, Variant } from './domain';
import type { DirectingState, Scene } from './directing';
import { materialBasis } from './material-basis';

export type VersionSource = {
  role: 'script'|'hero'|'style'|'location'|'frame'|'audio'|'reference';
  itemId?: string; variantId?: string; assetId?: string;
  // Explicit alternate frames stay pinned; automatic approved frames follow
  // their card. Hiding a library reference never changes an existing source.
  followApproval?: boolean;
};
export type VersionInfo = {
  mergedFromIds?: string[];
  parentVariantId?: string; created: string; reason?: string;
  sources: VersionSource[]; settings?: unknown;
};
export type CreativeSnapshot = {
  brief: DirectingState['brief']; durationMode?: DirectingState['durationMode'];
  productionOrder?: Project['productionOrder']; scenes: Scene[]; scenesApproved?: string;
};
export type CreativeVersion = {
  id: string; parentId?: string; restoredFromId?: string; created: string;
  reason: string; basis: string; snapshot: CreativeSnapshot;
};
export type CharacterVersion = {
  id: string; parentId?: string; restoredFromId?: string; created: string;
  reason: string; profile: CharacterBrief;
};
export function versionStable(v: unknown): string {
  return Array.isArray(v)?'['+v.map(versionStable).join(',')+']':v&&typeof v==='object'
    ?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+versionStable((v as any)[k])).join(',')+'}'
    :JSON.stringify(v)??'null';
}
export function versionSignature(v: unknown): string {
  let a=2166136261,b=5381;
  for(const c of versionStable(v)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}
  return (a>>>0).toString(16)+(b>>>0).toString(16);
}
export const normalizedName=(s:string)=>s.toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const active=(i:Item)=>!i.removedAt&&!i.planArchive;
const approved=(i:Item)=>i.variants.find(v=>v.id===i.approvedId);
export function versionShot(p:Project,item:Item):any {
  const script=p.items.find(i=>i.stage===4&&active(i)),v=script&&approved(script);
  try{return JSON.parse((v?.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')).shots?.find((s:any)=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));}catch{return undefined;}
}
export function relevantHeroItems(p:Project,shot:any,selected?:string[]):Item[] {
  if(!shot)return [];
  return p.items.filter(i=>i.stage===1&&active(i)&&(!selected||selected.includes(i.id))&&(
    shot.characterIds?.includes(i.id)||shot.cast?.some((name:string)=>name===i.id||normalizedName(name)===normalizedName(approved(i)?.character?.name??i.character?.name??i.title))
  ));
}
export function relevantLocationItems(p:Project,scene?:Scene,shot?:any):Item[] {
  const ids=shot?.locationIds??scene?.locationIds;
  const label=normalizedName(scene?.location??shot?.location??'');
  return p.items.filter(i=>i.stage===3&&active(i)&&(ids!==undefined?ids.includes(i.id):
    !!label&&normalizedName(i.title).length>=4&&(` ${label} `).includes(` ${normalizedName(i.title)} `)));
}
export function captureVersionInfo(p:Project,item:Item,data:Partial<Variant>={},settings?:unknown,reason?:string):VersionInfo {
  const sources:VersionSource[]=[];
  const add=(i:Item,role:VersionSource['role'])=>{const v=approved(i);if(v)sources.push({role,itemId:i.id,variantId:v.id,assetId:v.assetId,followApproval:true});};
  const shot=versionShot(p,item),scene=p.directing?.scenes.find(s=>s.id===shot?.sceneId);
  const script=p.items.find(i=>i.stage===(item.stage>=4?4:0)&&active(i));if(script&&script.id!==item.id)add(script,'script');
  if([5,6,7].includes(item.stage)){
    for(const i of relevantHeroItems(p,shot,data.characterIds))add(i,'hero');
    if(item.stage!==6){for(const i of p.items.filter(i=>i.stage===2&&active(i)))add(i,'style');for(const i of relevantLocationItems(p,scene,shot))add(i,'location');}
  }else for(const i of p.items.filter(i=>active(i)&&[0,1,2,3].includes(i.stage)&&i.id!==item.id))
    add(i,i.stage===0?'script':i.stage===1?'hero':i.stage===2?'style':'location');
  for(const assetId of [...new Set([...(data.refs??[]),...(data.characterRefs??[])])]){
    const i=p.items.find(i=>i.variants.some(v=>v.assetId===assetId));
    const v=i?.variants.find(v=>v.assetId===assetId);
    const role=i?.stage===5?'frame':i?.stage===6?'audio':i?.stage===1?'hero':i?.stage===2?'style':i?.stage===3?'location':'reference';
    if(!sources.some(s=>s.assetId===assetId&&s.itemId===i?.id))sources.push({role,assetId,itemId:i?.id,variantId:v?.id,followApproval:!!i&&approved(i)?.assetId===assetId});
  }
  const parent=item.variants.find(v=>v.id===item.selectedId);
  return {parentVariantId:parent?.id,created:new Date().toISOString(),reason,sources:structuredClone(sources),
    settings:settings===undefined?undefined:structuredClone(settings)};
}
export function stampGenerationVersions(p:Project,jobs:Job[]) {
  for(const job of jobs){
    if(job.purpose)continue;
    const item=p.items.find(i=>i.id===job.itemId);if(!item)continue;
    job.versionInfo??=captureVersionInfo(p,item,job,{brief:p.directing?.brief,image:job.imageSettings,model:job.model},'generation');
    if(p.directing&&[5,6,7].includes(item.stage)){
      job.basisVersion=2;job.reviewBasis=materialBasis(p,item,job)||undefined;
    }
  }
}
export function creativeSnapshot(p:Project):CreativeSnapshot|undefined {
  const d=p.directing;if(!d)return undefined;
  return structuredClone({brief:d.brief,durationMode:d.durationMode,productionOrder:p.productionOrder,scenes:d.scenes,scenesApproved:d.scenesApproved});
}
function snapshotBasis(snapshot:CreativeSnapshot) {
  return versionSignature({...snapshot,scenesApproved:undefined,scenes:snapshot.scenes.map(s=>({...s,shots:s.shots.map(shot=>{
    const {approved,approvedFoundation,approvalVersion,imagePrompt,videoPrompt,promptBasis,...content}=shot;
    return content;
  })}))});
}
export function recordCreativeVersion(p:Project,reason:string,parentId=p.creativeVersionId):CreativeVersion|undefined {
  const snapshot=creativeSnapshot(p);if(!snapshot)return undefined;
  const basis=snapshotBasis(snapshot),head=p.creativeHistory?.find(v=>v.id===p.creativeVersionId);
  if(head?.basis===basis)return head;
  const entry:CreativeVersion={id:crypto.randomUUID(),parentId,created:new Date().toISOString(),reason,basis,snapshot};
  (p.creativeHistory??=[]).push(entry);p.creativeVersionId=entry.id;return entry;
}
export function restoreCreativeVersion(p:Project,versionId:string):CreativeVersion {
  const source=p.creativeHistory?.find(v=>v.id===versionId);if(!source||!p.directing)throw Error('Версия творческой разработки не найдена.');
  if(p.directing.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error)))throw Error('Остановите текущую проработку перед восстановлением версии.');
  recordCreativeVersion(p,'before-restore');
  const parent=p.creativeVersionId,s=structuredClone(source.snapshot),d=p.directing;
  d.brief=s.brief;d.scenes=s.scenes;d.scenesApproved=s.scenesApproved;d.durationMode=s.durationMode;p.productionOrder=s.productionOrder;
  d.editorBasis=undefined;d.patchesBasis=undefined;d.acceptedRuntime=undefined;d.issues=[];d.patches=[];
  // Restoration is a new branch, not a rewind of paid jobs or other choices.
  const entry:CreativeVersion={id:crypto.randomUUID(),parentId:parent,restoredFromId:source.id,created:new Date().toISOString(),reason:'restore',basis:snapshotBasis(s),snapshot:creativeSnapshot(p)!};
  (p.creativeHistory??=[]).push(entry);p.creativeVersionId=entry.id;return entry;
}
export function restoreSceneVersion(p:Project,versionId:string,sceneId:string):CreativeVersion|undefined {
  const d=p.directing,source=p.creativeHistory?.find(v=>v.id===versionId)?.snapshot.scenes.find(s=>s.id===sceneId);
  if(!d||!source)throw Error('Сцена не найдена в этой версии.');
  if(d.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error)))throw Error('Остановите проработку перед выбором версии сцены.');
  const index=d.scenes.findIndex(s=>s.id===sceneId);if(index<0)throw Error('Сцена больше не входит в фильм.');
  recordCreativeVersion(p,'До выбора версии сцены');
  d.scenes[index]=structuredClone(source);d.scenesApproved=undefined;d.editorBasis=undefined;d.patchesBasis=undefined;d.acceptedRuntime=undefined;
  return recordCreativeVersion(p,'Выбрана версия сцены',p.creativeVersionId);
}
export function recordCharacterVersion(item:Item,reason:string):CharacterVersion|undefined {
  if(!item.character)return undefined;
  const head=item.characterHistory?.find(v=>v.id===item.characterVersionId);
  if(head&&versionStable(head.profile)===versionStable(item.character))return head;
  const entry:CharacterVersion={id:crypto.randomUUID(),parentId:item.characterVersionId,created:new Date().toISOString(),reason,profile:structuredClone(item.character)};
  (item.characterHistory??=[]).push(entry);item.characterVersionId=entry.id;return entry;
}
export function restoreCharacterVersion(item:Item,versionId:string):CharacterVersion {
  const source=item.characterHistory?.find(v=>v.id===versionId);if(!source)throw Error('Версия описания героя не найдена.');
  recordCharacterVersion(item,'before-restore');const parent=item.characterVersionId;
  item.character=structuredClone(source.profile);item.title=item.character.name;
  const entry:CharacterVersion={id:crypto.randomUUID(),parentId:parent,restoredFromId:source.id,created:new Date().toISOString(),reason:'restore',profile:structuredClone(item.character)};
  (item.characterHistory??=[]).push(entry);item.characterVersionId=entry.id;return entry;
}
