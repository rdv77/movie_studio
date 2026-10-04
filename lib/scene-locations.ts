import {prepareImageRetries,type ImageRetryOptions} from './image-retries';
import {id,makeVariant,type Project,type Item,type Job,dependencies,now} from './domain';
import {emptyLocation,locationDraftForItem,locationItems,locationProfileText} from './world-assets';
import {model} from './models';
import {availableForDirecting} from './model-capabilities';
import {compileMediaJob} from './prompt-jobs';
import {conceptImageAdmissionIssue} from './generation-queue';
import {FINAL_IMAGE_SETTINGS,GROK_IMAGE_MODEL} from './image-quality';

const key=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function sceneLocationName(description:string){return description.trim().split(/[.!?\n]/u)[0].trim().slice(0,100);}
/** Extract the explicit place from the scene, without inventing geography or issuing a paid request.
 * Only identical place names are grouped; explicit user bindings and edited profiles are preserved. */
export function prepareSceneLocations(p:Project){
  let changed=false;
  for(const scene of p.directing?.scenes??[]){
    if(scene.locationIds!==undefined)continue;
    const name=sceneLocationName(scene.location);
    if(!name||/^(уточните|не указана|неизвестно)/iu.test(name))continue;
    const matches=locationItems(p).filter(item=>key(locationDraftForItem(item)!.name)===key(name));
    if(matches.length>1)continue; // Ambiguous existing places need the director's choice.
    let item=matches[0];
    if(!item){
      const profile={...emptyLocation(name),identity:name,geography:scene.location.trim().slice(0,2000)};
      item={id:id(),stage:3,title:name,location:profile,variants:[]};p.items.push(item);
      const draft=makeVariant(p,item,{kind:'text',title:name,text:locationProfileText(profile),model:'Локация из структуры сцен',location:structuredClone(profile)});
      item.variants.push(draft);item.selectedId=draft.id;
    }
    scene.locationIds=[item.id];changed=true;
  }
  return changed;
}
export function sceneLocationsNeedPreparation(p:Project){return (p.directing?.scenes??[]).some(s=>s.locationIds===undefined&&!!sceneLocationName(s.location)&&!/^(уточните|не указана|неизвестно)/iu.test(s.location));}
export function locationImageItems(p:Project){
  const used=new Set(p.directing?.scenes.flatMap(s=>s.locationIds??[])??[]);
  return locationItems(p).filter(i=>used.has(i.id));
}
export function hasLocationImage(item:Item){return item.variants.some(v=>v.kind==='image'&&!!v.assetId);}
export function locationImagePrompt(p:Project,item:Item){
  const profile=locationDraftForItem(item);if(!profile)throw Error('Сначала сохраните описание локации.');
  const scenes=p.directing?.scenes.filter(s=>s.locationIds?.includes(item.id))??[];
  return ['Создай один цельный визуальный образ постоянной локации фильма. Без персонажей, надписей, титров и коллажа. Сохрани географию и постоянные признаки места.',
    locationProfileText(profile),`Используется в сценах: ${scenes.map(s=>s.title).join('; ')}. Описание выше — сохранённая редакция локации; не заменяй его прежними описаниями места из сценария.`,
    ...(scenes.length===1&&scenes[0].locationState?[`Состояние места для этой сцены: ${JSON.stringify(scenes[0].locationState)}`]:[])].join('\n\n');
}
export function createLocationImageJobs(p:Project,input:{batchId:string;model:string;itemIds:string[];count:number;estimate:string|null;imageRetry?:ImageRetryOptions}){
  const m=model(input.model);if(m.kind!=='image'||p.directing&&!availableForDirecting(m.id))throw Error('Выберите доступную модель изображений.');
  if(!Number.isInteger(input.count)||input.count<1||input.count>4)throw Error('Выберите от одного до четырёх вариантов.');
  const available=locationImageItems(p),ids=new Set(input.itemIds);
  if(!ids.size||ids.size!==input.itemIds.length)throw Error('Выберите локации без повторов.');
  return input.itemIds.flatMap(itemId=>{
    const item=available.find(i=>i.id===itemId);if(!item)throw Error('Локация не привязана к сцене текущего фильма.');
    const issue=conceptImageAdmissionIssue(p,item.id);if(issue)throw Error(item.title+': '+issue);
    const profile=structuredClone(locationDraftForItem(item)!);
    return Array.from({length:input.count},(_,n)=>{
      const job:Job={id:id(),batchId:input.batchId,itemId,model:m.id,kind:'image',brief:locationImagePrompt(p,item),prompt:'',location:profile,
        refs:profile.refs.filter(ref=>!p.hiddenReferenceIds?.includes(ref)),duration:5,camera:'Статичная камера',continuity:'',offset:0,volume:1,dialogue:'',voiceId:'',
        ...(m.id===GROK_IMAGE_MODEL?{imageSettings:FINAL_IMAGE_SETTINGS}:{}),deps:dependencies(p,3),created:now(),status:'queued',transportVersion:2,estimate:input.estimate,actual:null};
      const task={variantIndex:n+1,variantCount:input.count};return prepareImageRetries(p,compileMediaJob(p,job,task),input.imageRetry,task);
    });
  });
}
