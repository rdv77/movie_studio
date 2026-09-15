import { strict as assert } from 'node:assert';
import { build } from 'esbuild';

await build({
  stdin: { resolveDir: process.cwd(), contents: "export {projectAssetIds} from './lib/project-assets'; export {newProject,makeVariant,id} from './lib/domain';" },
  bundle: true, platform: 'node', format: 'esm', outfile: 'work/tests/project-assets.mjs',
});
const { projectAssetIds, newProject, makeVariant, id } = await import('../work/tests/project-assets.mjs');
const p = newProject('Изолированный фильм');
assert.deepEqual([...projectAssetIds(p)], [], 'A genuinely new project must not inherit any files');

const expected = new Set(), unrelated = new Set();
const asset = () => { const value = id(); expected.add(value); return value; };
const other = () => { const value = id(); unrelated.add(value); return value; };
const profile = () => ({ name: other(), appearance: other(), description: other(), instructions: other(), refs: [asset()] });
const addVariant = (item, extra = {}) => {
  const value = makeVariant(p, item, {
    id: other(), title: other(), kind: 'image', assetId: asset(), refs: [asset()],
    characterRefs: [asset()], character: profile(), text: other(), model: other(),
    jobId: other(), shotSource: other(), voiceId: other(), camera: other(),
    continuity: other(), dialogue: other(), deps: other(), ...extra,
  });
  return value;
};
const [active, archived, removed] = p.items;
active.character = profile();
active.variants.push(addVariant(active), addVariant(active));
active.selectedId = active.variants[0].id;
active.approvedId = active.variants[0].id;
archived.planArchive = { reason: 'duplicate', replacementId: other() };
archived.character = profile();
archived.variants.push(addVariant(archived));
removed.removedAt = new Date().toISOString();
removed.character = profile();
removed.variants.push(addVariant(removed));
p.removedVariants = [{ itemId: other(), variant: addVariant(active), removedAt: new Date().toISOString() }];
p.animatic = { variants: [addVariant(active)], removedVariants: [addVariant(active)] };

// Actual animaticBasis() layout: retain only clip/audio file slots, never the
// surrounding variant IDs, voice indexes, speakers or arbitrary JSON content.
const sourceRow = () => [other(), asset(), 5, 0, 0, 1, 'character', other()];
p.animatic.variants[0].animaticBasis = JSON.stringify([0, '16:9', 45, 'plans', [sourceRow()], [sourceRow()], [other()]]);
const basisOnly = asset();
p.animatic.removedVariants[0].animaticBasis = JSON.stringify([0, '9:16', 45, 'track', [[other(), basisOnly, 5, 0, 0, 1, null, null]], [], []]);
active.variants[0].lipsync = { audioVariantId: other(), audioItemId: other(), videoVariantId: other() };
active.variants[1].lipsync = { inputType: 'image', audioVariantId: other(), audioItemId: other(), imageVariantId: other(), imageItemId: other(), speaker: { x: .5, y: .5 }, prompt: other() };

const addJob = (kind, status, extra = {}) => {
  const job = {
    id: kind === 'text' ? other() : asset(), itemId: other(), batchId: other(),
    kind, status, refs: [asset()], characterRefs: [asset()], character: profile(),
    model: other(), prompt: other(), brief: other(), voiceId: other(), voiceName: other(),
    shotSource: other(), requestId: other(), pollingUrl: 'https://invalid.test/' + other(),
    output: { url: 'https://invalid.test/' + other(), text: other(), mime: 'image/png' },
    usage: { assetId: other(), refs: [other()] }, error: other(), actualSource: other(),
    created: new Date().toISOString(), camera: '', continuity: '', offset: 0, volume: 1,
    dialogue: '', duration: 5, deps: other(), estimate: null, actual: null, ...extra,
  };
  p.jobs.push(job); return job;
};
for (const status of ['queued', 'dispatching', 'pending', 'saving', 'done', 'failed', 'unknown', 'cancelled']) {
  for (const kind of ['image', 'audio', 'video']) addJob(kind, status);
}
addJob('text', 'done');
const videoSync = addJob('video', 'failed', { lipsync: {
  videoVariantId: other(), audioVariantId: other(), audioItemId: other(),
  videoAssetId: asset(), audioAssetId: asset(), seconds: 5,
} });
addJob('video', 'unknown', { lipsync: {
  inputType: 'image', imageVariantId: other(), imageItemId: other(), audioVariantId: other(), audioItemId: other(),
  imageAssetId: asset(), audioAssetId: asset(), seconds: 5, imageWidth: 1024, imageHeight: 1024,
  speaker: { x: .5, y: .5 }, prompt: other(),
} });
const voiceJob = addJob('audio', 'unknown', { purpose: 'voice-test' });
p.voiceComparisons = [
  { id: voiceJob.itemId, phrase: other(), created: new Date().toISOString(), samples: [
    { jobId: voiceJob.id, model: other(), voiceId: other(), name: other() },
    { jobId: other(), model: other(), voiceId: other(), name: other(), assetId: asset() },
  ] },
  { id: other(), phrase: other(), created: new Date().toISOString(), removedAt: new Date().toISOString(), samples: [
    { jobId: other(), model: other(), voiceId: other(), name: other(), assetId: asset() },
  ] },
];
p.preferredVoice = { model: other(), voiceId: other(), name: other() };
p.id = other(); p.title = other();
p.extra = { assetId: other(), refs: [other()] };

const before = JSON.stringify(p);
const found = projectAssetIds(p);
assert.deepEqual(found, expected, 'All persisted media references and recoverable job outputs are included');
assert.equal(JSON.stringify(p), before, 'Collection must not migrate or mutate the snapshot');
for (const value of unrelated) assert(!found.has(value), `Non-asset identifier must not grant membership: ${value}`);
assert(found.has(voiceJob.id), 'A saved voice-test output remains recoverable before sample.assetId is recorded');
assert(found.has(videoSync.lipsync.videoAssetId), 'Legacy video lipsync without inputType is supported');
assert(found.has(basisOnly), 'Historical animatic source files survive independently of current variants');

const emptyLegacy = newProject('Старый пустой фильм');
const blankVariant = makeVariant(emptyLegacy, emptyLegacy.items[0], { text: 'Only text', refs: [] });
delete blankVariant.refs;
blankVariant.assetId = '';
blankVariant.characterRefs = [null, '', 1, {}, []];
blankVariant.animaticBasis = 'broken JSON';
emptyLegacy.items[0].variants.push(blankVariant);
assert.equal(projectAssetIds(emptyLegacy).size, 0, 'Missing optional legacy fields and malformed empty references add nothing');
for (const badBasis of [
  JSON.stringify({ assetId: other(), refs: [other()] }),
  JSON.stringify([0, '16:9', 45, 'plans', [[other(), other()]], [], []]),
  JSON.stringify([other(), '16:9', 45, 'plans', [[other(), other(), 5, 0, 0, 1, null, null]], [], []]),
]) {
  blankVariant.animaticBasis = badBasis;
  assert.equal(projectAssetIds(emptyLegacy).size, 0, 'Unknown animatic JSON shapes are never recursively scanned');
}
// Invalid/missing kinds cannot make arbitrary job identifiers into file IDs.
emptyLegacy.jobs = [{ id: other(), kind: 'text', purpose: 'voice-test', refs: [] }, { id: other(), refs: [] }];
assert.equal(projectAssetIds(emptyLegacy).size, 0);

const duplicate = active.variants[0].assetId;
active.variants[0].refs.push(duplicate, duplicate);
assert.deepEqual(projectAssetIds(p), expected, 'The collector deduplicates shared and imported references');
found.clear();
assert.deepEqual(projectAssetIds(p), expected, 'Calls return independent sets');
assert.equal(projectAssetIds(newProject('Другой новый фильм')).size, 0, 'No state is shared between projects');
console.log('PASS project asset candidates: blank projects, all archived/removed/character/job/sync/voice/animatic sources, paid-output recovery, no arbitrary UUID scanning or snapshot mutation.');
