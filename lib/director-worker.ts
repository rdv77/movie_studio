import {projectWorkerTick} from './project-worker';

// Ticks overlap while synchronous providers are slow. Per-attempt guards and
// persisted CAS claims enforce shared project/provider limits across all work.
export const directorWorkerTick=projectWorkerTick;
export function startProjectWorker(){
  const globals=globalThis as typeof globalThis&{__kadrProjectWorker?:ReturnType<typeof setTimeout>};
  if(globals.__kadrProjectWorker)return;
  const tick=()=>{
    void projectWorkerTick().catch(()=>{/* Persisted receipts remain safe on failure. */});
    globals.__kadrProjectWorker=setTimeout(tick,5000);globals.__kadrProjectWorker.unref();
  };
  globals.__kadrProjectWorker=setTimeout(tick,1000);globals.__kadrProjectWorker.unref();
}
export const startDirectorWorker=startProjectWorker;
