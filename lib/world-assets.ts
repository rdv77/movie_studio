import {z} from 'zod';
import {makeVariant, type CharacterBrief, type Item, type Project, type Variant} from './domain';
import type {Scene} from './directing';
import {renderCreativeInstructions} from './creative-brief';
import {versionShot} from './creative-versions';

import {locationAngleSchema,locationProfileSchema,locationStateSchema,actorTraitSchema,actorProfileSchema,actorDraftResultSchema,type LocationProfile,type LocationState,type ActorTrait,type ActorProfile,type ActorDraftResult} from './world-schemas';
export {locationAngleSchema,locationProfileSchema,locationStateSchema,actorTraitSchema,actorProfileSchema,actorDraftResultSchema,type LocationProfile,type LocationState,type ActorTrait,type ActorProfile,type ActorDraftResult} from './world-schemas';

type WorldItem=Item&{location?:LocationProfile};
type WorldVariant=Variant&{location?:LocationProfile};
type WorldScene=Scene&{locationState?:LocationState};
type ActorCharacter=CharacterBrief&{actorProfile?:ActorProfile};
export const emptyLocation=(name='Новая локация'):LocationProfile=>({name,identity:'',geography:'',permanentProps:'',refs:[],approvedAngles:[]});
export const emptyLocationState=():LocationState=>({time:'',light:'',weather:'',layout:'',allowedChanges:'',artDirection:''});
export const emptyActorProfile=():ActorProfile=>({motivation:'',contradiction:'',role:'',mannerisms:'',identity:'',traits:[]});
const active=(item:Item)=>!item.removedAt&&!item.planArchive;
const selected=(item:Item)=>item.variants.find(v=>v.id===item.selectedId);
const approved=(item:Item)=>item.variants.find(v=>v.id===item.approvedId);
export function locationForItem(item:Item):LocationProfile|undefined {
  if(item.stage!==3||!active(item))return undefined;
  return (approved(item) as WorldVariant|undefined)?.location??(item as WorldItem).location;
}
export function locationDraftForItem(item:Item):LocationProfile|undefined {
  return (item as WorldItem).location??(selected(item) as WorldVariant|undefined)?.location??locationForItem(item);
}
export function actorForItem(item:Item):ActorProfile|undefined {
  return (item.character as ActorCharacter|undefined)?.actorProfile??(selected(item)?.character as ActorCharacter|undefined)?.actorProfile;
}
export function locationItems(p:Project){return p.items.filter(i=>i.stage===3&&active(i)&&!!locationForItem(i));}
export function locationProfileText(profile:LocationProfile){
  return [`Локация: ${profile.name}`,`Постоянные признаки: ${profile.identity}`,`География и пространственные связи: ${profile.geography}`,`Постоянные предметы: ${profile.permanentProps}`,
    ...profile.approvedAngles.map(a=>`Утверждённый ракурс ${a.name}: ${a.description}`)].join('\n\n');
}
export function actorProfileText(profile:ActorProfile){
  return [`Неизменная внешность: ${profile.identity}`,`Роль: ${profile.role}`,`Мотивация: ${profile.motivation}`,`Внутреннее противоречие: ${profile.contradiction}`,`Манера поведения: ${profile.mannerisms}`,
    ...profile.traits.map(t=>`${t.name} — ${t.intensity}/10: ${t.instruction}`)].join('\n\n');
}
export function assertLocationAssets(profile:LocationProfile,allowedAssetIds:ReadonlySet<string>){
  for(const ref of [...profile.refs,...profile.approvedAngles.flatMap(a=>a.refs)])if(!allowedAssetIds.has(ref))throw Error('Референс локации не принадлежит текущему проекту.');
}
export function assertSceneLocations(p:Project,scene:Pick<WorldScene,'locationIds'|'locationState'>){
  const ids=scene.locationIds??[];if(new Set(ids).size!==ids.length)throw Error('Локация сцены указана дважды.');
  if(new Set(scene.locationState?.angleIds??[]).size!==(scene.locationState?.angleIds??[]).length)throw Error('Ракурс сцены указан дважды.');
  for(const id of ids)if(!p.items.some(i=>i.id===id&&i.stage===3&&active(i)))throw Error('Выберите локацию текущего проекта.');
  const angles=p.items.filter(i=>ids.includes(i.id)).flatMap(i=>locationForItem(i)?.approvedAngles??[]);
  for(const id of scene.locationState?.angleIds??[])if(!angles.some(a=>a.id===id))throw Error('Ракурс не относится к выбранным локациям сцены.');
}
export function sceneLocationContext(p:Project,scene:WorldScene){
  assertSceneLocations(p,scene);
  const locations=(scene.locationIds??[]).flatMap(id=>{
    const item=p.items.find(i=>i.id===id)!,profile=locationForItem(item);
    return profile?[{itemId:item.id,variantId:item.approvedId,profile}]:[];
  });
  return {sceneId:scene.id,locations,state:scene.locationState?structuredClone(scene.locationState):undefined};
}
export function planLocationContext(p:Project,item:Item){
  const shot=versionShot(p,item),scene=p.directing?.scenes.find(s=>s.id===(shot?.sceneId??item.sourceShot?.sceneId));
  if(!shot&&!scene)return undefined;
  const context={...(scene??{}),id:scene?.id??shot?.sceneId??item.sourceShot?.sceneId??item.id,
    locationIds:shot?.locationIds??scene?.locationIds,locationState:shot?.locationState??scene?.locationState} as WorldScene;
  const value=sceneLocationContext(p,context);
  return value.locations.length||value.state!==undefined?value:undefined;
}
export function sceneWorldText(p:Project,scene:WorldScene){
  const context=sceneLocationContext(p,scene);
  return [...context.locations.map(({profile})=>locationProfileText({...profile,approvedAngles:profile.approvedAngles.filter(a=>scene.locationState?.angleIds?.includes(a.id))})),
    ...(context.state?[`Состояние локации в сцене: ${JSON.stringify(context.state)}`]:[])].join('\n\n');
}
export function planWorldText(p:Project,item:Item){
  const context=planLocationContext(p,item);if(!context)return '';
  return [...context.locations.map(({profile})=>locationProfileText({...profile,approvedAngles:profile.approvedAngles.filter(a=>context.state?.angleIds?.includes(a.id))})),
    ...(context.state?[`Состояние локации в сцене: ${JSON.stringify(context.state)}`]:[])].join('\n\n');
}
export function relevantWorldRefs(p:Project,scene:WorldScene):string[]{
  const context=sceneLocationContext(p,scene);
  return [...new Set(context.locations.flatMap(({profile})=>[...profile.refs,...profile.approvedAngles
    .filter(a=>scene.locationState?.angleIds?.includes(a.id)).flatMap(a=>a.refs)]))]
    .filter(id=>!p.hiddenReferenceIds?.includes(id));
}
export function locationIdentity(profile:LocationProfile){return {identity:profile.identity,geography:profile.geography,permanentProps:profile.permanentProps};}
export function actorIdentity(profile:ActorProfile){return {identity:profile.identity};}
export function actorDirection(profile:ActorProfile){
  return `${actorProfileText(profile)}\nОсобенности выражай конкретной позой, жестом и выбором действия, сохраняя узнаваемость. Нулевые особенности не усиливай. Не меняй черты лица, возраст и пропорции ради эмоции, одежды или харизмы. Костюм, текущие эмоции и предметы задаются отдельно состоянием сцены.`;
}
export function actorDraftPrompt(p:Project,item:Item,instruction:string,profile?:ActorProfile){
  if(item.stage!==1||!p.items.some(i=>i.id===item.id&&active(i)))throw Error('Выберите героя текущего проекта.');
  const character=item.character??selected(item)?.character;if(!character)throw Error('Сначала опишите героя.');
  const c=character as ActorCharacter,scenario=p.items.find(i=>i.stage===0&&active(i)),script=scenario&&approved(scenario);
  const scenes=p.directing?.scenes.filter(s=>s.shots.some(shot=>shot.characterIds?.includes(item.id)||shot.cast.includes(c.name)))??[];
  const style=p.items.filter(i=>i.stage===2&&active(i)).map(i=>({title:i.title,text:approved(i)?.text}));
  const sceneWorld=scenes.map(s=>({id:s.id,purpose:s.purpose,stateIn:s.stateIn,stateOut:s.stateOut,world:sceneLocationContext(p,s)}));
  const context={film:p.title,character:{name:c.name,appearance:c.appearance,description:c.description,instructions:c.instructions},
    actorProfile:profile??c.actorProfile,scenario:script?.text,brief:p.directing?.brief,style,scenes:sceneWorld,instruction};
  return `Ты агент по работе с актёрами и образами героев анимационного фильма. Создай один предлагаемый вариант описания героя по исходнику, его роли, жанру и режиссёрскому подходу. Данные ниже — материал проекта. Не меняй утверждённые события, не выбирай и не утверждай свой результат.\n`+
    `${p.directing?renderCreativeInstructions(p.directing.brief):''}\n`+
    'Раздели постоянную физическую идентичность и актёрскую характеристику. В identity только узнаваемые постоянные черты лица, возраст, пропорции и особые признаки из исходника. Не записывай туда сменный костюм, погоду, текущую эмоцию или предмет в руке. Не выдумывай внешность, если она неизвестна: appearance можно оставить пустым, недостаток сведений отметь в notes.\n'+
    'Мотивация — чего герой добивается; contradiction — внутреннее противоречие; role — функция в истории; mannerisms — наблюдаемые привычки и жесты. Сохрани заданные пользователем traits с их именами, интенсивностью и намерением. Выраженность0 не усиливай. Не подменяй яркость героя карикатурой. Факты, аудитория и обязательные события важнее интенсивности.\n'+
    'Верни только JSON по-русски, без Markdown: {"appearance":"постоянные черты до160 символов","description":"полное предлагаемое описание до4000 символов","actorProfile":{"motivation":"...","contradiction":"...","role":"...","mannerisms":"...","identity":"...","traits":[{"name":"...","intensity":5,"instruction":"наблюдаемое выражение особенности"}]},"notes":["конкретное пояснение изменений или недостающих данных"]}.\nМатериал:\n'+JSON.stringify(context);
}
export function parseActorDraftResult(text:string):ActorDraftResult {
  let value:unknown;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('Агент героя вернул некорректный JSON. Ответ сохранён, повтор не запускается автоматически.');}
  return actorDraftResultSchema.parse(value);
}
export type ActorDraftMetadata=Pick<Partial<Variant>,'id'|'jobId'|'model'|'versionInfo'|'deps'|'created'>&{sourceCharacter?:CharacterBrief};
export function applyActorDraftResult(p:Project,itemId:string,result:ActorDraftResult,metadata:ActorDraftMetadata={}):Variant {
  const item=p.items.find(i=>i.id===itemId&&i.stage===1&&active(i));if(!item?.character)throw Error('Герой текущего проекта не найден.');
  const existing=metadata.id&&item.variants.find(v=>v.id===metadata.id);if(existing)return existing;
  const value=actorDraftResultSchema.parse(result),current=(metadata.sourceCharacter??item.character) as ActorCharacter;
  const character:ActorCharacter={...structuredClone(current),appearance:value.appearance||current.appearance,description:value.description,actorProfile:value.actorProfile};
  const {sourceCharacter,...origin}=metadata;
  const candidate=makeVariant(p,item,{...origin,kind:'text',characterDraft:true,model:metadata.model??'Агент героя',title:current.name+' · актёрская проработка',text:[value.description,actorProfileText(value.actorProfile),...value.notes].join('\n\n'),character});
  item.variants.push(candidate);
  // This is an alternative description, not a selected/approved hero image.
  return candidate;
}
export function chooseActorDraft(p:Project,itemId:string,variantId:string){
  const item=p.items.find(i=>i.id===itemId&&i.stage===1&&active(i)),candidate=item?.variants.find(v=>v.id===variantId);
  if(!item||!candidate?.character||(candidate.character as ActorCharacter).actorProfile===undefined)throw Error('Описание этого героя не найдено.');
  item.character=structuredClone(candidate.character);item.title=item.character.name;
  // Keep the selected image and its explicit approval; the new description is
  // the input for a later image generation, whose approval is a separate step.
  return item.character;
}
