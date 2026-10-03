import type {Project} from './domain';

export const characterNameKey=(name:string)=>name.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Explicit project-local aliases only. Never guess from a similar name. */
export function boundCharacterId(p:Project,name:string):string|undefined {
  const key=characterNameKey(name),bindings=p.characterBindings;
  return bindings&&Object.hasOwn(bindings,key)&&typeof bindings[key]==='string'?bindings[key]:undefined;
}
export function shotBindsCharacter(p:Project,shot:{cast?:string[]},itemId:string):boolean {
  return !!shot.cast?.some(name=>boundCharacterId(p,name)===itemId);
}
export function setCharacterBinding(p:Project,name:string,characterId:string|null){
  const key=characterNameKey(name);if(!key)throw Error('Укажите имя участника плана.');
  const source=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive),variant=source?.variants.find(v=>v.id===source.approvedId);
  let shots:{cast?:string[],characterIds?:string[]}[]=[];
  try{shots=JSON.parse((variant?.text??'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')).shots??[];}catch{throw Error('Сначала примените утверждённый подробный сценарий.');}
  const rows=shots.filter(shot=>shot.cast?.some(label=>characterNameKey(label)===key));
  if(!rows.length)throw Error('Это имя не встречается среди участников утверждённых планов.');
  if(characterId!==null){
    const hero=p.items.find(i=>i.id===characterId&&i.stage===1&&!i.removedAt&&!i.planArchive),approved=hero?.variants.find(v=>v.id===hero.approvedId);
    if(!approved?.character||approved.kind!=='image'||!approved.assetId)throw Error('Выберите действующий утверждённый образ героя этого проекта.');
    if(rows.some(shot=>shot.characterIds?.length&&!shot.characterIds.includes(characterId)))throw Error('В этих планах уже задан другой состав героев. Исправьте состав в подробном сценарии.');
    (p.characterBindings??={})[key]=characterId;
  }else if(p.characterBindings)delete p.characterBindings[key];
}
