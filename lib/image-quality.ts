import { z } from 'zod';

export const GROK_IMAGE_MODEL = 'grok-imagine-image-2.0';
export const imageSettingsSchema = z.object({
  quality: z.enum(['low', 'medium']),
  resolution: z.enum(['1k', '2k']),
});
export type ImageSettings = z.infer<typeof imageSettingsSchema>;
export const FINAL_IMAGE_SETTINGS: ImageSettings = { quality: 'medium', resolution: '2k' };
// Missing parameters in saved jobs mean the historical request, never a paid upgrade.
export const LEGACY_IMAGE_SETTINGS: ImageSettings = { quality: 'low', resolution: '1k' };
export const GROK_PRICING_DATE = '2026-10-01';

export function grokImageEstimate(settings: ImageSettings = FINAL_IMAGE_SETTINGS, refCount = 0): string {
  const value = imageSettingsSchema.parse(settings);
  if (!Number.isInteger(refCount) || refCount < 0 || refCount > 5) throw Error('Grok: допустимо до пяти референсов.');
  const output = value.quality === 'medium' ? (value.resolution === '2k' ? 800000000n : 600000000n)
    : value.resolution === '2k' ? 600000000n : 400000000n;
  return (output + BigInt(refCount) * 100000000n).toString();
}
export function imageSettingsLabel(settings: ImageSettings): string {
  return `${settings.quality === 'medium' ? 'Финальный' : 'Черновой'} · ${settings.quality} / ${settings.resolution.toUpperCase()}`;
}
