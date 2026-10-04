import {participates,type Project} from './domain';
import {keyframeOptions} from './keyframes';
import {allowNewSeries,unresolvedJobBlocks} from './job-wait';
import {queueActive} from './queue-policy';

/** Only unresolved initial-image attempts of active plans without a first image. */
export function missingStoryboardStartRetries(p:Project){
  return p.items.filter(item=>item.stage===5&&participates(p,item)&&!keyframeOptions(item,'start').length)
    .filter(item=>!p.jobs.some(job=>job.itemId===item.id&&job.purpose!=='media-review'&&queueActive(job)))
    .map(item=>({itemId:item.id,title:item.title,jobIds:p.jobs.filter(job=>job.itemId===item.id&&job.kind==='image'&&!job.purpose&&(job.keyframe??'start')==='start'&&unresolvedJobBlocks(job)).map(job=>job.id)}))
    .filter(row=>row.jobIds.length);
}
/** Explicit permission only: no job is created, retried, settled or marked successful. */
export function allowMissingStoryboardStarts(p:Project,itemIds:string[]){
  if(!itemIds.length||new Set(itemIds).size!==itemIds.length)throw Error('Выберите неповторяющийся список пропущенных планов.');
  const retryRows=missingStoryboardStartRetries(p),jobs=itemIds.flatMap(itemId=>{
    const item=p.items.find(item=>item.id===itemId);
    if(!item||item.stage!==5||!participates(p,item)||keyframeOptions(item,'start').length)throw Error('Этот план уже имеет первый кадр или не участвует в текущей раскадровке. Обновите список.');
    if(p.jobs.some(job=>job.itemId===itemId&&job.purpose!=='media-review'&&queueActive(job)))throw Error('У плана есть действующая генерация. Дождитесь результата.');
    return retryRows.find(row=>row.itemId===itemId)?.jobIds??[];
  });
  // Validate the whole set before changing the first permission.
  for(const jobId of jobs)allowNewSeries(p.jobs.find(job=>job.id===jobId)!);
}
