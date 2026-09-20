import {dependencies,participates,type Project} from './domain';

// Store storyboard identities, never positions or titles, so paid media cannot
// be reassigned to another scene after a move or a script reconciliation.
export function orderedScriptShots<T extends {title:string}>(p:Project,scriptId:string,shots:T[]):T[] {
  if(!p.storyboardOrder?.length)return shots;
  const titles=p.storyboardOrder.flatMap(id=>{
    const frame=p.items.find(i=>i.id===id&&i.stage===5&&participates(p,i)&&i.sourceShot?.scriptId===scriptId);
    return frame?.sourceShot?[frame.sourceShot.title]:[];
  });
  const rank=new Map(titles.map((title,n)=>[title,n]));
  return [...shots].sort((a,b)=>(rank.get(a.title)??Infinity)-(rank.get(b.title)??Infinity));
}

export function moveStoryboardPlan(p:Project,itemId:string,toIndex:number) {
  const frames=p.items.filter(i=>i.stage===5&&participates(p,i));
  const from=frames.findIndex(i=>i.id===itemId);
  if(from<0||!Number.isInteger(toIndex)||toIndex<0||toIndex>=frames.length)throw new Error('Выберите актуальный план и его место в раскадровке.');
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw new Error('Дождитесь завершения текущей генерации перед перестановкой планов.');
  if(from===toIndex)return;
  const oldDeps=new Map([6,7].map(stage=>[stage,dependencies(p,stage)]));
  const [moved]=frames.splice(from,1);frames.splice(toIndex,0,moved);
  p.storyboardOrder=frames.map(i=>i.id);
  const key=(i:typeof moved)=>i.sourceShot?JSON.stringify([i.sourceShot.scriptId,i.sourceShot.title]):'item:'+i.id;
  const ranks=new Map(frames.map((i,n)=>[key(i),n]));
  for(const stage of [5,6,7]){
    const group=p.items.filter(i=>i.stage===stage&&participates(p,i)&&ranks.has(key(i)));
    group.sort((a,b)=>ranks.get(key(a))!-ranks.get(key(b))!);
    const ids=new Set(group.map(i=>i.id));let at=0;
    p.items=p.items.map(i=>ids.has(i.id)?group[at++]:i);
  }
  // A move changes ordering only. Retain approvals that were current beforehand;
  // never revive an already stale voice/video. Assemblies retain their old basis.
  for(const stage of [6,7]){
    const before=oldDeps.get(stage)!,after=dependencies(p,stage);
    for(const i of p.items.filter(i=>i.stage===stage))for(const v of i.variants)if(v.deps===before)v.deps=after;
  }
}
