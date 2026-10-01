/** Extracts a small, labelled visual sample from an owned video in the browser. */
export async function sampleVideo(assetId:string,count=3,signal?:AbortSignal):Promise<{file:File;at:number}[]>{
  if(!Number.isInteger(count)||count<1||count>8)throw Error('Выберите от 1 до 8 кадров для проверки.');
  const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.preload='auto';video.src='/api/assets/'+encodeURIComponent(assetId);
  const wait=(name:string,trigger?:()=>void)=>new Promise<void>((resolve,reject)=>{let timeout:ReturnType<typeof setTimeout>;const cleanup=()=>{clearTimeout(timeout);video.removeEventListener(name,done);video.removeEventListener('error',error);signal?.removeEventListener('abort',abort);};const done=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('Не удалось прочитать видеоплан для проверки.'));},abort=()=>{cleanup();reject(signal?.reason??Error('Проверка остановлена.'));};video.addEventListener(name,done,{once:true});video.addEventListener('error',error,{once:true});signal?.addEventListener('abort',abort,{once:true});timeout=setTimeout(error,45000);trigger?.();if(signal?.aborted)abort();});
  try{
    await wait('loadeddata',()=>video.load());if(!Number.isFinite(video.duration)||video.duration<=0)throw Error('Не удалось измерить видео.');
    const canvas=document.createElement('canvas'),scale=Math.min(1,768/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw Error('Браузер не поддерживает извлечение кадров.');const rows:{file:File;at:number}[]=[];
    for(let n=0;n<count;n++){
      signal?.throwIfAborted();const at=Math.min(Math.max(0,video.duration-.05),count===1?video.duration/2:n*(video.duration-.05)/(count-1));
      if(Math.abs(video.currentTime-at)>.001)await wait('seeked',()=>{video.currentTime=at;});
      context.drawImage(video,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось извлечь кадр.')),'image/jpeg',.85));
      rows.push({at,file:new File([blob],`Проверка кадра ${n+1}.jpg`,{type:'image/jpeg'})});
    }return rows;
  }finally{video.removeAttribute('src');video.load();}
}
