import type { CharacterBrief, Project, Variant } from './domain';

/**
 * Asset candidates referenced by a trusted, already saved project snapshot.
 * Includes history so a removed variant/hero remains recoverable. This is not an
 * ownership check: callers must intersect the result with the owner's asset rows.
 * Validate incoming references before changing the snapshot used for this lookup.
 */
export function projectAssetIds(p: Project): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => { if (typeof value === 'string' && value.length) ids.add(value); };
  const refs = (values: unknown) => { if (Array.isArray(values)) for (const value of values) add(value); };
  const character = (value?: CharacterBrief) => refs(value?.refs);

  // animaticBasis() records [config, format, seconds, speech mode, clips, audio,
  // audio indexes]. Its source tuples contain an asset ID only at position 1.
  // Older source variants may no longer be present elsewhere in the snapshot.
  const animaticSources = (basis?: string) => {
    if (!basis) return;
    let value: unknown;
    try { value = JSON.parse(basis); } catch { return; }
    if (!Array.isArray(value) || value.length !== 7 || !Number.isSafeInteger(value[0]) ||
      !['16:9', '9:16'].includes(value[1]) || typeof value[2] !== 'number' ||
      !['track', 'plans'].includes(value[3]) || !Array.isArray(value[4]) ||
      !Array.isArray(value[5]) || !Array.isArray(value[6])) return;
    for (const rows of [value[4], value[5]]) {
      for (const row of rows) {
        if (Array.isArray(row) && row.length === 8 && typeof row[0] === 'string' &&
          row.slice(2, 6).every(number => typeof number === 'number' && Number.isFinite(number))) add(row[1]);
      }
    }
  };
  const variant = (value: Variant) => {
    add(value.assetId);
    refs(value.refs);
    refs(value.characterRefs);
    character(value.character);
    animaticSources(value.animaticBasis);
    // Variant.lipsync contains item/variant identifiers, not file identifiers.
  };

  for (const item of p.items) {
    character(item.character);
    // Deliberately include every variant, including unselected/unapproved ones,
    // and every item, including planArchive and removedAt entries.
    for (const value of item.variants) variant(value);
  }
  for (const removed of p.removedVariants ?? []) variant(removed.variant);
  for (const value of p.animatic?.variants ?? []) variant(value);
  for (const value of p.animatic?.removedVariants ?? []) variant(value);

  for (const job of p.jobs) {
    refs(job.refs);
    refs(job.characterRefs);
    character(job.character);
    if (job.lipsync) {
      add(job.lipsync.audioAssetId);
      if (job.lipsync.inputType === 'image') add(job.lipsync.imageAssetId);
      else add(job.lipsync.videoAssetId);
    }
    // storeAsset saves generated media under job.id before the project update.
    // Keep this candidate for all statuses (including a lost final save). Voice
    // tests are audio jobs whose itemId identifies a comparison, not an Item.
    if (job.kind === 'image' || job.kind === 'audio' || job.kind === 'video') add(job.id);
  }
  for (const comparison of p.voiceComparisons ?? []) {
    for (const sample of comparison.samples) add(sample.assetId);
  }
  return ids;
}
