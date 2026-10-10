import {z} from 'zod';
import {api,owner,loadProject,saveProject,getKey} from '@/lib/server';
import {model} from '@/lib/models';
import {advanceGeneralScenario,runGeneralScenarioJob} from '@/lib/general-scenario-runner';
import {GENERAL_SCENARIO_SECTIONS,generalScenarioConfigSchema,generalCandidateActionSchema,configureGeneralScenario,prepareGeneralScenario,saveGeneralPreparation,generateGeneralScenario,retryGeneralScenario,continueGeneralScenarioWithout,generalCandidateAction} from '@/lib/general-scenario-workflow';

const requestId=z.string().min(1).max(200),section=z.enum(GENERAL_SCENARIO_SECTIONS);
const preparation=z.object({requestId,section,sourceVariantId:z.string().uuid(),model:z.string().min(1).max(200),cinemaModel:z.enum(['gpt-6-astra','grok-4.7']).optional(),question:z.string().max(3000).optional()}).strict();
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('advance')}).passthrough(),
  z.object({action:z.literal('configure'),revision:z.number().int(),data:generalScenarioConfigSchema}).strict(),
  z.object({action:z.literal('prepare'),revision:z.number().int(),data:preparation}).strict(),
  z.object({action:z.literal('savePreparation'),revision:z.number().int(),data:preparation.extend({result:z.unknown()})}).strict(),
  z.object({action:z.literal('generate'),revision:z.number().int(),data:generalScenarioConfigSchema.extend({requestId})}).strict(),
  z.object({action:z.literal('retry'),revision:z.number().int(),data:z.object({runId:z.string().uuid(),acknowledgeCost:z.boolean().optional()}).strict()}).strict(),
  z.object({action:z.literal('continueWithout'),revision:z.number().int(),data:z.object({runId:z.string().uuid(),sections:z.array(section).min(1).max(3)}).strict()}).strict(),
  z.object({action:z.literal('candidate'),revision:z.number().int(),data:generalCandidateActionSchema}).strict(),
]);
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),projectId=(await ctx.params).id,body=schema.parse(await req.json());
  if(body.action==='advance')return Response.json(await advanceGeneralScenario(user,projectId));
  let p=await loadProject(user,projectId);
  // A retransmitted idempotency key returns its existing durable result even
  // when the original successful response was lost and the revision advanced.
  if(body.action==='generate'){const requestId=body.data.requestId;if(p.generalScenario?.runs.some(r=>r.requestId===requestId))return Response.json(p);}
  if(body.action==='prepare'||body.action==='savePreparation'){const requestId=body.data.requestId;if(p.generalScenario?.preparations.some(r=>r.requestId===requestId))return Response.json(p);}
  if(body.revision!==p.revision)throw Error('Проект изменился. Обновите данные и повторите действие.');
  if(body.action==='retry'){
    const key=body.data.runId,run=p.generalScenario?.runs.find(r=>r.id===key),jobIds=new Set([...(p.generalScenario?.preparations.filter(prep=>prep.id===key||Object.values(run?.preparationIds??{}).includes(prep.id)).map(prep=>prep.jobId)??[]),...(run?.scriptRun?.tasks.map(t=>t.jobId)??[])]);
    // Check a retained paid response before admitting an explicitly requested
    // repeat. The original reply may have arrived since the UI last refreshed.
    await Promise.all(p.jobs.filter(j=>jobIds.has(j.id)&&j.status==='unknown').map(j=>runGeneralScenarioJob(user,projectId,j.id)));
    p=await loadProject(user,projectId);
  }
  const checkModel=async(key:string)=>{const chosen=model(key);if(chosen.kind!=='text'||!['openai','xai','minimax'].includes(chosen.provider))throw Error('Выберите текстовую модель.');await getKey(user,chosen.provider);};
  if(body.action==='prepare'||body.action==='generate'){
    if(p.limit!==null)throw Error('Стоимость текстовой подготовки рассчитывается по использованию. Для запуска снимите жёсткий лимит и сверяйте журнал.');
    await checkModel(body.action==='prepare'&&body.data.section==='cinema'?(body.data.cinemaModel??'gpt-6-astra'):body.data.model);
    if(body.action==='generate'&&body.data.options.cinema)await checkModel(body.data.cinemaModel);
  }
  switch(body.action){
    case 'configure':configureGeneralScenario(p,body.data);break;
    case 'prepare':prepareGeneralScenario(p,body.data);break;
    case 'savePreparation':saveGeneralPreparation(p,body.data);break;
    case 'generate':generateGeneralScenario(p,body.data);break;
    case 'retry':retryGeneralScenario(p,body.data.runId,body.data.acknowledgeCost);break;
    case 'continueWithout':continueGeneralScenarioWithout(p,body.data.runId,body.data.sections);break;
    case 'candidate':generalCandidateAction(p,body.data);break;
  }
  return Response.json(await saveProject(user,p,p.revision));
});
