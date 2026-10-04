import {getItem,makeVariant,isStoryboardDraft,type Project,type Job} from './domain';
import {model} from './models';
import type {PromptCompilationSnapshot} from './prompt-jobs';

/** The same immutable generation basis is used for normal completion and
 * recovery of a file already stored before a failed final project write. */
export function finishItemMediaJob(p:Project,job:Job,assetId?:string,text?:string){
  const jobId=job.id,item=getItem(p,job.itemId);
  if(!item.variants.some(v=>v.jobId===jobId)){
    const compilation=(job as Job&{compilation?:PromptCompilationSnapshot}).compilation;
    const v=makeVariant(p,item,{
      ...(compilation?{compilation}:{}),keyframe:job.keyframe,pairId:job.pairId,sourceFrameVariantId:job.sourceFrameVariantId,keyframeSourceBasis:job.keyframeSourceBasis,keyframeReviewBasis:job.keyframeReviewBasis,endFrameAssetId:job.endFrameAssetId,
      id:jobId,reviewBasis:job.reviewBasis,basisVersion:job.basisVersion,versionInfo:job.versionInfo,
      title:model(job.model).name+(job.lipsync?.inputType==='image'?' · из кадра':'')+' · '+(item.variants.length+1),
      text:text??job.brief,kind:job.kind,shotSource:job.shotSource,assetId,model:job.model,
      imageSettings:job.imageSettings,refs:job.refs,character:job.character,location:job.location,
      characterRefs:job.characterRefs,characterIds:job.characterIds,dialogue:job.dialogue,
      speechType:job.speechType,speaker:job.speaker,voiceId:job.voiceId,
      voiceDelivery:job.voiceDelivery,voiceProfileId:job.voiceProfileId,ttsRequestText:job.ttsRequestText,
      videoPreparationBasis:job.videoPreparationBasis,duration:job.duration,providerDuration:job.providerDuration,
      camera:job.camera,continuity:job.continuity,offset:job.offset,volume:job.volume,deps:job.deps,jobId,
      lipsync:job.lipsync?(job.lipsync.inputType==='image'
        ?{inputType:'image',imageVariantId:job.lipsync.imageVariantId,imageItemId:job.lipsync.imageItemId,speaker:job.lipsync.speaker,prompt:job.lipsync.prompt,audioVariantId:job.lipsync.audioVariantId,audioItemId:job.lipsync.audioItemId}
        :{videoVariantId:job.lipsync.videoVariantId,audioVariantId:job.lipsync.audioVariantId,audioItemId:job.lipsync.audioItemId}):undefined,
    });
    item.variants.push(v);
    const previousSelection=item.variants.find(value=>value.id===item.selectedId);
    if(item.stage===5&&job.keyframe){const field=job.keyframe==='start'?'startId':job.keyframe==='middle'?'middleId':'endId';if(!item.keyframeSelection?.[field])item.keyframeSelection={...item.keyframeSelection,[field]:v.id};}
    if((!job.keyframe||job.keyframe==='start')&&(!item.selectedId||(item.stage===5&&v.kind==='image'&&v.assetId&&previousSelection&&isStoryboardDraft(previousSelection))))item.selectedId=v.id;
  }
  job.waitStoppedAt=undefined;job.waitStopReason=undefined;job.resumeStatus=undefined;
  job.status='done';job.error=undefined;
}
