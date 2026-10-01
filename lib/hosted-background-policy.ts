import type {Job} from './domain';
import {FAL_QWEN,FAL_H3,FAL_WAN} from './fal-models';
import {isGoogleVideo} from './google-models';
import {zenProfile} from './zencreator-models';

/**
 * Protocol allowlist, not a promise that every network submit finishes in 30s.
 * Each listed installed adapter returns a receipt without awaiting generation.
 * Recheck this policy when changing an adapter; unknown models stay foreground.
 */
export function hostedQueuedDispatchEligible(job:Job):boolean{
  // These runners await the complete response, even if their selected model's
  // ordinary media adapter supports an asynchronous queue.
  if(job.purpose==='directing'||job.purpose==='voice-design'||job.soundInput||
    job.purpose==='music'||job.purpose==='music-ideas'||job.purpose==='media-review')return false;
  if(job.lipsync)return job.kind==='video'&&['sync-3','lipsync-2','lipsync-2-pro'].includes(job.model);
  if(job.model===FAL_QWEN)return job.kind==='image';
  if([FAL_H3,FAL_WAN].includes(job.model))return job.kind==='video';
  if(job.model==='flux-2-pro')return job.kind==='image';
  if(['MiniMax-H3','MiniMax-Hailuo-2.3','grok-imagine-video-1.5'].includes(job.model))return job.kind==='video';
  if(isGoogleVideo(job.model))return job.kind==='video';
  const zen=zenProfile(job.model);return !!zen&&zen.kind===job.kind;
}
