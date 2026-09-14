import { api, owner, loadProject, saveProject, getKey } from '@/lib/server';
import { id, now, stageReady, dependencies, assertBudget, type Job } from '@/lib/domain';
import { speechPlans, speechCharacters } from '@/lib/speech';
import { spokenText } from '@/lib/spoken-text';
import { model } from '@/lib/models';
import { z } from 'zod';
import { speechInfo, assertSpeech, speechNames } from '@/lib/speech-mode';
export const POST = api(async (req, ctx) => {
  const user = await owner(req, true);
  const original = await loadProject(user, (await ctx.params).id);
  const s = z.object({ revision: z.number().int(), batchId: z.string().uuid(), model: z.string(),
    voiceId: z.string().trim().min(1).max(150), estimate: z.string().regex(/^\d+$/).nullable(),
    plans: z.array(z.object({ frameId: z.string().uuid(), dialogue: z.string().trim().min(1).max(9500),
      speechType:z.enum(['voiceover','character']).optional(),speaker:z.string().trim().max(100).optional() })).min(1).max(20)
  }).parse(await req.json());
  if (original.jobs.some(j => j.batchId === s.batchId)) return Response.json(original);
  if (original.revision !== s.revision) throw new Error('Проект изменился. Откройте окно озвучки заново.');
  if (!stageReady(original, 6)) throw new Error('Сначала утвердите все кадры раскадровки.');
  if (original.jobs.some(j => ['queued','dispatching','pending','saving'].includes(j.status))) throw new Error('Дождитесь текущей серии.');
  const m = model(s.model);
  if (m.kind !== 'audio') throw new Error('Выберите модель озвучки.');
  if (new Set(s.plans.map(r => r.frameId)).size !== s.plans.length) throw new Error('Планы повторяются.');
  const p = structuredClone(original), rows = speechPlans(p);
  if (!rows.length) throw new Error('В сценарии нет реплик.');
  // All speech cards are required, even when only some are queued this time.
  for (const row of rows) if (!row.item) {
    if (p.items.length >= 120) throw new Error('В проекте максимум 120 материалов.');
    row.item = { id: id(), stage: 6, title: row.title, sourceShot: { scriptId: row.scriptId, title: row.title, scriptVersion:row.scriptVersion }, variants: [] };
    p.items.push(row.item);
  }
  const jobs: Job[] = s.plans.map(input => {
    const row = rows.find(r => r.frameId === input.frameId);
    if (!row || row.blocked) throw new Error('План недоступен или содержит попытку с неизвестным исходом.');
    const info=speechInfo({...row,...input});assertSpeech(info,input.dialogue);
    const dialogue = spokenText(input.dialogue, [...speechCharacters(p),info.speaker]);
    if (!dialogue) throw new Error('В реплике нет произносимого текста.');
    return { id: id(), batchId: s.batchId, itemId: row.item!.id, kind: 'audio', model: m.id,
      voiceId: s.voiceId, dialogue, ...info, brief: `${speechNames[info.speechType]}${info.speaker?' · '+info.speaker:''}: «${row.title}»`, prompt: dialogue, refs: [],
      duration: row.duration, offset: row.offset, volume: 1, camera: '', continuity: '',
      shotSource: row.scriptVersion, deps: dependencies(p, 6), created: now(), status: 'queued', transportVersion: 2,
      estimate: s.estimate, actual: null };
  });
  await getKey(user, m.provider);
  assertBudget(p, jobs);
  p.speechMode = 'plans'; p.jobs.push(...jobs);
  return Response.json(await saveProject(user, p, original.revision));
});
