import { now, type Job, type Project } from './domain';

export const canArchiveJob = (job: Job) => ['done','failed','cancelled'].includes(job.status);
export const journalArchived = (job: Job) => !!job.journalArchivedAt && canArchiveJob(job);
export function newestJobs(jobs: Job[]) {
  return jobs.map((job,index)=>({job,index})).sort((a,b)=>
    (Date.parse(b.job.created)||0)-(Date.parse(a.job.created)||0)||b.index-a.index).map(row=>row.job);
}
// Keep complete receipts and provenance in the project. Hiding rows must never
// erase costs, reset an unknown outcome, change queue order or invalidate approvals.
export function archiveJournal(p: Project, restore=false) {
  const at=now();
  for(const job of p.jobs) {
    if(restore)delete job.journalArchivedAt;
    else if(canArchiveJob(job)&&!job.journalArchivedAt)job.journalArchivedAt=at;
  }
}
