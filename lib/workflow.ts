import {scenesBasis} from './directing';
import { STAGES, chosen, isApproved, independentApproval, participates, stageReady, silentFilm, type Project } from './domain';
import { animaticApproved } from './animatic';
import { musicSettings, musicIssue } from './music';

// UI order is separate from persisted stage IDs: existing video dependencies
// and projects keep their original IDs when the animatic page is added.
export const WORKFLOW=[{id:0,title:STAGES[0]},{id:12,title:'Сцены'},...[2,3,1,4,5,6].map(id=>({id,title:STAGES[id]})),{id:9,title:'Аниматик'},{id:7,title:STAGES[7]},{id:11,title:'Музыка'},{id:10,title:'Титры'},{id:8,title:STAGES[8]}];
export function projectWorkflow(p?:Project){if(p?.productionOrder!=='video-first')return WORKFLOW;const stages=WORKFLOW.filter(s=>s.id!==7);const at=stages.findIndex(s=>s.id===6);return [...stages.slice(0,at),{id:7,title:STAGES[7]},...stages.slice(at)];}
export const stageTitle=(stage:number)=>WORKFLOW.find(s=>s.id===stage)?.title??'';
export const nextStage=(stage:number,p?:Project)=>projectWorkflow(p)[projectWorkflow(p).findIndex(s=>s.id===stage)+1]?.id;
export const workflowReady=(p:Project,stage:number)=>stage===12?true:stage===11?true:stage===10?p.items.some(i=>i.stage===5&&participates(p,i)):stageReady(p,stage===9?6:stage);
export function stageComplete(p:Project,stage:number) {
  if(stage===12)return !!p.directing?.scenesApproved&&p.directing.scenesApproved===scenesBasis(p);
  if(stage===11)return !!p.music&&(!musicSettings(p).enabled||!musicIssue(p));
  if(stage===10)return !!p.captions?.some(c=>c.enabled&&c.text.trim()&&p.items.some(i=>i.id===c.planId&&participates(p,i)));
  if(stage===9)return animaticApproved(p);
  const items=p.items.filter(i=>i.stage===stage&&participates(p,i));
  if(stage===6)return stageReady(p,6)&&(!!items.length||silentFilm(p))&&items.every(i=>isApproved(p,i)&&i.selectedId===i.approvedId&&chosen(i)?.kind==='audio'&&!!chosen(i)?.assetId);
  return !!items.length&&(independentApproval(stage)||stageReady(p,stage))&&items.every(i=>isApproved(p,i));
}
