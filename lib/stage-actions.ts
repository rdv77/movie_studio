import {z} from 'zod';
import {approve,chosen,isApproved,participates,silentFilm,type Project} from './domain';
import {stageComplete,stageTitle} from './workflow';
import {markStageEditing,markStageApproved,pendingStageBefore} from './stage-review-state';
import {approveAnimatic} from './animatic';
import {approvePlanSets} from './shot-planning';
import {directorRunActive,scenesBasis,sceneSchema} from './directing';
import {prepareSceneLocations} from './scene-locations';
import {musicSettings} from './music';

export const stageActionSchema=z.object({stage:z.number().int().min(0).max(14),operation:z.enum(['rework','approve','skip'])}).strict();
export function stageHasResult(p:Project,stage:number){
  if(stage===9)return !!p.animatic?.variants.length;
  if(stage===10)return !!p.captions?.length;
  if(stage===11)return !!p.music?.variants.length||!!p.soundscape?.layers.length;
  if(stage===12)return !!p.directing?.scenes.length;
  if(stage===14)return !!p.directing?.scenes.some(s=>s.shots.length);
  if(stage===13)return !!p.directing?.runs.some(r=>r.mode==='script-workflow');
  return p.items.some(i=>i.stage===stage&&participates(p,i)&&i.variants.length);
}
export function stageSkipAllowed(p:Project,stage:number){return [10,11,13].includes(stage)||stage===6&&silentFilm(p);}
export function stageWorking(p:Project,stage:number){
  if(stage===0)return !!p.generalScenario?.runs.some(r=>['preparing','generating','reviewing'].includes(r.status))||!!p.generalScenario?.preparations.some(r=>['queued','running'].includes(r.status));
  if([4,12,13,14].includes(stage)&&p.directing?.runs.some(directorRunActive))return true;
  return p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)&&
    (stage===11?['music','music-ideas','soundscape'].includes(j.purpose??''):p.items.some(i=>i.id===j.itemId&&i.stage===stage)));
}
/** Stage approval is separate from artifact seals: opening revision must never
 * change dependency hashes, lose paid files, or approve stale material. */
export function applyStageAction(p:Project,raw:unknown){
  const {stage,operation}=stageActionSchema.parse(raw);
  if(stageWorking(p,stage))throw Error('Дождитесь завершения генерации или остановите её в журнале.');
  if(operation==='rework'){markStageEditing(p,stage);return;}
  const previous=pendingStageBefore(p,stage);
  if(previous!==undefined)throw Error(`Сначала завершите доработку и утвердите этап «${stageTitle(previous)}».`);
  const next=structuredClone(p);
  if(operation==='skip'){
    if(!stageSkipAllowed(next,stage))throw Error('Этот этап содержит обязательные материалы и не может быть пропущен.');
    if(stage===10)for(const caption of next.captions??[])caption.enabled=false;
    if(stage===11){next.music??={variants:[],settings:musicSettings(next)};next.music.settings.enabled=false;if(next.soundscape)next.soundscape.enabled=false;}
    next.stageReviews??={};next.stageReviews[stage]={status:'skipped',updated:new Date().toISOString()};
    Object.assign(p,next);return;
  }
  markStageApproved(next,stage);
  if(stage===12){
    if(!next.directing?.scenes.length)throw Error('Сначала создайте структуру сцен.');
    next.directing.scenes.forEach(s=>sceneSchema.parse(s));prepareSceneLocations(next);next.directing.scenesApproved=scenesBasis(next);
  }else if(stage===14){approvePlanSets(next,next.directing?.scenes.map(s=>s.id)??[]);
  }else if(stage===9){approveAnimatic(next,next.animatic?.selectedId??'');
  }else if(stage<=8){
    const items=next.items.filter(i=>i.stage===stage&&participates(next,i));
    if(!items.length&&!(stage===6&&silentFilm(next)))throw Error('Сначала подготовьте материалы этапа.');
    for(const item of items){
      const v=chosen(item);
      if(!v||(stage===5&&(v.kind!=='image'||!v.assetId))||(stage===6&&(v.kind!=='audio'||!v.assetId))||([7,8].includes(stage)&&(v.kind!=='video'||!v.assetId)))throw Error(`«${item.title}»: нет готового выбранного материала.`);
      if(!isApproved(next,item)||item.approvedId!==v.id)approve(next,item.id);
    }
  }
  if(!stageComplete(next,stage))throw Error('Этап ещё не готов: проверьте выбранные материалы, утверждения и сообщения о конфликтах ниже.');
  Object.assign(p,next);
}
