'use client';
import { useQuery } from '@tanstack/react-query';
import { audioDuration } from '@/lib/audio-duration';
import { approvedPlanAudio, speechTimingMessage } from '@/lib/video-readiness';
import type { Project, Item } from '@/lib/domain';

export function VideoTiming({p,item,planSeconds,videoSeconds}:{p:Project;item:Item;planSeconds:number;videoSeconds:number}) {
  const audio=approvedPlanAudio(p,item);
  const timing=useQuery({queryKey:['audio-duration',p.id,audio?.assetId],enabled:!!audio?.assetId,
    queryFn:({signal})=>audioDuration(audio!.assetId!,signal),staleTime:Infinity,retry:false});
  if(p.speechMode!=='plans')return <p className="muted small">Озвучка общей дорожкой: длительность речи для этого плана отдельно не определена. Проверьте её в аниматике.</p>;
  if(!audio)return <p className="muted small">Для этого плана нет отдельной утверждённой аудиозаписи; её длительность не сравнивается.</p>;
  return <div className="note" aria-label={`Длительность речи — ${item.title}`}>
    {timing.isError?<><p>Не удалось измерить длину озвучки. Совпадение с видео пока не проверено.</p><button type="button" className="underline" onClick={()=>void timing.refetch()}>Повторить проверку длительности</button></>
      :timing.data===undefined?<p role="status">Проверяем длительность утверждённой озвучки…</p>
      :<p>{speechTimingMessage(timing.data,audio.trim,planSeconds,videoSeconds)}</p>}
  </div>;
}
