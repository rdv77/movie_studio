import { wasmUrl } from './wasm';
import type { Variant } from './domain';
import { lipsyncSeconds, lipsyncImageSeconds, SYNC_FILE_LIMIT, SYNC_PAIR_LIMIT } from './lipsync';

export function lipsyncVideoArgs(video: Variant, seconds: number) {
  return ['-y','-ss',String(video.trim),'-i','video','-t',String(seconds),'-an',
    '-vf',"scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=24,format=yuv420p",
    '-c:v','libx264','-preset','veryfast','-crf','20','-maxrate','6000k','-bufsize','6000k','-threads','1','-movflags','+faststart','prepared.mp4'];
}
export async function prepareLipsyncImage(image: Variant, audio: Variant, duration: number, progress: (s: string) => void) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg(); let engineUrl = '';
  try {
    progress('Проверка изображения и подготовка полной реплики…');
    engineUrl = await wasmUrl();
    await ff.load({ classWorkerURL: location.origin + '/ffmpeg/client/worker.js', coreURL: location.origin + '/ffmpeg/ffmpeg-core.js', wasmURL: engineUrl });
    for (const [name, source] of [['image', image], ['audio', audio]] as const) {
      const r = await fetch('/api/assets/' + source.assetId);
      if (!r.ok) throw new Error('Не удалось загрузить исходный файл.');
      await ff.writeFile(name, new Uint8Array(await r.arrayBuffer()));
    }
    async function probe(name: string) {
      if (await ff.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json','-o',name+'.json',name]) > 0)
        throw new Error('Не удалось проверить изображение или озвучку.');
      const bytes = await ff.readFile(name+'.json');
      return JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
    }
    const sourceInfo = await probe('image');
    const frame = sourceInfo.streams?.find((s: any) => s.codec_type === 'video');
    if (!frame || frame.width > 4096 || frame.height > 4096 || frame.width * frame.height > 16_000_000)
      throw new Error('Для говорящего плана выберите изображение до 4096 пикселей по стороне и 16 мегапикселей.');
    const voice = await probe('audio');
    if (!voice.streams?.some((s: any) => s.codec_type === 'audio')) throw new Error('В файле реплики нет звука.');
    const seconds = lipsyncImageSeconds(duration, audio, Number(voice.format?.duration));
    // Normalize image orientation/format, not a frozen intermediate video.
    if (await ff.exec(['-y','-i','image','-frames:v','1','-threads','1','prepared.png']) || await ff.exec(lipsyncAudioArgs(audio,seconds)))
      throw new Error('Не удалось подготовить изображение и речь. Запрос не отправлен.');
    const normalized = await probe('prepared.png');
    const {width,height} = normalized.streams.find((s: any) => s.codec_type === 'video');
    const v = await ff.readFile('prepared.png'), a = await ff.readFile('prepared.wav');
    if (typeof v === 'string' || typeof a === 'string') throw new Error('Некорректные файлы для sync-3.');
    if (v.byteLength > SYNC_FILE_LIMIT || a.byteLength > SYNC_FILE_LIMIT || v.byteLength + a.byteLength > SYNC_PAIR_LIMIT)
      throw new Error('Изображение и речь слишком велики для sync-3. Выберите изображение меньшего размера.');
    return {image: new File([new Uint8Array(v)],'sync-frame.png',{type:'image/png'}),
      audio: new File([new Uint8Array(a)],'sync-audio.wav',{type:'audio/wav'}),seconds,width: Number(width),height: Number(height)};
  } finally { ff.terminate(); if (engineUrl) URL.revokeObjectURL(engineUrl); }
}
export function lipsyncAudioArgs(audio: Variant, seconds: number) {
  return ['-y','-i','audio','-vn','-af',`atrim=start=${audio.trim},asetpts=PTS-STARTPTS,volume=${audio.volume},apad`,
    '-t',String(seconds),'-ar','48000','-ac','1','-c:a','pcm_s16le','prepared.wav'];
}
export async function prepareLipsyncMedia(video: Variant, audio: Variant, progress: (s: string) => void) {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ff = new FFmpeg(); let engineUrl = '';
  try {
    progress('Подготовка видео и полной реплики…');
    engineUrl = await wasmUrl();
    await ff.load({ classWorkerURL: location.origin + '/ffmpeg/client/worker.js', coreURL: location.origin + '/ffmpeg/ffmpeg-core.js', wasmURL: engineUrl });
    async function input(name: string, v: Variant) {
      const response = await fetch('/api/assets/' + v.assetId);
      if (!response.ok) throw new Error('Не удалось загрузить исходный файл.');
      await ff.writeFile(name, new Uint8Array(await response.arrayBuffer()));
      const probe = name + '-probe.json';
      if (await ff.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type','-of','json','-o',probe,name]) > 0) throw new Error('Не удалось проверить длительность файла.');
      const raw = await ff.readFile(probe);
      const info = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      if (!info.streams?.some((s: any) => s.codec_type === name)) throw new Error(`В файле нет дорожки ${name}.`);
      return Number(info.format?.duration);
    }
    const videoSeconds = await input('video', video), audioSeconds = await input('audio', audio);
    const seconds = lipsyncSeconds(video, audio, videoSeconds, audioSeconds);
    if (await ff.exec(lipsyncVideoArgs(video, seconds)) || await ff.exec(lipsyncAudioArgs(audio, seconds)))
      throw new Error('Не удалось подготовить файлы для синхронизации. Запрос провайдеру не отправлен.');
    const v = await ff.readFile('prepared.mp4'), a = await ff.readFile('prepared.wav');
    if (typeof v === 'string' || typeof a === 'string') throw new Error('Некорректные файлы для синхронизации.');
    if (v.byteLength > SYNC_FILE_LIMIT || a.byteLength > SYNC_FILE_LIMIT || v.byteLength + a.byteLength > SYNC_PAIR_LIMIT)
      throw new Error('Подготовленный фрагмент слишком большой для sync.so. Сократите длительность плана.');
    return { video: new File([new Uint8Array(v)], 'sync-video.mp4', { type: 'video/mp4' }),
      audio: new File([new Uint8Array(a)], 'sync-audio.wav', { type: 'audio/wav' }), seconds };
  } finally { ff.terminate(); if (engineUrl) URL.revokeObjectURL(engineUrl); }
}
