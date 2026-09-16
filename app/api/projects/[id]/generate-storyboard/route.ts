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
  refs: z.array(z.string().uuid()).max(8), estimate: z.string().regex(/^\d+$/).nullable(),
  plans: z.array(z.object({ itemId: z.string().uuid(), prompt: z.string().trim().min(1).max(20000) })).min(1).max(20),
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
  const refs = characterImageRefs(p,{stage:5} as any,s.refs);
  assertCharacterRefLimit(refs,m.provider==='xai'?5:8);
  if (m.kind !== 'image') throw new Error('Выберите одну модель изображений.');
  if (m.provider === 'xai' && s.refs.length > 5) throw new Error('Grok принимает до пяти референсов.');
  if (new Set(s.plans.map(x => x.itemId)).size !== s.plans.length) throw new Error('Один план можно включить в серию только один раз.');
  if (new Set(s.refs).size !== s.refs.length) throw new Error('Удалите повторяющиеся референсы.');
  let imageBytes=0;
  const imageAssets:{mime:string;size:number}[]=[];
  for (const ref of refs) {
    const a = await asset(user, ref, p);
    imageAssets.push(a);
    if(isOpenAIImage(m.id)&&a.size>10*1024*1024)throw new Error('GPT Image: каждый референс должен быть до 10 МБ.');
    imageBytes+=a.size;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(a.mime)) throw new Error('Референс должен быть изображением PNG, JPEG или WebP.');
  }
  if(isOpenAIImage(m.id)&&imageBytes>OPENAI_IMAGE_REFS_BYTES)throw new Error('GPT Image: выберите референсы суммарно до 20 МБ. Запрос не отправлен.');
  if(isMiniMaxImage(m.id)){const issue=miniMaxImageRefIssue(imageAssets);if(issue)throw new Error(issue);}
  const available = storyboardBatchPlans(p);
  const jobs: Job[] = s.plans.map(row => {
    const entry = available.find(x => x.item.id === row.itemId);
    if (!entry || entry.blocked) throw new Error(entry?.blocked || 'План не найден в раскадровке утверждённого сценария.');
    const basis = chosen(entry.item), fields = planFields(p, entry.item, basis);
    const request=storyboardImageRequest(p,entry.item,row.prompt,refs,1,1,m.id);
    const issue=storyboardImagePromptIssue(request,m.id,entry.item.title);if(issue)throw new Error(issue);
    return { id: id(), batchId: s.batchId, itemId: entry.item.id, model: m.id, kind: 'image',
      brief: row.prompt, prompt: request.prompt, refs,
      ...fields, offset: 0, volume: 1, voiceId: '', deps: dependencies(p, 5), created: now(),
      status: 'queued', transportVersion: 2, estimate: s.estimate, actual: null };
  });
  await getKey(user, m.provider);
  assertBudget(p, jobs);
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
