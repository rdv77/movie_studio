import { z } from 'zod';
import { api, owner, loadProject, saveProject, asset, getKey } from '@/lib/server';
import { assertBudget, dependencies, id, now, type Job } from '@/lib/domain';
import { SYNC_MODELS } from '@/lib/models';
import { withCharacterIdentity } from '@/lib/characters';
import { lipsyncSource, lipsyncImageSource, lipsyncEstimate, SYNC_FILE_LIMIT, SYNC_PAIR_LIMIT, SYNC_IMAGE_PROMPT_LIMIT } from '@/lib/lipsync';

const common = {itemId:z.string().uuid(),audioVariantId:z.string().uuid(),audioAssetId:z.string().uuid(),seconds:z.number().positive().max(15)};
const videoInput = z.object({...common,inputType:z.literal('video').optional(),videoVariantId:z.string().uuid(),videoAssetId:z.string().uuid()});
const imageInput = z.object({...common,inputType:z.literal('image'),imageVariantId:z.string().uuid(),imageItemId:z.string().uuid(),imageAssetId:z.string().uuid(),
  imageWidth:z.number().int().positive().max(4096),imageHeight:z.number().int().positive().max(4096),
  speaker:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1)}),prompt:z.string().trim().min(1).max(SYNC_IMAGE_PROMPT_LIMIT)});
const input = z.object({
  revision: z.number().int(), batchId: z.string().uuid(), model: z.string(),
  rate: z.string().regex(/^\d{1,15}$/),
  plans: z.array(z.union([imageInput,videoInput])).min(1).max(20),
});
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const s = input.parse(await req.json());
  if (p.jobs.some(j => j.batchId === s.batchId)) return Response.json(p);
  if (p.revision !== s.revision) throw new Error('Проект изменился. Закройте окно и заново проверьте выбранные планы.');
  const model = SYNC_MODELS.find(m => m.id === s.model);
  if (!model || BigInt(s.rate) <= 0n) throw new Error('Выберите модель sync.so и положительную оценку тарифа.');
  if (new Set(s.plans.map(r => r.itemId)).size !== s.plans.length) throw new Error('Выберите каждый план один раз.');
  if (p.jobs.some(j => ['queued','dispatching','pending','saving'].includes(j.status))) throw new Error('Дождитесь завершения текущей серии.');
  const jobs: Job[] = [];
  for (const row of s.plans) {
    const prompt=row.inputType==='image'?withCharacterIdentity(p,row.prompt):'';
    if(prompt.length>SYNC_IMAGE_PROMPT_LIMIT)throw new Error(`Описание вместе с героями содержит ${prompt.length} символов. Сократите задачу до общего лимита ${SYNC_IMAGE_PROMPT_LIMIT}.`);
    const source = row.inputType === 'image' ? lipsyncImageSource(p,row.itemId) : lipsyncSource(p, row.itemId, row.videoVariantId);
    const {item,audioItem,audio} = source;
    const visual = 'image' in source ? source.image : source.video;
    const duration = 'image' in source ? source.duration : source.video.duration;
    if (audio.id !== row.audioVariantId) throw new Error(`${item.title}: утверждённая озвучка изменилась.`);
    if (p.jobs.some(j => j.itemId === item.id && j.lipsync && j.status === 'unknown' && j.actual === null))
      throw new Error(`${item.title}: сначала сверьте попытку с неизвестным исходом в журнале расходов.`);
    if (row.seconds + 0.001 < duration || Math.abs(row.seconds * 24 - Math.round(row.seconds * 24)) > 0.001)
      throw new Error('Подготовленные файлы не соответствуют длительности плана.');
    if (row.inputType === 'image' && 'image' in source && (model.id !== 'sync-3' || row.imageVariantId !== source.image.id || row.imageItemId !== source.imageItem.id))
      throw new Error('Для генерации из утверждённого кадра выберите sync-3 и актуальную раскадровку.');
    const va = await asset(user, row.inputType === 'image' ? row.imageAssetId : row.videoAssetId), aa = await asset(user, row.audioAssetId);
    if (va.mime !== (row.inputType === 'image' ? 'image/png' : 'video/mp4') || !['audio/wav','audio/x-wav'].includes(aa.mime) ||
      va.size > SYNC_FILE_LIMIT || aa.size > SYNC_FILE_LIMIT || va.size + aa.size > SYNC_PAIR_LIMIT)
      throw new Error(`${item.title}: нужны подготовленные ${row.inputType === 'image' ? 'PNG' : 'MP4'} и WAV допустимого размера.`);
    jobs.push({ id: id(), batchId: s.batchId, itemId: item.id, model: model.id, kind: 'video',
      camera: visual.camera, continuity: visual.continuity, offset: visual.offset, volume: visual.volume,
      prompt,
      brief: `${row.inputType === 'image' ? 'Говорящий план из утверждённого кадра.\n' + row.prompt : visual.text}\nСинхронизация губ с утверждённой репликой: ${audio.dialogue || audio.text}`,
      dialogue: audio.dialogue, speechType:'character',speaker:audio.speaker, refs: row.inputType === 'image' ? [visual.assetId!] : visual.refs, voiceId: audio.voiceId, duration: row.inputType === 'image' ? row.seconds : duration,
      shotSource: visual.shotSource, deps: dependencies(p,7), created: now(), status: 'queued', transportVersion: 2,
      estimate: lipsyncEstimate(s.rate, row.seconds,row.inputType), actual: null,
      lipsync: row.inputType === 'image' ? {inputType:'image',imageVariantId:row.imageVariantId,imageItemId:row.imageItemId,
        imageAssetId:va.id,imageWidth:row.imageWidth,imageHeight:row.imageHeight,speaker:row.speaker,prompt,
        audioVariantId:audio.id,audioItemId:audioItem.id,audioAssetId:aa.id,seconds:row.seconds} :
        { videoVariantId: visual.id, audioVariantId: audio.id, audioItemId: audioItem.id,
          videoAssetId: va.id, audioAssetId: aa.id, seconds: row.seconds },
    });
  }
  await getKey(user, 'sync');
  assertBudget(p, jobs);
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
