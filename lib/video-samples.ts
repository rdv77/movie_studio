export type VideoSamplingPlan={count?:number;eventTimes?:number[];intervals?:{start:number;end:number}[]};
/** Actual media seconds: include boundaries and inspect around authored events. */
export function videoSampleTimes(duration:number,input:number|VideoSamplingPlan=6):number[]{
  const plan=typeof input==='number'?{count:input}:input,count=plan.count??6;
  if(!Number.isInteger(count)||count<1||count>8)throw Error('Выберите от 1 до 8 кадров для проверки.');
  if(!Number.isFinite(duration)||duration<=0)throw Error('Не удалось измерить видео.');
  const end=Math.max(0,duration-.05),times:number[]=[],add=(at:number)=>{if(Number.isFinite(at)&&at>=0&&at<=duration&&times.length<count){at=Math.round(Math.min(end,at)*1000)/1000;if(!times.some(t=>Math.abs(t-at)<.04))times.push(at);}};
  if(count===1){add((plan.eventTimes??[]).find(t=>Number.isFinite(t)&&t>=0&&t<=duration)??duration/2);return times;}
  add(0);add(end);
  const around=Math.min(.25,duration/12);
  for(const at of plan.eventTimes??[])if(Number.isFinite(at)&&at>=0&&at<=duration){add(Math.max(0,at-around));add(at);add(Math.min(end,at+around));}
  for(const beat of plan.intervals??[])if(Number.isFinite(beat.start)&&Number.isFinite(beat.end)&&beat.end>beat.start&&beat.start>=0&&beat.end<=duration){add(Math.max(0,beat.start-around));add((beat.start+beat.end)/2);add(Math.min(end,beat.end+around));}
  // Fill remaining coverage only after the event samples have been reserved.
  for(let n=1;n<count-1;n++)add(n*end/(count-1));
  return times.sort((a,b)=>a-b);
}
/** Extracts bounded, labelled samples from an owned video in the browser. */
export async function sampleVideo(assetId:string,plan:number|VideoSamplingPlan=6,signal?:AbortSignal):Promise<{file:File;at:number}[]>{
  const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.preload='auto';video.src='/api/assets/'+encodeURIComponent(assetId);
  const wait=(name:string,trigger?:()=>void)=>new Promise<void>((resolve,reject)=>{let timeout:ReturnType<typeof setTimeout>;const cleanup=()=>{clearTimeout(timeout);video.removeEventListener(name,done);video.removeEventListener('error',error);signal?.removeEventListener('abort',abort);};const done=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('Не удалось прочитать видеоплан для проверки.'));},abort=()=>{cleanup();reject(signal?.reason??Error('Проверка остановлена.'));};video.addEventListener(name,done,{once:true});video.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});timeout=setTimeout(error,45000);trigger?.();if(signal?.aborted)abort();});
  try{
    await wait('loadeddata',()=>video.load());if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('Не удалось измерить видео.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,768/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('Браузер не поддерживает извлечение кадров.');const rows:{file:File;at:number}[]=[];
    const times=videoSampleTimes(video.duration,plan);
    for(const [n,at] of times.entries()){
      signal?.throwIfAborted();
      if(Math.abs(video.currentTime-at)>.001)await wait('seeked',()=>{video.currentTime=at;});
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось извлечь кадр.')),'image/jpeg',.85));
      rows.push({at,file:new File([blob],`Проверка кадра ${n+1}.jpg`,{type:'image/jpeg'})});
    }return rows;
  }finally{video.removeAttribute('src');video.load();}
}
