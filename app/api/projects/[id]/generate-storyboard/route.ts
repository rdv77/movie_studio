import { filterPlanReferences } from '@/lib/plan-references';
import {materialBasis} from '@/lib/material-basis';
import { prepareFalJobs } from '@/lib/fal-models';
import { assertSelectedReferences } from '@/lib/reference-selection';
import { prepareZenJobs } from '@/lib/zencreator-models';
import { z } from 'zod';
import { api, owner, loadProject, saveProject, asset, getKey } from '@/lib/server';
import { chosen, stageReady, dependencies, assertBudget, id, now, type Job } from '@/lib/domain';
import { model } from '@/lib/models';
import { planFields, storyboardBatchPlans } from '@/lib/storyboard';
import { characterImageRefs, assertCharacterRefLimit } from '@/lib/characters';
import { isOpenAIImage, OPENAI_IMAGE_REFS_BYTES } from '@/lib/openai-image';
import { storyboardImageRequest, storyboardImagePromptIssue } from '@/lib/storyboard-image-prompt';
import { isMiniMaxImage, miniMaxImageRefIssue } from '@/lib/minimax-image';

const input = z.object({
  revision: z.number().int(), batchId: z.string().uuid(), model: z.string(),
  refs: z.array(z.string().uuid()).max(960), estimate: z.string().regex(/^\d+$/).nullable(),
  referenceMode: z.enum(['auto','selected']).default('auto'),
  plans: z.array(z.object({ itemId: z.string().uuid(), prompt: z.string().trim().min(1).max(20000), refs:z.array(z.string().uuid()).max(8).optional() })).min(1).max(120),
});
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const s = input.parse(await req.json());
  if (p.jobs.some(j => j.batchId === s.batchId)) return Response.json(p);
  if (p.revision !== s.revision) throw new Error('Проект изменился. Закройте окно и заново проверьте серию.');
  if (!stageReady(p, 5)) throw new Error('Утвердите подробный сценарий и предыдущие этапы.');
  if (p.jobs.some(j => ['queued', 'dispatching', 'pending', 'saving'].includes(j.status)))
    throw new Error('Дождитесь текущей серии или отмените неотправленные попытки.');
  const m = model(s.model);
  if (m.kind !== 'image') throw new Error('Выберите одну модель изображений.');
  if(new Set(s.plans.map(x=>x.itemId)).size!==s.plans.length)throw new Error('Один план указан дважды.');
  assertSelectedReferences(p,s.refs);
  const available = storyboardBatchPlans(p);
  const jobs: Job[] = [];
  for (const row of s.plans) {
    const entry = available.find(x => x.item.id === row.itemId);
    if (!entry || entry.blocked) throw new Error(entry?.blocked || 'План не найден в раскадровке утверждённого сценария.');
    const refs=filterPlanReferences(p,entry.item,row.refs!==undefined?assertSelectedReferences(p,row.refs):s.referenceMode==='selected'?s.refs:characterImageRefs(p,entry.item,s.refs));
    assertCharacterRefLimit(refs,m.provider==='xai'?5:8);
    const imageAssets=[];
    for(const ref of refs){const a=await asset(user,ref,p);if(!['image/png','image/jpeg','image/webp'].includes(a.mime))throw Error('Референс должен быть изображением PNG, JPEG или WebP.');imageAssets.push(a);}
    if(isOpenAIImage(m.id)&&(imageAssets.some(a=>a.size>10*1024*1024)||imageAssets.reduce((n,a)=>n+a.size,0)>OPENAI_IMAGE_REFS_BYTES))throw Error('GPT Image: каждый референс до 10 МБ, суммарно до 20 МБ на план.');
    if(isMiniMaxImage(m.id)){const issue=miniMaxImageRefIssue(imageAssets);if(issue)throw Error(issue);}
    const basis = chosen(entry.item), fields = planFields(p, entry.item, basis);
    const request=storyboardImageRequest(p,entry.item,row.prompt,refs,1,1,m.id);
    const issue=storyboardImagePromptIssue(request,m.id,entry.item.title);if(issue)throw new Error(issue);
    const job:Job={ id: id(), batchId: s.batchId, itemId: entry.item.id, model: m.id, kind: 'image',
      brief: row.prompt, prompt: request.prompt, refs,
      ...fields, offset: 0, volume: 1, voiceId: '', deps: dependencies(p, 5), created: now(),
      status: 'queued', transportVersion: 2, estimate: s.estimate, actual: null };
    prepareFalJobs([job],imageAssets);prepareZenJobs([job],imageAssets);jobs.push(job);
  }
  await getKey(user, m.provider);
  assertBudget(p, jobs);
  if(p.directing)for(const job of jobs)job.reviewBasis=materialBasis(p,p.items.find(i=>i.id===job.itemId)!,job);
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
