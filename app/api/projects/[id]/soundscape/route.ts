import {z} from 'zod';
import {api,owner,loadProject,saveProject,getKey,asset,HttpError} from '@/lib/server';
import {id,now} from '@/lib/domain';
import {soundscape,getSoundLayer,saveSoundLayer,chooseSoundVariant,approveSoundLayer,soundLayerIssue,soundLayerApproved,removeSoundVariant,queueSoundGeneration,soundJobs,type SoundscapeProject} from '@/lib/soundscape';
import {runSoundscapeStep,stopSoundscape} from '@/lib/soundscape-runner';
const identity=z.string().uuid();
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),projectId=(await ctx.params).id,p=await loadProject(user,projectId) as SoundscapeProject;
  const body=z.object({revision:z.number().int(),action:z.enum(['enable','saveLayer','addVariant','measure','choose','approve','approveReady','generate','advance','stop','allowNewSeries','removeVariant','restoreVariant','removeLayer','restoreLayer']),data:z.any()}).parse(await req.json());
  const v=body.data;
  if(body.action==='advance'){const jobId=v?.jobId===undefined?undefined:identity.parse(v.jobId);if(jobId&&!soundJobs(p).some(j=>j.id===jobId))throw Error('Попытка звука текущего проекта не найдена.');return Response.json(await runSoundscapeStep(user,projectId,jobId));}
  if(body.action==='generate'&&typeof v?.batchId==='string'&&soundJobs(p).some(j=>j.batchId===v.batchId))return Response.json(p);
  if(body.revision!==p.revision)throw new HttpError('Проект изменился. Обновите звуковые слои перед сохранением.',409);
  switch(body.action){
    case 'enable':soundscape(p).enabled=z.boolean().parse(v.enabled);break;
    case 'saveLayer':saveSoundLayer(p,v.layer,v.layerId===undefined?undefined:identity.parse(v.layerId));break;
    case 'addVariant':{
      const layer=getSoundLayer(p,identity.parse(v.layerId)),assetId=identity.parse(v.assetId),file=await asset(user,assetId,p); // Ownership is checked before adding snapshot membership.
      if(!file.mime.startsWith('audio/'))throw Error('Загрузите аудиофайл звукового слоя.');if(layer.variants.filter(v=>!v.removedAt).length>=100)throw Error('В рабочем списке слоя максимум 100 вариантов звука.');
      const seconds=v.seconds===undefined?undefined:z.number().finite().positive().max(3600).parse(v.seconds);
      layer.variants.push({id:id(),assetId,mime:file.mime,model:'Загруженный звук',created:now(),prompt:z.string().max(1000).parse(v.description??''),seconds});break;
    }
    case 'measure':{
      const layer=getSoundLayer(p,identity.parse(v.layerId)),variant=layer.variants.find(r=>r.id===identity.parse(v.variantId));if(!variant||variant.removedAt)throw Error('Вариант звука не найден.');
      await asset(user,variant.assetId,p);variant.seconds=z.number().finite().positive().max(3600).parse(v.seconds);break;
    }
    case 'choose':chooseSoundVariant(p,identity.parse(v.layerId),identity.parse(v.variantId));break;
    case 'approve':{
      const layer=getSoundLayer(p,identity.parse(v.layerId));if(v.seconds!==undefined){const selected=layer.variants.find(r=>r.id===layer.selectedId&&!r.removedAt);if(!selected)throw Error('Выбранный звуковой файл не найден.');await asset(user,selected.assetId,p);selected.seconds=z.number().finite().positive().max(3600).parse(v.seconds);}approveSoundLayer(p,layer.id);break;
    }
    case 'approveReady':{
      if(v.measurements!==undefined){const rows=z.array(z.object({layerId:identity,variantId:identity,seconds:z.number().finite().positive().max(3600)}).strict()).max(200).parse(v.measurements);if(new Set(rows.map(r=>r.variantId)).size!==rows.length)throw Error('Измерения звуковых файлов повторяются.');for(const row of rows){const layer=getSoundLayer(p,row.layerId),variant=layer.variants.find(v=>v.id===row.variantId&&!v.removedAt);if(!variant)throw Error('Измеренный звуковой файл не найден.');await asset(user,variant.assetId,p);variant.seconds=row.seconds;}}
      const layers=soundscape(p).layers.filter(l=>!l.removedAt&&l.settings.enabled&&l.selectedId&&!soundLayerIssue(l)&&!soundLayerApproved(l));if(!layers.length)throw Error('Нет выбранных готовых звуковых слоёв для утверждения.');
      for(const layer of layers)approveSoundLayer(p,layer.id);break;
    }
    case 'generate':await getKey(user,'elevenlabs');queueSoundGeneration(p,identity.parse(v.batchId),identity.parse(v.layerId),v.generation);break;
    case 'stop':stopSoundscape(p,identity.parse(v.jobId));break;
    case 'allowNewSeries':{
      const job=soundJobs(p).find(j=>j.id===identity.parse(v.jobId));if(!job||job.status!=='unknown')throw Error('Запрос с неизвестным исходом не найден.');job.newSeriesAllowedAt=now();break;
    }
    case 'removeVariant':case 'restoreVariant':removeSoundVariant(p,identity.parse(v.layerId),identity.parse(v.variantId),body.action==='restoreVariant');break;
    case 'removeLayer':case 'restoreLayer':{
      const layer=getSoundLayer(p,identity.parse(v.layerId),true);if(body.action==='removeLayer'){
        if(soundJobs(p).some(j=>j.itemId===layer.id&&['queued','dispatching','saving'].includes(j.status)))throw Error('Сначала остановите незавершённые попытки звукового слоя.');
        layer.removedAt=now();layer.selectedId=undefined;layer.approvedId=undefined;layer.approvedBasis=undefined;
      }else layer.removedAt=undefined;break;
    }
  }
  return Response.json(await saveProject(user,p,p.revision));
});
