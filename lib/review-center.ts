import { chosen,dependencies,variantCurrent,isApproved,approve,participates,type Project,type Item } from './domain';
import { materialBasis } from './material-basis';
import { stagePosition } from './stage-order';
import { unchangedSpeechReason } from './speech-approval';
import { resolveFinalClip } from './render';
export type ReviewRow={itemId:string;variantId?:string;stage:number;title:string;status:'ready'|'review'|'conflict'|'missing'|'approved';reason:string;};
export function pairedItem(p:Project,item:Item,stage:number){return p.items.find(i=>i.stage===stage&&participates(p,i)&&(item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:i.sourceShot?.scriptId===item.sourceShot?.scriptId&&i.sourceShot?.title===item.sourceShot?.title));}
export function timingConflict(p:Project,item:Item){
  if(![6,7].includes(item.stage)||!item.sourceShot)return '';
  const video=item.stage===7?item:pairedItem(p,item,7),audio=item.stage===6?item:pairedItem(p,item,6);
  const v=video&&chosen(video),a=audio&&chosen(audio);
  if(!v?.assetId||!a?.assetId)return '';
  const vs=p.mediaDurations?.[v.assetId],as=p.mediaDurations?.[a.assetId];
  if(!vs||!as)return 'Проверьте длительности файлов перед быстрым утверждением.';
  const cut=p.assemblyCuts?.find(c=>c.itemId===video!.id&&c.variantId===v.id),available=vs-(cut?.trim??v.trim),seconds=cut?.duration??available,speech=as-a.trim;
  if(available<=0||speech<=0||seconds>available+.05)return 'Монтажный участок выходит за границы файла. Исправьте начало или длительность.';
  try{resolveFinalClip({...v,title:item.title,trim:cut?.trim??v.trim,duration:cut?.duration??v.duration,assemblyMode:cut?.duration!=null?'custom':'full'},vs,speech);return '';}
  catch(e){return `Видео ${seconds.toFixed(2)} сек, речь ${speech.toFixed(2)} сек${speech>seconds?`: превышение ${(speech-seconds).toFixed(2)} сек`:''}. ${(e as Error).message}`;}
}
export function reviewRows(p:Project):ReviewRow[]{
  return p.items.filter(i=>participates(p,i)&&i.stage!==8).sort((a,b)=>stagePosition(a.stage)-stagePosition(b.stage)).map(item=>{
    const v=chosen(item),base={itemId:item.id,variantId:v?.id,stage:item.stage,title:item.title};
    if(!v)return {...base,status:'missing',reason:'Выберите готовый вариант.'};
    if(item.character&&(v.kind!=='image'||!v.assetId||!v.character))return {...base,status:'missing',reason:'Выберите готовый образ героя с сохранённым описанием.'};
    if([5,6,7].includes(item.stage)&&(!v.assetId||v.kind!==({5:'image',6:'audio',7:'video'} as any)[item.stage]))return {...base,status:'missing',reason:'Нужен готовый файл.'};
    const conflict=timingConflict(p,item);
    if(conflict)return {...base,status:'conflict',reason:conflict};
    if(v.lipsync&&p.items.find(i=>i.id===v.lipsync!.audioItemId)?.approvedId!==v.lipsync.audioVariantId)return {...base,status:'conflict',reason:'После синхронизации выбран другой голос. Повторите синхронизацию губ.'};
    if(p.jobs.some(j=>j.itemId===item.id&&['queued','dispatching','pending','saving'].includes(j.status)))return {...base,status:'conflict',reason:'Материал ещё создаётся.'};
    if(isApproved(p,item)&&v.id===item.approvedId)return {...base,status:'approved',reason:'Утверждён.'};
    if(variantCurrent(p,item,v))return {...base,status:'ready',reason:'Выбран актуальный вариант.'};
    if(item.stage===6&&!unchangedSpeechReason(p,item.id,v.id))return {...base,status:'ready',reason:'Реплика не изменилась.'};
    return {...base,status:'review',reason:'Основа изменилась. Посмотрите материал и отметьте, если он подходит текущему фильму.'};
  });
}
export function approveReview(p:Project,selections:{itemId:string;variantId:string;reviewed?:boolean}[]){
  if(!selections.length||new Set(selections.map(s=>s.itemId)).size!==selections.length)throw Error('Выберите материалы без повторов.');
  const copy=structuredClone(p);
  const rows=reviewRows(copy);
  for(const row of rows.filter(r=>selections.some(s=>s.itemId===r.itemId))){
    const currentRow=reviewRows(copy).find(r=>r.itemId===row.itemId)!;
    if(currentRow.status==='review'&&!selections.find(s=>s.itemId===row.itemId)?.reviewed)throw Error(`${row.title}: после предыдущих утверждений изменилась основа. Посмотрите материал и отметьте его повторно.`);
    if(row.variantId!==selections.find(s=>s.itemId===row.itemId)?.variantId)throw Error('Выбор изменился. Обновите данные.');
    if(['conflict','missing'].includes(currentRow.status))throw Error(`${row.title}: ${currentRow.reason}`);
    const item=copy.items.find(i=>i.id===row.itemId)!,v=chosen(item)!;
    // Explicit multi-card director approval: preserve file, ID, source and cost.
    v.deps=dependencies(copy,item.stage);
    if([5,6,7].includes(item.stage))v.reviewBasis=materialBasis(copy,item,v)||undefined;
    approve(copy,item.id);
  }
  if(selections.some(s=>!rows.some(r=>r.itemId===s.itemId)))throw Error('Материал больше не участвует в фильме.');
  p.items=copy.items;
}
