import {z} from 'zod';
import type {Project,Job} from './domain';
import type {DirectorRole,DirectorRun,DirectorTask} from './directing';
import {model} from './models';
import {id} from './domain';
import {compactPromptText} from './prompt-text';
import {shotBindsCharacter} from './character-bindings';
export const directorExecutionSchema=z.object({parallelModels:z.array(z.string()).max(3).optional(),fallbackModel:z.string().optional()});
export type DirectorExecution=z.infer<typeof directorExecutionSchema>;
export function validateDirectorExecution(input:unknown):DirectorExecution{const value=directorExecutionSchema.parse(input);for(const key of [...(value.parallelModels??[]),...(value.fallbackModel?[value.fallbackModel]:[])]){const m=model(key);if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Для команды и резерва выберите текстовую модель GPT, Grok или MiniMax.');}return value;}
export function taskModel(run:DirectorRun,t:DirectorTask){if(t.fallbackFromJobId)return run.execution?.fallbackModel??run.model;const pool=run.execution?.parallelModels?.length?run.execution.parallelModels:[run.model];return pool[run.tasks.filter(v=>v.sceneId&&['story','camera','art','dialogue','performance','shot-planner'].includes(v.role)).findIndex(v=>v.id===t.id)%pool.length]??run.model;}
export function fallbackEligible(job:Job,validation=false){if(job.status!=='failed')return false;const error=job.error??'';if(/safety|public figure|sexual|content.?policy|moderation|запрещ|политик|баланс|HTTP (?:400|401|402|403|404|422)/i.test(error))return false;return validation||/HTTP 429/.test(error);}
/** One reserve attempt, separate receipt/cost. Unknown paid outcomes never qualify. */
export function scheduleDirectorFallback(p:Project,run:DirectorRun,t:DirectorTask,job:Job,validation=false){if(!run.execution?.fallbackModel||run.stopped||t.fallbackFromJobId||!fallbackEligible(job,validation))return false;t.previousJobIds=[...(t.previousJobIds??[]),job.id];t.fallbackFromJobId=job.id;t.jobId=undefined;t.error=undefined;t.result=undefined;t.applied=undefined;return true;}
/** Repeating a legacy whole-scene task also uses the new small groups. The old
 * paid receipt stays in jobs; downstream checks wait for every replacement. */
export function prepareDirectorRetry(p:Project,run:DirectorRun,t:DirectorTask){const scene=p.directing?.scenes.find(s=>s.id===t.sceneId),ids=scene?.shots.filter(s=>t.shotIds?t.shotIds.includes(s.id):t.shotId?s.id===t.shotId:true).map(s=>s.id)??[];const prior=t.jobId;
  if(ids.length>3&&['story','camera','art','dialogue','performance','compress'].includes(t.role)){
    const replacements=Array.from({length:Math.ceil(ids.length/3)},(_,n)=>{const group=ids.slice(n*3,n*3+3);return {id:id(),role:t.role,sceneId:t.sceneId,requires:[...t.requires],...(group.length===1?{shotId:group[0]}:{shotIds:group}),...(n===0&&prior?{previousJobIds:[...(t.previousJobIds??[]),prior]}:{})} as DirectorTask;});
    run.tasks.splice(run.tasks.indexOf(t),1,...replacements);for(const target of run.tasks)target.requires=target.requires.flatMap(key=>key===t.id?replacements.map(v=>v.id):[key]);
  }else{t.jobId=undefined;t.error=undefined;t.result=undefined;t.applied=undefined;}
  run.stopped=false;
}
const optionalDirectionKeys=new Set(['stagingMode','requiresEndFrame','framingStart','framingEnd','angle','description','composition','attention','cameraMovement','from','to','purpose','speed','keepInFrame','actionBeats','timing','openingHold','endingHold','revealAt','positions','screenDirection','subjectId','performance','characterId','transition','toShotId','sound','ambience','effects','music','silence','startFrame','endFrame','id','emotionalChange']);
function cleanDirection(value:any):any{
  if(Array.isArray(value))return value.map(cleanDirection);if(!value||typeof value!=='object')return value;
  const copy:any={};
  for(const [key,v] of Object.entries(value))if(v!==null||!optionalDirectionKeys.has(key)){
    copy[key]=cleanDirection(v);
    // Camera timing is optional. Action-beat start/end and actor positions are
    // required, so null there must remain a validation error, not be hidden.
    if(key==='cameraMovement'&&copy[key]&&typeof copy[key]==='object')
      for(const time of ['start','end'])if(copy[key][time]===null)delete copy[key][time];
  }
  if(typeof copy.screenDirection==='string'&&!['left-to-right','right-to-left','toward-camera','away-from-camera','static','custom'].includes(copy.screenDirection)){
    const raw=copy.screenDirection,normal=raw.toLowerCase().replace(/[.]/g,'').trim();const aliases:Record<string,string>={'слева направо':'left-to-right','справа налево':'right-to-left','к камере':'toward-camera','от камеры':'away-from-camera','неподвижно':'static','статично':'static'};
    copy.screenDirection=aliases[normal]??'custom';copy.end=(copy.end??'')+'; направление: '+raw;
  }
  return copy;
}
/** Only unambiguous syntax cleanup. Unknown IDs, duplicates, missing rows and timing conflicts stay errors. */
export function normalizeDirectorAnswer(p:Project,role:DirectorRole,sceneId:string|undefined,answer:unknown):unknown{const copy=structuredClone(answer) as any;if(!copy||!Array.isArray(copy.shots))return copy;if(role==='camera'||role==='story')for(const shot of copy.shots)if(shot.direction)shot.direction=cleanDirection(shot.direction);
  // Some actor responses include neighbours marked as context. Drop only IDs
  // belonging to another known scene, never unknown/new or unrequested current shots.
  if(role==='performance'&&sceneId){const contextIds=new Set(p.directing?.scenes.filter(s=>s.id!==sceneId).flatMap(s=>s.shots.map(v=>v.id)));copy.shots=copy.shots.filter((s:any)=>!contextIds.has(s.id));}
  return copy;
}
export function compactSpecialistContext(p:Project,t:DirectorTask,base:any){if(!t.sceneId||!['story','camera','art','dialogue','performance','compress','shot-planner'].includes(t.role))return base;const scene=p.directing!.scenes.find(s=>s.id===t.sceneId)!;const ids=t.shotIds??(t.shotId?[t.shotId]:scene.shots.map(s=>s.id)),selected=scene.shots.filter(s=>ids.includes(s.id)),index=p.directing!.scenes.indexOf(scene);
  const summary=(s:any)=>s&&({id:s.id,title:s.title,purpose:s.purpose,location:s.location,stateIn:s.stateIn,stateOut:s.stateOut,turn:s.turn});
  const excerpt=(value:string|undefined,max=600)=>value===undefined?undefined:value.length<=max?value:value.slice(0,max)+'… [контекст сокращён]';
  const neighbourCamera=(d:any)=>!d?{}:{
    framingEnd:d.framingEnd,angle:d.angle?{type:d.angle.type,description:excerpt(d.angle.description)}:undefined,
    startFrame:excerpt(d.startFrame),endFrame:excerpt(d.endFrame),
    cameraMovement:d.cameraMovement?{...d.cameraMovement,description:excerpt(d.cameraMovement.description),from:excerpt(d.cameraMovement.from),to:excerpt(d.cameraMovement.to),purpose:excerpt(d.cameraMovement.purpose),speed:excerpt(d.cameraMovement.speed,200),keepInFrame:excerpt(d.cameraMovement.keepInFrame)}:undefined,
    positions:d.positions?.slice(0,8).map((v:any)=>({subject:v.subject,subjectId:v.subjectId,start:excerpt(v.start,300),end:excerpt(v.end,300),screenDirection:v.screenDirection})),
  };
  // A neighbour's already played realization is part of the acting continuity,
  // but must not become another action to perform in the requested shot.
  const neighbourPerformance=(d:any)=>!d?.performance?.length?{}:{performance:d.performance.slice(0,8).map((v:any)=>({
    character:v.character,characterId:v.characterId,objective:excerpt(v.objective,300),subtext:excerpt(v.subtext,400),
    emotionStart:excerpt(v.emotionStart,200),emotionEnd:excerpt(v.emotionEnd,200),visibleAction:excerpt(v.visibleAction,600),
  }))};
  const neighbour=(s:any)=>({id:s.id,title:s.title,duration:s.duration,story:s.story,stateIn:s.stateIn,stateOut:s.stateOut,continuityChanges:s.continuityChanges,dialogue:s.dialogue,framing:s.direction?.framingStart,transition:s.direction?.transition,...(['camera','compress'].includes(t.role)?neighbourCamera(s.direction):{}),...(['performance','compress'].includes(t.role)?neighbourPerformance(s.direction):{})});
  const edge=new Set<number>();for(const shot of selected){const n=scene.shots.indexOf(shot);for(const k of [n-1,n+1])if(k>=0&&k<scene.shots.length&&!ids.includes(scene.shots[k].id))edge.add(k);}
  const stripped=(s:any)=>{const {approved,approvedFoundation,approvalVersion,imagePrompt,videoPrompt,promptBasis,...content}=s;return content;};
  // Scene specialists own only these target rows; adjacent rows are lightweight
  // context. Hero locks and relevant world information remain intact.
  const result={...base,approved:base.approved.filter((v:any)=>v.stage===2||v.stage===1&&(t.role==='shot-planner'||selected.some(s=>s.cast.includes(v.character?.name??v.title)||s.characterIds?.includes(v.id)||shotBindsCharacter(p,s,v.id)))),outline:base.outline.map(summary),previous:summary(p.directing!.scenes[index-1]),next:summary(p.directing!.scenes[index+1]),scene:{...scene,shots:selected.map(stripped)},requestedShotIds:ids,contextOnlyNeighbours:[...edge].sort((a,b)=>a-b).map(n=>neighbour(scene.shots[n])),sceneBoundaryNeighbours:[p.directing!.scenes[index-1]?.shots.at(-1),p.directing!.scenes[index+1]?.shots[0]].filter(Boolean).map(neighbour)};
  if(t.role==='compress'){
    // The approved target shots contain the story. Sending the entire film again,
    // plus the same hero JSON in text and profile form, adds no visual information.
    delete result.currentScenario;
    result.outline=[result.previous,summary(scene),result.next].filter(Boolean);
    result.approved=result.approved.map((v:any)=>v.character?{id:v.id,stage:v.stage,title:v.title,character:{name:v.character.name,appearance:v.character.appearance,instructions:v.character.instructions,locked:v.character.locked,actorProfile:v.character.actorProfile?{identity:v.character.actorProfile.identity,mannerisms:v.character.actorProfile.mannerisms}:undefined}}:{...v,text:compactPromptText(v.text)});
    const names=new Set(selected.flatMap(s=>s.cast));
    result.scene={...result.scene,continuity:scene.continuity.filter(c=>names.has(c.character)||selected.some(s=>s.characterIds?.includes(c.characterId??'')))};
  }
  return result;
}
