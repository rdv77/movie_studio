import {runtime,loadProject} from './server';
import {createBackgroundWorker,type OwnedProjectRow} from './background-work';
import {queueActive} from './queue-policy';
import {executeMediaJob} from './media-job-runner';
import {runVoiceWorkflowStep} from './voice-design-runner';
import {runSoundscapeStep} from './soundscape-runner';
import {runDirectorStep} from './director-runner';

// The database supplies every owner. A caller cannot choose a different owner
// or turn a public HTTP handler into an authenticated internal request.
type ProjectRow=OwnedProjectRow&{revision:number};
const revisions=new Map<string,number>(),active=new Set<string>();
async function ownedActiveProjects():Promise<OwnedProjectRow[]>{
  const rows=(await runtime.DB.prepare('SELECT id, owner, revision FROM projects').all<ProjectRow>()).results;
  const ids=new Set(rows.map(row=>row.id));
  for(const id of revisions.keys())if(!ids.has(id)){revisions.delete(id);active.delete(id);}
  const picked:OwnedProjectRow[]=[];
  for(const row of rows){
    if(revisions.get(row.id)!==row.revision){
      try{
        const p=await loadProject(row.owner,row.id);revisions.set(row.id,p.revision);
        if(p.jobs.some(queueActive)||p.directing?.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error)))active.add(row.id);
        else active.delete(row.id);
      }catch{continue;/* One inaccessible/corrupt snapshot must not stall other owners' work. */}
    }
    if(active.has(row.id))picked.push({id:row.id,owner:row.owner});
  }
  return picked;
}
const worker=createBackgroundWorker({listProjects:ownedActiveProjects,loadProject,executeMediaJob,
  executeVoiceJob:runVoiceWorkflowStep,executeSoundJob:runSoundscapeStep,runDirectorStep}, {maxFlights:8});

/** One trusted tick. Repeated/overlapping calls share in-flight guards. */
export const projectWorkerTick=()=>worker.tickAll();
/** Authorized enqueue endpoints may kick only their own project. */
export const projectWorkerTickFor=(owner:string,id:string)=>worker.tickProject(owner,id);
export const projectWorkerFlights=()=>worker.inFlightCount();
