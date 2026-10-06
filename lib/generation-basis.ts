import {chosen,dependencies,getItem,precedesStage,stageReady,type Item,type Project} from './domain';
import {versionSignature} from './creative-versions';

function material(item:Item,current=false){
  return {id:item.id,title:item.title,stage:item.stage,removedAt:item.removedAt,planArchive:item.planArchive,
    approvedId:item.approvedId,approved:item.variants.find(v=>v.id===item.approvedId),
    character:item.character,location:item.location,sourceShot:item.sourceShot,
    keyframeMode:item.keyframeMode,keyframeSelection:item.keyframeSelection,approvedKeyframes:item.approvedKeyframes,
    keyframes:item.variants.filter(v=>v.keyframe&&[...Object.values(item.keyframeSelection??{}),...Object.values(item.approvedKeyframes??{})].includes(v.id)),
    ...(current?{selected:chosen(item),videoPreparation:item.videoPreparation}:{}),
  };
}
/** Admission token excludes job progress, bills, archives and unselected takes.
 * It is an optimistic concurrency check, never authorization or a price quote. */
export function generationBasis(p:Project,itemId:string):string{
  const item=getItem(p,itemId),sceneId=item.sourceShot?.sceneId;
  const prior=p.items.filter(i=>precedesStage(i.stage,item.stage)&&!i.removedAt&&!i.planArchive&&
    (!(item.stage===7&&[5,6].includes(i.stage))||
      (item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:i.sourceShot?.title===item.sourceShot?.title)));
  return 'generation-v1:'+versionSignature({format:p.format,seconds:p.seconds,config:p.configVersion,productionOrder:p.productionOrder,
    ready:stageReady(p,item.stage),dependencies:dependencies(p,item.stage),item:material(item,true),prior:prior.map(i=>material(i)),
    hiddenReferences:p.hiddenReferenceIds,bindings:p.characterBindings,
    directing:p.directing?{brief:p.directing.brief,durationMode:p.directing.durationMode,scenesApproved:p.directing.scenesApproved,
      scenes:sceneId?p.directing.scenes.filter(s=>s.id===sceneId):p.directing.scenes}:undefined});
}
export function assertGenerationBasis(p:Project,itemId:string,revision:number,basis?:string){
  if(basis?basis!==generationBasis(p,itemId):revision!==p.revision)
    throw Error('Основа плана или выбранные референсы изменились. Заново откройте серию и проверьте задание. Обновление очереди других планов не мешает запуску.');
}
