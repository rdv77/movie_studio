import {chosen,participates,variantCurrent,type Item,type Project} from './domain';
import {queueAdmissionIssue} from './queue-policy';
import {videoShot} from './video';

export type BatchScope='all'|'selected'|'remaining'|'attention';
export type BatchCandidate={id:string;remaining:boolean;needsAttention:boolean;blocked?:boolean|string};
/** This only selects candidates. Submission still validates sources, revision, budget and admission. */
export function batchScopeIds(rows:BatchCandidate[],scope:BatchScope,current:string[]=[]){
  const selected=new Set(current);
  return rows.filter(r=>!r.blocked&&(scope==='all'||scope==='selected'&&selected.has(r.id)||scope==='remaining'&&r.remaining||scope==='attention'&&r.needsAttention)).map(r=>r.id);
}
export function mediaBatchCandidate(p:Project,item:Item,kind:'image'|'audio'|'video'):BatchCandidate{
  const v=chosen(item),hasFile=item.variants.some(x=>x.kind===kind&&x.assetId);
  const current=!!v?.assetId&&v.kind===kind&&variantCurrent(p,item,v);
  return {id:item.id,remaining:!hasFile,needsAttention:!current,blocked:queueAdmissionIssue(p,item.id)};
}
export function videoBatchPlans(p:Project){
  return p.items.filter(i=>i.stage===7&&participates(p,i)&&!!videoShot(p,i)&&!queueAdmissionIssue(p,i.id));
}
