import { runtime,loadProject } from './server';
import { runDirectorStep } from './director-runner';
// Run inside the app's single Node process: the file store has in-process locks.
// SQLite revisions let idle projects skip loading their larger blob snapshots.
const revisions=new Map<string,number>(),active=new Set<string>(),flights=new Set<string>();
export async function directorWorkerTick(){
  const rows=(await runtime.DB.prepare('SELECT id, owner, revision FROM projects').all<{id:string;owner:string;revision:number}>()).results;
  const ids=new Set(rows.map(r=>r.id));for(const id of revisions.keys())if(!ids.has(id)){revisions.delete(id);active.delete(id);}
  for(const row of rows){
    if(flights.has(row.id))continue;
    if(revisions.get(row.id)!==row.revision){
      const p=await loadProject(row.owner,row.id);revisions.set(row.id,p.revision);
      if(p.directing?.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error)))active.add(row.id);else active.delete(row.id);
    }
    if(!active.has(row.id)||flights.size>=3)continue;
    flights.add(row.id);
    void runDirectorStep(row.owner,row.id).catch(()=>{/* Persisted job errors are shown in the studio; retry only unclaimed work. */}).finally(()=>flights.delete(row.id));
  }
}
export function startDirectorWorker(){
  const globals=globalThis as typeof globalThis&{__kadrDirectorWorker?:ReturnType<typeof setTimeout>};
  if(globals.__kadrDirectorWorker)return;
  const tick=async()=>{try{await directorWorkerTick();}catch{/* Database startup/unavailability: no provider dispatch before a persisted claim. */}finally{globals.__kadrDirectorWorker=setTimeout(tick,5000);globals.__kadrDirectorWorker.unref();}};
  globals.__kadrDirectorWorker=setTimeout(tick,1000);globals.__kadrDirectorWorker.unref();
}
