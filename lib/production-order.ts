import { dependencies,type Project } from './domain';
import { precedesStage } from './stage-order';
export function productionPrecedes(p:Project,before:number,after:number){return !(p.productionOrder==='video-first'&&before===6&&after===7)&&precedesStage(before,after);}
// Changing workflow is not a content edit. Rebase only snapshots which were
// current under the previous rules; stale results remain stale.
export function setProductionOrder(p:Project,mode:'voice-first'|'video-first'){
  if(p.productionOrder===mode)return;
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw Error('Дождитесь текущих генераций перед сменой порядка.');
  const basis=()=>dependencies(p,7);
  const before=basis();p.productionOrder=mode;const after=basis();
  for(const i of p.items.filter(i=>i.stage===7))for(const v of i.variants)if(v.deps===before)v.deps=after;
}
