import { STAGES, chosen, isApproved, independentApproval, participates, stageReady, silentFilm, type Project } from './domain';
import { animaticApproved } from './animatic';
import { musicSettings, musicIssue } from './music';

// UI order is separate from persisted stage IDs: existing video dependencies
// and projects keep their original IDs when the animatic page is added.
export const WORKFLOW=[...STAGES.slice(0,7).map((title,id)=>({id,title})),{id:9,title:'Аниматик'},{id:7,title:STAGES[7]},{id:11,title:'Музыка'},{id:10,title:'Титры'},{id:8,title:STAGES[8]}];
export const stageTitle=(stage:number)=>WORKFLOW.find(s=>s.id===stage)?.title??'';
export const nextStage=(stage:number)=>WORKFLOW[WORKFLOW.findIndex(s=>s.id===stage)+1]?.id;
export const workflowReady=(p:Project,stage:number)=>stage===11?true:stage===10?p.items.some(i=>i.stage===5&&participates(p,i)):stageReady(p,stage===9?6:stage);
export function stageComplete(p:Project,stage:number) {
  if(stage===11)return !!p.music&&(!musicSettings(p).enabled||!musicIssue(p));
  if(stage===10)return !!p.captions?.some(c=>c.enabled&&c.text.trim()&&p.items.some(i=>i.id===c.planId&&participates(p,i)));
  if(stage===9)return animaticApproved(p);
  const items=p.items.filter(i=>i.stage===stage&&participates(p,i));
  if(stage===6)return stageReady(p,6)&&(!!items.length||silentFilm(p))&&items.every(i=>isApproved(p,i)&&i.selectedId===i.approvedId&&chosen(i)?.kind==='audio'&&!!chosen(i)?.assetId);
  return !!items.length&&(independentApproval(stage)||stageReady(p,stage))&&items.every(i=>isApproved(p,i));
}
