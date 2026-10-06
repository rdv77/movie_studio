import {api,owner} from '@/lib/server';
import {executeMediaJob} from '@/lib/media-job-runner';
import {unchangedJobProgress} from '@/lib/job-progress';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),{id,jobId}=await ctx.params;
  const body=(await req.json().catch(()=>null)) as {action?:unknown;compact?:boolean;revision?:number}|null;
  const p=await executeMediaJob(user,id,jobId,body?.action);
  return Response.json(body?.compact?unchangedJobProgress(p,body.revision)??p:p);
});
