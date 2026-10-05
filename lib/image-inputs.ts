import {asset,runtime} from '@/lib/server';
import type {Project} from './domain';
import {ProviderError} from './provider-http';
import {OPENAI_IMAGE_REFS_BYTES} from './openai-image';

/** GPT Image accepts multipart files. Avoid binary -> base64 -> binary copies. */
export async function imageBlobs(user:string,ids:string[],p:Project):Promise<Blob[]>{
  const metadata=[];let total=0;
  for(const id of ids){
    const a=await asset(user,id,p);total+=a.size;
    if(!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024||total>OPENAI_IMAGE_REFS_BYTES)
      throw new ProviderError('GPT Image: PNG, JPEG или WebP до 10 МБ, суммарно до 20 МБ. Запрос не отправлен.',true,true);
    metadata.push({...a,id});
  }
  const blobs:Blob[]=[];
  // Sequential reads bound transient buffers; retain the original file bytes.
  for(const a of metadata){
    const file=await runtime.FILES.get(a.id);
    if(!file||file.size!==a.size)throw new ProviderError('Файл референса недоступен или изменился. Запрос не отправлен.',true,true);
    blobs.push(new Blob([await file.arrayBuffer()],{type:a.mime}));
  }
  return blobs;
}
