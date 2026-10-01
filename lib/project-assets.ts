import type { CharacterBrief, Project, Variant } from './domain';
import type {LocationProfile} from './world-assets';
// Only the persisted file slots are needed here; keep the collector independent
// of the later animatic renderer and its runtime schemas.
type SavedManifestSources={schemaVersion:1;projectId:string;clips:{frames?:{role:string;assetId:string}[]}[];audio:{assetId:string}[];soundscape?:{assetId:string}[];music?:{assetId:string}};

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
  const location=(value?:LocationProfile)=>{refs(value?.refs);for(const angle of value?.approvedAngles??[])refs(angle.refs);};
  const provenance=(value?:Variant['versionInfo'])=>{for(const source of value?.sources??[])add(source.assetId);};

  // animaticBasis() records [config, format, seconds, speech mode, clips, audio,
  // audio indexes]. Its source tuples contain an asset ID only at position 1.
  // Older source variants may no longer be present elsewhere in the snapshot.
  const animaticSources = (basis?: string) => {
    if (!basis) return;
    let value: unknown;
    try { value = JSON.parse(basis); } catch { return; }
    if (!Array.isArray(value) || value.length < 7 || !Number.isSafeInteger(value[0]) ||
      !['16:9', '9:16'].includes(value[1]) || typeof value[2] !== 'number' ||
      !['track', 'plans'].includes(value[3]) || !Array.isArray(value[4]) ||
      !Array.isArray(value[5]) || !Array.isArray(value[6])) return;
    for (const rows of [value[4], value[5]]) {
      for (const row of rows) {
        if (Array.isArray(row) && row.length === 8 && typeof row[0] === 'string' &&
          row.slice(2, 6).every(number => typeof number === 'number' && Number.isFinite(number))) add(row[1]);
      }
    }
    // R09 appends a role-set snapshot. Inspect only its documented asset slots;
    // captions, variant IDs and arbitrary nested JSON never grant membership.
    for(const extra of value.slice(7))if(Array.isArray(extra))for(const set of extra){
      if(!set||typeof set!=='object'||typeof set.id!=='string'||!['single','pair','triple'].includes(set.mode)||!Array.isArray(set.frames)||set.frames.length!==3)continue;
      for(const frame of set.frames)if(Array.isArray(frame)&&frame.length===4&&typeof frame[0]==='string')add(frame[1]);
    }
  };
  const manifestSources=(value?:SavedManifestSources)=>{
    if(value?.schemaVersion!==1||value.projectId!==p.id||!Array.isArray(value.clips)||!Array.isArray(value.audio))return;
    for(const clip of value.clips)if(Array.isArray(clip?.frames))for(const frame of clip.frames)
      if(frame&&['start','middle','end'].includes(frame.role))add(frame.assetId);
    for(const audio of value.audio)add(audio?.assetId);
    for(const sound of value.soundscape??[])add(sound?.assetId);
    add(value.music?.assetId);
  };
  const variant = (value: Variant) => {
    add(value.assetId);
    add(value.endFrameAssetId);
    refs(value.refs);
    refs(value.characterRefs);
    character(value.character);
    location(value.location);provenance(value.versionInfo);
    animaticSources(value.animaticBasis);
    manifestSources((value as Variant&{animaticManifest?:SavedManifestSources}).animaticManifest);
    // Variant.lipsync contains item/variant identifiers, not file identifiers.
  };

  for (const item of p.items) {
    character(item.character);
    location(item.location);
    for(const version of item.characterHistory??[])character(version.profile);
    // Deliberately include every variant, including unselected/unapproved ones,
    // and every item, including planArchive and removedAt entries.
    for (const value of item.variants) variant(value);
  }
  for (const removed of p.removedVariants ?? []) variant(removed.variant);
  for (const value of [...p.music?.variants??[],...p.music?.removedVariants??[]]) variant(value);
  for (const value of p.animatic?.variants ?? []) variant(value);
  for (const value of p.animatic?.removedVariants ?? []) variant(value);

  for (const job of p.jobs) {
    refs(job.refs);
    add(job.endFrameAssetId);
    refs(job.characterRefs);
    character(job.character);
    location(job.location);provenance(job.versionInfo);
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
  for(const run of p.directing?.runs??[]){character(run.characterInput?.character);provenance(run.characterInput?.versionInfo);}
  for(const review of p.mediaReviews??[])for(const sample of review.samples??[])
    if(['target','start','end','reference','video-sample'].includes(sample.role))add(sample.assetId);
  for (const comparison of p.voiceComparisons ?? []) {
    for (const sample of comparison.samples) add(sample.assetId);
  }
  // Voice-design previews use their own file IDs. Retain deleted series/profile
  // history and late receipts for playback/recovery, never external Voice IDs.
  for(const design of p.voiceStudio?.designs??[])for(const preview of design.previews)add(preview.assetId);
  for(const profile of p.voiceStudio?.profiles??[])add(profile.previewAssetId);
  for(const job of p.jobs)for(const preview of job.voiceWorkflow?.previews??[])add(preview.assetId);
  // Sound layers keep uploaded/generated variants in recoverable history.
  // Scope IDs identify plans/scenes and never grant file membership.
  for(const layer of p.soundscape?.layers??[])for(const value of layer.variants)add(value.assetId);
  return ids;
}
