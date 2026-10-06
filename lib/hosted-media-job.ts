import {executeMediaJob as execute} from './media-job-runner';
import {withMediaWorkScope} from './media-work-slot';
/** Heavy snapshots and binary media remain serialized; lightweight provider
 * waiting releases the slot without weakening durable dispatch claims. */
export const executeMediaJob=(user:string,id:string,jobId:string,action?:unknown)=>withMediaWorkScope(scope=>execute(user,id,jobId,action,scope));
