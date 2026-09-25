import { materialBasis } from './material-basis';
import { approve, chosen, dependencies, getItem, participates, stageReady, type Project } from './domain';
import { assertSpeech, speechInfo } from './speech-mode';
import { spokenText } from './spoken-text';
import { shotSchema } from './shots';

// A recording's approval depends on the spoken scene, not on image IDs.
// Recover the source at its last approval; never compare the current recording
// with itself (speechPlans intentionally preserves director-edited audio text).
export function unchangedSpeechReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),audio=chosen(item);
  const unavailable=speechReapprovalReason(p,itemId,variantId);
  if(unavailable)return unavailable;
  if(audio!.id!==item.approvedId)return 'Это новый выбор голоса. Прослушайте и утвердите запись отдельно.';
  if(!item.sourceShot)return 'Общую дорожку нужно прослушать и утвердить отдельно.';
  try {
    const before=JSON.parse(audio!.deps) as [number,...[string,string|null][]];
    const after=JSON.parse(dependencies(p,6)) as typeof before;
    const source=getItem(p,item.sourceShot.scriptId);
    if(source.stage!==4)throw new Error('Missing script');
    const oldVersion=(id:string)=>{const entry=before.slice(1).find(e=>Array.isArray(e)&&e[0]===id);return Array.isArray(entry)?entry[1]:undefined;};
    const version=(id:string,versionId:string|null|undefined)=>p.items.find(i=>i.id===id)?.variants.find(v=>v.id===versionId)
      ??p.removedVariants?.find(r=>r.itemId===id&&r.variant.id===versionId)?.variant;
    const other=(basis:typeof before)=>JSON.stringify([basis[0],...basis.slice(1).filter(e=>Array.isArray(e)&&![4,5].includes(getItem(p,e[0]).stage)).sort()]);
    if(other(before)!==other(after))return 'Изменилась общая основа озвучки. Прослушайте запись и утвердите её отдельно.';
    const oldScript=version(source.id,oldVersion(source.id)),newScript=version(source.id,source.approvedId);
    if(!oldScript||!newScript)throw new Error('Missing script version');
    const read=(text:string)=>shotSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))).shots;
    const find=(text:string)=>{const rows=read(text).filter(s=>s.title===item.sourceShot!.title);if(rows.length!==1)throw new Error('Ambiguous plan');return rows[0];};
    const oldShot=find(oldScript.text),newShot=find(newScript.text);
    const contract=(value:{dialogue?:string;speechType?:'voiceover'|'character'|'none';speaker?:string;duration?:number})=>{
      const info=speechInfo(value);
      return JSON.stringify({...info,dialogue:(value.dialogue??'').trim().replace(/\s+/g,' '),duration:value.duration});
    };
    if(contract(oldShot)!==contract(newShot))return 'В сценарии изменились реплика, говорящий, вид речи или длительность плана. Проверьте запись отдельно.';
    const frames=p.items.filter(i=>i.stage===5&&participates(p,i)&&i.sourceShot?.scriptId===source.id&&i.sourceShot.title===item.sourceShot!.title);
    if(frames.length!==1)throw new Error('Missing frame');
    const frame=frames[0],oldImage=version(frame.id,oldVersion(frame.id)),newImage=version(frame.id,frame.approvedId);
    if(!oldImage||!newImage)throw new Error('Missing frame version');
    const effective=(image:typeof oldImage,shot:typeof oldShot)=>({...(image.speechType?image:shot),duration:image.duration??shot.duration});
    if(contract(effective(oldImage,oldShot))!==contract(effective(newImage,newShot)))
      return 'В раскадровке изменились параметры реплики или длительность плана. Проверьте запись отдельно.';
    return '';
  } catch {
    return 'Не удалось сравнить прежнюю и текущую основу реплики. Прослушайте запись и утвердите её отдельно.';
  }
}

export function speechReapprovalReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),audio=chosen(item);
  if(item.stage!==6||!participates(p,item))return 'Откройте активную карточку озвучки в выбранном режиме: «По планам» или «Общая дорожка».';
  if(audio?.id!==variantId||audio.kind!=='audio'||!audio.assetId)return 'Выберите готовую аудиозапись в этой карточке.';
  if(!stageReady(p,6))return 'Сначала утвердите материалы предыдущих этапов. Причины блокировки перечислены выше.';
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))return 'Дождитесь завершения текущих задач, затем подтвердите запись.';
  if(audio.speechType){
    try {assertSpeech(speechInfo(audio),audio.dialogue);}catch(e){return (e as Error).message+' Исправьте описание речи через «Правки».';}
    if(audio.speechType==='character'&&!item.sourceShot)return 'Для реплики героя нужна отдельная карточка плана. Используйте «Подготовить озвучку по планам».';
    if(audio.speechType==='character'&&!spokenText(audio.dialogue,[audio.speaker??'']))return 'В реплике героя нет произносимого текста. Проверьте запись и заполните реплику через «Правки».';
  }
  if(audio.deps===dependencies(p,6))return 'Запись уже относится к текущей версии. Используйте обычное утверждение.';
  return '';
}

export function reapproveSpeech(p:Project,itemId:string,variantId:string) {
  const reason=speechReapprovalReason(p,itemId,variantId);if(reason)throw new Error(reason);
  const copy=structuredClone(p),item=getItem(copy,itemId);
  // The director reviews the existing recording. Do not rewrite its words,
  // speaker, timings, file or generation receipt to match a newer script.
  chosen(item)!.deps=dependencies(copy,6);
  if(chosen(item)!.reviewBasis)chosen(item)!.reviewBasis=materialBasis(copy,item,chosen(item));
  approve(copy,itemId);
  Object.assign(getItem(p,itemId),item);
}
