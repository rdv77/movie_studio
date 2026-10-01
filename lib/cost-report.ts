import type {Project,Job} from './domain';

export const COST_DIMENSIONS=['stage','role','model','scene','plan','variant','quality'] as const;
export type CostDimension=typeof COST_DIMENSIONS[number];
export const COST_DIMENSION_NAMES:Record<CostDimension,string>={stage:'Этап',role:'Агент / задача',model:'Модель',scene:'Сцена',plan:'План',variant:'Вариант / попытка',quality:'Качество изображения'};
const STAGE_NAMES=['Общий сценарий','Герои','Визуальный стиль','Образы и локации','Подробный сценарий','Раскадровка','Голоса','Видеопланы','Финальная сборка'];
const ROLE_NAMES:Record<string,string>={critic:'Рецензент сценария',scenes:'Структура сцен',story:'Режиссёр сцены',camera:'Оператор',art:'Художник',dialogue:'Автор реплик',performance:'Актёрская работа','scene-expressive-reviewer':'Рецензент сцены',editor:'Редактор фильма',compress:'Редактор промпта','actor-profile':'Агент героя','script-adaptation':'Творческая адаптация','script-critic':'Критик сценария','script-dramaturg':'Драматург','script-producer':'Продюсер','script-control':'Контроль сценария',image:'Изображение',video:'Видео',audio:'Озвучка',text:'Текст','voice-test':'Проба голоса','voice-design':'Дизайн голоса',soundscape:'Звуковая атмосфера','sound-ambience':'Атмосфера','sound-foley':'Шумы действий','sound-event':'Звуковой акцент',music:'Музыка','music-ideas':'Музыкальное решение','media-review':'Визуальный редактор',lipsync:'Синхронизация губ',directing:'Режиссёрская команда'};
const ACTIVE=new Set(['queued','dispatching','pending','saving']);
const ticks=(value:unknown):string|null=>typeof value==='string'&&/^\d+$/.test(value)?BigInt(value).toString():null;
export type CostIdentity={id:string;label:string};
export type JobCostRow={jobId:string;requestId?:string;created:string;status:Job['status'];actual:string|null;estimate:string|null;reserved:string;unknown:boolean;archived:boolean;actualSource?:string;estimatedCredits?:number}&Record<CostDimension,CostIdentity>;
export type CostSummary={attempts:number;actual:string;estimate:string;reserved:string;unknown:number;archived:number;pending:number;receipts:number;unknownEstimates:number};
export type CostGroup=CostSummary&CostIdentity;
export type ProjectCostReport={dimension:CostDimension;total:CostSummary;groups:CostGroup[];rows:JobCostRow[];currency:'USD';tickScale:'10000000000'};

/** Read original receipts, including removed material and archived journal rows. */
export function jobCostRows(p:Project):JobCostRow[]{
  return p.jobs.map(job=>{
    const soundLayer=p.soundscape?.layers.find(l=>l.id===job.soundInput?.layerId),soundOutput=soundLayer?.variants.find(v=>v.jobId===job.id),soundScope=soundLayer?.scope;
    const voiceDesign=p.voiceStudio?.designs.find(d=>d.jobIds.includes(job.id)||d.saveJobId===job.id);
    const item=p.items.find(i=>i.id===job.itemId)??(soundScope?.type==='plan'?p.items.find(i=>i.id===soundScope.itemId):undefined),task=p.directing?.runs.flatMap(r=>r.tasks).find(t=>t.jobId===job.id);
    const settings=job.versionInfo?.settings as {role?:unknown;sceneId?:unknown;shotId?:unknown}|undefined;
    const role=task?.role??(typeof settings?.role==='string'?settings.role:undefined)??(soundLayer?'sound-'+soundLayer.kind:job.lipsync?'lipsync':job.purpose??job.kind??'other');
    const sceneId=task?.sceneId??item?.sourceShot?.sceneId??(soundLayer?.scope.type==='scene'?soundLayer.scope.sceneId:undefined)??(typeof settings?.sceneId==='string'?settings.sceneId:undefined);
    const shotId=task?.shotId??item?.sourceShot?.shotId??(typeof settings?.shotId==='string'?settings.shotId:undefined);
    const scene=p.directing?.scenes.find(s=>s.id===sceneId),shot=scene?.shots.find(s=>s.id===shotId)??p.directing?.scenes.flatMap(s=>s.shots).find(s=>s.id===shotId);
    const output=[...p.items.flatMap(i=>i.variants),...p.removedVariants?.map(r=>r.variant)??[],...p.music?.variants??[],...p.music?.removedVariants??[],...p.animatic?.variants??[],...p.animatic?.removedVariants??[]].find(v=>v.jobId===job.id||v.id===job.id);
    let stageId=item?.stage,stageLabel=stageId==null?'Другие задачи':STAGE_NAMES[stageId]??`Этап ${stageId}`;
    if(role==='critic'||role.startsWith('script-')){stageId=0;stageLabel=STAGE_NAMES[0];}
    if(['music','music-ideas','voice-test','voice-design','soundscape'].includes(job.purpose??''))stageLabel=ROLE_NAMES[job.purpose!];
    const actual=ticks(job.actual),estimate=ticks(job.estimate),active=ACTIVE.has(job.status);
    const imageSettings=job.imageSettings as (typeof job.imageSettings&{mode?:string})|undefined;
    const imageQuality:CostIdentity=job.kind!=='image'?{id:'not-applicable',label:'Не применяется'}:!imageSettings?{id:'legacy',label:'Как раньше (параметры не сохранены)'}:
      {id:JSON.stringify([imageSettings.mode??'',imageSettings.quality,imageSettings.resolution]),label:[imageSettings.mode,imageSettings.quality==='medium'?'Финальный':imageSettings.quality==='low'?'Черновой':undefined,imageSettings.quality,imageSettings.resolution?.toUpperCase()].filter(Boolean).join(' · ')};
    const reserved=actual===null&&active&&estimate!==null?estimate:'0';
    // A reserve is an estimate, not a verified charge. Terminal/unknown requests
    // without receipts remain visible instead of being reported as free.
    const unknown=actual===null&&job.status!=='cancelled'&&!(active&&estimate!==null);
    const deletedOutput=p.removedVariants?.some(r=>r.variant.jobId===job.id)||p.animatic?.removedVariants?.some(v=>v.jobId===job.id)||p.music?.removedVariants?.some(v=>v.jobId===job.id);
    return {jobId:job.id,requestId:job.requestId,created:job.created,status:job.status,actual,estimate,reserved,unknown,
      archived:!!(job.journalArchivedAt||item?.removedAt||item?.planArchive||deletedOutput||soundLayer?.removedAt||soundOutput?.removedAt||voiceDesign?.removedAt||p.voiceStudio?.profiles.some(v=>v.sourceJobId===job.id&&v.removedAt)||p.voiceComparisons?.some(c=>c.removedAt&&c.samples.some(s=>s.jobId===job.id))),actualSource:job.actualSource,
      ...(typeof job.zenCreditsEstimate==='number'&&Number.isFinite(job.zenCreditsEstimate)?{estimatedCredits:job.zenCreditsEstimate}:{}),
      stage:{id:['music','music-ideas'].includes(job.purpose??'')?'music':['voice-test','voice-design','soundscape'].includes(job.purpose??'')?job.purpose!:stageId==null?'other':String(stageId),label:stageLabel},
      role:{id:role,label:ROLE_NAMES[role]??role},model:{id:job.model,label:job.model},
      scene:{id:sceneId??'film',label:scene?.title??(sceneId?`Сцена ${sceneId}`:'Весь фильм / без сцены')},
      plan:{id:shotId??(item?.sourceShot?item.id:'film'),label:shot?.title??item?.sourceShot?.title??(item?.sourceShot?item.title:'Весь фильм / без плана')},
      variant:{id:output?.id??soundOutput?.id??job.id,label:output?.title??soundLayer?.name??voiceDesign?.name??`Попытка ${job.id}`},
      quality:imageQuality,
    };
  });
}
const empty=():CostSummary=>({attempts:0,actual:'0',estimate:'0',reserved:'0',unknown:0,archived:0,pending:0,receipts:0,unknownEstimates:0});
function append(total:CostSummary,row:JobCostRow){
  total.attempts++;total.actual=(BigInt(total.actual)+BigInt(row.actual??'0')).toString();
  total.estimate=(BigInt(total.estimate)+BigInt(row.estimate??'0')).toString();total.reserved=(BigInt(total.reserved)+BigInt(row.reserved)).toString();
  if(row.unknown)total.unknown++;if(row.archived)total.archived++;if(ACTIVE.has(row.status))total.pending++;
  if(row.actual!==null)total.receipts++;if(row.estimate===null)total.unknownEstimates++;
}
export function costReport(p:Project,dimension:CostDimension='stage'):ProjectCostReport{
  if(!COST_DIMENSIONS.includes(dimension))throw Error('Выберите группировку отчёта.');
  const rows=jobCostRows(p),total=empty(),groups=new Map<string,CostGroup>();
  for(const row of rows){append(total,row);const identity=row[dimension];let group=groups.get(identity.id);if(!group){group={...empty(),...identity};groups.set(identity.id,group);}append(group,row);}
  return {dimension,total,groups:[...groups.values()].sort((a,b)=>BigInt(a.actual)!==BigInt(b.actual)?BigInt(a.actual)>BigInt(b.actual)?-1:1:a.label.localeCompare(b.label,'ru')),rows,currency:'USD',tickScale:'10000000000'};
}
export function formatCost(value:string|null|undefined):string{
  const parsed=ticks(value);if(parsed===null)return 'Неизвестно';const amount=BigInt(parsed);
  if(amount>0n&&amount<1000000n)return '<$0.0001';
  const rounded=(amount+500000n)/1000000n,dollars=rounded/10000n,fraction=(rounded%10000n).toString().padStart(4,'0').replace(/0+$/,'').padEnd(2,'0');
  return '$'+new Intl.NumberFormat('en-US').format(dollars)+'.'+fraction;
}
export function formatActualCost(total:CostSummary):string{
  if(total.receipts===0&&total.attempts>0&&(total.unknown>0||total.pending>0))return 'Неизвестно';
  return formatCost(total.actual)+(total.unknown>0?' + невыясненные списания':'');
}
const dollars=(value:string)=>{const n=BigInt(value);return (n/10000000000n).toString()+'.'+(n%10000000000n).toString().padStart(10,'0');};
const csv=(value:string|number)=>'"'+String(value).replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
export function costReportCsv(p:Project,dimension:CostDimension='stage'):string{
  const report=costReport(p,dimension),header=[COST_DIMENSION_NAMES[dimension],'Попыток','Факт USD','Оценка USD','В резерве USD','Без сверки','В архиве'];
  const row=(label:string,total:CostSummary)=>[label,total.attempts,total.receipts===0&&total.attempts>0&&(total.unknown>0||total.pending>0)?'Неизвестно':dollars(total.actual),dollars(total.estimate),dollars(total.reserved),total.unknown,total.archived].map(csv).join(',');
  return [header.map(csv).join(','),...report.groups.map(g=>row(g.label,g)),row('Итого',report.total)].join('\r\n');
}
