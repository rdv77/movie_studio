import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
await mkdir('work/tests', { recursive: true });
await build({
  entryPoints: ['lib/domain.ts', 'lib/render.ts', 'lib/providers.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outdir: 'work/tests',
  outExtension: { '.js': '.mjs' },
  external: ['@ffmpeg/ffmpeg'],
});
const D = await import('../work/tests/domain.mjs');
const R = await import('../work/tests/render.mjs');
const P = await import('../work/tests/providers.mjs');
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log('PASS', name);
}
let project = D.newProject('Проверка');
test('cannot skip director approval', () =>
  assert.throws(() =>
    D.addVariant(project, project.items[1].id, { text: 'герой' }),
  ));
for (const i of project.items) {
  D.addVariant(project, i.id, { text: 'Материал ' + i.stage });
  D.approve(project, i.id);
}
test('all stages approved in dependency order', () =>
  assert(project.items.every((i) => D.isApproved(project, i))));
const first = project.items[0],
  original = first.approvedId;
D.addVariant(project, first.id, { text: 'Новая история' });
test('selection alone does not revoke approval', () => {
  assert.equal(first.approvedId, original);
  assert(D.isApproved(project, project.items[8]));
});
D.approve(project, first.id);
test('new script preserves creative approvals and invalidates production without losing variants', () => {
  assert(!D.isApproved(project, project.items[8]));
  assert.equal(project.items[8].variants.length, 1);
  assert(project.items.slice(1,4).every(i=>D.isApproved(project,i)));
  assert.throws(() => D.approve(project, project.items[4].id));
});
test('money uses exact integer ticks', () => {
  assert.equal(D.ticks('0.0000000001'), '1');
  assert.equal(D.ticks('0.85'), '8500000000');
  assert.throws(() => D.ticks('-1'));
  assert.throws(() => D.ticks('0.12345678901'));
});
test('unknown charges are not zero and prevent bounded batches', () => {
  const p = D.newProject('Стоимость');
  p.limit = D.ticks('10');
  p.jobs = [{ status: 'unknown', actual: null, estimate: D.ticks('1') }];
  assert.equal(D.totals(p).unknown, 1);
  assert.throws(() => D.assertBudget(p, [{ estimate: D.ticks('1') }]));
});
test('reservations include every paid attempt, even unselected', () => {
  const p = D.newProject('Стоимость');
  p.limit = D.ticks('2');
  p.jobs = [
    { status: 'done', actual: D.ticks('1'), estimate: null },
    {
      status: 'queued',
      actual: null,
      estimate: D.ticks('.5'.replace('.', '0.')),
    },
  ];
  assert.throws(() => D.assertBudget(p, [{ estimate: D.ticks('0.6') }]));
  D.assertBudget(p, [{ estimate: D.ticks('0.5') }]);
});
const calls = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  return Response.json({
    request_id: 'known-id',
    usage: { cost_in_usd_ticks: 8500000000 },
  });
};
const j = {
  model: 'grok-imagine-video-1.5',
  kind: 'video',
  prompt: '[Push in]',
  duration: 6,
};
const receipt = await P.generate(
  j,
  'test-key',
  ['data:image/png;base64,AA=='],
  '16:9',
);
test('Grok i2v contract preserves first frame, prompt and cost', () => {
  const b = JSON.parse(calls[0].opts.body);
  assert.equal(calls[0].url, 'https://api.x.ai/v1/videos/generations');
  assert.equal(b.image.url, 'data:image/png;base64,AA==');
  assert.equal(b.duration, 6);
  assert.equal(receipt.requestId, 'known-id');
  assert.equal(receipt.actual, '8500000000');
});
globalThis.fetch = async () => {
  throw new Error('network');
};
await assert.rejects(
  () => P.generate(j, 'test-key', ['ref'], '16:9'),
  (e) => e instanceof P.ProviderError && !e.definite,
);
console.log(
  'PASS ambiguous network response is never considered a definite failure',
);
count++;
globalThis.fetch = nativeFetch;
const p = D.newProject('Монтаж');
for (const i of p.items) {
  D.addVariant(p, i.id, {
    text: 'материал',
    ...(i.stage === 7 ? { kind: 'video', assetId: 'test', duration: 50 } : {}),
  });
  D.approve(p, i.id);
}
test('editing plan validates approved media and duration', () => {
  assert.equal(R.editPlan(p).seconds, 50);
  p.items[7].variants[0].duration = 20;
  assert.throws(() => R.editPlan(p));
});
test('sound is stripped from generated video and voice timing is explicit', () => {
  assert(
    R.clipArgs({ trim: 1, duration: 5 }, 0, 1920, 1080, false).includes('-an'),
  );
  assert(
    R.audioArgs(
      [{ trim: 0, duration: 5, offset: 2, volume: 0.5 }],
      50,
    ).includes(
      '[1:a]atrim=start=0:duration=5,asetpts=PTS-STARTPTS,volume=0.5,adelay=2000:all=1[a0];[a0]amix=inputs=1:normalize=0,alimiter=limit=0.95,apad[mix]',
    ),
  );
});
const voiced = D.newProject('Аниматик с речью');
for (const i of voiced.items) {
  if (i.stage > 6) break;
  D.addVariant(voiced, i.id, {
    text: 'Материал',
    ...(i.stage === 5 ? { kind: 'image', assetId: 'frame', duration: 50 } : {}),
    ...(i.stage === 6 ? { kind: 'audio', assetId: 'voice', duration: 50 } : {}),
  });
  D.approve(voiced, i.id);
}
test('animatic includes approved speech and never silently drops stale audio', () => {
  assert.equal(R.editPlan(voiced, true).audio[0].assetId, 'voice');
  const stale = structuredClone(voiced);
  D.addVariant(stale, stale.items[5].id, { text: 'Другой кадр', kind: 'image', assetId: 'new-frame', duration: 50 });
  D.approve(stale, stale.items[5].id);
  assert.throws(() => R.editPlan(stale, true), /Выбранная озвучка.*прежней раскадровке/);
  const audio = stale.items[6].variants[0];
  D.addVariant(stale, stale.items[6].id, { ...audio, id: D.id(), deps: D.dependencies(stale, 6) });
  D.approve(stale, stale.items[6].id);
  assert.equal(R.editPlan(stale, true).audio[0].assetId, 'voice');
});
test('animatic previews selected current speech without approving it, but rejects missing, muted, or out-of-range audio', () => {
  const unapproved = structuredClone(voiced);
  unapproved.items[6].approvedId = undefined;
  assert.equal(R.editPlan(unapproved, true).audio[0].assetId, 'voice');
  assert.equal(unapproved.items[6].approvedId, undefined);
  const unselected = structuredClone(unapproved);
  unselected.items[6].selectedId = undefined;
  assert.throws(() => R.editPlan(unselected, true), /Выберите аудиозапись для аниматика/);
  const muted = structuredClone(voiced);
  muted.items[6].variants[0].volume = 0;
  assert.throws(() => R.editPlan(muted, true), /громкость равна нулю/);
  muted.items[6].variants[0].volume = 1;
  muted.items[6].variants[0].offset = 50;
  assert.throws(() => R.editPlan(muted, true), /после конца фильма/);
});
test('saving an animatic preserves voice selection and approval', () => {
  const s = structuredClone(voiced), item = s.items[6];
  const selected = item.selectedId, approved = item.approvedId;
  const preview = D.addAnimatic(s, item.id, { title: 'Аниматик', kind: 'video', assetId: 'preview', duration: 50 });
  assert.equal(item.selectedId, selected);
  assert.equal(item.approvedId, approved);
  assert.equal(R.editPlan(s, true).audio[0].assetId, 'voice');
  item.selectedId = preview.id;
  assert.throws(() => D.approve(s, item.id), /Утвердите аудиозапись/);
  assert.equal(item.approvedId, approved);
});
// Exercise the actual single-thread WASM engine; this is not a browser UI test.
globalThis.self = {
  location: {
    href: pathToFileURL(process.cwd() + '/public/ffmpeg/ffmpeg-core.js').href,
  },
};
const { default: createCore } = await import('../public/ffmpeg/ffmpeg-core.js');
const core = await createCore({
  wasmBinary: new Uint8Array(
    await readFile('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm'),
  ),
});
let log = [];
core.setLogger(({ message }) => log.push(message));
function exec(args) {
  core.reset();
  const result = core.exec(...args);
  if (result !== 0) throw new Error(log.slice(-12).join('\n'));
}
exec([
  '-f',
  'lavfi',
  '-i',
  'color=c=black:s=320x180:r=24',
  '-t',
  '25',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-threads',
  '1',
  '-f',
  'mp4',
  'in0',
]);

exec(R.clipArgs({ trim: 0, duration: 25 }, 0, 320, 180, false));
core.FS.writeFile('in1', core.FS.readFile('in0'));
exec(R.clipArgs({ trim: 0, duration: 25 }, 1, 320, 180, false));
core.FS.writeFile(
  'list.txt',
  new TextEncoder().encode("file 'clip0.mp4'\nfile 'clip1.mp4'"),
);
exec([
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  'list.txt',
  '-c',
  'copy',
  'silent.mp4',
]);
exec([
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=2',
  '-f',
  'mp3',
  'audio0',
]);
exec(R.audioArgs([{ trim: 0, duration: 2, offset: 1, volume: 0.2 }], 50));
core.reset();
core.ffprobe(
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'default=noprint_wrappers=1:nokey=1',
  '-o',
  'duration.txt',
  'film.mp4',
);
const duration = Number(
  new TextDecoder().decode(core.FS.readFile('duration.txt')),
);
assert(Math.abs(duration - 50) < 0.2);
assert(core.FS.readFile('film.mp4').length > 1000);
core.reset();
core.ffprobe('-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'json', '-o', 'audio-probe.json', 'film.mp4');
const streams = JSON.parse(new TextDecoder().decode(core.FS.readFile('audio-probe.json'))).streams;
assert.equal(streams[0].codec_name, 'aac');
log = [];
exec(['-v', 'info', '-i', 'film.mp4', '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
assert(log.some((line) => /max_volume: -?\d+(\.\d+)? dB/.test(line)), 'Rendered audio must contain audible samples');
await writeFile('work/tests/assembly-test.mp4', core.FS.readFile('film.mp4'));
console.log(
  'PASS actual FFmpeg WASM: two clips + voice track → ' + duration + ' sec MP4',
);
count++;
console.log(count + ' checks passed. No paid API requests.');
