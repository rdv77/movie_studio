import {api,HttpError} from '@/lib/server';
import {workerSecretMatches} from '@/lib/background-work';
import {projectWorkerTick} from '@/lib/project-worker';

// Optional server cron uses a separate secret; no model key, owner ID or
// impersonation header can replace it. The body cannot select users.
export const POST=api(async(req)=>{
  if(!await workerSecretMatches(process.env.QUEUE_WORKER_SECRET,req.headers.get('x-queue-worker-secret')))
    throw new HttpError('Фоновый доступ не разрешён.',401);
  await projectWorkerTick();
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
});
