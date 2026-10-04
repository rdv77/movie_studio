import {imageRetrySchema,prepareImageRetries,imageRetryValidationJobs} from '@/lib/image-retries';
import {scenarioVariantInstruction} from '@/lib/scenario-generation';
import {preparedVideoInputs} from '@/lib/video-from-animatic';
import {prepareKeyframeGeneration,keyframeRoleInstruction,type KeyframeRole} from '@/lib/keyframes';
import { planCharacterIds } from '@/lib/plan-references';
import { stampGenerationVersions } from '@/lib/creative-versions';
import { imageSettingsSchema, FINAL_IMAGE_SETTINGS, GROK_IMAGE_MODEL } from '@/lib/image-quality';
import { availableForDirecting } from '@/lib/model-capabilities';
import { enqueuePlanJobs, conceptImageAdmissionIssue, storyboardAdmissionIssue, videoAdmissionIssue } from '@/lib/generation-queue';
import { videoDurationIssue } from '@/lib/video-readiness';
import { assertSelectedReferences } from '@/lib/reference-selection';
import { api, owner, loadProject, saveProject, getKey, asset } from '@/lib/server';
import { id, now, getItem, stageReady, chosen, dependencies, promptFor, assertBudget, type Job } from '@/lib/domain';
import { model, MODELS } from '@/lib/models';
import { resolveSpeechSource, speechCharacters, speechPlans } from '@/lib/speech';
import { spokenText } from '@/lib/spoken-text';
import { videoShot, scriptVideo } from '@/lib/video';
import { planFields } from '@/lib/storyboard';
import { z } from 'zod';
import { characterPrompt, characterImageRefs, videoCharacterRefs, videoCharacters } from '@/lib/characters';
import { planSpeech } from '@/lib/plan-speech';
import { speechInfo, assertSpeech } from '@/lib/speech-mode';
import { compileMediaJob } from '@/lib/prompt-jobs';
import {voiceDeliverySchema} from '@/lib/voice-direction';
import {queueAdmissionIssue} from '@/lib/queue-policy';
import {freezeVoiceJob} from '@/lib/voice-tts';
import { validateCompiledMediaAssets, type PromptAsset } from '@/lib/prompt-assets';
import {MEDIA_INPUT_LIMIT} from '@/lib/prompt-limits';

export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const s = z.object({
    revision: z.number().int(), batchId: z.string().uuid(), itemId: z.string().uuid(),
    models: z.array(z.string()).min(1).max(MODELS.length), count: z.number().int().min(1).max(4),
    prompt: z.string().trim().min(1).max(MEDIA_INPUT_LIMIT), instruction: z.string().trim().max(MEDIA_INPUT_LIMIT).optional(),
    keyframe:z.enum(['start','middle','end']).optional(), refs: z.array(z.string().uuid()).max(8), characterIds: z.array(z.string().uuid()).max(120).optional(),
    referenceMode: z.enum(['auto', 'selected']).default('auto'), imageSettings: imageSettingsSchema.optional(), imageRetry:imageRetrySchema.optional(),
    dialogue: z.string().max(9500), voiceId: z.string().max(150), speechSource: z.string().max(200).optional(),
    profileId:z.string().uuid().optional(),voiceDelivery:voiceDeliverySchema.optional(),
    speechType: z.enum(['voiceover', 'character', 'none']).optional(), speaker: z.string().trim().max(100).optional(),
    estimates: z.record(z.string(), z.string().regex(/^\d+$/).nullable()),
  }).parse(await req.json());
  if (p.jobs.some(j => j.batchId === s.batchId)) return Response.json(p);
  if (s.revision !== p.revision) throw Error('Проект изменился. Обновите оценку серии.');
  const item = getItem(p, s.itemId);
  if (item.planArchive) throw Error('Эта карточка сохранена в истории. Откройте актуальный план из сценария. Запрос не отправлен.');
  if (item.removedAt) throw Error('Сначала восстановите удалённую карточку героя.');
  if (!stageReady(p, item.stage)) throw Error('Утвердите предыдущие этапы.');
  const ms = [...new Set(s.models)].map(model);
  if (p.directing && s.models.some(id => !availableForDirecting(id))) throw Error('Эта модель имеет короткий промпт и исключена из режиссёрского процесса. Выберите другую.');
  const parallelStoryboard = item.stage === 5 && ms.every(m => m.kind === 'image');
  const parallelVideo = item.stage === 7 && ms.every(m => m.kind === 'video' && m.provider !== 'sync');
  const parallelConcept = [1, 2, 3].includes(item.stage) && ms.every(m => m.kind === 'image');
  const queueIssue = parallelConcept ? conceptImageAdmissionIssue(p, item.id) : parallelStoryboard ? storyboardAdmissionIssue(p, item.id) : parallelVideo ? videoAdmissionIssue(p, item.id) : queueAdmissionIssue(p,item.id);
  if (queueIssue) throw Error(queueIssue);
  if (ms.some(m => m.kind !== ms[0].kind)) throw Error('Сравнивайте модели одного типа.');
  if (ms.some(m => m.provider === 'sync')) throw Error('Для sync.so откройте «Синхронизировать губы · выбранные планы».');
  const kind = ms[0].kind;
  if(s.keyframe&&(kind!=='image'||item.stage!==5))throw Error('Ключевые кадры создаются в раскадровке.');
  const keyframeRole=s.keyframe??(kind==='image'&&item.stage===5?'start':undefined);
  const refs = kind === 'image' ? s.referenceMode === 'selected' ? assertSelectedReferences(p, s.refs) : characterImageRefs(p, item, s.refs) : s.refs;
  if (kind === 'video') videoCharacters(p, s.characterIds);
  const characterIds = kind === 'video' ? planCharacterIds(p, item, s.characterIds) : undefined;
  const characterRefs = kind === 'video' ? videoCharacterRefs(p, 'xai', characterIds) : [];
  const shot = ['image', 'video'].includes(kind) && [5, 7].includes(item.stage) ? videoShot(p, item) : undefined;
  const fields = shot ? planFields(p, item, chosen(item)) : undefined;
  if (kind === 'video') {
    if (item.stage === 7 && !shot) throw Error('Подтяните планы из утверждённого подробного сценария и выберите нужный план.');
    for(const m of ms){const duration=preparedVideoInputs(p,item,m.id,s.refs[0]).duration??shot?.duration;if(duration&&videoDurationIssue(item.title,duration,[m.id]))throw Error(videoDurationIssue(item.title,duration,[m.id]));}
    if (s.refs.length !== 1) throw Error('Для видео выберите ровно один первый кадр.');
  }
  const speechSource = kind === 'audio' ? resolveSpeechSource(p, s.speechSource) : undefined;
  const info = kind === 'audio' ? s.speechType ? speechInfo(s) : speechSource ? speechInfo(speechSource) : planSpeech(p, item, chosen(item)) : planSpeech(p, item, kind === 'video' ? undefined : chosen(item));
  const dialogue = kind === 'audio' ? spokenText(s.dialogue, [...speechCharacters(p), info.speaker]) : fields?.dialogue ?? s.dialogue;
  if (kind === 'audio') assertSpeech(info, dialogue);
  if (kind === 'audio' && p.productionOrder === 'video-first' && item.sourceShot) {
    const target = speechPlans(p).find(r => r.item?.id === item.id); if (target?.timingIssue) throw Error(target.timingIssue);
  }
  if (kind === 'audio' && info.speechType === 'character' && !item.sourceShot) throw Error('Для реплик героев сначала нажмите «Подготовить озвучку по планам». Общая дорожка предназначена для закадрового текста.');
  if (kind === 'video') assertSpeech(info, '');
  if (kind === 'audio' && ((!s.voiceId.trim()&&!s.profileId) || !dialogue)) throw Error('Укажите voice_id или профиль голоса и произносимую реплику. Служебные пометки не озвучиваются.');
  const linked = p.items.find(i => i.stage === 5 && !i.planArchive && i.title === item.title);
  const basis = chosen(item) ?? linked?.variants.find(v => v.id === linked.approvedId);
  const jobs: Job[] = ms.flatMap(m => Array.from({ length: s.count }, (_, n) => {
    const prepared=keyframeRole?prepareKeyframeGeneration(p,item.id,keyframeRole,{model:m.id,refs,imageSettings:m.id===GROK_IMAGE_MODEL?s.imageSettings??FINAL_IMAGE_SETTINGS:undefined}):undefined;
    const videoInput=kind==='video'?preparedVideoInputs(p,item,m.id,refs[0]):undefined;
    const job: Job = {
      ...(videoInput?{videoPreparationBasis:videoInput.basis,endFrameAssetId:videoInput.endFrameId}:{}),
      ...(prepared?{keyframe:prepared.keyframe,pairId:prepared.pairId,sourceFrameVariantId:prepared.sourceFrameVariantId,keyframeSourceBasis:prepared.keyframeSourceBasis,keyframeReviewBasis:prepared.keyframeReviewBasis}:{}),
      id: id(), batchId: s.batchId, itemId: item.id, model: m.id, kind,
      shotSource: fields?.shotSource ?? (kind === 'audio' ? scriptVideo(p).variant?.id : undefined),
      ...(m.id === GROK_IMAGE_MODEL ? { imageSettings: prepared?.imageSettings??s.imageSettings ?? FINAL_IMAGE_SETTINGS } : {}),
      ...(['audio', 'image', 'video'].includes(kind) && item.stage >= 5 ? info : {}),
      brief: s.prompt, prompt: ['image', 'video'].includes(kind) ? '' : promptFor(p, item,
        (item.character ? characterPrompt(item.character) + '\n\nПравки к этой попытке: ' : '') + (item.stage===0?scenarioVariantInstruction(s.prompt,n+1,s.count):s.prompt+`\nПредложи вариант ${n + 1} из ${s.count}.`), basis),
      refs:prepared?.refs??(videoInput?.startFrameId?[videoInput.startFrameId]:refs), characterRefs: kind === 'video' && m.provider === 'xai' ? characterRefs : undefined,
      characterIds, character: item.stage === 1 ? item.character : undefined,
      location: item.stage === 3 ? item.location ?? chosen(item)?.location : undefined,
      camera: fields?.camera ?? basis?.camera ?? 'Статичная камера', continuity: fields?.continuity ?? basis?.continuity ?? '',
      offset: speechSource?.offset ?? basis?.offset ?? 0, volume: basis?.volume ?? 1, dialogue, voiceId: s.voiceId,
      duration: kind === 'video' ? videoInput?.duration??shot?.duration ?? Math.min(basis?.duration ?? 6, 6) : speechSource?.duration ?? fields?.duration ?? basis?.duration ?? 5,
      deps: dependencies(p, item.stage), created: now(), status: 'queued', transportVersion: 2,
      estimate: s.estimates[m.id] ?? null, actual: null,
    };
    const input={keyframe:keyframeRole,keyframeInstruction:prepared?.roleInstruction,instruction:s.instruction,variantIndex:n+1,variantCount:s.count};
    return kind==='image'?prepareImageRetries(p,compileMediaJob(p,job,input),s.imageRetry,input):kind==='video'?compileMediaJob(p,job,input):kind==='audio'?freezeVoiceJob(p,job,{profileId:s.profileId,delivery:s.voiceDelivery}):job;
  }));
  // Compile every model first. A critical conflict must stop the batch before storage reads or reservation.
  const loaded = new Map<string, Promise<PromptAsset>>();
  const load = (ref: string) => { let value = loaded.get(ref); if (!value) { value = asset(user, ref, p); loaded.set(ref, value); } return value; };
  for (const job of imageRetryValidationJobs(jobs)) {
    if (job.kind === 'image' || job.kind === 'video') await validateCompiledMediaAssets(job, load);
    else for (const ref of job.refs) if (!(await load(ref)).mime.startsWith('image/')) throw Error('Референс должен быть изображением.');
  }
  for (const provider of new Set(imageRetryValidationJobs(jobs).map(j=>model(j.model).provider))) await getKey(user,provider);
  if (parallelConcept || parallelStoryboard || parallelVideo) return Response.json(await enqueuePlanJobs(p, jobs, () => loadProject(user, p.id), (next, revision) => saveProject(user, next, revision)));
  assertBudget(p, jobs); stampGenerationVersions(p, jobs); p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, p.revision));
});
