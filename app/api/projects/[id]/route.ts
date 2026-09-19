import { syncVideoPlans } from '@/lib/video';
import { approveBatch, approveSelectedSpeech } from '@/lib/bulk-approval';
import { reapproveVideo } from '@/lib/video-approval';
import { reapproveStyle } from '@/lib/style-approval';
import { reapproveScript } from '@/lib/script-approval';
import { reapproveStoryboard } from '@/lib/storyboard-approval';
import { reapproveSpeech } from '@/lib/speech-approval';
import { removeCharacter, restoreCharacter } from '@/lib/character-removal';
import { preparePlanCards } from '@/lib/storyboard';
import { api, owner, loadProject, saveProject, asset } from '@/lib/server';
import {
  addVariant,
  addAnimatic,
  approve,
  getItem,
  id as uid,
  makeVariant,
  dependencies,
  isApproved,
  deleteVariant,
  restoreVariant,
  type Kind,
} from '@/lib/domain';
import { z } from 'zod';
import { speechInfo, assertSpeech } from '@/lib/speech-mode';
import { saveAnimatic, approveAnimatic } from '@/lib/animatic';
import { archiveJournal } from '@/lib/journal';
const character = z.object({name:z.string().trim().min(1).max(100),appearance:z.string().trim().max(160).default(''),
  description:z.string().trim().max(4000).default(''),instructions:z.string().trim().max(4000).default(''),refs:z.array(z.string().uuid()).max(5).default([])});
const variant = z.object({
  speechType: z.enum(['voiceover','character','none']).optional(),
  speaker: z.string().trim().max(100).optional(),
  character: character.optional(),
  characterRefs: z.array(z.string().uuid()).max(7).optional(),
  shotSource: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  text: z.string().max(80000),
  kind: z.enum(['text', 'image', 'audio', 'video']),
  assetId: z.string().uuid().optional(),
  refs: z.array(z.string().uuid()).max(8).default([]),
  duration: z.number().min(0.2).default(5),
  trim: z.number().min(0).max(600).default(0),
  offset: z.number().min(0).default(0),
  volume: z.number().min(0).max(2).default(1),
  camera: z.string().max(2000).default(''),
  dialogue: z.string().max(10000).default(''),
  continuity: z.string().max(4000).default(''),
  voiceId: z.string().max(150).default(''),
});
export const GET = api(async (req, ctx) =>
  Response.json(await loadProject(await owner(req), (await ctx.params).id)),
);
export const PATCH = api(async (req, ctx) => {
  const user = await owner(req, true);
  const p = await loadProject(user, (await ctx.params).id);
  const body = z
    .object({
      revision: z.number().int(),
      action: z.string(),
      itemId: z.string().optional(),
      data: z.unknown().optional(),
    })
    .parse(await req.json());
  if (body.revision !== p.revision)
    throw new Error('Проект изменился. Обновите данные перед сохранением.');
  const d: any = body.data;
  if(body.itemId&&p.items.find(i=>i.id===body.itemId)?.planArchive)throw new Error('Эта карточка сохранена в истории. Откройте актуальный план из сценария.');
  if(body.itemId&&p.items.find(i=>i.id===body.itemId)?.removedAt&&body.action!=='restoreCharacter')throw new Error('Сначала восстановите удалённую карточку героя.');
  switch (body.action) {
    case 'saveCaption': {
      const c=z.object({planId:z.string().uuid(),text:z.string().trim().max(300),enabled:z.boolean(),font:z.enum(['Arial','Times New Roman','Courier New']),size:z.number().int().min(16).max(160),x:z.number().min(0).max(100),y:z.number().min(0).max(100),color:z.enum(['white','black']),background:z.boolean()}).parse(d);
      if(!p.items.some(i=>i.id===c.planId&&i.stage===5&&!i.removedAt&&!i.planArchive))throw new Error('Выберите актуальный план раскадровки этого проекта.');
      p.captions=[...(p.captions??[]).filter(old=>old.planId!==c.planId),c].sort((a,b)=>a.planId.localeCompare(b.planId));
      break;
    }
    case 'hideReference':
    case 'restoreReference': {
      const {assetId}=z.object({assetId:z.string().uuid()}).parse(d);
      if(!(await asset(user,assetId,p)).mime.startsWith('image/'))throw new Error('Выберите изображение этого проекта.');
      p.hiddenReferenceIds=body.action==='hideReference'?[...new Set([...(p.hiddenReferenceIds??[]),assetId])]:(p.hiddenReferenceIds??[]).filter(id=>id!==assetId);
      break;
    }
    case 'archiveJournal': archiveJournal(p); break;
    case 'restoreJournal': archiveJournal(p,true); break;
    case 'saveAnimaticPreview': {
      const v=variant.parse(d),basis=z.string().min(1).max(100000).parse(d?.basis);
      if(!v.assetId||(await asset(user, v.assetId, p)).mime!=='video/mp4')throw new Error('Для аниматика нужен файл MP4.');
      for (const ref of [...v.refs,...(v.characterRefs??[]),...(v.character?.refs??[])]) await asset(user,ref,p);
      saveAnimatic(p,v,basis);break;
    }
    case 'selectAnimatic':
    case 'approveAnimatic':
    case 'deleteAnimatic':
    case 'restoreAnimatic': {
      const variantId=z.string().uuid().parse(d?.variantId),a=p.animatic;
      if(!a)throw new Error('Аниматик не найден.');
      if(body.action==='restoreAnimatic'){
        const v=a.removedVariants?.find(v=>v.id===variantId);if(!v)throw new Error('Удалённый аниматик не найден.');
        a.variants.push(v);a.removedVariants=a.removedVariants!.filter(v=>v.id!==variantId);break;
      }
      const v=a.variants.find(v=>v.id===variantId);if(!v)throw new Error('Аниматик не найден.');
      if(body.action==='selectAnimatic')a.selectedId=v.id;
      else if(body.action==='approveAnimatic')approveAnimatic(p,v.id);
      else {a.removedVariants??=[];a.removedVariants.push(v);a.variants=a.variants.filter(x=>x.id!==v.id);if(a.selectedId===v.id)a.selectedId=undefined;if(a.approvedId===v.id)a.approvedId=undefined;}
      break;
    }
    case 'chooseVoiceTest': {
      const jobId=z.string().uuid().parse(d?.jobId);
      const sample=p.voiceComparisons?.filter(c=>!c.removedAt).flatMap(c=>c.samples).find(s=>s.jobId===jobId);
      if(!sample?.assetId||p.jobs.find(j=>j.id===jobId)?.status!=='done')throw new Error('Сначала дождитесь готовой пробы голоса.');
      p.preferredVoice={model:sample.model,voiceId:sample.voiceId,name:sample.name};break;
    }
    case 'removeVoiceComparison':
    case 'restoreVoiceComparison': {
      const comparisonId=z.string().uuid().parse(d?.comparisonId),c=p.voiceComparisons?.find(c=>c.id===comparisonId);
      if(!c)throw new Error('Сравнение не найдено.');
      if(p.jobs.some(j=>j.itemId===c.id&&['queued','dispatching','pending','saving'].includes(j.status)))throw new Error('Дождитесь завершения проб или отмените неотправленные попытки в журнале.');
      c.removedAt=body.action==='removeVoiceComparison'?new Date().toISOString():undefined;break;
    }
    case 'removeCharacter': removeCharacter(p,body.itemId!); break;
    case 'restoreCharacter': restoreCharacter(p,body.itemId!); break;
    case 'reapproveStyle': {
      const {variantId}=z.object({variantId:z.string().uuid()}).parse(d);
      reapproveStyle(p,body.itemId!,variantId);break;
    }
    case 'reapproveScript': {
      const {variantId}=z.object({variantId:z.string().uuid()}).parse(d);
      reapproveScript(p,body.itemId!,variantId);break;
    }
    case 'reapproveStoryboard': {
      const {variantId}=z.object({variantId:z.string().uuid()}).parse(d);
      const source=getItem(p,body.itemId!).variants.find(v=>v.id===variantId);
      if(source?.kind==='image'&&(!source.assetId||!(await asset(user,source.assetId,p)).mime.startsWith('image/')))
        throw new Error('Изображение недоступно. Выберите готовый кадр.');
      reapproveStoryboard(p,body.itemId!,variantId);break;
    }
    case 'reapproveSpeech': {
      const {variantId}=z.object({variantId:z.string().uuid()}).parse(d);
      const source=getItem(p,body.itemId!).variants.find(v=>v.id===variantId);
      if(!source?.assetId||!(await asset(user, source.assetId, p)).mime.startsWith('audio/'))throw new Error('Аудиофайл недоступен. Выберите готовую запись.');
      reapproveSpeech(p,body.itemId!,variantId);break;
    }
    case 'saveCharacter': {
      const c = character.parse(d?.profile);
      const imageId = z.string().uuid().optional().parse(d?.imageId);
      if (!c.description && !c.appearance && !c.refs.length) throw new Error('Опишите героя или добавьте исходное изображение.');
      for (const ref of [...new Set([...c.refs,...(imageId?[imageId]:[])])]) {
        const a = await asset(user, ref, p);
        if (!['image/png','image/jpeg','image/webp'].includes(a.mime) || a.size > 10*1024*1024) throw new Error('Образ героя: PNG, JPEG или WebP до 10 МБ.');
      }
      let item = body.itemId ? getItem(p,body.itemId) : p.items.find(i=>i.stage===1&&!i.removedAt&&!i.character&&!i.variants.length);
      if (item && item.stage!==1) throw new Error('Карточка героя должна находиться на этапе «Герои».');
      if (!item) {if(p.items.length>=120)throw new Error('В проекте максимум 120 материалов.');item={id:uid(),stage:1,title:c.name,variants:[]};p.items.push(item);}
      item.title=c.name;item.character=c;
      if (imageId) addVariant(p,item.id,{title:c.name+' · готовый образ',kind:'image',assetId:imageId,
        text:[c.name,c.appearance,c.description,c.instructions].filter(Boolean).join('\n\n'),refs:c.refs,character:c});
      break;
    }
    case 'reapproveVideo': {
      const {variantId} = z.object({variantId:z.string().uuid()}).parse(d);
      const source = getItem(p, body.itemId!).variants.find(v => v.id === variantId);
      if (!source?.assetId || !(await asset(user, source.assetId, p)).mime.startsWith('video/'))
        throw new Error('Видеофайл недоступен.');
      reapproveVideo(p, body.itemId!, variantId);
      break;
    }
    case 'deleteVariant':
    case 'restoreVariant': {
      const {variantId} = z.object({variantId:z.string().uuid()}).parse(d);
      (body.action === 'deleteVariant' ? deleteVariant : restoreVariant)(p,body.itemId!,variantId);
      break;
    }
    case 'approveSelectedSpeech': {
      const {selections} = z.object({selections:z.array(z.object({itemId:z.string().uuid(),variantId:z.string().uuid()})).min(1).max(120)}).parse(d);
      approveSelectedSpeech(p,selections);
      break;
    }
    case 'approveBatch': {
      const batch = z.object({
        stage: z.union([z.literal(5), z.literal(6), z.literal(7)]),
        selections: z.array(z.object({ itemId: z.string().uuid(), variantId: z.string().uuid() })).min(1).max(120),
      }).parse(d);
      approveBatch(p, batch.stage, batch.selections);
      break;
    }
    case 'speechMode':
      p.speechMode = z.enum(['track', 'plans']).parse(d?.mode);
      break;
    case 'syncVideoPlans': {
      if (!syncVideoPlans(p)) return Response.json(p);
      break;
    }
    case 'prepareShots': {
      if (!preparePlanCards(p)) return Response.json(p);
      break;
    }
    case 'saveAnimatic':
    case 'addVariant': {
      const v = variant.parse(d);
      if (v.speechType) assertSpeech(speechInfo(v),v.dialogue);
      if(v.kind==='audio'&&v.speechType==='character'&&!getItem(p,body.itemId!).sourceShot) throw new Error('Для реплик героев используйте отдельные карточки: «Подготовить озвучку по планам».');
      if (v.assetId) {
        const a = await asset(user, v.assetId, p);
        if (!a.mime.startsWith(v.kind + '/'))
          throw new Error('Тип файла не соответствует варианту.');
      }
      for (const ref of v.refs) await asset(user, ref, p);
      for (const ref of v.characterRefs??[]) await asset(user, ref, p);
      if (v.character) {
        if (getItem(p,body.itemId!).stage!==1) throw new Error('Описание героя доступно на этапе «Герои».');
        for (const ref of v.character.refs) {const a=await asset(user, ref, p);if(!a.mime.startsWith('image/'))throw new Error('Референс героя должен быть изображением.');}
      }
      if (body.action === 'saveAnimatic') addAnimatic(p, body.itemId!, v);
      else addVariant(p, body.itemId!, v);
      break;
    }
    case 'select': {
      const i = getItem(p, body.itemId!);
      const v = i.variants.find((v) => v.id === d?.variantId);
      if (!v) throw new Error('Вариант не найден.');
      i.selectedId = v.id;
      break;
    }
    case 'approve':
      approve(p, body.itemId!);
      break;
    case 'unapprove':
      getItem(p, body.itemId!).approvedId = undefined;
      break;
    case 'addItem': {
      const x = z
        .object({
          stage: z.number().int().min(0).max(8),
          title: z.string().trim().min(1).max(100),
        })
        .parse(d);
      if (p.items.length >= 120)
        throw new Error('В проекте максимум 120 материалов.');
      p.items.push({ id: uid(), ...x, variants: [] });
      break;
    }
    case 'renameItem':
      getItem(p, body.itemId!).title = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .parse(d?.title);
      break;
    case 'removeEmpty': {
      const i = getItem(p, body.itemId!);
      if (i.stage === 1) {
        removeCharacter(p, i.id);
        break;
      }
      if (
        i.variants.length ||
        p.removedVariants?.some(r => r.itemId === i.id) ||
        p.items.filter((x) => x.stage === i.stage).length < 2
      )
        throw new Error('Можно удалить только пустой дополнительный материал.');
      p.items = p.items.filter((x) => x.id !== i.id);
      break;
    }
    case 'moveItem': {
      const i = getItem(p, body.itemId!);
      const group = p.items.filter((x) => x.stage === i.stage);
      const at = group.findIndex((x) => x.id === i.id);
      const next =
        at + z.union([z.literal(-1), z.literal(1)]).parse(d?.direction);
      if (group[next]) {
        const a = p.items.indexOf(i),
          b = p.items.indexOf(group[next]);
        [p.items[a], p.items[b]] = [p.items[b], p.items[a]];
      }
      break;
    }
    case 'settings': {
      const s = z
        .object({
          title: z.string().trim().min(1).max(100),
          format: z.enum(['16:9', '9:16']),
          seconds: z.number().int().min(1),
          limit: z.string().regex(/^\d+$/).nullable(),
        })
        .parse(d);
      if (p.seconds !== s.seconds || p.format !== s.format) p.configVersion++;
      Object.assign(p, s);
      break;
    }
    case 'reconcile': {
      const s = z
        .object({
          jobId: z.string(),
          actual: z.string().regex(/^\d+$/),
          note: z.string().trim().min(1).max(500),
        })
        .parse(d);
      const j = p.jobs.find((j) => j.id === s.jobId);
      if (!j) throw new Error('Попытка не найдена.');
      j.actual = s.actual;
      j.actualSource = 'Ручная сверка: ' + s.note;
      break;
    }
    case 'cancel': {
      const j = p.jobs.find((j) => j.id === d?.jobId);
      if (!j || j.status !== 'queued')
        throw new Error('Отменить можно только неотправленную попытку.');
      j.status = 'cancelled';
      j.actual = '0';
      j.actualSource = 'Не отправлено';
      break;
    }
    case 'importLibrary': {
      const x = z
        .object({ projectId: z.string().uuid(), itemId: z.string().uuid() })
        .parse(d);
      const source = await loadProject(user, x.projectId);
      const item = getItem(source, x.itemId);
      if (![1, 2, 3].includes(item.stage))
        throw new Error('В библиотеке доступны персонажи, стиль и образы.');
      const v = item.variants.find((v) => v.id === item.approvedId);
      if (!v || !isApproved(source, item))
        throw new Error('Исходный материал не утвержден.');
      const copy = {
        id: uid(),
        title: item.title,
        stage: item.stage,
        variants: [] as any[],
      };
      copy.variants = [
        makeVariant(p, copy, {
          ...v,
          id: uid(),
          model: 'Библиотека · ' + source.title,
          deps: dependencies(p, copy.stage),
        }),
      ];
      (copy as any).selectedId = copy.variants[0].id;
      p.items.push(copy);
      break;
    }
    default:
      throw new Error('Неизвестное действие.');
  }
  return Response.json(await saveProject(user, p, p.revision));
});
