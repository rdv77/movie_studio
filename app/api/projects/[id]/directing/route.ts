import { z } from 'zod';
import { createScriptWorkflowRun,importScriptWorkflowCandidate,isRecoverableUnsentScriptRun,resumeUnsentScriptRun,scriptRoleSchema,scriptPromptOverridesSchema,CINEMA_METHOD_IDS } from '@/lib/script-workflow';
import { recordCreativeVersion, restoreCreativeVersion, restoreSceneVersion, relevantHeroItems, relevantLocationItems } from '@/lib/creative-versions';
import { api, owner, loadProject, saveProject, getKey } from '@/lib/server';
import { model } from '@/lib/models';
import { id, makeVariant } from '@/lib/domain';
import { runDirectorStep } from '@/lib/director-runner';
import { ensureDirecting, creativeBriefSchema, sceneSchema, directingShotSchema, dialogueSchema, newDirectorRun, directorRunActive, scenesBasis, shotApproval, shotFoundationBasis, directorBasis, editorBasis, type DirectorRole } from '@/lib/directing';
import { setProductionOrder } from '@/lib/production-order';
import {parseShots} from '@/lib/shots';
import {applyEditorPatches} from '@/lib/directing';
import {applyEditorSolutions} from '@/lib/directing-solutions';
import {validateScenePlan,validateShotDirection} from '@/lib/shot-direction';
import {runtimeMode,plannedRuntime,runtimeAcceptanceBasis} from '@/lib/runtime-policy';
import {assertSceneLocations} from '@/lib/world-assets';
import {prepareSceneLocations} from '@/lib/scene-locations';
import {directorScopeSchema,assertDirectingShotReady} from '@/lib/directing-workflow';
import {allowNewSeries} from '@/lib/job-wait';
import {planPolicySchema,planSketchSchema,setPlanPolicy,choosePlanningProposal,approvePlanSets,replacePlanCards,planningScene,restorePlanningCard} from '@/lib/shot-planning';
import {directorExecutionSchema,validateDirectorExecution,normalizeDirectorAnswer,prepareDirectorRetry} from '@/lib/director-reliability';
import {parseDirectorJSON,applyDirectorResult,directorRunBasis,publishDirectorScript} from '@/lib/directing';
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),projectId=(await ctx.params).id;
  const body=z.object({action:z.string(),revision:z.number().optional(),data:z.any().optional()}).parse(await req.json());
  if(body.action==='advance')return Response.json(await runDirectorStep(user,projectId));
  const p=await loadProject(user,projectId);
  if(body.revision!==p.revision)throw Error('Проект изменился. Обновите данные и повторите действие.');
  const d=ensureDirecting(p),v=body.data??{};
  const running=d.runs.some(directorRunActive);
  if(running&&!['stop','retry','importScriptCandidate'].includes(body.action))throw Error('Дождитесь проработки или остановите её перед изменением основы.');
  const tracksHistory=['planPolicy','choosePlanSet','savePlanCards','restorePlanCard','approvePlanSets','brief','runtimePolicy','importScript','saveScene','removeScene','saveShot','applyPatch','applySolution','applyAllSolutions','applyMontageOperation','applyAllMontageOperations'].includes(body.action);
  if(tracksHistory)recordCreativeVersion(p,'До изменения: '+body.action);
  switch(body.action){
    case 'planPolicy':setPlanPolicy(p,planPolicySchema.parse(v.policy),z.string().optional().parse(v.sceneId));break;
    case 'choosePlanSet':choosePlanningProposal(p,z.string().uuid().parse(v.proposalId));break;
    case 'savePlanCards':replacePlanCards(p,z.string().parse(v.sceneId),z.array(planSketchSchema).min(1).max(40).parse(v.cards));break;
    case 'restorePlanCard':restorePlanningCard(p,z.string().parse(v.sceneId),z.string().parse(v.shotId));break;
    case 'approvePlanSets':approvePlanSets(p,z.array(z.string()).min(1).max(24).parse(v.sceneIds));break;
    case 'repairSavedAnswer':{
      const run=d.runs.find(r=>r.id===v.runId),task=run?.tasks.find(t=>t.id===v.taskId),job=p.jobs.find(j=>j.id===task?.jobId);
      if(!run||!task?.error||!job?.output?.text||job.status!=='failed'||run.stopped||run.basis!==directorRunBasis(p,run))throw Error('Нет сохранённого ответа для исправления формата текущего задания.');
      const proposal=structuredClone(p),r=proposal.directing!.runs.find(r=>r.id===run.id)!,t=r.tasks.find(t=>t.id===task.id)!;
      applyDirectorResult(proposal,r,t,normalizeDirectorAnswer(proposal,t.role,t.sceneId,parseDirectorJSON(job.output.text)));
      if(!t.applied)throw Error(t.error??'Ответ не прошёл проверку.');const receipt=proposal.jobs.find(j=>j.id===job.id)!;receipt.status='done';receipt.error=undefined;
      if(r.mode==='compress'&&!r.published&&r.tasks.every(t=>t.applied)){publishDirectorScript(proposal);r.published=true;}
      Object.assign(p,proposal);break;
    }
    case 'restoreCreativeVersion':restoreCreativeVersion(p,z.string().uuid().parse(v.versionId));break;
    case 'restoreSceneVersion':restoreSceneVersion(p,z.string().uuid().parse(v.versionId),z.string().uuid().parse(v.sceneId));break;
    case 'scriptRun':{
      const input=z.object({model:z.string(),roles:z.array(scriptRoleSchema).min(1).max(5),sourceVariantId:z.string().uuid(),sourceTaskId:z.string().uuid().optional(),methodologyIds:z.array(z.enum(CINEMA_METHOD_IDS)).max(7).optional(),promptOverrides:scriptPromptOverridesSchema.optional()}).parse(v);
      const m=model(input.model);if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Выберите текстовую модель.');
      await getKey(user,m.provider);if(p.limit!==null)throw Error('Для текстовых агентов расходы определяются по токенам. Снимите лимит на время прохода и сверяйте журнал.');
      createScriptWorkflowRun(p,input.model,input.roles,input.sourceVariantId,input.sourceTaskId,{methodologyIds:input.methodologyIds,promptOverrides:input.promptOverrides});break;
    }
    case 'resumeScriptRun':{
      const runId=z.string().uuid().parse(v.runId),run=d.runs.find(r=>r.id===runId);
      if(!isRecoverableUnsentScriptRun(p,run))throw Error('Этот запуск нельзя продолжить: нет подтверждения, что запрос к модели не отправлялся.');
      const m=model(run.model);if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Выберите текстовую модель.');
      await getKey(user,m.provider);if(p.limit!==null)throw Error('Для текстовых агентов расходы определяются по токенам. Снимите лимит на время прохода и сверяйте журнал.');
      resumeUnsentScriptRun(p,runId);break;
    }
    case 'importScriptCandidate':importScriptWorkflowCandidate(p,z.string().uuid().parse(v.runId),z.string().uuid().parse(v.taskId));break;
    case 'runtimePolicy':{
      const mode=z.enum(['free','strict']).parse(v.mode);
      if(d.durationMode!==mode){d.durationMode=mode;d.editorBasis=undefined;d.acceptedRuntime=undefined;
        for(const issue of d.issues){if(issue.category==='runtime_metadata'||issue.category==='runtime_target'&&mode==='free')issue.severity='note';if(issue.category==='runtime_target'&&mode==='strict'){issue.severity='conflict';issue.resolved=false;}}
      }break;
    }
    case 'acceptRuntime':{
      const seconds=plannedRuntime(p);if(runtimeMode(p)!=='free'||seconds<=0||d.scenes.some(s=>!s.shots.length))throw Error('Принять расчёт можно после подготовки всех сцен в свободном режиме.');
      d.acceptedRuntime={seconds,basis:runtimeAcceptanceBasis(p)};
      for(const issue of d.issues)if(issue.category==='runtime_target'){issue.severity='note';issue.resolved=true;issue.resolution=`Режиссёр принял расчётную длительность ${seconds} сек.`;}
      break;
    }
    case 'importScript':{
      const card=p.items.find(i=>i.stage===4),source=card?.variants.find(v=>v.id===(card.approvedId??card.selectedId));if(!source)throw Error('Нет подробного сценария для переноса.');
      if(d.scenes.length)throw Error('Структура сцен уже есть. Используйте её правки.');
      const shots=parseShots(source.text,p.seconds);
      const groups=new Map<string,typeof shots>();shots.forEach((s,n)=>{const key=s.sceneId??String(Math.floor(n/20));groups.set(key,[...(groups.get(key)??[]),s]);});
      d.scenes=[...groups.entries()].map(([key,shots],n)=>({id:shots[0].sceneId??id(),title:`Сцена ${n+1} · из текущего сценария`,purpose:'Уточните задачу эпизода',location:'Уточните локацию',conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:shots.map(s=>({id:s.id??id(),title:s.title,duration:s.duration,cast:s.cast??(s.speaker?[s.speaker]:[]),story:s.description,stateIn:s.continuity,stateOut:'',cinematography:s.camera,productionDesign:s.productionDesign??'',dialogue:{speechType:s.speechType??(s.dialogue?'voiceover':'none'),speaker:s.speaker??'',text:s.dialogue,delivery:''},continuityChanges:'',...(s.direction?{direction:structuredClone(s.direction)}:{})}))}));break;
    }
    case 'brief':d.brief=creativeBriefSchema.parse(v.brief);if(v.productionOrder)setProductionOrder(p,z.enum(['voice-first','video-first']).parse(v.productionOrder));break;
    case 'run':{
      const s=z.object({model:z.string(),execution:directorExecutionSchema.optional(),mode:z.enum(['plan-shots','critic','scenes','develop','role','editor']),sceneId:z.string().optional(),shotId:z.string().optional(),role:z.enum(['story','camera','art','dialogue','performance','scene-expressive-reviewer']).optional()}).extend(directorScopeSchema.shape).parse(v);
      const scoped=s.scope!==undefined||s.sceneIds!==undefined||s.shotIds!==undefined?{scope:s.scope,sceneIds:s.sceneIds,shotIds:s.shotIds}:undefined;
      if(model(s.model).kind!=='text'||!['openai','xai','minimax'].includes(model(s.model).provider))throw Error('Выберите текстовую модель OpenAI, Grok или MiniMax.');
      await getKey(user,model(s.model).provider);
      const execution=s.execution&&validateDirectorExecution(s.execution);for(const key of new Set([...(execution?.parallelModels??[]),...(execution?.fallbackModel?[execution.fallbackModel]:[])]))await getKey(user,model(key).provider);
      if(p.limit!==null)throw Error('Для текстовых агентов стоимость определяется по токенам. Снимите денежный лимит на время проработки и сверяйте расход в журнале.');
      if(s.mode==='scenes'&&d.scenes.length&&!v.replaceScenes&&(!scoped||s.scope==='all'&&s.sceneIds===undefined))throw Error('Структура уже существует. Для замены используйте явное повторное разбиение.');
      const run=newDirectorRun(p,s.model,s.mode,s.sceneId,s.role as DirectorRole,s.shotId,scoped);if(execution)run.execution=execution;break;
    }
    case 'stop':{const r=d.runs.find(r=>r.id===v.runId);if(!r)throw Error('Запуск не найден.');r.stopped=true;for(const t of r.tasks){const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='dispatching'){j.status='unknown';j.error='Ожидание остановлено. Запрос мог быть оплачен; поздний ответ будет сохранён.';}if(!t.result&&!t.error)t.error='Проработка остановлена.';}break;}
    case 'retry':{
      const r=d.runs.find(r=>r.id===v.runId),t=r?.tasks.find(t=>t.id===v.taskId);if(!r||!t?.error)throw Error('Выберите неудавшееся задание.');
      const j=p.jobs.find(j=>j.id===t.jobId);if(j?.status==='unknown'&&!v.acknowledgeCost)throw Error('Исход неизвестен: подтвердите возможность повторного списания.');
      if(j?.status==='unknown')allowNewSeries(j);
      prepareDirectorRetry(p,r,t);break;
    }
    case 'saveScene':{
      const scene=sceneSchema.parse(v.scene);assertSceneLocations(p,scene);const old=d.scenes.find(s=>s.id===scene.id);
      if(!old){if(d.scenes.length>=24)throw Error('Максимум 24 сцены.');d.scenes.push({...scene,id:id(),shots:[]});}
      else Object.assign(old,{...scene,shots:old.shots});break;
    }
    case 'removeScene':d.scenes=d.scenes.filter(s=>s.id!==v.sceneId);break;
    case 'approveScenes':if(!d.scenes.length)throw Error('Сначала создайте сцены.');prepareSceneLocations(p);d.scenesApproved=scenesBasis(p);break;
    case 'saveShot':{
      const scene=d.scenes.find(s=>s.id===v.sceneId);if(!scene)throw Error('Сцена не найдена.');
      const shot=directingShotSchema.parse(v.shot),old=scene.shots.find(s=>s.id===shot.id);
      const conflict=validateShotDirection(shot).find(i=>i.severity==='conflict');if(conflict)throw Error(conflict.message);
      if(old)Object.assign(old,{...shot,direction:shot.direction,approved:undefined});else scene.shots.push({...shot,id:id()});break;
    }
    case 'approveShots':{
      const reviewed=d.editorBasis===editorBasis(p);
      const ids=z.array(z.string()).max(120).parse(v.ids);
      // Older clients may submit an empty list after every shot was approved.
      // Return the current project without modifying approvals or its revision.
      if(!ids.length)return Response.json(p);
      const targets=d.scenes.flatMap(scene=>scene.shots.filter(shot=>ids.includes(shot.id)).map(shot=>({scene,shot})));
      if(targets.length!==new Set(ids).size)throw Error('Состав планов изменился.');
      for(const {scene,shot} of targets)assertDirectingShotReady(p,scene,shot);
      for(const {scene,shot} of targets){shot.characterIds??=relevantHeroItems(p,shot).map(i=>i.id);shot.locationIds??=relevantLocationItems(p,scene,shot).map(i=>i.id);shot.approvalVersion=2;shot.approved=shotApproval(scene,shot);shot.approvedFoundation=shotFoundationBasis(p,scene,shot);}
      if(reviewed)d.editorBasis=editorBasis(p);break;
    }
    case 'resolveIssue':{const issue=d.issues.find(i=>i.id===v.issueId);if(!issue)throw Error('Замечание не найдено.');issue.resolution=z.string().trim().min(1).max(2000).parse(v.resolution);issue.resolved=true;break;}
    case 'applyPatch':{
      applyEditorPatches(p,[z.string().parse(v.patchId)]);break;
    }
    case 'applySolution':{const issueId=z.string().parse(v.issueId);applyEditorSolutions(p,d.patches.filter(patch=>patch.issueId===issueId||patch.relatedIssueIds?.includes(issueId)).map(patch=>patch.id),(d.montageOperations??[]).filter(op=>op.issueId===issueId||op.relatedIssueIds?.includes(issueId)).map(op=>op.id));break;}
    case 'applyAllSolutions':applyEditorSolutions(p,d.patches.filter(patch=>!patch.applied).map(patch=>patch.id),(d.montageOperations??[]).filter(op=>!op.applied).map(op=>op.id));break;
    case 'applyMontageOperation':applyEditorSolutions(p,[],[z.string().parse(v.operationId)]);break;
    case 'applyAllMontageOperations':applyEditorSolutions(p,[],(d.montageOperations??[]).filter(op=>!op.applied).map(op=>op.id));break;
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
  if(tracksHistory)recordCreativeVersion(p,'Изменение: '+body.action);
  return Response.json(await saveProject(user,p,p.revision));
});
