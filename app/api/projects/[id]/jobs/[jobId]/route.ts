import {api,owner} from '@/lib/server';
import {executeMediaJob} from '@/lib/media-job-runner';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),{id,jobId}=await ctx.params;
  const action=((await req.json().catch(()=>null)) as {action?:unknown}|null)?.action;
  return Response.json(await executeMediaJob(user,id,jobId,action));
});
