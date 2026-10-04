import {isApproved,participates,variantCurrent,type Project,type Job} from './domain';
import {keyframeOptions,selectedKeyframe,planKeyframeMode,requiredKeyframeRoles,KEYFRAME_ROLE_NAMES,type KeyframeRole} from './keyframes';
import {storyboardSetIssues} from './storyboard-approval';

export type FrameProgressStatus='missing'|'queued'|'generating'|'saving'|'failed'|'unknown'|'choose'|'review'|'conflict'|'ready';
export type FrameProgress={role:KeyframeRole;label:string;status:FrameProgressStatus;imageCount:number;selectedId?:string;assetId?:string;message:string;jobMessage?:string};
export type StoryboardProgressRow={itemId:string;title:string;frames:FrameProgress[];approved:boolean;missingImages:boolean;selected:boolean;attention:boolean};
const active=(job:Job)=>['queued','dispatching','pending','saving'].includes(job.status);
const jobMessage=(job:Job)=>job.status==='queued'?'В очереди':job.status==='saving'?'Сохраняется файл':job.status==='unknown'?'Исход неизвестен. Проверьте эту попытку в журнале перед новым запуском.':job.status==='failed'?'Ошибка генерации. Откройте план и журнал.':job.status==='cancelled'?'Ожидание остановлено. Проверьте попытку в журнале.':'Создаётся изображение';

/** Read-only progress: a text draft or a successful request without a saved image is not a frame. */
export function storyboardProgress(p:Project):StoryboardProgressRow[]{
  const jobsByRole=new Map<string,Job[]>();
  for(const job of p.jobs){
    if(job.kind!=='image'||job.purpose)continue;
    const key=job.itemId+':'+(job.keyframe??'start'),jobs=jobsByRole.get(key)??[];
    jobs.push(job);jobsByRole.set(key,jobs);
  }
  return p.items.filter(item=>item.stage===5&&participates(p,item)).map(item=>{
    const issues=storyboardSetIssues(p,item);
    const frames=requiredKeyframeRoles(planKeyframeMode(p,item)).map((role):FrameProgress=>{
      const images=keyframeOptions(item,role),candidate=selectedKeyframe(item,role);
      // A fallback preview does not choose a variant on the director's behalf.
      const selected=candidate&&(candidate.keyframe??'start')===role&&(role!=='start'||item.selectedId===candidate.id)?candidate:undefined;
      const jobs=jobsByRole.get(item.id+':'+role)??[];
      const pending=jobs.filter(active).at(-1),latest=jobs.reduce<Job|undefined>((last,job)=>!last||job.created>=last.created?job:last,undefined);
      const base={role,label:KEYFRAME_ROLE_NAMES[role],imageCount:images.length,selectedId:selected?.id,assetId:(selected??images.at(-1))?.assetId};
      if(!images.length){
        const job=pending??latest;
        const status:FrameProgressStatus=!job?'missing':job.status==='queued'?'queued':job.status==='saving'?'saving':active(job)?'generating':job.status==='unknown'?'unknown':job.status==='failed'?'failed':'missing';
        return {...base,status,message:job&&job.status!=='done'?jobMessage(job):job?.status==='done'?'Запрос завершён, но сохранённого изображения нет.':'Нет изображения'};
      }
      const local=issues.filter(issue=>!issue.role||issue.role===role),structural=local.find(issue=>!['foundation_changed','missing_basis'].includes(issue.code));
      const status:FrameProgressStatus=!selected?'choose':structural?'conflict':local.length||!variantCurrent(p,item,selected)?'review':'ready';
      const message=!selected?'Есть изображение · выберите вариант':structural?.message??local[0]?.message??(status==='review'?'Основа изменилась · проверьте изображение':'Изображение выбрано');
      return {...base,status,message,...(pending?{jobMessage:'Ещё один вариант: '+jobMessage(pending)}:{})};
    });
    const missingImages=frames.some(frame=>!frame.imageCount),selected=frames.every(frame=>!!frame.selectedId);
    const approved=selected&&!missingImages&&frames.every(frame=>frame.status==='ready')&&isApproved(p,item)&&item.selectedId===item.approvedId;
    return {itemId:item.id,title:item.title,frames,approved,missingImages,selected,attention:!approved||frames.some(frame=>frame.status!=='ready'||!!frame.jobMessage)};
  });
}

export function storyboardProgressSummary(rows:StoryboardProgressRow[]){
  return {total:rows.length,startImages:rows.filter(row=>row.frames[0]?.imageCount>0).length,
    completeImages:rows.filter(row=>!row.missingImages).length,selected:rows.filter(row=>row.selected).length,
    approved:rows.filter(row=>row.approved).length,missing:rows.filter(row=>row.missingImages).length,
    attention:rows.filter(row=>row.attention).length};
}
