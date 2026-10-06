import type {Job} from './domain';
import type {Result} from './providers';

/** Unchanged provider progress is a read, not a new immutable film revision. */
export function pendingReceiptUnchanged(job:Job,result:Result):boolean{
  return !!result.pending&&!result.error&&job.status==='pending'&&!job.error&&!job.pollRetry?.attempts&&
    (!result.requestId||job.requestId===result.requestId)&&(!result.pollingUrl||job.pollingUrl===result.pollingUrl)&&
    (result.actual==null||job.actual===result.actual)&&(!result.usage||JSON.stringify(job.usage)===JSON.stringify(result.usage));
}
export function pollRetryState(previous:Job['pollRetry'],message:string,time=Date.now()):NonNullable<Job['pollRetry']>{
  const attempts=Math.min(20,(previous?.attempts??0)+1),delay=Math.min(120000,10000*2**Math.min(4,attempts-1));
  return {attempts,lastAttemptAt:new Date(time).toISOString(),nextPollAt:new Date(time+delay).toISOString(),lastError:message.slice(0,600)};
}
export const pollDeferred=(job:Job,time=Date.now())=>job.status==='pending'&&!!job.pollRetry?.nextPollAt&&Date.parse(job.pollRetry.nextPollAt)>time;
