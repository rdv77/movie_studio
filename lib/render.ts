import { wasmUrl } from './wasm';
import { captionForPlan, captionPng } from './captions';
import type { Project, Variant } from './domain';
import { chosen, dependencies, stageReady, isApproved, participates } from './domain';
import { scriptSpeech, speechPlans } from './speech';
type RenderClip = Variant & { assemblyMode?: 'full' | 'custom' };
export function editPlan(p: Project, animatic = false) {
  const stage = animatic ? 5 : 7;
  const items = p.items.filter((i) => i.stage === stage && participates(p,i));
  if (!items.length || items.some((i) => !isApproved(p, i)))
    throw new Error('Утвердите все планы перед сборкой.');
  const clips: RenderClip[] = items.map((i) => {
    const v=i.variants.find((v) => v.id === i.approvedId)!;
    if(animatic)return {...v};
    const cut=p.assemblyCuts?.find(c=>c.itemId===i.id&&c.variantId===v.id);
    return {...v,title:i.title,trim:cut?.trim??v.trim,duration:cut?.duration??v.duration,assemblyMode:cut?.duration!=null?'custom':'full'};
  });
  if (
    clips.some((v) => !v.assetId || v.kind !== (animatic ? 'image' : 'video'))
  )
    throw new Error(
      animatic
        ? 'В каждом плане раскадровки нужно изображение.'
        : 'В каждом видеоплане нужен видеофайл.',
    );
  const seconds = clips.reduce((sum, v) => sum + v.duration, 0);
  if (clips.some(v => !Number.isFinite(v.duration) || v.duration <= 0) || !Number.isFinite(seconds) || seconds <= 0)
    throw new Error('Укажите положительную длительность каждого плана.');
  const soundItems = p.items.filter((i) => i.stage === 6 && participates(p, i));
  if (p.speechMode === 'plans') {
    const rows = speechPlans(p);
    for (const row of rows) {
      if (!row.item || (!animatic && !isApproved(p, row.item))) throw new Error(`Выберите${animatic ? '' : ' и утвердите'} озвучку: ${row.title}.`);
    }
  }
  for (const item of soundItems) {
    if (p.speechMode !== 'plans' && !item.variants.some((v) => v.kind === 'audio' && v.assetId)) continue;
    const approved = item.variants.find((v) => v.id === item.approvedId);
    const selected = chosen(item);
    if (animatic) {
      if (selected?.kind !== 'audio' || !selected.assetId) throw new Error(`Выберите аудиозапись для аниматика: «${item.title}». Выбор видео аниматика не заменяет выбор голоса.`);
      if (selected.deps !== dependencies(p,6) || !stageReady(p,6)) throw new Error(`Выбранная озвучка «${item.title}» относится к прежней раскадровке. Сохраните актуальную версию через «Правки» и проверьте её.`);
      continue;
    }
    if (selected?.kind === 'audio' && selected.id !== item.approvedId)
      throw new Error(`Для «${item.title}» выбран новый голос, но утверждён другой. В разделе «Голоса» нажмите «Утвердить выбранные новые голоса».`);
    if (!isApproved(p, item) || approved?.kind !== 'audio' || !approved.assetId)
      throw new Error(`Озвучка «${item.title}» не утверждена для текущей раскадровки. Выберите аудиозапись и утвердите её. Если указано «Основа изменилась», откройте «Правки», сохраните новую версию с тем же файлом и утвердите её. Повторная генерация не нужна.`);
  }
  const audio = soundItems
    .filter((i) => animatic ? chosen(i)?.kind === 'audio' && !!chosen(i)?.assetId : isApproved(p, i))
    .map((i) => {
      const v = (animatic ? chosen(i) : i.variants.find((v) => v.id === i.approvedId))!;
      if (p.speechMode !== 'plans') return v;
      const index = items.findIndex(clip => clip.sourceShot?.scriptId === i.sourceShot?.scriptId && clip.sourceShot?.title === i.sourceShot?.title);
      if (index < 0) throw new Error(`Не найден кадр для озвучки «${i.title}». Обновите карточки планов.`);
      return { ...v, title: i.title, offset: clips.slice(0, index).reduce((s, c) => s + c.duration, 0), duration: clips[index].duration };
    })
    .filter((v) => v.kind === 'audio' && v.assetId);
  if (!audio.length && scriptSpeech(p).sources.length)
    throw new Error('В сценарии есть реплики, но нет утверждённой озвучки. Создайте или выберите аудиозапись и нажмите «Утвердить вариант» перед сборкой.');
  for (const v of audio) {
    if (v.volume <= 0) throw new Error(`У озвучки «${v.title}» громкость равна нулю. Исправьте её через «Правки» и утвердите вариант.`);
    if (animatic && v.offset >= seconds) throw new Error(`Озвучка «${v.title}» начинается после конца фильма. Исправьте «Начало в фильме, сек» через «Правки» и утвердите вариант.`);
  }
  return {
    clips,
    audio,
    audioClipIndexes: audio.map(v => {
      const voice = soundItems.find(i => (animatic ? i.selectedId : i.approvedId) === v.id);
      return p.speechMode === 'plans' ? items.findIndex(i => i.sourceShot?.scriptId === voice?.sourceShot?.scriptId && i.sourceShot?.title === voice?.sourceShot?.title) : -1;
    }),
    seconds,
    width: p.format === '16:9' ? 1920 : 1080,
    height: p.format === '16:9' ? 1080 : 1920,
  };
}
// The same frame-aligned schedule is used by the preview and the actual render.
export function fitPlanToSpeech(plan: ReturnType<typeof editPlan>, sourceSeconds: number[]) {
  if (sourceSeconds.length !== plan.audio.length) throw new Error('Не удалось проверить длительность всех реплик.');
  if (!plan.clips.length || plan.clips.some(v => !Number.isFinite(v.duration) || v.duration <= 0)) throw new Error('Укажите положительную длительность каждого плана.');
  const clips = plan.clips.map(v => ({ ...v }));
  const audio = plan.audio.map((v, n) => {
    const duration = sourceSeconds[n] - v.trim;
    const index = plan.audioClipIndexes[n];
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Не удалось определить звучащий участок «${v.title}». Проверьте файл и начало в исходном файле.`);
    if (!Number.isInteger(index) || !clips[index]) throw new Error(`Не найден кадр для озвучки «${v.title}».`);
    clips[index].duration = Math.max(clips[index].duration, duration);
    return { ...v, duration };
  });
  const rawFrames=clips.map(v=>v.duration*24);
  const counts=rawFrames.map(n=>Math.ceil(n-1e-8));
  const minSpeechFrames=clips.map(()=>1);
  audio.forEach((v,n)=>{const index=plan.audioClipIndexes[n];minSpeechFrames[index]=Math.max(minSpeechFrames[index],Math.ceil(v.duration*24-1e-8));});
  const continuousFrames=rawFrames.reduce((s,n)=>s+n,0);
  let roundingExtra=counts.reduce((s,n)=>s+n,0)-Math.ceil(continuousFrames-1e-8);
  // Avoid accumulating fractional-frame padding at any runtime, without
  // removing a frame needed by the complete spoken audio.
  if(roundingExtra>0){
    const candidates=counts.map((n,i)=>({i,padding:n-rawFrames[i]})).filter(({i,padding})=>padding>1e-8&&counts[i]-1>=minSpeechFrames[i]).sort((a,b)=>b.padding-a.padding);
    for(const {i} of candidates){if(roundingExtra<=0)break;counts[i]--;roundingExtra--;}
  }
  let frames = 0;
  const offsets = clips.map((v,n) => {
    const start = frames / 24;
    const count = counts[n];
    v.duration = count / 24;
    frames += count;
    return start;
  });
  audio.forEach((v, n) => { v.offset = offsets[plan.audioClipIndexes[n]]; });
  const seconds = frames / 24;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Не удалось рассчитать длительность сборки.');
  return { ...plan, clips, audio, seconds };
}
export const fitAnimaticToSpeech = fitPlanToSpeech;
export function videoStreamDuration(info: {streams?: {codec_type?: string;duration?: string|number}[];format?: {duration?: string|number}}) {
  const video=info.streams?.find(s=>s.codec_type==='video');
  if(!video)throw new Error('В исходном файле нет видеодорожки.');
  const seconds=Number(video.duration);
  return Number.isFinite(seconds)&&seconds>0?seconds:Number(info.format?.duration);
}
// Final montage has its own cuts. Speech never shortens a video or silently
// overrides an explicit cut; all following voices use these same cut boundaries.
export function resolveFinalClip(v: RenderClip, sourceSeconds: number, speechSeconds = 0): RenderClip {
  if(!Number.isFinite(sourceSeconds)||sourceSeconds<=v.trim)throw new Error(`Не удалось определить доступный участок видео «${v.title}». Проверьте начало в исходном файле.`);
  const available=sourceSeconds-v.trim;
  let duration=v.assemblyMode==='full'?Math.floor(available*24+1e-6)/24:Math.ceil(v.duration*24-1e-8)/24;
  if(v.assemblyMode==='full'&&v.lipsync&&speechSeconds>duration&&speechSeconds<=available+1/24+0.001)
    duration=Math.ceil(speechSeconds*24-1e-8)/24;
  if(duration<=0)throw new Error(`Выбранный участок «${v.title}» короче одного кадра.`);
  if(speechSeconds>duration+0.001)throw new Error(`Реплика «${v.title}» длится ${speechSeconds.toFixed(2)} сек, а в сборке оставлено ${duration.toFixed(2)} сек. Увеличьте «Оставить в фильме, сек» или выберите «Весь ролик». Если исходного видео недостаточно, переозвучьте план либо выберите более длинный ролик. Речь не обрезана.`);
  const clip={...v,duration};
  validateVideoDuration(clip,sourceSeconds,v.title);
  return clip;
}
export function fitFinalPlan(plan: ReturnType<typeof editPlan>, videoSeconds: number[], speechSeconds: number[]) {
  if(videoSeconds.length!==plan.clips.length)throw new Error('Не удалось проверить длительность всех видео.');
  if(plan.audioClipIndexes.some(i=>i>=0)&&speechSeconds.length!==plan.audio.length)throw new Error('Не удалось проверить длительность всех реплик.');
  const audio=plan.audio.map((v,n)=>{
    if(plan.audioClipIndexes[n]<0)return {...v};
    const duration=speechSeconds[n]-v.trim;
    if(!Number.isFinite(duration)||duration<=0)throw new Error(`Не удалось определить звучащий участок «${v.title}».`);
    return {...v,duration};
  });
  const clips=plan.clips.map((v,n)=>resolveFinalClip(v,videoSeconds[n],Math.max(0,...audio.filter((_,j)=>plan.audioClipIndexes[j]===n).map(v=>v.duration))));
  let seconds=0;
  const offsets=clips.map(v=>{const start=seconds;seconds+=v.duration;return start;});
  audio.forEach((v,n)=>{if(plan.audioClipIndexes[n]>=0)v.offset=offsets[plan.audioClipIndexes[n]];});
  for(const v of audio)if(v.offset>=seconds)throw new Error(`Озвучка «${v.title}» начинается после конца фильма. Исправьте начало звуковой дорожки.`);
  return {...plan,clips,audio,seconds};
}
export function validateVideoDuration(v: Variant, sourceDuration: number, title: string) {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0)
    throw new Error(`Не удалось определить длительность видео «${title}».`);
  const available = sourceDuration - v.trim;
  const tolerance = (v.lipsync ? 1 / 24 : 0) + 0.001;
  if (available + tolerance < v.duration)
    throw new Error(`Для плана «${title}» в сборке нужно ${v.duration.toFixed(2)} сек видео, а после начала выбранного участка доступно ${Math.max(0, available).toFixed(2)} сек. Уменьшите длительность или начало участка в финальной сборке, либо выберите более длинный ролик. Если не помещается речь, переозвучьте план. Речь не обрезана.`);
}
export function fittedSpeechDuration(v: Variant, sourceSeconds: number) {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds <= v.trim)
    throw new Error(`Не удалось определить звучащий участок «${v.title}». Проверьте файл и начало в исходном файле.`);
  const remaining = sourceSeconds - v.trim;
  if (remaining > v.duration + 0.05)
    throw new Error(`Реплика «${v.title}» длится ${remaining.toFixed(1)} сек, а план — ${v.duration.toFixed(1)} сек. Увеличьте длительность этого плана до ${Math.ceil(remaining * 10) / 10} сек через «Правки» и пересмотрите утверждения либо сократите текст и повторите озвучку. Речь не обрезана.`);
  return Math.min(remaining, v.duration);
}
export function clipArgs(
  v: Variant,
  index: number,
  width: number,
  height: number,
  animatic: boolean,
  captionFile?: string,
) {
  const base=`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24${!animatic && v.lipsync ? ',tpad=stop_mode=clone:stop=1' : ''}`;
  return [
    '-y',
    ...(animatic ? ['-loop', '1'] : ['-ss', String(v.trim)]),
    '-i',
    `in${index}`,
    ...(captionFile?['-loop','1','-i',captionFile]:[]),
    '-t',
    String(v.duration),
    '-an',
    ...(captionFile?['-filter_complex',`[0:v]${base}[base];[base][1:v]overlay=0:0:format=auto,format=yuv420p[out]`,'-map','[out]']:['-vf',`${base},format=yuv420p`]),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '23',
    '-threads',
    '1',
    `clip${index}.mp4`,
  ];
}
export function audioArgs(audio: Variant[], seconds: number) {
  const inputs = audio.flatMap((_, i) => ['-i', `audio${i}`]);
  const filters = audio.map(
    (v, i) =>
      `[${i + 1}:a]atrim=start=${v.trim}:duration=${v.duration},asetpts=PTS-STARTPTS,volume=${v.volume},adelay=${Math.round(v.offset * 1000)}:all=1[a${i}]`,
  );
  filters.push(
    audio.map((_, i) => `[a${i}]`).join('') +
      `amix=inputs=${audio.length}:normalize=0,alimiter=limit=0.95,apad[mix]`,
  );
  return [
    '-y',
    '-i',
    'silent.mp4',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v:0',
    '-map',
    '[mix]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    String(seconds),
    '-movflags',
    '+faststart',
    'film.mp4',
  ];
}
export async function renderFilm(
  p: Project,
  animatic: boolean,
  progress: (s: string) => void,
  signal?: AbortSignal,
) {
  let plan = editPlan(p, animatic);
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg();
  let engineUrl = '';
  const cancel = () => ff.terminate();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    progress('Загрузка монтажного движка…');
    engineUrl = await wasmUrl(signal);
    await ff.load({
      classWorkerURL: location.origin + '/ffmpeg/client/worker.js',
      coreURL: location.origin + '/ffmpeg/ffmpeg-core.js',
      wasmURL: engineUrl,
    });
    async function input(name: string, v: Variant) {
      const r = await fetch('/api/assets/' + v.assetId, { signal });
      if (!r.ok) throw new Error('Не удалось загрузить материал.');
      await ff.writeFile(name, new Uint8Array(await r.arrayBuffer()));
    }
    const speechSeconds: number[] = [];
    // Measure all speech before calculating cuts or rendering frames.
    for (let i = 0; i < plan.audio.length; i++) {
      progress(`Проверка озвучки ${i + 1} из ${plan.audio.length}…`);
      await input('audio' + i, plan.audio[i]);
      if (p.speechMode === 'plans') {
        const name = `speech-probe-${i}.json`;
        if (await ff.ffprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', '-o', name, 'audio' + i]) > 0)
          throw new Error(`Не удалось прочитать длительность озвучки «${plan.audio[i].title}».`);
        const raw = await ff.readFile(name);
        const info = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
        if (!info.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio')) throw new Error('В файле озвучки нет звуковой дорожки.');
        speechSeconds.push(Number(info.format?.duration));
      }
    }
    if (animatic && p.speechMode === 'plans') plan = fitPlanToSpeech(plan, speechSeconds);
    const videoSeconds: number[] = [];
    progress(`Хронометраж с озвучкой: ${plan.seconds.toFixed(2)} сек. Подготовка кадров…`);
    for (let i = 0; i < plan.clips.length; i++) {
      progress(`Подготовка плана ${i + 1} из ${plan.clips.length}…`);
      await input('in' + i, plan.clips[i]);
      const item=p.items.filter(item=>item.stage===(animatic?5:7)&&participates(p,item))[i];
      const caption=captionForPlan(p,item),captionFile=caption?`caption${i}.png`:undefined;
      if(caption&&captionFile)await ff.writeFile(captionFile,await captionPng(caption,plan.width,plan.height));
      if (!animatic) {
        if (
          (await ff.ffprobe([
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_type,duration',
            '-of',
            'json',
            '-o',
            'probe.json',
            'in' + i,
          ])) > 0
        )
          throw new Error(
            'Не удалось определить длительность исходного плана.',
          );
        const raw = await ff.readFile('probe.json');
        const sourceDuration = videoStreamDuration(
          JSON.parse(
            typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
          ),
        );
        videoSeconds.push(sourceDuration);
        const speech=Math.max(0,...plan.audio.flatMap((v,n)=>plan.audioClipIndexes[n]===i?[speechSeconds[n]-v.trim]:[]));
        plan.clips[i]=resolveFinalClip(plan.clips[i],sourceDuration,speech);
      }
      if (
        (await ff.exec(
          clipArgs(plan.clips[i], i, plan.width, plan.height, animatic, captionFile),
        )) !== 0
      )
        throw new Error(
          `Не удалось обработать план ${i + 1}. Проверьте длительность и формат исходного файла.`,
        );
      await ff.deleteFile('in' + i);
      if(captionFile)await ff.deleteFile(captionFile);
    }
    if(!animatic)plan=fitFinalPlan(plan,videoSeconds,speechSeconds);
    await ff.writeFile(
      'list.txt',
      new TextEncoder().encode(
        plan.clips.map((_, i) => `file 'clip${i}.mp4'`).join('\n'),
      ),
    );
    progress('Склейка планов…');
    if (
      (await ff.exec([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'list.txt',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        'silent.mp4',
      ])) !== 0
    )
      throw new Error('Не удалось склеить планы.');
    let output = 'silent.mp4';
    if (plan.audio.length) {
      progress('Сведение речи и музыки…');
      if ((await ff.exec(audioArgs(plan.audio, plan.seconds))) !== 0)
        throw new Error('Не удалось свести звуковые дорожки.');
      output = 'film.mp4';
    }
    const bytes = await ff.readFile(output);
    if (typeof bytes === 'string')
      throw new Error('Некорректный результат сборки.');
    return { blob: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), seconds: plan.seconds,
      timing: plan.clips.map((v, n) => `${n + 1}. ${v.duration.toFixed(3)} сек`).join('\n') };
  } finally {
    signal?.removeEventListener('abort', cancel);
    ff.terminate();
    if (engineUrl) URL.revokeObjectURL(engineUrl);
  }
}
