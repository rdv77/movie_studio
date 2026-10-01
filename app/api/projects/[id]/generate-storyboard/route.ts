import {prepareKeyframeGeneration,selectedKeyframe} from '@/lib/keyframes';
import { compileMediaJob } from '@/lib/prompt-jobs';
import { validateCompiledMediaAssets, type PromptAsset } from '@/lib/prompt-assets';
import {stampGenerationVersions} from '@/lib/creative-versions';
import { imageSettingsSchema, FINAL_IMAGE_SETTINGS, GROK_IMAGE_MODEL } from '@/lib/image-quality';
import { assertSelectedReferences } from '@/lib/reference-selection';
import { z } from 'zod';
import { api, owner, loadProject, saveProject, asset, getKey } from '@/lib/server';
import { chosen, stageReady, dependencies, assertBudget, id, now, type Job } from '@/lib/domain';
import { model } from '@/lib/models';
import { planFields, storyboardBatchPlans } from '@/lib/storyboard';
import { characterImageRefs } from '@/lib/characters';

const input = z.object({
  keyframe:z.enum(['start','middle','end']).default('start'),revision: z.number().int(), batchId: z.string().uuid(), model: z.string(),
  refs: z.array(z.string().uuid()).max(960), estimate: z.string().regex(/^\d+$/).nullable(),
  referenceMode: z.enum(['auto','selected']).default('auto'),
  imageSettings: imageSettingsSchema.optional(),
  plans: z.array(z.object({ itemId: z.string().uuid(), prompt: z.string().trim().min(1).max(20000), instruction:z.string().trim().max(20000).optional(), refs:z.array(z.string().uuid()).max(8).optional() })).min(1).max(120),
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
    const refs=row.refs!==undefined?assertSelectedReferences(p,row.refs):s.referenceMode==='selected'?s.refs:characterImageRefs(p,entry.item,s.refs);
    const first=selectedKeyframe(entry.item,'start');
    const frameModel=s.keyframe==='start'?m:model(first?.jobId?first.model:m.id);
    const prepared=prepareKeyframeGeneration(p,entry.item.id,s.keyframe,{model:frameModel.id,refs,imageSettings:frameModel.id===GROK_IMAGE_MODEL?s.imageSettings??FINAL_IMAGE_SETTINGS:undefined});
    const basis = chosen(entry.item), fields = planFields(p, entry.item, basis);
    const job:Job={ id: id(), batchId: s.batchId, itemId: entry.item.id, model: frameModel.id, kind: 'image',keyframe:prepared.keyframe,pairId:prepared.pairId,sourceFrameVariantId:prepared.sourceFrameVariantId,keyframeSourceBasis:prepared.keyframeSourceBasis,keyframeReviewBasis:prepared.keyframeReviewBasis,
      brief: row.prompt, prompt: '', refs:prepared.refs,
      ...(frameModel.id === GROK_IMAGE_MODEL ? { imageSettings: prepared.imageSettings??s.imageSettings ?? FINAL_IMAGE_SETTINGS } : {}),
      ...fields, offset: 0, volume: 1, voiceId: '', deps: dependencies(p, 5), created: now(),
      status: 'queued', transportVersion: 2, estimate:s.keyframe==='start'?s.estimate:frameModel.estimate, actual: null };
    jobs.push(compileMediaJob(p,job,{keyframe:s.keyframe,keyframeInstruction:prepared.roleInstruction,instruction:row.instruction}));
  }
  const loaded=new Map<string,Promise<PromptAsset>>();
  const load=(ref:string)=>{let value=loaded.get(ref);if(!value){value=asset(user,ref,p);loaded.set(ref,value);}return value;};
  for(const job of jobs)await validateCompiledMediaAssets(job,load);
  for(const provider of new Set(jobs.map(j=>model(j.model).provider)))await getKey(user,provider);
  assertBudget(p, jobs);
  stampGenerationVersions(p,jobs);
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
