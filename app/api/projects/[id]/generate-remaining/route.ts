import {videoPromptLimit} from '@/lib/model-capabilities';
import { prepareZenJobs } from '@/lib/zencreator-models';
import { prepareGoogleJobs } from '@/lib/google-models';
import { enqueuePlanJobs, videoAdmissionIssue } from '@/lib/generation-queue';
import { videoDurationIssue } from '@/lib/video-readiness';
import { prepareFalJobs } from '@/lib/fal-models';
import { z } from 'zod';
import { api, owner, loadProject, saveProject, asset, getKey } from '@/lib/server';
import { getItem, chosen, stageReady, dependencies, assertBudget, id, now, type Job } from '@/lib/domain';
import { selectedVideoModel, remainingVideoPlans, videoShot, scriptVideo, videoGenerationPrompt, VIDEO_PROMPT_LIMIT } from '@/lib/video';
import { planSpeech } from '@/lib/plan-speech';
import { assertSpeech } from '@/lib/speech-mode';
import { videoCharacterRefs, withCharacterIdentity, assertCharacterRefLimit } from '@/lib/characters';

const input = z.object({
  revision: z.number().int(), batchId: z.string().uuid(),
  basis: z.string().max(20000).optional(),
  sourceItemId: z.string().uuid(), sourceVariantId: z.string().uuid(),
  estimate: z.string().regex(/^\d+$/).nullable(),
  characterIds: z.array(z.string().uuid()).max(120).optional(),
  plans: z.array(z.object({ itemId: z.string().uuid(), ref: z.string().uuid(),
    prompt: z.string().trim().min(1).max(32000),
  })).min(1).max(120),
});
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const s = input.parse(await req.json());
  // A repeated submission resumes the same saved queue, never another paid batch.
  if (p.jobs.some(j => j.batchId === s.batchId)) return Response.json(p);
  if (p.revision !== s.revision&&s.basis!==dependencies(p,7)) throw new Error('Проект изменился. Закройте окно и заново проверьте серию.');
  if (!stageReady(p, 7)) throw new Error('Утвердите предыдущие этапы.');
  const queueIssue=videoAdmissionIssue(p);if(queueIssue)throw new Error(queueIssue);
  const source = getItem(p, s.sourceItemId);
  const m = selectedVideoModel(p, source);
  if (!m || chosen(source)?.id !== s.sourceVariantId)
    throw new Error('Выберите готовый видеоролик с доступной моделью и заново откройте окно создания оставшихся планов.');
  if (new Set(s.plans.map(x => x.itemId)).size !== s.plans.length)
    throw new Error('В серии один запрос на каждый план; удалите дубли.');
  const remaining = remainingVideoPlans(p);
  const characterRefs=videoCharacterRefs(p,m.provider,s.characterIds);assertCharacterRefLimit(characterRefs,7);
  for(const ref of characterRefs) {const a=await asset(user, ref, p);if(!a.mime.startsWith('image/'))throw new Error('Образ героя должен быть изображением.');}
  const jobs: Job[] = [];
  for (const row of s.plans) {
    const item = remaining.find(i => i.id === row.itemId);
    if (!item) throw new Error('Состав оставшихся планов изменился. Существующие ролики и попытки с неизвестным исходом не повторяются.');
    const shot = videoShot(p, item)!;
    const info=planSpeech(p,item);assertSpeech(info,'');
    const prompt=videoGenerationPrompt(p,item,row.prompt,s.characterIds);
    if(prompt.length>videoPromptLimit(m.id))throw new Error(`${item.title}: вместе с героями промпт содержит ${prompt.length} символов. Сократите задачу до общего лимита ${videoPromptLimit(m.id)}.`);
    if (videoDurationIssue(item.title,shot.duration,[m.id])) throw new Error(videoDurationIssue(item.title,shot.duration,[m.id]));
    const frame = await asset(user, row.ref, p);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(frame.mime))
      throw new Error(`${item.title}: выберите первый кадр PNG, JPEG или WebP.`);
    prepareZenJobs([{model:m.id,kind:'video',prompt,refs:[row.ref],duration:shot.duration} as Job],[frame]);
    prepareFalJobs([{model:m.id,kind:'video',prompt,refs:[row.ref],duration:shot.duration} as Job],[frame]);
    prepareGoogleJobs([{model:m.id,kind:'video',prompt,refs:[row.ref],duration:shot.duration} as Job],[frame]);
    jobs.push({ id: id(), batchId: s.batchId, itemId: item.id, model: m.id, kind: 'video',
      prompt, brief: row.prompt, refs: [row.ref], characterRefs:characterRefs.length?characterRefs:undefined, camera: shot.camera,
      characterIds:s.characterIds,
      ...info,
      continuity: shot.continuity, duration: shot.duration, offset: 0, volume: 1,
      dialogue: shot.dialogue, voiceId: '', shotSource: scriptVideo(p).variant?.id, deps: dependencies(p, 7), created: now(),
      status: 'queued', transportVersion: 2, estimate: s.estimate, actual: null,
    });
  }
  await getKey(user, m.provider);
  prepareZenJobs(jobs);
  prepareGoogleJobs(jobs);
  return Response.json(await enqueuePlanJobs(p,jobs,()=>loadProject(user,p.id),(next,revision)=>saveProject(user,next,revision),source.id));
});
