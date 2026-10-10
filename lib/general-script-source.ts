import type {Project} from './domain';

/** The fixed left pane and every new request share exactly this source. */
export function generalScriptSource(p:Project){
  const items=p.items.filter(i=>i.stage===0&&!i.removedAt&&!i.planArchive);
  const canonical=items.find(i=>i.id===p.generalScenario?.approvedItemId)??items.find(i=>i.approvedId)??items[0];
  const variant=canonical?.variants.find(v=>v.id===canonical.approvedId&&v.kind==='text')
    ??canonical?.variants.find(v=>v.kind==='text'&&v.text.trim());
  return variant&&canonical?{item:canonical,variant}:undefined;
}
export function assertGeneralScriptSource(p:Project,id:string){
  if(generalScriptSource(p)?.variant.id!==id)throw Error('Основной сценарий изменился. Обновите страницу: генерация использует текст левого окна.');
}
export const screenplayModel=(p:Project)=>p.screenplayModel??p.generalScenario?.config?.model??'gpt-6-astra';
