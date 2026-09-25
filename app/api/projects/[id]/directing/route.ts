import { z } from 'zod';
import { api, owner, loadProject, saveProject, getKey } from '@/lib/server';
import { model } from '@/lib/models';
import { id, makeVariant } from '@/lib/domain';
import { runDirectorStep } from '@/lib/director-runner';
import { ensureDirecting, creativeBriefSchema, sceneSchema, directingShotSchema, dialogueSchema, newDirectorRun, scenesBasis, shotApproval, directorBasis, type DirectorRole } from '@/lib/directing';
import { setProductionOrder } from '@/lib/production-order';
import {parseShots} from '@/lib/shots';
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),projectId=(await ctx.params).id;
  const body=z.object({action:z.string(),revision:z.number().optional(),data:z.any().optional()}).parse(await req.json());
  if(body.action==='advance')return Response.json(await runDirectorStep(user,projectId));
  const p=await loadProject(user,projectId);
  if(body.revision!==p.revision)throw Error('Проект изменился. Обновите данные и повторите действие.');
  const d=ensureDirecting(p),v=body.data??{};
  const running=d.runs.some(r=>!r.stopped&&r.tasks.some(t=>!t.result&&!t.error));
  if(running&&!['stop','retry'].includes(body.action))throw Error('Дождитесь проработки или остановите её перед изменением основы.');
  switch(body.action){
    case 'importScript':{
      const card=p.items.find(i=>i.stage===4),source=card?.variants.find(v=>v.id===(card.approvedId??card.selectedId));if(!source)throw Error('Нет подробного сценария для переноса.');
      if(d.scenes.length)throw Error('Структура сцен уже есть. Используйте её правки.');
      const shots=parseShots(source.text,p.seconds);
      const groups=new Map<string,typeof shots>();shots.forEach((s,n)=>{const key=s.sceneId??String(Math.floor(n/20));groups.set(key,[...(groups.get(key)??[]),s]);});
      d.scenes=[...groups.entries()].map(([key,shots],n)=>({id:shots[0].sceneId??id(),title:`Сцена ${n+1} · из текущего сценария`,purpose:'Уточните задачу эпизода',location:'Уточните локацию',conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:shots.map(s=>({id:s.id??id(),title:s.title,duration:s.duration,cast:s.cast??(s.speaker?[s.speaker]:[]),story:s.description,stateIn:s.continuity,stateOut:'',cinematography:s.camera,productionDesign:s.productionDesign??'',dialogue:{speechType:s.speechType??(s.dialogue?'voiceover':'none'),speaker:s.speaker??'',text:s.dialogue,delivery:''},continuityChanges:''}))}));break;
    }
    case 'brief':d.brief=creativeBriefSchema.parse(v.brief);if(v.productionOrder)setProductionOrder(p,z.enum(['voice-first','video-first']).parse(v.productionOrder));break;
    case 'run':{
      const s=z.object({model:z.string(),mode:z.enum(['critic','scenes','develop','role','editor']),sceneId:z.string().optional(),shotId:z.string().optional(),role:z.enum(['story','camera','art','dialogue']).optional()}).parse(v);
      if(model(s.model).kind!=='text'||!['openai','xai','minimax'].includes(model(s.model).provider))throw Error('Выберите текстовую модель OpenAI, Grok или MiniMax.');
      await getKey(user,model(s.model).provider);
      if(p.limit!==null)throw Error('Для текстовых агентов стоимость определяется по токенам. Снимите денежный лимит на время проработки и сверяйте расход в журнале.');
      if(s.mode==='scenes'&&d.scenes.length&&!v.replaceScenes)throw Error('Структура уже существует. Для замены используйте явное повторное разбиение.');
      newDirectorRun(p,s.model,s.mode,s.sceneId,s.role as DirectorRole,s.shotId);break;
    }
    case 'stop':{const r=d.runs.find(r=>r.id===v.runId);if(!r)throw Error('Запуск не найден.');r.stopped=true;for(const t of r.tasks){const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='dispatching'){j.status='unknown';j.error='Ожидание остановлено. Запрос мог быть оплачен; поздний ответ будет сохранён.';}if(!t.result&&!t.error)t.error='Проработка остановлена.';}break;}
    case 'retry':{
      const r=d.runs.find(r=>r.id===v.runId),t=r?.tasks.find(t=>t.id===v.taskId);if(!r||!t?.error)throw Error('Выберите неудавшееся задание.');
      const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='unknown'&&!v.acknowledgeCost)throw Error('Исход неизвестен: подтвердите возможность повторного списания.');
      t.jobId=undefined;t.error=undefined;t.result=undefined;t.applied=undefined;r.stopped=false;break;
    }
    case 'saveScene':{
      const scene=sceneSchema.parse(v.scene);const old=d.scenes.find(s=>s.id===scene.id);
      if(!old){if(d.scenes.length>=24)throw Error('Максимум 24 сцены.');d.scenes.push({...scene,id:id(),shots:[]});}
      else Object.assign(old,{...scene,shots:old.shots});break;
    }
    case 'removeScene':d.scenes=d.scenes.filter(s=>s.id!==v.sceneId);break;
    case 'approveScenes':if(!d.scenes.length)throw Error('Сначала создайте сцены.');d.scenesApproved=scenesBasis(p);break;
    case 'saveShot':{
      const scene=d.scenes.find(s=>s.id===v.sceneId);if(!scene)throw Error('Сцена не найдена.');
      const shot=directingShotSchema.parse(v.shot),old=scene.shots.find(s=>s.id===shot.id);
      if(old)Object.assign(old,{...shot,approved:undefined});else scene.shots.push({...shot,id:id()});break;
    }
    case 'approveShots':{
      const ids=z.array(z.string()).min(1).max(120).parse(v.ids);let count=0;
      for(const s of d.scenes)for(const shot of s.shots)if(ids.includes(shot.id)){
        if(!shot.story.trim()||!shot.cinematography.trim()||!shot.productionDesign.trim())throw Error('Заполните сценарий, операторскую работу и художественное решение.');
        if(shot.dialogue.speechType==='character'&&(!shot.dialogue.speaker||!shot.cast.includes(shot.dialogue.speaker)))throw Error('Укажите присутствующего в кадре говорящего.');
        if(d.issues.some(i=>i.severity==='conflict'&&!i.resolved&&(!i.shotId||i.shotId===shot.id)&&(!i.sceneId||i.sceneId===s.id)))throw Error('Сначала разрешите конфликт редактора.');
        dialogueSchema.parse(shot.dialogue);shot.approved=shotApproval(s,shot);shot.approvedFoundation=directorBasis(p);count++;
      }if(count!==new Set(ids).size)throw Error('Состав планов изменился.');break;
    }
    case 'resolveIssue':{const issue=d.issues.find(i=>i.id===v.issueId);if(!issue)throw Error('Замечание не найдено.');issue.resolution=z.string().trim().min(1).max(2000).parse(v.resolution);issue.resolved=true;break;}
    case 'applyPatch':{
      const patch=d.patches.find(s=>s.id===v.patchId),shot=d.scenes.flatMap(s=>s.shots).find(s=>s.id===patch?.shotId);
      if(!patch||!shot)throw Error('Предложение не найдено.');
      const before=typeof shot[patch.section]==='string'?shot[patch.section]:JSON.stringify(shot[patch.section]);
      if(before!==patch.before)throw Error('Раздел уже изменился. Сравните предложение с текущим текстом.');
      if(patch.section==='dialogue')shot.dialogue=dialogueSchema.parse(JSON.parse(patch.after));else shot[patch.section]=patch.after;
      shot.approved=undefined;patch.applied=true;break;
    }
    case 'useAlternative':{
      const a=d.critic?.alternatives[v.index],item=p.items.find(i=>i.stage===0);if(!a||!item)throw Error('Альтернатива не найдена.');
      const candidate=makeVariant(p,item,{kind:'text',text:a.text,title:a.title,model:'Рецензент'});item.variants.push(candidate);item.selectedId=candidate.id;break;
    }
    case 'publish':{
      const m=model(z.string().parse(v.model));if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Выберите текстовую модель.');
      await getKey(user,m.provider);if(p.limit!==null)throw Error('Для подготовки промптов требуется оценка текстовых вызовов. Снимите лимит или подготовьте сценарий вручную.');
      newDirectorRun(p,m.id,'compress');break;
    }
    default:throw Error('Неизвестное действие.');
  }
  return Response.json(await saveProject(user,p,p.revision));
});
