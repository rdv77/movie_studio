import {dependencies,getItem,now,type Project,type Item} from './domain';
import {scriptVideo} from './video';

function sameScene(a:Item,b:Item) {
  return a.id===b.id||!!a.sourceShot&&!!b.sourceShot&&a.sourceShot.scriptId===b.sourceShot.scriptId&&a.sourceShot.title===b.sourceShot.title;
}
export function setPlanExcluded(p:Project,itemId:string,excluded:boolean) {
  const item=getItem(p,itemId);
  if(![5,6,7].includes(item.stage))throw new Error('Выберите карточку плана.');
  const candidates=p.items.filter(i=>i.stage===5&&sameScene(i,item)&&(!i.planArchive||i.planArchive.reason==='excluded'));
  if(candidates.length!==1)throw new Error('Не удалось однозначно найти план раскадровки. Подтяните карточки из сценария.');
  const frame=candidates[0];
  if(excluded?!!frame.excludedAt:!frame.excludedAt)throw new Error(excluded?'План уже удалён.':'План не удалён.');
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw new Error('Дождитесь завершения текущих генераций перед изменением состава планов.');
  if(!excluded&&frame.sourceShot){
    const script=scriptVideo(p,true);
    if(script.source?.id!==frame.sourceShot.scriptId||!script.shots.some(s=>s.title===frame.sourceShot!.title))throw new Error('Этого плана больше нет в утверждённом сценарии. Сначала обновите карточки.');
  }
  const before=new Map([6,7].map(stage=>[stage,dependencies(p,stage)]));
  // The array positions, media, titles and selections stay intact for Undo.
  const stamp=now();
  for(const i of p.items.filter(i=>[5,6,7].includes(i.stage)&&sameScene(i,frame)&&(!i.planArchive||i.planArchive.reason==='excluded'))){
    i.excludedAt=excluded?stamp:undefined;i.planArchive=excluded?{reason:'excluded'}:undefined;
  }
  if(!excluded&&p.storyboardOrder)p.storyboardOrder=p.items.filter(i=>i.stage===5&&!i.planArchive&&!i.removedAt).map(i=>i.id);
  for(const stage of [6,7]){
    const after=dependencies(p,stage);
    for(const i of p.items.filter(i=>i.stage===stage))for(const v of i.variants)if(v.deps===before.get(stage))v.deps=after;
  }
}
