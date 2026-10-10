import {prepareMediaPrompt,recoverPromptPreparation} from '@/lib/prompt-optimization-runner';
import {runCinemaResearchStep} from './cinema-references-runner';
import {runGeneralScenarioJob} from './general-scenario-runner';
import type {MediaWorkScope} from './media-work-slot';
import {pendingReceiptUnchanged,pollRetryState,pollDeferred} from './media-reliability';
import {GOOGLE_OMNI} from './google-models';
import {enqueueImageRetry} from '@/lib/image-retries';
import {imageBlobs} from '@/lib/image-inputs';
import {isOpenAIImage} from '@/lib/openai-image';
import {runSoundscapeStep} from '@/lib/soundscape-runner';
import {isSoundJob} from '@/lib/soundscape';
import {runVoiceWorkflowStep} from '@/lib/voice-design-runner';
import {generateDirectedSpeech,VoiceSpeechResponseError} from '@/lib/voice-tts';
import {videoPreparationIssue} from '@/lib/video-from-animatic';
import {keyframeQueueIssue} from '@/lib/keyframes';
import {mediaReviewCurrent,mediaReviewForJob,completeMediaReview} from '@/lib/media-review';
import {generateMediaReview} from '@/lib/media-review-provider';
import { retrieveGoogle } from '@/lib/google-provider';
import {waitExpired,stopJobWait,resumeJobWait} from '@/lib/job-wait';
import {isMusicJob,musicBasis,parseMusicIdeas,DEFAULT_MUSIC} from '@/lib/music';
import {finishItemMediaJob} from '@/lib/item-media-result';
import {
  loadProject,
  mutate,
  getKey,
  imageData,
  storeAsset,
  asset,
  runtime,
} from '@/lib/server';
import {queueSlotIssue} from '@/lib/queue-policy';
import {
  dependencies,
  jobCurrent,
  stageReady,
  getItem,
  makeVariant,
  now,
  type Job,
  type Project,
} from '@/lib/domain';
import { model } from '@/lib/models';
import { speechCharacters } from '@/lib/speech';
import { spokenText } from '@/lib/spoken-text';
import { assertLipsyncJob, SYNC_FILE_LIMIT, SYNC_PAIR_LIMIT } from '@/lib/lipsync';
import { generateSync, pollSync } from '@/lib/sync-provider';
import {
  generate,
  poll,
  retrieve,
  ProviderError,
  type Result,
} from '@/lib/providers';
/** Trusted executor: callers supply a database-verified owner; public HTTP still authorizes separately. */
export async function executeMediaJob(user:string,id:string,jobId:string,recoveryAction?:unknown,scope?:MediaWorkScope):Promise<Project> {
  let p = await loadProject(user, id);
  let j = p.jobs.find((j) => j.id === jobId);
  if (!j) throw new Error('Попытка не найдена.');
  if(recoveryAction==='inspect-provider-error'){
    if(model(j.model).provider!=='fal'||!j.requestId||!['failed','unknown'].includes(j.status))throw Error('Проверка доступна для завершённой попытки fal с номером запроса.');
    let diagnostic='';
    try{const result=await poll(j,await getKey(user,'fal'));diagnostic=result.error??(result.pending?'Провайдер ещё обрабатывает прежний запрос.':'Провайдер вернул результат прежнего запроса.');}
    catch(e){diagnostic=e instanceof Error?e.message:'Не удалось уточнить ошибку.';}
    return mutate(user,id,p=>{const job=p.jobs.find(x=>x.id===jobId)!;job.providerDiagnostic=diagnostic;});
  }
  if(recoveryAction==='recover-image-file'||recoveryAction==='recover-media-file'||j.status==='saving'&&!j.purpose&&!j.lipsync){
    if(!['image','audio','video'].includes(j.kind)||j.purpose)throw new Error('Восстановление доступно для сохранённого медиафайла. Новая генерация не запускалась.');
    if(j.status==='done')return p;
    if(!['unknown','dispatching','saving'].includes(j.status))throw new Error('Эта попытка не ожидает восстановления файла.');
    const saved=await asset(user,jobId,p).catch(()=>null),stored=saved?.project_id===id&&saved.mime.startsWith(j.kind+'/')?await runtime.FILES.head(jobId):null;
    if(saved&&saved.project_id===id&&saved.mime.startsWith(j.kind+'/')&&stored&&stored.size===saved.size)return mutate(user,id,p=>{
      const job=p.jobs.find(j=>j.id===jobId);
      if(!job||job.purpose||!['unknown','dispatching','saving','done'].includes(job.status))throw new Error('Статус попытки изменился. Обновите данные.');
      finishItemMediaJob(p,job,jobId);
      job.timings={...job.timings,finishedAt:now()};
    });
    if(recoveryAction==='recover-image-file'||recoveryAction==='recover-media-file'){
      if(!j.output?.url)throw new Error('Сохранённый файл или ссылка не найдены. Новая генерация не запускалась. Проверьте исход и списание в кабинете провайдера.');
      p=undefined!;
      p=await mutate(user,id,p=>{const job=p.jobs.find(x=>x.id===jobId)!;if(!job.output?.url)throw Error('Ссылка больше недоступна.');job.status='saving';job.waitStoppedAt=undefined;job.waitStopReason=undefined;job.resumeStatus=undefined;job.saveFailures=0;job.error=undefined;});
      j=p.jobs.find(x=>x.id===jobId)!;
    }
  }
  if(j.purpose==='directing')return p;
  if(j.waitStoppedAt&&j.status==='unknown'&&recoveryAction==='resume-wait'){
    p=await mutate(user,id,p=>resumeJobWait(p.jobs.find(x=>x.id===jobId)!));
    j=p.jobs.find(x=>x.id===jobId)!;
  }
  if(waitExpired(j)){
    p=await mutate(user,id,p=>{const job=p.jobs.find(x=>x.id===jobId)!;if(waitExpired(job)&&!recoverPromptPreparation(p,job))stopJobWait(job,'timeout');});
    return p;
  }
  // A watchdog may run while the original HTTP request is still in flight.
  // It only checks the deadline; it must never dispatch or poll a provider.
  if(recoveryAction==='check-wait')return p;
  if(j.purpose==='prompt-optimization')return p;
  if(j.purpose==='cinema-research'){p=undefined!;return runCinemaResearchStep(user,id,jobId,scope);}
  if(j.purpose==='general-scenario'){p=undefined!;return runGeneralScenarioJob(user,id,jobId,scope);}
  if(j.purpose==='voice-design')return runVoiceWorkflowStep(user,id,jobId);
  if(isSoundJob(j))return runSoundscapeStep(user,id,jobId);
  // A byte-return TTS may already be paid and stored when the final project
  // write fails. Recover only that owned file; never call the provider again.
  if(j.purpose==='voice-test'&&['unknown','dispatching'].includes(j.status)&&
    recoveryAction==='recover-voice-file') {
    const saved=await asset(user, jobId, p).catch(()=>null);
    if(!saved?.mime.startsWith('audio/')||!await runtime.FILES.head(jobId))throw new Error('Сохранённая проба пока не найдена. Новая генерация не запускалась. Проверьте исход запроса в кабинете провайдера.');
    p=await mutate(user,id,p=>{
      const job=p.jobs.find(j=>j.id===jobId)!,sample=p.voiceComparisons?.find(c=>c.id===job.itemId)?.samples.find(s=>s.jobId===jobId);
      if(!sample)throw new Error('Проба не найдена.');
      if(!['unknown','dispatching','done'].includes(job.status))throw new Error('Статус пробы изменился. Обновите данные.');
      sample.assetId=jobId;job.status='done';job.error=undefined;
    });return p;
  }
  // Explicit recovery only polls the existing provider receipt. It must never
  // move a failed request back to queued or resend a paid generation.
  if (j.status === 'failed' && j.lipsync && j.requestId &&
      recoveryAction === 'recover-result') {
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (job.status === 'failed' && job.lipsync && job.requestId) {
        job.status = 'pending';
        job.error = undefined;
      }
    });
    j = p.jobs.find((x) => x.id === jobId)!;
  }
  if (['done', 'failed', 'unknown', 'cancelled'].includes(j.status))
    return p;
  if (j.status === 'dispatching') {
    return p;
  }
  if(pollDeferred(j)&&recoveryAction!=='resume-wait')return p;
  const saving = j.status === 'saving';
  const refreshZen = saving && model(j.model).provider === 'zencreator';
  const key = saving && !refreshZen && model(j.model).provider!=='google' ? '' : await getKey(user, model(j.model).provider);
  const polling = j.status === 'pending';
  if (!polling && !saving) {
    // The claim reloads a current snapshot. Do not retain the previous 18+ MB
    // film while loading/encoding its successor during CAS.
    p=undefined!;
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (job.status !== 'queued')
        throw new Error('Попытка уже обрабатывается.');
      if(job.videoPreparationBasis){const issue=videoPreparationIssue(p,getItem(p,job.itemId),job);if(issue){job.status='cancelled';job.actual='0';job.error=issue;return;}}
      const i = job.purpose==='voice-test'||job.purpose==='media-review'||isMusicJob(job)?undefined:getItem(p, job.itemId);
      if(job.purpose==='media-review'){const review=mediaReviewForJob(p,job.id);if(!review||review.removedAt||!mediaReviewCurrent(p,review)){job.status='cancelled';job.actual='0';job.actualSource='Материал проверки изменился до отправки';return;}if(job.mediaReviewPhase==='compare'&&(!review.observation||p.jobs.find(j=>j.id===review.observationJobId)?.status!=='done')){job.status='cancelled';job.actual='0';job.error='Сначала нужны завершённые независимые наблюдения.';return;}if(p.limit!==null){job.status='cancelled';job.actual='0';job.error='Стоимость проверки неизвестна заранее; установленный лимит не позволяет отправить запрос.';return;}}
      if(job.keyframe){const issue=keyframeQueueIssue(p,job);if(issue){job.status='cancelled';job.actual='0';job.actualSource='Основа ключевого кадра изменилась до отправки';job.error=issue;return;}}
      if(isMusicJob(job)&&job.deps!==musicBasis(p)){job.status='cancelled';job.actual='0';job.actualSource='Сценарий или стиль изменились до отправки';return;}
      if (i && (!jobCurrent(p,i,job) || !stageReady(p, i.stage))) {
        job.status = 'cancelled';
        job.actual = '0';
        job.actualSource = 'Основа изменилась до отправки';
      } else {
        try { assertLipsyncJob(p, job); } catch (e) {
          job.status = 'cancelled'; job.actual = '0'; job.actualSource = 'Основа синхронизации изменилась до отправки';
          job.error = e instanceof Error ? e.message : 'Основа изменилась'; return;
        }
        if(job.purpose==='voice-test'&&!p.voiceComparisons?.some(c=>!c.removedAt&&c.id===job.itemId&&c.samples.some(s=>s.jobId===job.id))) {
          job.status='cancelled';job.actual='0';job.actualSource='Проба удалена до отправки';return;
        }
        if (job.kind === 'audio' && job.purpose!=='voice-test' && !isMusicJob(job)) {
          job.dialogue = spokenText(job.dialogue, [...speechCharacters(p),job.speaker??'']);
          if (!job.dialogue) {
            job.status = 'cancelled';
            job.actual = '0';
            job.actualSource = 'После удаления служебных пометок нет текста для озвучки';
            return;
          }
        }
        // Shared project/provider slots are reserved in the same CAS as dispatch.
        // A full pool leaves this attempt queued, without another budget charge.
        if(queueSlotIssue(p,job))return;
        job.status = 'dispatching';
        job.transportVersion = 2;
        job.started = now();
        job.timings={...job.timings,queuedAt:job.timings?.queuedAt??job.created};
      }
    });
    j = p.jobs.find((x) => x.id === jobId)!;
    if (j.status === 'cancelled'||j.status === 'queued') return p;
  }
  let received:Result|undefined,providerResponseAt:string|undefined;
  try {
    if(!polling&&!saving&&!j.lipsync&&!j.purpose&&['image','video'].includes(j.kind)){
      p=undefined!;
      const prepare=async()=>!!(await prepareMediaPrompt(user,id,j!,key,scope?.withState));
      const prepared=scope?await scope.outside(prepare):await prepare();
      if(prepared)return loadProject(user,id);
      p=await loadProject(user,id);
    }
    const directImages=!polling&&!saving&&!j.lipsync&&j.kind==='image'&&isOpenAIImage(j.model);
    const binaryRefs=directImages?await imageBlobs(user,j.refs,p):undefined;
    const refs =
      polling || saving || j.lipsync || directImages
        ? []
        : await Promise.all(j.refs.map((ref) => imageData(user, ref, p)));
    const characterRefs = polling || saving || j.lipsync ? [] : await Promise.all((j.characterRefs??[]).map(ref=>imageData(user, ref, p)));
    let endFrame=polling||saving||j.lipsync||!j.endFrameAssetId?undefined:await imageData(user,j.endFrameAssetId,p);
    const format=p.format;
    // All ownership/source checks finished. Provider I/O needs only this job.
    // Lipsync still reads its project-scoped inputs below before releasing it.
    if(!j.lipsync||polling||saving)p=undefined!;
    if(!polling&&!saving){j.timings={...j.timings,providerSubmittedAt:now()};}
    const directed=polling||saving||j.kind!=='audio'?undefined:await generateDirectedSpeech(j,key,model(j.model).provider as 'minimax'|'elevenlabs');
    const readProvider=async()=>{const result=await (j!.lipsync?pollSync(j!,key):poll(j!,key));providerResponseAt=now();return result;};
    // Gemini Omni can return inline video bytes, so its poll stays in the
    // binary slot. Other installed adapters return only small JSON receipts.
    const read=()=>scope&&j!.model!==GOOGLE_OMNI?scope.outside(readProvider):readProvider();
    const result: Result = j.purpose==='media-review'?(saving?j.output!:await generateMediaReview(j,key,refs)):directed??(refreshZen ? await read() : saving
      ? j.output!
      : j.lipsync ? await (polling ? read() : (async () => {
          // Transfer private files directly; never grant public access to the asset library.
          let video: Blob, audio: Blob;
          try {
            const sync = j.lipsync!;
            const va = await asset(user, sync.inputType === 'image' ? sync.imageAssetId : sync.videoAssetId, p), aa = await asset(user, sync.audioAssetId, p);
            if (va.size > SYNC_FILE_LIMIT || aa.size > SYNC_FILE_LIMIT || va.size + aa.size > SYNC_PAIR_LIMIT) throw new Error('Превышен размер файлов sync.so.');
            const v = await runtime.FILES.get(va.id), a = await runtime.FILES.get(aa.id);
            if (!v || !a) throw new Error('Исходные файлы синхронизации недоступны.');
            video = new Blob([await v.arrayBuffer()], {type: va.mime}); audio = new Blob([await a.arrayBuffer()], {type: aa.mime});
          } catch { throw new ProviderError('Не удалось загрузить файлы синхронизации. Запрос не отправлен.', true, true); }
          return generateSync(j, key, video, audio);
        })()) : await (polling ? read() : generate(j, key, refs, format, characterRefs,endFrame,binaryRefs)));
    received=result;
    providerResponseAt??=now();
    // Do not keep large reference strings across project snapshot writes.
    refs.length=0;characterRefs.length=0;endFrame=undefined;if(binaryRefs)binaryRefs.length=0;p=undefined!;
    if(result.pending){
      p=await loadProject(user,id);
      const current=p.jobs.find(x=>x.id===jobId)!;
      if(current.status==='done'||pendingReceiptUnchanged(current,result))return p;
      p=undefined!;
    }
    p=await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if(job.status==='done')return;
      job.timings={...job.timings,...(j!.timings?.providerSubmittedAt?{providerSubmittedAt:j!.timings.providerSubmittedAt}:{}),
        ...(!polling&&!saving&&result.requestId?{providerAcceptedAt:providerResponseAt}:{}),
        ...(!result.pending&&!result.error?{providerCompletedAt:job.timings?.providerCompletedAt??providerResponseAt}:{}),
        ...(!result.pending&&(result.url||result.bytes)?{savingStartedAt:job.timings?.savingStartedAt??now()}:{}),};
      if(polling&&!result.error){job.pollRetry=undefined;job.error=undefined;}
      if (result.actual != null) {
        job.actual = result.actual;
        job.actualSource = 'Ответ API';
      }
      if (result.usage) job.usage = result.usage;
      if(job.purpose==='media-review'&&result.text)job.output={text:result.text};
      if(job.purpose==='music-ideas'&&result.text)job.output={text:result.text.slice(0,20000)};
      if (result.requestId) job.requestId = result.requestId;
      if (result.pollingUrl) job.pollingUrl = result.pollingUrl;
      if (!result.pending && result.url) {
        job.output = { url: result.url, mime: result.mime };
        if(job.waitStoppedAt)job.resumeStatus='saving';else job.status = 'saving';
      }
      if (result.pending) {
        if (!job.requestId)
          throw new Error('Провайдер не вернул идентификатор задачи.');
        if(job.waitStoppedAt)job.resumeStatus='pending';else job.status = 'pending';
      }
    });
    if (result.error) {p=undefined!;throw new ProviderError(result.error, true, false, j.kind==='image' && !/(content|moderation|recognis|public figure|safety|blocked|filter|nsfw|отклон|запрещ|содержим|баланс|ключ)/i.test(result.error));}
    if (result.pending) return p;
    p=undefined!;
    let assetId: string | undefined;
    if (j.kind !== 'text') {
      let bytes = result.bytes;
      let mime = result.mime;
      if (!bytes) {
        if (!result.url) throw new Error('Провайдер не вернул файл.');
        const file = model(j.model).provider==='google' ? await retrieveGoogle(result.url,key) : await retrieve(result.url);
        bytes = file.bytes;
        mime = file.mime;
      }
      mime = mime?.startsWith(j.kind + '/')
        ? mime
        : j.kind === 'image'
          ? 'image/png'
          : j.kind === 'audio'
            ? 'audio/mpeg'
            : 'video/mp4';
      assetId = await storeAsset(
        user,
        jobId,
        `${model(j.model).name} — ${j.kind}`,
        mime,
        bytes,
        id,
      );
      // The private file is durable now. Final CAS writes need only metadata.
      result.bytes=undefined;bytes=undefined;
    }
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      job.timings={...job.timings,finishedAt:now()};
      // A late, valid result is still retained after stopping local waiting.
      job.waitStoppedAt=undefined;job.waitStopReason=undefined;job.resumeStatus=undefined;
      if(job.purpose==='media-review'){try{completeMediaReview(p,job,result.text??job.output?.text??'');}catch(e){throw new ProviderError(e instanceof Error?e.message:'Некорректный ответ визуального редактора.',true);}return;}
      if(isMusicJob(job)){
        p.music??={variants:[],settings:{...DEFAULT_MUSIC}};
        if(job.purpose==='music-ideas'){
          try{p.music.ideas=parseMusicIdeas(result.text??job.output?.text??'',job.id);}catch(e){throw new ProviderError(e instanceof Error?e.message:'Не удалось прочитать музыкальные идеи.',true);}
        }else if(!p.music.variants.some(v=>v.jobId===job.id)){
          if(!assetId)throw Error('Не найден созданный музыкальный файл.');
          p.music.variants.push(makeVariant(p,{id:p.id,stage:0,title:'Музыка',variants:[]},{id:job.id,jobId:job.id,title:model(job.model).name+' · '+(p.music.variants.length+1),text:job.brief,kind:'audio',assetId,duration:job.duration,model:job.model,deps:job.deps}));
          if(!p.music.selectedId)p.music.selectedId=job.id;
        }
        job.status='done';job.error=undefined;return;
      }
      if(job.purpose==='voice-test') {
        const sample=p.voiceComparisons?.find(c=>c.id===job.itemId)?.samples.find(s=>s.jobId===jobId);
        if(!sample||!assetId)throw new Error('Не найдена проба голоса для сохранения результата.');
        sample.assetId=assetId;job.status='done';job.error=undefined;return;
      }
      finishItemMediaJob(p,job,assetId,result.text);
    });
  } catch (e) {
    p=undefined!;
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (job.status === 'done') return;
      job.error = e instanceof Error ? e.message : 'Ошибка обработки.';
      if(j!.timings?.providerSubmittedAt)job.timings={...job.timings,providerSubmittedAt:j!.timings.providerSubmittedAt};
      // A persistence failure after a provider receipt is not an unknown
      // generation. Retain the receipt/link and resume only its read/save.
      if(received?.requestId)job.requestId=received.requestId;
      if(received?.pollingUrl)job.pollingUrl=received.pollingUrl;
      if(received?.actual!=null){job.actual=received.actual;job.actualSource='Ответ API';}
      if(received?.usage)job.usage=received.usage;
      if(job.purpose==='media-review'&&received?.text)job.output={text:received.text};
      if(received?.requestId&&!polling&&!saving)job.timings={...job.timings,providerAcceptedAt:providerResponseAt};
      if(received?.url&&!received.error){job.output={url:received.url,mime:received.mime};job.timings={...job.timings,providerCompletedAt:job.timings?.providerCompletedAt??providerResponseAt,savingStartedAt:job.timings?.savingStartedAt??now()};}
      if(e instanceof VoiceSpeechResponseError){job.requestId=e.receipt.requestId??job.requestId;job.actual=e.receipt.actual??null;job.usage=e.receipt.usage;}
      if(job.waitStoppedAt){job.status='unknown';if(received?.url&&!received.error)job.resumeStatus='saving';else if(received?.pending&&job.requestId)job.resumeStatus='pending';return;}
      if(received?.url&&!received.error)job.status='saving';
      else if(received?.pending&&!received.error){job.status='pending';job.pollRetry=pollRetryState(job.pollRetry,job.error);return;}
      if (!polling && e instanceof ProviderError && e.notSent) {
        job.actual = '0';
        job.actualSource = 'Запрос не отправлен';
      }
      if (job.status === 'saving') {
        job.saveFailures=(job.saveFailures??0)+1;
        if(job.saveFailures>=3)stopJobWait(job,'saving');
        return;
      }
      if (polling && (!(e instanceof ProviderError && e.definite)||e.httpStatus===429)) {
        job.status = 'pending';
        job.pollRetry=pollRetryState(job.pollRetry,job.error);
      } else
        job.status =
          e instanceof ProviderError && e.definite ? 'failed' : 'unknown';
      if(['failed','unknown'].includes(job.status))job.timings={...job.timings,finishedAt:now()};
      enqueueImageRetry(p,job,e instanceof ProviderError&&e.retryable&&!e.notSent);
    });
  }
  return p;
}
