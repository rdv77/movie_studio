import { ProviderError } from './provider-http';

/** New endpoint/animatic jobs use an integer grid; existing jobs retain the six-second contract. */
export const VIDEO_DURATION_CONTRACTS: Record<string, { min: number; max: number; legacy: number; source: string; checked: string }> = {
  'grok-imagine-video-1.5': { min: 1, max: 15, legacy: 6, source: 'https://docs.x.ai/developers/model-capabilities/video/generation', checked: '2026-10-01' },
  'fal-kling-3.0-pro': {min:3,max:15,legacy:6,source:'https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api',checked:'2026-10-05'},
  'grok-imagine-video-1.5-1080p': {min:1,max:15,legacy:6,source:'https://docs.x.ai/developers/model-capabilities/video/generation',checked:'2026-10-05'},
  'MiniMax-H3': { min: 4, max: 15, legacy: 6, source: 'https://platform.minimax.io/docs/guides/video-generation', checked: '2026-10-01' },
  'fal-minimax-h3-max': { min: 5, max: 15, legacy: 6, source: 'https://fal.ai/models/minimax/h3-max/image-to-video/api', checked: '2026-10-01' },
};
export type VideoTiming = { requestedSeconds: number; planMaxSeconds: number; planSeconds: number; rounded: boolean; modern: boolean; source?: string };
export function videoRequestTiming(modelId: string, planSeconds: number, modern = false, fixedFallback = 6): VideoTiming {
  const contract = Object.hasOwn(VIDEO_DURATION_CONTRACTS, modelId) ? VIDEO_DURATION_CONTRACTS[modelId] : undefined;
  const useVariable = (modern || ['fal-kling-3.0-pro','grok-imagine-video-1.5-1080p'].includes(modelId)) && !!contract, max = useVariable ? contract.max : fixedFallback;
  if (!Number.isFinite(planSeconds) || planSeconds <= 0 || planSeconds > max)
    throw new ProviderError(`План длится ${Number.isFinite(planSeconds) ? planSeconds : 'неизвестное число'} сек, а этот режим создаёт до ${max} сек. Разделите план или выберите другую модель. Речь не обрезана; запрос не отправлен.`, true, true);
  // Ceil never shortens the director's duration. Grok's studio adapter uses the
  // same integer grid; this is a conservative studio choice, not an upstream restriction.
  const requestedSeconds = useVariable ? Math.max(contract.min, Math.ceil(planSeconds)) : fixedFallback;
  return { requestedSeconds, planMaxSeconds: max, planSeconds, rounded: requestedSeconds !== planSeconds, modern: useVariable, source: contract?.source };
}
export const modernVideoTiming = (job: { endFrameAssetId?: string; videoPreparationBasis?: string }) => !!(job.endFrameAssetId || job.videoPreparationBasis);

/** Existing six-second catalog price is a conservative reservation, never an actual charge. */
export function scaledVideoReservation(baseline: string | null | undefined, selected: string | null | undefined, requestedSeconds: number): string | null {
  if (baseline == null) return selected ?? null;
  if (!/^\d+$/.test(baseline) || selected != null && !/^\d+$/.test(selected) || !Number.isFinite(requestedSeconds) || requestedSeconds <= 0)
    throw Error('Некорректная смета или длительность видеоплана. Запрос не отправлен.');
  const integerSeconds = Math.ceil(Math.max(6, requestedSeconds));
  const minimum = (BigInt(baseline) * BigInt(integerSeconds) + 5n) / 6n;
  return selected != null && BigInt(selected) > minimum ? selected : minimum.toString();
}

/** Installed Grok adapter requests 720p: $0.14/output second + $0.01/input image. */
export function grokVideoReservation(requestedSeconds: number, imageCount: number, selected?: string | null, resolution:'720p'|'1080p'='720p'): string {
  if (!Number.isInteger(requestedSeconds) || requestedSeconds < 1 || requestedSeconds > 15 || !Number.isInteger(imageCount) || imageCount < 1 || imageCount > 9 || selected != null && !/^\d+$/.test(selected))
    throw Error('Grok Video: некорректная длительность, число изображений или смета. Запрос не отправлен.');
  const minimum = BigInt(requestedSeconds) * (resolution==='1080p'?2500000000n:1400000000n) + BigInt(imageCount) * 100000000n;
  return selected != null && BigInt(selected) > minimum ? selected : minimum.toString();
}
