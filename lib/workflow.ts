import { STAGES, chosen, isApproved, participates, stageReady, silentFilm, type Project } from './domain';
import { animaticApproved } from './animatic';

// UI order is separate from persisted stage IDs: existing video dependencies
// and projects keep their original IDs when the animatic page is added.
export const WORKFLOW=[...STAGES.slice(0,7).map((title,id)=>({id,title})),{id:9,title:'Аниматик'},...STAGES.slice(7).map((title,n)=>({id:n+7,title}))];
export const stageTitle=(stage:number)=>WORKFLOW.find(s=>s.id===stage)?.title??'';
export const nextStage=(stage:number)=>WORKFLOW[WORKFLOW.findIndex(s=>s.id===stage)+1]?.id;
export const workflowReady=(p:Project,stage:number)=>stageReady(p,stage===9?6:stage);
export function stageComplete(p:Project,stage:number) {
  if(stage===9)return animaticApproved(p);
  const items=p.items.filter(i=>i.stage===stage&&participates(p,i));
  if(stage===6)return stageReady(p,6)&&(!!items.length||silentFilm(p))&&items.every(i=>isApproved(p,i)&&i.selectedId===i.approvedId&&chosen(i)?.kind==='audio'&&!!chosen(i)?.assetId);
  return !!items.length&&stageReady(p,stage)&&items.every(i=>isApproved(p,i));
}
