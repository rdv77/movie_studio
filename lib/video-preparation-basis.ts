import type {Item,Job,Project,Variant} from './domain';
import type {PreparedFrame,VideoPreparation} from './video-from-animatic';

// No runtime domain/animatic imports: domain uses this before queue dispatch.
const stable=(v:any):string=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)??'null';
export function preparationSignature(v:unknown){let a=2166136261,b=5381;for(const c of stable(v)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);}
// The old full-object hash includes undefined keys. Retain its exact algorithm
// only for compatibility with already paid jobs and already approved videos.
function legacyStable(v:any):string{return Array.isArray(v)?'['+v.map(legacyStable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+legacyStable(v[k])).join(',')+'}':JSON.stringify(v)??'null';}
export function legacyPreparationSignature(v:unknown){let a=2166136261,b=5381;for(const c of legacyStable(v)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return (a>>>0).toString(16)+(b>>>0).toString(16);}

const active=(i:Item)=>!i.removedAt&&!i.planArchive&&!i.excludedAt;
function scriptShots(p:Project,item:Item,variantId?:string):any[]{
  const script=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive&&(!item.sourceShot?.scriptId||i.id===item.sourceShot.scriptId));
  const v=script?.variants.find(v=>v.id===(variantId??script.approvedId))??p.removedVariants?.find(r=>r.itemId===script?.id&&r.variant.id===variantId)?.variant;
  try{return JSON.parse((v?.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')).shots??[];}catch{return [];}
}
/** Only the current shot and adjoining boundary states, never film history. */
export function preparationShotBasis(p:Project,item:Item,source?:{scriptVariantId?:string;shotOrder?:string[]}):string{
  const shots=scriptShots(p,item,source?.scriptVariantId),shot=shots.find(s=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));
  if(!shot)return preparationSignature({format:p.format,shotId:item.sourceShot?.shotId??item.sourceShot?.title});
  const frames=p.items.filter(i=>i.stage===5&&active(i));
  const order=source?.shotOrder??(p.storyboardOrder?.length?p.storyboardOrder.map(id=>frames.find(i=>i.id===id)?.sourceShot?.shotId??frames.find(i=>i.id===id)?.sourceShot?.title??id):frames.map(i=>i.sourceShot?.shotId??i.sourceShot?.title??i.title));
  const rank=new Map(order.map((id,n)=>[id,n]));
  const timeline=shots.filter(s=>source?.shotOrder?order.includes(s.id??s.title):!p.items.some(i=>i.stage===5&&!active(i)&&(i.sourceShot?.shotId?i.sourceShot.shotId===s.id:i.sourceShot?.title===s.title)))
    .map((s,n)=>({s,n:rank.get(s.id??s.title)??rank.size+n})).sort((a,b)=>a.n-b.n).map(row=>row.s);
  const index=timeline.indexOf(shot),boundary=(s:any,side:'in'|'out')=>s?{id:s.id??s.title,sceneId:s.sceneId,state:side==='in'?s.stateIn:s.stateOut,legacy:s.stateIn===undefined&&s.stateOut===undefined?s.continuity:undefined}:null;
  return preparationSignature({format:p.format,shot:{id:shot.id??shot.title,sceneId:shot.sceneId,description:shot.description,duration:shot.duration,cast:shot.cast,characterIds:shot.characterIds,locationIds:shot.locationIds,camera:shot.camera,productionDesign:shot.productionDesign,stateIn:shot.stateIn,stateOut:shot.stateOut,continuity:shot.continuity,continuityChanges:shot.continuityChanges,direction:shot.direction,videoPrompt:shot.videoPrompt,speechType:shot.speechType,speaker:shot.speaker,speakerId:shot.speakerId},previous:boundary(timeline[index-1],'out'),next:boundary(timeline[index+1],'in')});
}
export function preparationMediaBasis(value:VideoPreparation|undefined){return preparationSignature(value&&{shotId:value.shotId,startFrame:frameValue(value.startFrame),endFrame:frameValue(value.endFrame),duration:value.duration});}
function frameValue(frame:PreparedFrame|undefined){return frame&&{assetId:frame.assetId,...(frame.transform?{transform:frame.transform}:{})};}

type BasisFrame={follow:boolean;assetId:string;transform?:PreparedFrame['transform']};
type BasisPayload={v:2;signature:string;model:string;start:BasisFrame;end?:BasisFrame;refs:string[];providerDuration?:number};
type VideoRequest=Pick<Job,'model'|'refs'|'characterRefs'|'endFrameAssetId'|'providerDuration'>;
function requestFrame(value:VideoPreparation,role:'start'|'end',assetId:string):BasisFrame{
  const frame=role==='start'?value.startFrame:value.endFrame;
  return {follow:frame?.assetId===assetId,assetId,...(frame?.assetId===assetId&&frame.transform?{transform:frame.transform}:{})};
}
function payloadSignature(p:Project,item:Item,payload:Omit<BasisPayload,'signature'>){
  const value=item.videoPreparation!;
  const frame=(f:BasisFrame|undefined,role:'start'|'end')=>f&&(f.follow?frameValue(role==='start'?value.startFrame:value.endFrame):{assetId:f.assetId,...(f.transform?{transform:f.transform}:{})});
  return preparationSignature({shot:preparationShotBasis(p,item),duration:value.duration,start:frame(payload.start,'start'),end:frame(payload.end,'end'),refs:payload.refs,model:payload.model,providerDuration:payload.providerDuration});
}
/** Created AFTER compilation so unsupported last frames never enter the basis. */
export function captureVideoPreparationBasis(p:Project,item:Item,request:VideoRequest):string|undefined{
  const value=item.videoPreparation;if(!value)return undefined;
  if(!request.refs[0])throw Error('В подготовленном видеоплане нет первого кадра.');
  const payload:Omit<BasisPayload,'signature'>={v:2,model:request.model,start:requestFrame(value,'start',request.refs[0]),...(request.endFrameAssetId?{end:requestFrame(value,'end',request.endFrameAssetId)}:{}),refs:[...request.refs,...(request.characterRefs??[]),...(request.endFrameAssetId?[request.endFrameAssetId]:[])],...(request.providerDuration?{providerDuration:request.providerDuration}:{})};
  return 'vp2:'+JSON.stringify({...payload,signature:payloadSignature(p,item,payload)});
}
function parsedBasis(basis:string):BasisPayload|undefined{try{const v=JSON.parse(basis.slice(4));return v?.v===2&&typeof v.signature==='string'&&typeof v.start?.assetId==='string'&&typeof v.start.follow==='boolean'&&Array.isArray(v.refs)?v:undefined;}catch{return undefined;}}
export function videoBasisUsesEnd(record:{videoPreparationBasis?:string;endFrameAssetId?:string}){return record.videoPreparationBasis?.startsWith('vp2:')?!!parsedBasis(record.videoPreparationBasis)?.end:!!record.endFrameAssetId;}
export function videoBasisFollowsFrame(record:{videoPreparationBasis?:string},role:'start'|'end'){
  if(!record.videoPreparationBasis?.startsWith('vp2:'))return true;
  const payload=parsedBasis(record.videoPreparationBasis);return role==='start'?payload?.start.follow!==false:payload?.end?.follow!==false;
}
/** Selection in an explicit pair is material. A legacy unapproved draft is not. */
function currentSourceFrame(item:Item,role:'start'|'end'){
  const selected=role==='start'?item.keyframeSelection?.startId:item.keyframeSelection?.endId;
  if(selected)return item.variants.find(v=>v.id===selected&&v.kind==='image');
  if(role==='end')return undefined;
  return item.variants.find(v=>v.id===item.approvedId&&v.kind==='image')??item.variants.find(v=>v.id===item.selectedId&&v.kind==='image');
}
export function preparationOriginalFramesIssue(p:Project,item:Item,request?:{videoPreparationBasis?:string;endFrameAssetId?:string},useEnd=request?videoBasisUsesEnd(request):true):string{
  const value=item.videoPreparation;if(!value)return '';
  if(item.sourceShot?.scriptId&&!p.items.some(i=>i.stage===4&&i.id===item.sourceShot!.scriptId&&!i.removedAt&&!i.planArchive))return 'Исходный подробный сценарий этого плана больше не активен.';
  const source=p.items.find(i=>i.stage===5&&active(i)&&(value.shotId?i.sourceShot?.shotId===value.shotId:i.sourceShot?.title===item.sourceShot?.title));
  if(!source)return 'Этот план исключён из текущего фильма.';
  const m=p.animatic?.variants.find(v=>v.id===value.animaticVariantId)?.animaticManifest,clip=m?.projectId===p.id?m.clips.find(c=>c.itemId===source.id):undefined;
  const originals=value.sourceFrames??(clip?{startFrame:clip.frames.find(f=>f.role==='start')!,endFrame:clip.frames.find(f=>f.role==='end')}:undefined);
  if(!originals)return 'Исходный план аниматика недоступен. Подготовьте текущий видеоплан.';
  for(const role of ['start',...(useEnd?['end']:[])] as ('start'|'end')[]){
    if(request&&!videoBasisFollowsFrame(request,role))continue;
    if((role==='start'?originals.startFrame:originals.endFrame)?.assetId!==currentSourceFrame(source,role)?.assetId)return 'Исходный ключевой кадр этого плана изменился. Подготовьте его из текущего аниматика.';
  }
  return '';
}
/** Legacy aliases are retained only by semantic-identical preparation updates. */
export function videoPreparationCurrent(p:Project,item:Item,record:Partial<Job|Variant>):boolean{
  const basis=record.videoPreparationBasis;if(!basis)return true;
  const value=item.videoPreparation;if(!value)return false;
  if(preparationOriginalFramesIssue(p,item,record))return false;
  if(!basis.startsWith('vp2:'))return basis===legacyPreparationSignature(value)||!!value.legacyBases?.includes(basis);
  const payload=parsedBasis(basis);if(!payload)return false;
  // Actual request fields remain frozen; provenance edits cannot substitute files.
  if(record.model!==undefined&&record.model!==payload.model)return false;
  if(record.refs!==undefined&&stable([...record.refs,...(record.characterRefs??[]),...(record.endFrameAssetId?[record.endFrameAssetId]:[])])!==stable(payload.refs))return false;
  return payload.signature===payloadSignature(p,item,payload);
}
