import type {Project} from './domain';

export type StageReview={status:'editing'|'approved'|'skipped';updated:string};
export const stageEditing=(p:Project,stage:number)=>p.stageReviews?.[stage]?.status==='editing';
export function pendingStageBefore(p:Project,stage:number):number|undefined {
  const order=[0,13,12,2,3,1,14,4,5,...(p.productionOrder==='video-first'?[7,6,9]:[6,9,7]),11,10,8];
  const at=order.indexOf(stage);
  return order.slice(0,Math.max(0,at)).find(id=>stageEditing(p,id));
}
export function markStageEditing(p:Project,stage:number){
  p.stageReviews??={};p.stageReviews[stage]={status:'editing',updated:new Date().toISOString()};
}
export function markStageApproved(p:Project,stage:number){
  p.stageReviews??={};p.stageReviews[stage]={status:'approved',updated:new Date().toISOString()};
}
