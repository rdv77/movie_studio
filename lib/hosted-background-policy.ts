import type {Job} from './domain';
import {FAL_QWEN,FAL_H3,FAL_WAN,FAL_KLING} from './fal-models';
import {GROK_VIDEO_1080,promptCapacity,fitsPrompt} from './model-capabilities';
import {isGoogleVideo} from './google-models';
import {zenProfile} from './zencreator-models';

/**
 * Protocol allowlist, not a promise that every network submit finishes in 30s.
 * Each listed installed adapter returns a receipt without awaiting generation.
 * Recheck this policy when changing an adapter; unknown models stay foreground.
 */
export function hostedQueuedDispatchEligible(job:Job):boolean{
  // LLM completion must stay in the foreground; waitUntil only has a short tail.
  if(job.purpose==='prompt-optimization'||job.compilation?.budget.needsOptimization&&job.promptOptimization?.state!=='done')return false;
  // Queued jobs may predate a corrected endpoint limit. Recheck the frozen
  // prompt, rather than trusting its historical needsOptimization flag.
  if(!job.purpose&&!job.lipsync&&(job.kind==='image'||job.kind==='video')&&typeof job.prompt==='string'){
    const cap=promptCapacity(job.model,job.kind);
    const counted=cap.unit==='tokens'&&job.promptTokenCount?.text===job.prompt&&job.promptTokenCount.count<=cap.limit;
    if(!counted&&!fitsPrompt(job.prompt,cap))return false;
  }
  // These runners await the complete response, even if their selected model's
  // ordinary media adapter supports an asynchronous queue.
  if(job.purpose==='directing'||job.purpose==='general-scenario'||job.purpose==='voice-design'||job.soundInput||
    job.purpose==='music'||job.purpose==='music-ideas'||job.purpose==='media-review'||job.purpose==='cinema-research')return false;
  if(job.lipsync)return job.kind==='video'&&['sync-3','lipsync-2','lipsync-2-pro'].includes(job.model);
  if(job.model===FAL_QWEN)return job.kind==='image';
  if([FAL_H3,FAL_WAN,FAL_KLING].includes(job.model))return job.kind==='video';
  if(job.model==='flux-2-pro')return job.kind==='image';
  if(['MiniMax-H3','MiniMax-Hailuo-2.3','grok-imagine-video-1.5',GROK_VIDEO_1080].includes(job.model))return job.kind==='video';
  if(isGoogleVideo(job.model))return job.kind==='video';
  const zen=zenProfile(job.model);return !!zen&&zen.kind===job.kind;
}
