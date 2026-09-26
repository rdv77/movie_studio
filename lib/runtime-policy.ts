import type {Project} from './domain';
export function runtimeMode(p:Project){return p.directing?.durationMode??'free';}
export function plannedRuntime(p:Project){return Math.round((p.directing?.scenes??[]).flatMap(s=>s.shots).reduce((n,s)=>n+s.duration,0)*1000)/1000;}
export function runtimeLimit(p:Project){return runtimeMode(p)==='strict'?p.directing?.brief.targetSeconds:undefined;}
export function runtimeAcceptanceBasis(p:Project){return JSON.stringify([p.directing?.brief.targetSeconds,(p.directing?.scenes??[]).flatMap(s=>s.shots.map(v=>[v.id,v.duration]))]);}
export function checkRuntime(seconds:number,limit?:number){if(limit!==undefined&&seconds>limit+1/24+0.001)throw Error(`Строгий хронометраж: ${seconds.toFixed(2)} сек превышают предел ${limit} сек. Сократите монтаж или выберите свободную длительность. Речь не ускоряется и не обрезается.`);}
