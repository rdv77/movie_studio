import type { Job, Project } from './domain';
import { getItem } from './domain';
import { GROK_IMAGE_MODEL, grokImageEstimate } from './image-quality';
import { compilePrompt, type CompiledPrompt, type PromptInput } from './prompt-compiler';
import { model } from './models';
import { grokVideoReservation, modernVideoTiming, scaledVideoReservation } from './video-duration';
import {captureVideoPreparationBasis} from './video-preparation-basis';
import type {KeyframeJob} from './keyframes';

/** Compact provenance saved with both the attempt and its resulting variant. */
export type PromptCompilationSnapshot = {
  compilerVersion: 1;
  kind: 'image' | 'video';
  keyframe?: 'start' | 'middle' | 'end';
  modelId: string;
  budget: CompiledPrompt['budget'];
  compression: CompiledPrompt['compression'];
  warnings: string[];
  references: CompiledPrompt['references'];
  duration?: CompiledPrompt['capability']['duration'];
};
export type CompiledMediaJob = Job & { compilation: PromptCompilationSnapshot; endFrameAssetId?: string; providerDuration?: number };
export type MediaJobInput = Partial<Omit<PromptInput, 'kind' | 'prompt'>> & { variantIndex?: number; variantCount?: number };

export function mediaVariantPrompt(brief: string, index = 1, count = 1): string {
  if (!Number.isInteger(count) || count < 1 || count > 4 || !Number.isInteger(index) || index < 1 || index > count)
    throw Error('В серии допустимо от одного до четырёх вариантов от каждой модели.');
  return brief + (count > 1 ? `\n\nСоздай самостоятельный вариант ${index} из ${count}, сохраняя обязательные признаки текущего плана.` : '');
}

export function compilationSnapshot(result: CompiledPrompt, keyframe?: 'start' | 'middle' | 'end'): PromptCompilationSnapshot {
  return {
    compilerVersion: 1, kind: result.capability.kind, keyframe, modelId: result.capability.modelId,
    budget: { ...result.budget },
    compression: { ...result.compression, omitted: result.compression.omitted.map(x => ({ ...x })), includedKeys: [...result.compression.includedKeys] },
    warnings: [...result.warnings], references: result.references.map(x => ({ ...x })),
    ...(result.capability.duration?{duration:{...result.capability.duration}}:{}),
  };
}

/** Run only while creating a NEW visual job. Saved/unknown attempts must never be recompiled. */
export function compileMediaJob(p: Project, job: Job, input: MediaJobInput = {}): CompiledMediaJob {
  if (job.kind !== 'image' && job.kind !== 'video') throw Error('Сборщик визуальных промптов принимает только изображения и видеопланы.');
  const item = getItem(p, job.itemId);
  const refs = input.references ?? [
    ...job.refs.map(assetId => ({ assetId, ...(job.kind === 'video' ? { role: 'first-frame' as const } : {}) })),
    ...(job.characterRefs ?? []).map(assetId => ({ assetId, role: 'character' as const })),
  ];
  const count = input.variantCount ?? 1, index = input.variantIndex ?? 1;
  const prompt = mediaVariantPrompt(job.brief, index, count);
  const sourceFrame = job.kind === 'image' && input.keyframe && input.keyframe !== 'start'
    ? item.variants.find(v => v.id === (job as KeyframeJob).sourceFrameVariantId && v.kind === 'image' && v.assetId && job.refs.includes(v.assetId)) : undefined;
  const result = compilePrompt(p, item, job.model, {
    ...input, kind: job.kind, prompt, references: refs,
    startFrameId: input.startFrameId ?? (job.kind === 'video' ? job.refs[0] : sourceFrame?.assetId),
    endFrameId: input.endFrameId ?? (job as Job & { endFrameAssetId?: string }).endFrameAssetId,
    characterIds: input.characterIds ?? job.characterIds,
    duration: input.duration ?? (job.kind === 'video' ? job.duration : undefined),
    // Older, non-directing projects retain their existing compact models. New directing hides them.
    allowLegacyModel: input.allowLegacyModel ?? !p.directing,
  });
  const first = result.references.find(ref => ref.role === 'first-frame');
  const last = result.references.find(ref => ref.role === 'last-frame');
  const auxiliary = result.references.filter(ref => ref.role !== 'first-frame' && ref.role !== 'last-frame').map(ref => ref.assetId);
  const output: CompiledMediaJob = {
    ...job, prompt: result.prompt,
    refs: job.kind === 'video' ? [first!.assetId] : result.references.map(ref => ref.assetId),
    characterRefs: job.kind === 'video' && auxiliary.length ? auxiliary : undefined,
    compilation: compilationSnapshot(result, job.kind === 'image' ? input.keyframe ?? 'start' : undefined),
    endFrameAssetId: job.kind === 'video' ? last?.assetId : undefined,
    ...(job.kind==='video'?{providerDuration:result.capability.duration!.requestedSeconds}:{}),
  };
  if(job.kind==='video'&&item.videoPreparation)output.videoPreparationBasis=captureVideoPreparationBasis(p,item,output);
  if (job.model === GROK_IMAGE_MODEL) output.estimate = grokImageEstimate(job.imageSettings, output.refs.length);
  if (job.kind==='video' && (last || modernVideoTiming(job) || item.videoPreparation))
    output.estimate=job.model==='grok-imagine-video-1.5'?grokVideoReservation(output.providerDuration!,result.references.length,job.estimate)
      : scaledVideoReservation(model(job.model).estimate,job.estimate,output.providerDuration!);
  return output;
}
