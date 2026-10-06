/** One isolate has one memory budget, shared by overlapping HTTP requests.
 * Refuse before loading a large project or claiming a paid request. This is
 * local admission only; database CAS remains the cross-isolate authority. */
// A cancelled Workers request may never settle its suspended promise/finally.
// This lease bounds only the local memory gate; it never requeues a job or
// authorizes resending a provider request. Durable CAS/status still owns that.
export const MEDIA_WORK_LEASE_MS=10*60*1000;
let occupied:{token:symbol;expires:number}|undefined;
export class MediaWorkBusyError extends Error {
  readonly code='MEDIA_WORKER_BUSY';
  constructor(message='Сервер обрабатывает предыдущий файл. Задача остаётся в очереди и продолжится автоматически.'){super(message);}
}
export async function withMediaWorkSlot<T>(work:()=>Promise<T>,busyMessage?:string,leaseMs=MEDIA_WORK_LEASE_MS):Promise<T>{
  if(occupied&&occupied.expires>Date.now())throw new MediaWorkBusyError(busyMessage);
  const token=Symbol('media-work');
  occupied={token,expires:Date.now()+leaseMs};
  try{return await work();}finally{if(occupied?.token===token)occupied=undefined;}
}

export type MediaWorkScope={
  /** Caller must release its project snapshot before leaving the heavy slot. */
  outside:<T>(work:()=>Promise<T>)=>Promise<T>;
  /** Brief snapshot IO performed while an outside operation is running. */
  withState:<T>(work:()=>Promise<T>)=>Promise<T>;
};
/** Keep one binary/snapshot operation at a time, but do not reserve that memory
 * capacity while waiting for an LLM or a small provider status response. New
 * requests still fail fast; an already accepted operation waits to save its
 * receipt instead of losing it merely because another request holds the slot. */
export async function withMediaWorkScope<T>(work:(scope:MediaWorkScope)=>Promise<T>):Promise<T>{
  let held:symbol|undefined;
  const release=()=>{if(held&&occupied?.token===held)occupied=undefined;held=undefined;};
  const acquire=async(wait:boolean)=>{
    const deadline=Date.now()+MEDIA_WORK_LEASE_MS+10000;
    while(occupied&&occupied.expires>Date.now()){
      if(!wait||Date.now()>=deadline)throw new MediaWorkBusyError();
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    held=Symbol('media-phase');occupied={token:held,expires:Date.now()+MEDIA_WORK_LEASE_MS};
  };
  await acquire(false);
  try{return await work({
    outside:async fn=>{release();try{return await fn();}finally{await acquire(true);}},
    withState:async fn=>{await acquire(true);try{return await fn();}finally{release();}},
  });}finally{release();}
}
