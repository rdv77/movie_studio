import type {Project,Job} from './domain';
import {queueRunnableJobs} from './queue-policy';
import {waitExpired} from './job-wait';

export type OwnedProjectRow={id:string;owner:string};
export type BackgroundAdapters={
  listProjects:()=>Promise<OwnedProjectRow[]>;
  loadProject:(owner:string,id:string)=>Promise<Project>;
  executeMediaJob:(owner:string,id:string,jobId:string,action?:'check-wait')=>Promise<Project>;
  executeVoiceJob:(owner:string,id:string,jobId:string)=>Promise<Project>;
  executeSoundJob?:(owner:string,id:string,jobId:string)=>Promise<Project>;
  runDirectorStep:(owner:string,id:string)=>Promise<Project>;
  watchDirector?:(owner:string,id:string)=>Promise<Project>;
  now?:()=>number;
  onError?:(error:unknown)=>void;
};
export type BackgroundExecutionContext={waitUntil:(promise:Promise<unknown>)=>void};
/** The HTTP caller must already be authorized. A missing context never starts an untracked promise. */
export function scheduleBackgroundWork(context:BackgroundExecutionContext|null|undefined,work:()=>Promise<unknown>,onError?:(error:unknown)=>void):boolean{
  if(!context)return false;
  context.waitUntil(Promise.resolve().then(work).catch(error=>{onError?.(error);}));return true;
}
/** Trusted worker adapter uses owners read from the database, never forged HTTP auth headers. */
export function createBackgroundWorker(adapters:BackgroundAdapters,options:{maxFlights?:number;dispatchQueued?:(job:Job,project:Project)=>boolean;dispatchDirectors?:boolean}={}){
  const maxFlights=options.maxFlights??8;if(!Number.isInteger(maxFlights)||maxFlights<1||maxFlights>32)throw Error('Неверное число фоновых операций.');
  const flights=new Map<string,Promise<unknown>>(),attempted=new Map<string,number>(),now=adapters.now??Date.now;
  const prefix=(owner:string,id:string)=>JSON.stringify([owner,id]);
  const launch=(key:string,work:()=>Promise<unknown>)=>{
    if(flights.has(key))return flights.get(key)!;
    const promise=Promise.resolve().then(work).catch(error=>{adapters.onError?.(error);}).finally(()=>flights.delete(key));flights.set(key,promise);return promise;
  };
  async function tickProject(owner:string,id:string){
    const p=await adapters.loadProject(owner,id),scope=prefix(owner,id),pending:Promise<unknown>[]=[];
    // Watchdogs only persist a deadline; they never send/poll another paid request.
    for(const job of p.jobs.filter(j=>j.purpose!=='directing'&&waitExpired(j,now()))){
      const key=scope+':watch:'+job.id;pending.push(launch(key,()=>adapters.executeMediaJob(owner,id,job.id,'check-wait')));
    }
    const directorKey=scope+':director',hasDirector=p.directing?.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error));
    const director=options.dispatchDirectors===false?adapters.watchDirector:adapters.runDirectorStep;
    if(hasDirector&&director&&!flights.has(directorKey)&&flights.size<maxFlights)pending.push(launch(directorKey,()=>director(owner,id)));
    const inputFlights=new Set(p.jobs.filter(j=>flights.has(scope+':job:'+j.id)).map(j=>j.id));
    // Filter BEFORE fair selection; held synchronous jobs must not starve
    // asynchronous submissions. The executor still rechecks the full saved
    // project in CAS. Existing receipts and saved files are never filtered.
    const queueProject=options.dispatchQueued?{...p,jobs:p.jobs.filter(j=>j.status!=='queued'||options.dispatchQueued!(j,p))}:p;
    for(const job of queueRunnableJobs(queueProject,inputFlights,attempted,now())){
      if(flights.size>=maxFlights)break;
      const key=scope+':job:'+job.id;if(flights.has(key))continue;
      // Expired dispatches are handled by the watchdog above, not resent.
      if(job.status==='dispatching')continue;
      attempted.set(job.id,now());
      pending.push(launch(key,()=>job.purpose==='voice-design'?adapters.executeVoiceJob(owner,id,job.id):
        (job as typeof job&{soundInput?:unknown}).soundInput&&adapters.executeSoundJob?adapters.executeSoundJob(owner,id,job.id):adapters.executeMediaJob(owner,id,job.id)));
    }
    await Promise.allSettled(pending);
  }
  async function tickAll(){
    const rows=await adapters.listProjects();
    // Every execution still reloads and authorizes the row's owner in the
    // trusted adapter. No project/user identity is accepted from public input.
    await Promise.allSettled(rows.map(row=>tickProject(row.owner,row.id)));
  }
  return {tickProject,tickAll,inFlightCount:()=>flights.size};
}
/** Optional external cron credentials are separate from model API keys and login cookies. */
export async function workerSecretMatches(configured:unknown,supplied:unknown):Promise<boolean>{
  if(typeof configured!=='string'||configured.length<32||configured.length>256||typeof supplied!=='string'||supplied.length>256)return false;
  const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([digest(configured),digest(supplied)]);let mismatch=0;for(let n=0;n<a.length;n++)mismatch|=a[n]^b[n];return mismatch===0;
}
