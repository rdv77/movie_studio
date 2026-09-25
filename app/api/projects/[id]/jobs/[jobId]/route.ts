import { retrieveGoogle } from '@/lib/google-provider';
import {waitExpired,stopJobWait,resumeJobWait} from '@/lib/job-wait';
import {isMusicJob,musicBasis,parseMusicIdeas,DEFAULT_MUSIC} from '@/lib/music';
import {
  api,
  owner,
  loadProject,
  mutate,
  getKey,
  imageData,
  storeAsset,
  asset,
  runtime,
} from '@/lib/server';
import { parallelJob, generationInProgress, PARALLEL_GENERATIONS } from '@/lib/generation-queue';
import {
  dependencies,
  stageReady,
  getItem,
  makeVariant,
  now,
  type Job,
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
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const { id, jobId } = await ctx.params;
  let p = await loadProject(user, id);
  let j = p.jobs.find((j) => j.id === jobId);
  if (!j) throw new Error('Попытка не найдена.');
  if(j.purpose==='directing')return Response.json(p);
  const recoveryAction=((await req.json().catch(()=>null)) as {action?:unknown}|null)?.action;
  if(j.waitStoppedAt&&j.status==='unknown'&&recoveryAction==='resume-wait'){
    p=await mutate(user,id,p=>resumeJobWait(p.jobs.find(x=>x.id===jobId)!));
    j=p.jobs.find(x=>x.id===jobId)!;
  }
  if(waitExpired(j)){
    p=await mutate(user,id,p=>{const job=p.jobs.find(x=>x.id===jobId)!;if(waitExpired(job))stopJobWait(job,'timeout');});
    return Response.json(p);
  }
  // A watchdog may run while the original HTTP request is still in flight.
  // It only checks the deadline; it must never dispatch or poll a provider.
  if(recoveryAction==='check-wait')return Response.json(p);
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
    });return Response.json(p);
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
    return Response.json(p);
  if (j.status === 'dispatching') {
    return Response.json(p);
  }
  const saving = j.status === 'saving';
  const refreshZen = saving && model(j.model).provider === 'zencreator';
  const key = saving && !refreshZen && model(j.model).provider!=='google' ? '' : await getKey(user, model(j.model).provider);
  const polling = j.status === 'pending';
  if (!polling && !saving) {
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (job.status !== 'queued')
        throw new Error('Попытка уже обрабатывается.');
      // CAS in mutate makes the slot reservation global across browser tabs.
      // A full pool leaves the request queued; it has not reached the provider.
      if(parallelJob(p,job)&&p.jobs.filter(j=>j.id!==job.id&&parallelJob(p,j)&&generationInProgress(j)).length>=PARALLEL_GENERATIONS)return;
      const i = job.purpose==='voice-test'||isMusicJob(job)?undefined:getItem(p, job.itemId);
      if(isMusicJob(job)&&job.deps!==musicBasis(p)){job.status='cancelled';job.actual='0';job.actualSource='Сценарий или стиль изменились до отправки';return;}
      if (i && (job.deps !== dependencies(p, i.stage) || !stageReady(p, i.stage))) {
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
        job.status = 'dispatching';
        job.transportVersion = 2;
        job.started = now();
      }
    });
    j = p.jobs.find((x) => x.id === jobId)!;
    if (j.status === 'cancelled'||j.status === 'queued') return Response.json(p);
  }
  try {
    const refs =
      polling || saving || j.lipsync
        ? []
        : await Promise.all(j.refs.map((ref) => imageData(user, ref, p)));
    const characterRefs = polling || saving || j.lipsync ? [] : await Promise.all((j.characterRefs??[]).map(ref=>imageData(user, ref, p)));
    const result: Result = refreshZen ? await poll(j, key) : saving
      ? j.output!
      : j.lipsync ? await (polling ? pollSync(j, key) : (async () => {
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
        })()) : await (polling ? poll(j, key) : generate(j, key, refs, p.format, characterRefs));
    await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (result.actual != null) {
        job.actual = result.actual;
        job.actualSource = 'Ответ API';
      }
      if (result.usage) job.usage = result.usage;
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
    if (result.error) throw new ProviderError(result.error, true);
    if (result.pending) return Response.json(await loadProject(user, id));
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
    }
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      // A late, valid result is still retained after stopping local waiting.
      job.waitStoppedAt=undefined;job.waitStopReason=undefined;job.resumeStatus=undefined;
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
      const item = getItem(p, job.itemId);
      if (!item.variants.some((v) => v.jobId === jobId)) {
        const v = makeVariant(p, item, {
          id: jobId,
          reviewBasis:job.reviewBasis,
          title: model(job.model).name + (job.lipsync?.inputType === 'image' ? ' · из кадра' : '') + ' · ' + (item.variants.length + 1),
          text: result.text ?? job.brief,
          kind: job.kind,
          shotSource: job.shotSource,
          assetId,
          model: job.model,
          refs: job.refs,
          character:job.character,
          characterRefs:job.characterRefs,
          characterIds:job.characterIds,
          dialogue: job.dialogue,
          speechType:job.speechType,
          speaker:job.speaker,
          voiceId: job.voiceId,
          duration: job.duration,
          camera: job.camera,
          continuity: job.continuity,
          offset: job.offset,
          volume: job.volume,
          deps: job.deps,
          jobId,
          lipsync: job.lipsync ? (job.lipsync.inputType === 'image'
            ? {inputType:'image',imageVariantId:job.lipsync.imageVariantId,imageItemId:job.lipsync.imageItemId,speaker:job.lipsync.speaker,prompt:job.lipsync.prompt,audioVariantId:job.lipsync.audioVariantId,audioItemId:job.lipsync.audioItemId}
            : { videoVariantId: job.lipsync.videoVariantId, audioVariantId: job.lipsync.audioVariantId, audioItemId: job.lipsync.audioItemId }) : undefined,
        });
        item.variants.push(v);
        if (!item.selectedId) item.selectedId = v.id;
      }
      job.status = 'done';
      job.error = undefined;
    });
  } catch (e) {
    p = await mutate(user, id, (p) => {
      const job = p.jobs.find((x) => x.id === jobId)!;
      if (job.status === 'done') return;
      job.error = e instanceof Error ? e.message : 'Ошибка обработки.';
      if(job.waitStoppedAt){job.status='unknown';return;}
      if (!polling && e instanceof ProviderError && e.notSent) {
        job.actual = '0';
        job.actualSource = 'Запрос не отправлен';
      }
      if (job.status === 'saving') {
        job.saveFailures=(job.saveFailures??0)+1;
        if(job.saveFailures>=3)stopJobWait(job,'saving');
        return;
      }
      if (polling && !(e instanceof ProviderError && e.definite)) {
        job.status = 'pending';
      } else
        job.status =
          e instanceof ProviderError && e.definite ? 'failed' : 'unknown';
    });
  }
  return Response.json(p);
});
