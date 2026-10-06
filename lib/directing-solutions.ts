import {syncPlanSetAfterMontage} from './shot-planning';
import {z} from 'zod';
import {id,type Project} from './domain';
import {recordCreativeVersion} from './creative-versions';
import {runtimeMode} from './runtime-policy';
import {directingShotSchema,dialogueSchema,ensureDirecting,editorBasis,directorApprovalBasis,type EditorIssue,type EditorPatch,type DirectingState,type Scene} from './directing';
import {shotDirectionSchema,preserveShotFacialExpression,montageOperationSchema,applyMontageOperations,scenePlanBasis,shotContentBasis,validateScenePlan,type MontageOperation} from './shot-direction';

export type EditorMontageOperation=MontageOperation&{applied?:boolean;relatedIssueIds?:string[];beforeTitles?:{id:string;title:string;duration:number}[]};
export type SceneExpressiveReview={sceneId:string;basis:string;foundation?:string;issues:EditorIssue[];patches:PreparedReview['patches'];montageOperations:EditorMontageOperation[]};
export type DirectingSolutionsState={montageOperations?:EditorMontageOperation[];sceneReviews?:SceneExpressiveReview[];planOrderChanged?:boolean};
const state=(p:Project)=>ensureDirecting(p) as DirectingState&DirectingSolutionsState;
const text=z.string().max(6000),patchText=z.string().max(32000);
export const REVIEW_SECTIONS=['story','cinematography','productionDesign','dialogue','stateIn','stateOut','continuityChanges','direction'] as const;
export const directorReviewSchema=z.object({
  issues:z.array(z.object({id:z.string().optional(),category:z.enum(['runtime_target','runtime_metadata','speech_fit','other']).optional(),sceneId:z.string().optional(),shotId:z.string().optional(),severity:z.enum(['note','conflict']),message:text,solution:text.optional()})).max(150),
  patches:z.array(z.object({issueId:z.string().optional(),shotId:z.string(),section:z.enum(REVIEW_SECTIONS),after:patchText,reason:text})).max(150),
  montageOperations:z.array(z.record(z.string(),z.unknown())).max(40).optional(),
});
type ExtendedPatch=Omit<EditorPatch,'section'>&{section:EditorPatch['section']|'direction'};
export type PreparedReview={issues:EditorIssue[];patches:ExtendedPatch[];montageOperations:EditorMontageOperation[]};
export const patchValue=(shot:Scene['shots'][number],section:ExtendedPatch['section']):string=>{
  const value=(shot as unknown as Record<string,unknown>)[section];return typeof value==='string'?value:JSON.stringify(value??null);
};
/** Hashes and before values come from the actual reviewed state, never from an LLM guess. */
export function prepareDirectorReview(p:Project,result:unknown,sceneId?:string):PreparedReview{
  const d=state(p),data=directorReviewSchema.parse(result),links=new Map<string,string>();
  const scenes=sceneId?d.scenes.filter(s=>s.id===sceneId):d.scenes;
  if(sceneId&&!scenes.length)throw Error('Сцена больше не существует.');
  const shots=scenes.flatMap(s=>s.shots),fields=new Set<string>();
  const issues=data.issues.map(v=>{
    if(v.sceneId&&!scenes.some(s=>s.id===v.sceneId)||v.shotId&&!shots.some(s=>s.id===v.shotId)||v.sceneId&&v.shotId&&!scenes.find(s=>s.id===v.sceneId)?.shots.some(s=>s.id===v.shotId))throw Error('Рецензент указал сцену или план вне своего задания.');
    const key=id();if(v.id){if(links.has(v.id))throw Error('Редактор повторил ID замечания.');links.set(v.id,key);}return {...v,sceneId:v.sceneId??sceneId,id:key,severity:v.category==='runtime_metadata'||v.category==='runtime_target'&&runtimeMode(p)==='free'?'note' as const:v.severity};
  });
  const patches=data.patches.map(v=>{
    const shot=shots.find(s=>s.id===v.shotId);if(!shot)throw Error('Редактор указал неизвестный план.');
    if(v.issueId&&!links.has(v.issueId))throw Error('Правка ссылается на неизвестное замечание.');
    const key=v.shotId+':'+v.section;if(fields.has(key))throw Error('Редактор предложил несовместимые повторные правки одного поля.');fields.add(key);
    if(v.section==='direction'){const raw=JSON.parse(v.after);v.after=JSON.stringify(preserveShotFacialExpression(raw===null?undefined:shotDirectionSchema.parse(raw),shot.direction)??null);}
    return {...v,issueId:v.issueId?links.get(v.issueId):undefined,id:id(),before:patchValue(shot,v.section)} as ExtendedPatch;
  });
  const montageOperations=(data.montageOperations??[]).map(raw=>{
    const scene=scenes.find(s=>s.id===(raw.sceneId??sceneId));if(!scene)throw Error('Монтажное решение относится к неизвестной сцене.');
    if(raw.issueId&&!links.has(String(raw.issueId)))throw Error('Монтажное решение ссылается на неизвестное замечание.');
    const shot=scene.shots.find(s=>s.id===raw.shotId),shotIds=Array.isArray(raw.shotIds)?raw.shotIds as string[]:[];
    const before=raw.type==='duration'?shot?.duration:raw.type==='remove'?shot&&shotContentBasis(shot):raw.type==='reorder'?scene.shots.map(s=>s.id):shotIds.map(shotId=>{const s=scene.shots.find(s=>s.id===shotId);if(!s)throw Error('Объединяемый план не найден.');return {shotId,basis:shotContentBasis(s)};});
    const op=montageOperationSchema.parse({...raw,id:id(),sceneId:scene.id,basis:scenePlanBasis(scene),before,issueId:raw.issueId?links.get(String(raw.issueId)):undefined});
    if(op.type==='merge'){const direction=preserveShotFacialExpression(op.after.direction,scene.shots.find(s=>s.id===op.keepShotId)?.direction);if(direction)op.after.direction=direction;else delete op.after.direction;}
    return {...op,beforeTitles:scene.shots.filter(s=>op.type==='duration'||op.type==='remove'?s.id===op.shotId:op.type==='merge'?op.shotIds.includes(s.id):true).map(s=>({id:s.id,title:s.title,duration:s.duration}))};
  });
  for(const scene of scenes)for(const conflict of validateScenePlan(scene).filter(i=>i.severity==='conflict'))
    issues.push({id:id(),sceneId:scene.id,shotId:conflict.shotId,severity:'conflict',category:'other',message:conflict.message,solution:'Исправьте структурированную постановку или примените подходящее решение редактора. Речь и действие не ускоряются автоматически.'});
  return {issues,patches,montageOperations};
}
export function currentSceneReviews(p:Project){const d=state(p);return (d.sceneReviews??[]).filter(v=>{const scene=d.scenes.find(s=>s.id===v.sceneId);return scene&&v.basis===scenePlanBasis(scene)&&(!v.foundation||v.foundation===directorApprovalBasis(p));});}
export function storeSceneReview(p:Project,sceneId:string,review:PreparedReview){
  const d=state(p),scene=d.scenes.find(s=>s.id===sceneId);if(!scene)throw Error('Сцена больше не существует.');
  const old=d.sceneReviews?.find(v=>v.sceneId===sceneId),oldIssues=new Set(old?.issues.map(v=>v.id)),oldPatches=new Set(old?.patches.map(v=>v.id)),oldOps=new Set(old?.montageOperations.map(v=>v.id));
  d.sceneReviews=[...(d.sceneReviews??[]).filter(v=>v.sceneId!==sceneId),{sceneId,basis:scenePlanBasis(scene),foundation:directorApprovalBasis(p),...review}];
  d.issues=[...d.issues.filter(v=>!oldIssues.has(v.id)),...review.issues];d.patches=[...d.patches.filter(v=>!oldPatches.has(v.id)),...review.patches] as EditorPatch[];
  d.montageOperations=[...(d.montageOperations??[]).filter(v=>!oldOps.has(v.id)),...review.montageOperations];d.editorBasis=undefined;d.patchesBasis=editorBasis(p);
}
export function storeWholeReview(p:Project,review:PreparedReview){
  const d=state(p),sceneReviews=currentSceneReviews(p),all=[...sceneReviews,review];
  const issueKeys=new Map<string,EditorIssue>(),issueIds=new Map<string,string>();
  for(const report of all)for(const issue of report.issues){const key=JSON.stringify([issue.sceneId,issue.shotId,issue.category,issue.message]),existing=issueKeys.get(key);if(existing)issueIds.set(issue.id,existing.id);else issueKeys.set(key,issue);}
  const fields=new Map<string,ExtendedPatch>(),operations=new Map<string,EditorMontageOperation>();
  const linked=(next:{issueId?:string;relatedIssueIds?:string[]},previous?:{issueId?:string;relatedIssueIds?:string[]})=>{
    const issueId=next.issueId?issueIds.get(next.issueId)??next.issueId:undefined;
    const relatedIssueIds=[...new Set([...next.relatedIssueIds??[],...previous?.relatedIssueIds??[],...(previous?.issueId?[previous.issueId]:[])].map(key=>issueIds.get(key)??key))].filter(key=>key!==issueId);return {issueId,...(relatedIssueIds.length?{relatedIssueIds}:{})};
  };
  for(const report of all){for(const patch of report.patches){const key=patch.shotId+':'+patch.section;fields.set(key,{...patch,...linked(patch,fields.get(key))});}for(const op of report.montageOperations){const key=JSON.stringify([op.sceneId,op.type,op.type==='duration'||op.type==='remove'?op.shotId:op.type==='merge'?op.shotIds:'order']);operations.set(key,{...op,...linked(op,operations.get(key))});}}
  d.issues=[...issueKeys.values()];d.patches=[...fields.values()] as EditorPatch[];if(d.montageOperations!==undefined||operations.size)d.montageOperations=[...operations.values()];
  d.editorBasis=editorBasis(p);d.patchesBasis=d.editorBasis;
}
const plainOperation=({applied,beforeTitles,relatedIssueIds,...op}:EditorMontageOperation):MontageOperation=>op;
const validateShot=(value:unknown)=>directingShotSchema.parse(value);
const assertDialogue=(shot:Scene['shots'][number])=>{
  dialogueSchema.parse(shot.dialogue);if(shot.dialogue.speechType==='character'&&!shot.cast.includes(shot.dialogue.speaker))throw Error('Говорящий герой должен присутствовать в составе плана.');
};
function operationStillCurrent(scene:Scene,op:EditorMontageOperation){
  try{applyMontageOperations(scene,[{...plainOperation(op),basis:scenePlanBasis(scene)}],{validateShot});return true;}catch{return false;}
}
/** One explicit user action, immutable preflight and one commit for text + montage. */
export function applyEditorSolutions(p:Project,patchIds:string[],operationIds:string[]=[]){
  if(!patchIds.length&&!operationIds.length)throw Error('Выберите готовые решения.');
  if(new Set(patchIds).size!==patchIds.length||new Set(operationIds).size!==operationIds.length)throw Error('Выберите готовые решения без повторов.');
  const original=p.directing as (DirectingState&DirectingSolutionsState)|undefined;if(!original)throw Error('Нет решений режиссёрской группы.');
  const copy=structuredClone(p),d=state(copy);
  const patches=patchIds.map(key=>{const patch=d.patches.find(v=>v.id===key);if(!patch)throw Error('Предложение не найдено.');return patch as ExtendedPatch;}).filter(v=>!v.applied);
  const operations=operationIds.map(key=>{const op=d.montageOperations?.find(v=>v.id===key);if(!op)throw Error('Монтажное решение не найдено.');return op;}).filter(v=>!v.applied);
  if(!patches.length&&!operations.length)return;
  if(d.patchesBasis&&d.patchesBasis!==editorBasis(copy))throw Error('После проверки изменился сценарий или его основа. Запустите редактора ещё раз для актуальных решений.');
  recordCreativeVersion(copy,'До решений редактора');
  for(const patch of patches){const shot=d.scenes.flatMap(s=>s.shots).find(s=>s.id===patch.shotId);if(!shot)throw Error('План больше не существует.');if(patchValue(shot,patch.section)!==patch.before)throw Error('Раздел уже изменился. Запустите редактора ещё раз.');}
  const groups=new Map<string,EditorMontageOperation[]>();for(const op of operations)groups.set(op.sceneId,[...groups.get(op.sceneId)??[],op]);
  for(const [sceneId,ops] of groups){
    const at=d.scenes.findIndex(s=>s.id===sceneId);if(at<0)throw Error('Сцена больше не существует.');
    const result=applyMontageOperations(d.scenes[at],ops.map(plainOperation),{validateShot,nextShotId:d.scenes[at+1]?.shots[0]?.id});
    d.scenes[at]=result.scene;for(const op of ops)op.applied=true;
  }
  for(const patch of patches){
    const shot=d.scenes.flatMap(s=>s.shots).find(s=>s.id===patch.shotId);if(!shot)throw Error('Монтаж удаляет план с выбранной текстовой правкой. Примените решения отдельными пакетами.');
    if(patchValue(shot,patch.section)!==patch.before)throw Error('Монтаж и текстовая правка меняют один раздел. Выберите одно решение или проверьте их отдельно.');
    if(patch.section==='dialogue')shot.dialogue=dialogueSchema.parse(JSON.parse(patch.after));
    else if(patch.section==='direction'){const raw=JSON.parse(patch.after);shot.direction=preserveShotFacialExpression(raw===null?undefined:shotDirectionSchema.parse(raw),shot.direction);}
    else (shot as unknown as Record<string,unknown>)[patch.section]=patch.after;
    directingShotSchema.parse(shot);assertDialogue(shot);shot.approved=undefined;patch.applied=true;
  }
  for(const scene of d.scenes){const conflict=validateScenePlan(scene).find(i=>i.severity==='conflict');if(conflict)throw Error(conflict.message);for(const shot of scene.shots)assertDialogue(shot);}
  for(const issue of d.issues){const linked=[...d.patches,...d.montageOperations??[]].filter(v=>v.issueId===issue.id||v.relatedIssueIds?.includes(issue.id));if(linked.length&&linked.every(v=>v.applied)){issue.resolved=true;issue.resolution='Применено решение редактора: '+(issue.solution||linked.map(v=>v.reason).join('; '));}}
  // After one independent proposal, keep remaining proposals usable only if their
  // exact before values are still true. Changed/removed targets keep the old basis.
  for(const op of d.montageOperations??[]){const scene=d.scenes.find(s=>s.id===op.sceneId),before=original.scenes.find(s=>s.id===op.sceneId);if(!op.applied&&scene&&before&&op.basis===scenePlanBasis(before)&&operationStillCurrent(scene,op))op.basis=scenePlanBasis(scene);}
  d.editorBasis=undefined;d.patchesBasis=editorBasis(copy);d.acceptedRuntime=undefined;if(operations.some(op=>op.type!=='duration'))d.planOrderChanged=true;
  syncPlanSetAfterMontage(copy,[...new Set(operations.map(op=>op.sceneId))]);
  recordCreativeVersion(copy,'Применены решения редактора');p.directing=d;p.creativeHistory=copy.creativeHistory;p.creativeVersionId=copy.creativeVersionId;
}
