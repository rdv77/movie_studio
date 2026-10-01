import {z} from 'zod';
import type {Project} from './domain';
import {dialogueSchema,directingShotSchema,shotApproved,type Scene,type DirectingShot,type DirectorRun} from './directing';
import {validateScenePlan} from './shot-direction';
import type {BatchCandidate,BatchScope} from './batch-scope';
import {unresolvedJobBlocks} from './job-wait';

export const directorScopeSchema=z.object({
  scope:z.enum(['all','selected','remaining','attention']).optional(),
  sceneIds:z.array(z.string().min(1).max(100)).max(24).optional(),
  shotIds:z.array(z.string().min(1).max(100)).max(120).optional(),
});
export type DirectorScopeRequest=z.infer<typeof directorScopeSchema>;
export type ShotReadiness={sceneId:string;shotId:string;title:string;status:'approved'|'ready'|'incomplete'|'conflict';missing:string[];conflicts:string[];changed:boolean};
const REQUIRED=[['story','Сценарий'],['cinematography','Операторская работа'],['productionDesign','Художественное решение'],['stateIn','Состояние в начале'],['stateOut','Состояние в конце']] as const;

/** One preflight drives the button and the server. Existing current approvals
 * remain compatible; they are not silently revoked by newly required fields. */
export function directingShotReadiness(p:Project,scene:Scene,shot:DirectingShot,force=false):ShotReadiness{
  const approved=shotApproved(scene,shot,p);
  if(approved&&!force){const conflicts=[...validateScenePlan(scene).filter(i=>i.severity==='conflict'&&(!i.shotId||i.shotId===shot.id)).map(i=>i.message),...(p.directing?.issues??[]).filter(i=>i.severity==='conflict'&&!i.resolved&&(!i.shotId||i.shotId===shot.id)&&(!i.sceneId||i.sceneId===scene.id)).map(i=>'Конфликт редактора: '+i.message)];return {sceneId:scene.id,shotId:shot.id,title:shot.title,status:conflicts.length?'conflict':'approved',missing:[],conflicts,changed:false};}
  const missing:string[]=REQUIRED.filter(([key])=>!shot[key]?.trim()).map(([,label])=>label),conflicts:string[]=[];
  if(shot.dialogue.speechType!=='none'&&!shot.dialogue.text.trim())missing.push('Произносимая реплика');
  const parsed=directingShotSchema.safeParse(shot);if(!parsed.success)conflicts.push(...parsed.error.issues.map(i=>i.message));
  const dialogue=dialogueSchema.safeParse(shot.dialogue);if(!dialogue.success)conflicts.push(...dialogue.error.issues.map(i=>i.message));
  if(shot.dialogue.speechType==='character'&&(!shot.dialogue.speaker.trim()||!shot.cast.includes(shot.dialogue.speaker)))conflicts.push('Говорящий герой должен присутствовать в кадре.');
  conflicts.push(...validateScenePlan(scene).filter(i=>i.severity==='conflict'&&(!i.shotId||i.shotId===shot.id)).map(i=>i.message));
  conflicts.push(...(p.directing?.issues??[]).filter(i=>i.severity==='conflict'&&!i.resolved&&(!i.shotId||i.shotId===shot.id)&&(!i.sceneId||i.sceneId===scene.id)).map(i=>'Конфликт редактора: '+i.message));
  const duplicate=(p.directing?.scenes??[]).flatMap(s=>s.shots).filter(s=>s.id===shot.id).length>1;if(duplicate)conflicts.push('ID плана повторяется в фильме.');
  return {sceneId:scene.id,shotId:shot.id,title:shot.title,status:conflicts.length?'conflict':missing.length?'incomplete':approved?'approved':'ready',missing,conflicts:[...new Set(conflicts)],changed:!!shot.approved&&!approved};
}
export function directingReadiness(p:Project){
  const rows=(p.directing?.scenes??[]).flatMap(scene=>scene.shots.map(shot=>directingShotReadiness(p,scene,shot)));
  return {rows,readyIds:rows.filter(r=>r.status==='ready').map(r=>r.shotId),incomplete:rows.filter(r=>r.missing.length),conflicts:rows.filter(r=>r.conflicts.length),pending:rows.filter(r=>r.status!=='approved')};
}
export function assertDirectingShotReady(p:Project,scene:Scene,shot:DirectingShot){
  const row=directingShotReadiness(p,scene,shot,true);
  if(row.conflicts.length)throw Error(`«${shot.title}»: ${row.conflicts[0]}`);
  if(row.missing.length)throw Error(`«${shot.title}»: заполните ${row.missing.join(', ').toLowerCase()}.`);
}
export function directingShotCandidates(p:Project,sceneId?:string):BatchCandidate[]{
  return directingReadiness(p).rows.filter(r=>!sceneId||r.sceneId===sceneId).map(r=>({id:r.shotId,remaining:r.missing.length>0,needsAttention:r.missing.length>0||r.conflicts.length>0||r.changed,blocked:directorUnknownBlocker(p,r.sceneId,r.shotId)}));
}
function directorUnknownBlocker(p:Project,sceneId:string,shotId?:string){
  for(const run of p.directing?.runs??[])for(const task of run.tasks){const job=p.jobs.find(j=>j.id===task.jobId);if(job&&unresolvedJobBlocks(job)&&task.sceneId===sceneId&&(!shotId||!task.shotId&&!task.shotIds?.length||task.shotId===shotId||task.shotIds?.includes(shotId)))return 'Для этой сцены/плана есть запрос с неизвестным исходом. Проверьте журнал и разрешите новую серию.';}
  return '';
}
export function directingSceneCandidates(p:Project,stage:'structure'|'plans'='plans'):BatchCandidate[]{
  return (p.directing?.scenes??[]).map(scene=>{
    const rows=scene.shots.map(shot=>directingShotReadiness(p,scene,shot));
    const incomplete=stage==='structure'?[scene.purpose,scene.location,scene.stateIn,scene.stateOut].some(v=>!v.trim()):!rows.length||rows.some(r=>r.missing.length);
    const issues=(p.directing?.issues??[]).some(i=>!i.resolved&&(!i.sceneId||i.sceneId===scene.id));
    return {id:scene.id,remaining:incomplete,needsAttention:incomplete||issues||rows.some(r=>r.conflicts.length||r.changed),blocked:directorUnknownBlocker(p,scene.id)};
  });
}

/** Resolve against the current saved project, never trust a client-selected ID.
 * This only narrows work; newDirectorRun still enforces approvals and its DAG. */
export function resolveDirectingScope(p:Project,mode:DirectorRun['mode'],input?:DirectorScopeRequest){
  const all=p.directing?.scenes??[];
  if(!input)return {scenes:all,shotIds:undefined,explicit:false};
  const s=directorScopeSchema.parse(input),scope:BatchScope=s.scope??'selected';
  if(['critic','editor','compress','script-workflow','character'].includes(mode))throw Error('Для этого прохода используйте весь фильм без выбора сцен и планов.');
  if(s.sceneIds&&new Set(s.sceneIds).size!==s.sceneIds.length||s.shotIds&&new Set(s.shotIds).size!==s.shotIds.length)throw Error('Уберите повторяющиеся сцены или планы.');
  if(s.sceneIds?.some(id=>!all.some(scene=>scene.id===id)))throw Error('Выбранная сцена отсутствует в этом проекте.');
  const shots=all.flatMap(scene=>scene.shots.map(shot=>({scene,shot})));
  if(s.shotIds?.some(id=>!shots.some(row=>row.shot.id===id)))throw Error('Выбранный план отсутствует в этом проекте.');
  if(s.shotIds?.some(id=>shots.filter(row=>row.shot.id===id).length!==1))throw Error('ID выбранного плана повторяется в фильме.');
  if(mode==='scenes'&&s.shotIds!==undefined)throw Error('Для структуры выберите сцены, а не планы.');
  if(mode==='scenes'&&scope==='all'&&s.sceneIds===undefined)return {scenes:all,shotIds:undefined,explicit:false};
  if(s.shotIds?.some(id=>s.sceneIds&&!s.sceneIds.includes(shots.find(row=>row.shot.id===id)!.scene.id)))throw Error('План не входит в выбранные сцены.');
  let scenes=all.filter(scene=>s.sceneIds===undefined||s.sceneIds.includes(scene.id)),shotIds=s.shotIds;
  if(scope==='selected'&&!s.sceneIds?.length&&!s.shotIds?.length)throw Error('Выберите хотя бы одну сцену или план.');
  if(scope==='remaining'||scope==='attention'){
    const selected=(row:BatchCandidate)=>scope==='remaining'?row.remaining:row.needsAttention;
    if(shotIds!==undefined){const ids=new Set(directingShotCandidates(p).filter(selected).map(r=>r.id));shotIds=shotIds.filter(id=>ids.has(id));}
    else {const ids=new Set(directingSceneCandidates(p,mode==='scenes'?'structure':'plans').filter(selected).map(r=>r.id));scenes=scenes.filter(scene=>ids.has(scene.id));}
  }
  if(shotIds!==undefined)scenes=scenes.filter(scene=>scene.shots.some(shot=>shotIds!.includes(shot.id)));
  if(!scenes.length||shotIds!==undefined&&!shotIds.length)throw Error('В выбранном наборе нет сцен или планов для проработки.');
  return {scenes,shotIds,explicit:true};
}
