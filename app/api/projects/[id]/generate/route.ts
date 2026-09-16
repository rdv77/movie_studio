import { prepareZenJobs } from '@/lib/zencreator-models';
import {
  api,
  owner,
  loadProject,
  saveProject,
  getKey,
  asset,
} from '@/lib/server';
import {
  id,
  now,
  getItem,
  stageReady,
  chosen,
  dependencies,
  promptFor,
  assertBudget,
  type Job,
} from '@/lib/domain';
import { model } from '@/lib/models';
import { resolveSpeechSource, speechCharacters } from '@/lib/speech';
import { spokenText } from '@/lib/spoken-text';
import { videoShot, videoGenerationPrompt, VIDEO_PROMPT_LIMIT } from '@/lib/video';
import { planFields } from '@/lib/storyboard';
import { z } from 'zod';
import { characterPrompt, characterImageRefs, characterReferenceNote, withCharacterIdentity, videoCharacterRefs, assertCharacterRefLimit } from '@/lib/characters';
import { planSpeech } from '@/lib/plan-speech';
import { speechInfo, assertSpeech, withSpeechDirection } from '@/lib/speech-mode';
import { isOpenAIImage, OPENAI_IMAGE_PROMPT_LIMIT, OPENAI_IMAGE_REFS_BYTES } from '@/lib/openai-image';
import { storyboardImageRequest, storyboardImagePromptIssue } from '@/lib/storyboard-image-prompt';
import { isMiniMaxImage, miniMaxImageRequest, miniMaxImageRefIssue, MINIMAX_IMAGE_PROMPT_LIMIT } from '@/lib/minimax-image';
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const s = z
    .object({
      revision: z.number().int(),
      batchId: z.string().uuid(),
      itemId: z.string().uuid(),
      models: z.array(z.string()).min(1).max(4),
      count: z.number().int().min(1).max(4),
      prompt: z.string().trim().min(1).max(20000),
      refs: z.array(z.string().uuid()).max(8),
      dialogue: z.string().max(9500),
      voiceId: z.string().max(150),
      speechSource: z.string().max(200).optional(),
      speechType: z.enum(['voiceover','character','none']).optional(),
      speaker: z.string().trim().max(100).optional(),
      estimates: z.record(z.string(), z.string().regex(/^\d+$/).nullable()),
    })
    .parse(await req.json());
  if (p.jobs.some((j) => j.batchId === s.batchId)) return Response.json(p);
  if (s.revision !== p.revision)
    throw new Error('Проект изменился. Обновите оценку серии.');
  const item = getItem(p, s.itemId);
  if(item.planArchive)throw new Error('Эта карточка сохранена в истории. Откройте актуальный план из сценария. Запрос не отправлен.');
  if(item.removedAt)throw new Error('Сначала восстановите удалённую карточку героя.');
  if (!stageReady(p, item.stage))
    throw new Error('Утвердите предыдущие этапы.');
  if (
    p.jobs.some((j) =>
      ['queued', 'dispatching', 'pending', 'saving'].includes(j.status),
    )
  )
    throw new Error(
      'Дождитесь текущей серии или отмените неотправленные попытки.',
    );
  const ms = [...new Set(s.models)].map(model);
  if (ms.some((m) => m.kind !== ms[0].kind))
    throw new Error('Сравнивайте модели одного типа.');
  if (ms.some(m => m.provider === 'sync')) throw new Error('Для sync.so откройте «Синхронизировать губы · выбранные планы».');
  for (const m of ms) await getKey(user, m.provider);
  const kind = ms[0].kind;
  const refs = kind === 'image' ? characterImageRefs(p,item,s.refs) : s.refs;
  const characterRefs = kind === 'video' && ms.some(m=>m.provider==='xai') ? videoCharacterRefs(p,'xai') : [];
  if(kind==='image') for(const m of ms) assertCharacterRefLimit(refs,m.provider==='xai'?5:8);
  assertCharacterRefLimit(characterRefs,7);
  let imageBytes=0;
  const imageAssets:{mime:string;size:number}[]=[];
  for (const ref of [...new Set([...refs,...characterRefs])]) {
    const a = await asset(user, ref, p);
    if(refs.includes(ref))imageAssets.push(a);
    if(ms.some(m=>isOpenAIImage(m.id))&&(!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024))throw new Error('GPT Image: каждый референс должен быть PNG, JPEG или WebP до 10 МБ.');
    if(refs.includes(ref))imageBytes+=a.size;
    if (!a.mime.startsWith('image/'))
      throw new Error('Референс должен быть изображением.');
  }
  if(ms.some(m=>isOpenAIImage(m.id))&&imageBytes>OPENAI_IMAGE_REFS_BYTES)throw new Error('GPT Image: выберите референсы суммарно до 20 МБ. Запрос не отправлен.');
  if(ms.some(m=>isMiniMaxImage(m.id))){const issue=miniMaxImageRefIssue(imageAssets);if(issue)throw new Error(issue);}
  const motionPrompt = kind === 'video' ? videoGenerationPrompt(p,item,s.prompt) : '';
  const shot = ['image', 'video'].includes(kind) && [5, 7].includes(item.stage) ? videoShot(p, item) : undefined;
  const fields = shot ? planFields(p, item, chosen(item)) : undefined;
  if (kind === 'video') {
    if (motionPrompt.length > VIDEO_PROMPT_LIMIT)
      throw new Error(`Видеопромпт вместе с описаниями героев содержит ${motionPrompt.length} символов. Сократите задачу до общего лимита ${VIDEO_PROMPT_LIMIT}; запрос не отправлен.`);
    if (item.stage === 7 && !shot)
      throw new Error('Подтяните планы из утверждённого подробного сценария и выберите нужный план.');
    if (shot && shot.duration > 6)
      throw new Error('Этот план длиннее 6 секунд. Разделите его в сценарии на более короткие планы перед генерацией.');
  }
  const speechSource = kind === 'audio' ? resolveSpeechSource(p, s.speechSource) : undefined;
  const info = kind==='audio' ? (s.speechType ? speechInfo(s) : speechSource ? speechInfo(speechSource) : planSpeech(p,item,chosen(item))) : planSpeech(p,item,kind==='video'?undefined:chosen(item));
  const dialogue = kind === 'audio' ? spokenText(s.dialogue, [...speechCharacters(p),info.speaker]) : fields?.dialogue ?? s.dialogue;
  if (kind==='audio') assertSpeech(info,dialogue);
  if (kind==='audio'&&info.speechType==='character'&&!item.sourceShot) throw new Error('Для реплик героев сначала нажмите «Подготовить озвучку по планам». Общая дорожка предназначена для закадрового текста.');
  if (kind==='video') assertSpeech(info,'');
  if (kind === 'video' && s.refs.length !== 1)
    throw new Error('Для видео выберите ровно один первый кадр.');
  if (kind === 'audio' && (!s.voiceId.trim() || !dialogue))
    throw new Error('Укажите voice_id и произносимую реплику. Служебные пометки не озвучиваются.');
  if (
    ms.some((m) => m.provider === 'xai') &&
    kind === 'image' &&
    s.refs.length > 5
  )
    throw new Error('Grok принимает до пяти референсов.');
  const linked = p.items.find((i) => i.stage === 5 && !i.planArchive && i.title === item.title);
  const basis =
    chosen(item) ?? linked?.variants.find((v) => v.id === linked.approvedId);
  const imageRequests=kind==='image'&&item.stage===5?Array.from({length:s.count},(_,n)=>storyboardImageRequest(p,item,s.prompt,refs,n+1,s.count)):[];
  for(const request of imageRequests)for(const m of ms.filter(m=>!isMiniMaxImage(m.id))){const issue=storyboardImagePromptIssue(request,m.id,item.title);if(issue)throw new Error(issue);}
  const jobs: Job[] = ms.flatMap((m) =>
    Array.from({ length: s.count }, (_, n) => ({
      id: id(),
      batchId: s.batchId,
      itemId: item.id,
      model: m.id,
      shotSource: fields?.shotSource,
      kind,
      ...(['audio','image','video'].includes(kind)&&item.stage>=5?info:{}),
      brief: s.prompt,
      camera: fields?.camera ?? basis?.camera ?? 'Статичная камера',
      continuity: fields?.continuity ?? basis?.continuity ?? '',
      offset: speechSource?.offset ?? basis?.offset ?? 0,
      volume: basis?.volume ?? 1,
      character: item.stage===1 ? item.character : undefined,
      characterRefs: kind==='video'&&m.provider==='xai'?characterRefs:undefined,
      prompt: isMiniMaxImage(m.id) ? miniMaxImageRequest(p,item,s.prompt,refs,n+1,s.count).prompt : kind === 'video' ? motionPrompt : imageRequests[n]?.prompt ?? (promptFor(
        p,
        item,
        (item.character ? characterPrompt(item.character)+'\n\nПравки к этой попытке: ' : '')+s.prompt + `\nПредложи вариант ${n + 1} из ${s.count}.`,
        basis,
      ) + (kind==='image'&&item.stage>1?characterReferenceNote(p,refs):'') + (kind==='image'&&item.stage===5?'\n\n'+withSpeechDirection('',info):'')),
      refs,
      dialogue,
      voiceId: s.voiceId,
      duration:
        kind === 'video'
          ? (shot?.duration ?? Math.min(basis?.duration ?? 6, 6))
          : (speechSource?.duration ?? fields?.duration ?? basis?.duration ?? 5),
      deps: dependencies(p, item.stage),
      created: now(),
      status: 'queued',
      transportVersion: 2,
      estimate: s.estimates[m.id] ?? null,
      actual: null,
    })),
  );
  if(jobs.some(j=>isOpenAIImage(j.model)&&j.prompt.length>OPENAI_IMAGE_PROMPT_LIMIT))throw new Error('GPT Image: полный промпт с утверждённой основой длиннее 32 000 символов. Сократите задачу или описания. Запрос не отправлен.');
  if(jobs.some(j=>isMiniMaxImage(j.model)&&j.prompt.length>MINIMAX_IMAGE_PROMPT_LIMIT))throw new Error('MiniMax image-01: сократите имена героев и описания до общего лимита 1500 символов. Запрос не отправлен.');
  prepareZenJobs(jobs, imageAssets);
  assertBudget(p, jobs);
  p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
