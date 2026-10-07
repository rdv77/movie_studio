import {z} from 'zod';
import type {Project} from '@/lib/domain';
import {stagingModeSchema,framePolicySchema} from '@/lib/staging-policy';
import {cameraPolicySchema} from '@/lib/camera-policy';
import {imageSettingsSchema} from '@/lib/image-quality';
import {imageRetrySchema} from '@/lib/image-retries';
import {MEDIA_INPUT_LIMIT} from '@/lib/prompt-limits';
import {MODELS} from '@/lib/models';
import {availableForDirecting} from '@/lib/model-capabilities';

// These are the same authenticated application actions as the visible controls.
// No URL, HTTP method, identity, API key or destructive command is accepted.
export const PROJECT_BROWSER_ACTIONS=['addVariant','addItem','renameItem','select','approve','approveBatch','approveReview','reapproveStyle','reapproveScript','reapproveStoryboard','reapproveUnchangedStoryboard','saveCharacter','importLibrary','bindPlanCharacter','prepareShots','speechMode','setAnimaticSettings','selectAnimatic','approveAnimatic'] as const;
export const DIRECTING_BROWSER_ACTIONS=['brief','runtimePolicy','acceptRuntime','importScript','saveScene','approveScenes','saveShot','approveShots','planPolicy','savePlanCards','choosePlanSet','approvePlanSets','run','scriptRun','importScriptCandidate','useAlternative','applyPatch','applySolution','applyAllSolutions','publish','repairSavedAnswer'] as const;
const targetSchema=z.object({projectId:z.string().uuid(),revision:z.number().int().nonnegative()});
const createSchema=z.object({title:z.string().trim().min(1).max(100),stagingMode:stagingModeSchema,framePolicy:framePolicySchema,cameraPolicy:cameraPolicySchema.optional()}).strict();
const editSchema=z.discriminatedUnion('operation',[
  targetSchema.extend({operation:z.literal('project'),action:z.enum(PROJECT_BROWSER_ACTIONS),itemId:z.string().uuid().optional(),data:z.unknown().optional()}).strict(),
  targetSchema.extend({operation:z.literal('directing'),action:z.enum(DIRECTING_BROWSER_ACTIONS),data:z.unknown().optional()}).strict(),
]);
// Deliberately mirrors /generate-storyboard rather than exposing generic paid calls.
const storyboardSchema=targetSchema.extend({
  keyframe:z.enum(['start','middle','end']).default('start'),batchId:z.string().uuid(),model:z.string().min(1),
  refs:z.array(z.string().uuid()).max(960),estimate:z.string().regex(/^\d+$/).nullable(),referenceMode:z.enum(['auto','selected']).default('auto'),
  imageSettings:imageSettingsSchema.optional(),imageRetry:imageRetrySchema.optional(),
  plans:z.array(z.object({itemId:z.string().uuid(),prompt:z.string().trim().min(1).max(MEDIA_INPUT_LIMIT),instruction:z.string().trim().max(MEDIA_INPUT_LIMIT).optional(),refs:z.array(z.string().uuid()).max(8).optional()}).strict()).min(1).max(120),
}).strict();

export function filmSummary(p:Project){
  const cut=(value:unknown,limit=12000)=>typeof value==='string'?value.slice(0,limit):undefined;
  const actor=(v:any)=>v?{identity:cut(v.identity,2000),role:cut(v.role,2000),motivation:cut(v.motivation,2000),contradiction:cut(v.contradiction,2000),mannerisms:cut(v.mannerisms,2000),traits:v.traits?.slice(0,20).map((t:any)=>({name:t.name,intensity:t.intensity,instruction:cut(t.instruction,1000)}))}:undefined;
  const character=(v:any)=>v?{name:v.name,appearance:cut(v.appearance,2000),description:cut(v.description,4000),instructions:cut(v.instructions,4000),locked:cut(v.locked,4000),refs:v.refs,actorProfile:actor(v.actorProfile)}:undefined;
  const location=(v:any)=>v?{name:v.name,identity:cut(v.identity,2000),geography:cut(v.geography,2000),permanentProps:cut(v.permanentProps,2000),refs:v.refs,approvedAngles:v.approvedAngles?.slice(0,24).map((a:any)=>({id:a.id,name:a.name,description:cut(a.description,2000),refs:a.refs}))}:undefined;
  const smallVariant=(v:any)=>({id:v.id,title:v.title,kind:v.kind,assetId:v.assetId,model:v.model,text:cut(v.text),duration:v.duration,
    character:character(v.character),location:location(v.location)});
  return {id:p.id,title:p.title,revision:p.revision,seconds:p.seconds,format:p.format,productionOrder:p.productionOrder,
    counts:{items:p.items.length,jobs:p.jobs.length,scenes:p.directing?.scenes.length??0,animatics:p.animatic?.variants.length??0},
    brief:p.directing?.brief,scenes:p.directing?.scenes.map(s=>({id:s.id,title:s.title,location:s.location,purpose:cut(s.purpose,2000),stateIn:cut(s.stateIn,2000),stateOut:cut(s.stateOut,2000),shots:s.shots.map(shot=>({id:shot.id,title:shot.title,duration:shot.duration,approved:shot.approved}))})),
    items:p.items.filter(i=>!i.removedAt&&!i.planArchive).map(i=>{const approved=i.variants.find(v=>v.id===i.approvedId);return {id:i.id,stage:i.stage,title:i.title,selectedId:i.selectedId,approvedId:i.approvedId,variantCount:i.variants.length,
      characterProfile:character(approved?.character??i.character),characterProfileSource:approved?.character?'approved-variant':i.character?'item':undefined,
      locationProfile:location(approved?.location??i.location),locationProfileSource:approved?.location?'approved-variant':i.location?'item':undefined,
      variants:i.variants.filter(v=>v.id===i.selectedId||v.id===i.approvedId).map(smallVariant),
      availableVariants:i.variants.map(v=>({id:v.id,title:v.title,kind:v.kind,assetId:v.assetId,model:v.model}))};}),
    jobs:p.jobs.slice(-20).map(j=>({id:j.id,itemId:j.itemId,model:j.model,status:j.status,purpose:j.purpose,error:cut(j.error,1500),warning:cut(j.warning,1000),created:j.created,estimate:j.estimate,actual:j.actual})),
    runs:p.directing?.runs.slice(-3).map(r=>({id:r.id,mode:r.mode,stopped:r.stopped,published:r.published,tasks:r.tasks.map(t=>({id:t.id,role:t.role,applied:t.applied,error:cut(t.error,1500)}))})),
    animaticSettings:p.animaticSettings,animatic:p.animatic?{selectedId:p.animatic.selectedId,approvedId:p.animatic.approvedId,variants:p.animatic.variants.filter(v=>v.id===p.animatic?.selectedId||v.id===p.animatic?.approvedId).map(smallVariant)}:undefined};
}
export type FilmBrowserBridge={
  current:()=>Project|undefined;activeProjectId:()=>string;
  readCurrent:(projectId:string)=>Promise<Project>;readConnections:()=>Promise<unknown>;
  request:(path:string,method:'POST'|'PATCH',body:unknown)=>Promise<Project>;
  replace:(project:Project)=>void;openProject:(id:string)=>void;
  run:<T>(work:()=>Promise<T>)=>Promise<T>;assembleSilent:(project:Project)=>Promise<void>;
};
export function assertBrowserFilmTarget(bridge:FilmBrowserBridge,input:{projectId:string;revision:number}){
  const p=bridge.current();
  if(!p||p.id!==input.projectId||bridge.activeProjectId()!==input.projectId)throw Error('Откройте указанный фильм: действие разрешено только для текущего проекта.');
  if(p.revision!==input.revision)throw Error('Проект изменился. Прочитайте актуальное состояние перед действием.');
  return p;
}
export function assertEmptyBrowserFilmItem(p:Project,itemId:string){
  const item=p.items.find(i=>i.id===itemId);
  if(!item||![1,2,3].includes(item.stage)||item.removedAt||item.planArchive||item.sourceShot||item.variants.length||item.character||item.location||item.characterHistory?.length||item.selectedId||item.approvedId||p.removedVariants?.some(v=>v.itemId===itemId)||p.jobs.some(j=>j.itemId===itemId))throw Error('Удалить можно только пустую карточку героя, стиля или локации без профиля, вариантов, истории и генераций.');
  return item;
}
export function filmBrowserTools(getBridge:()=>FilmBrowserBridge){
  const define=(name:string,title:string,description:string,schema:z.ZodType,execute:(input:any)=>unknown|Promise<unknown>,readOnlyHint=false)=>({name,title,description,inputSchema:z.toJSONSchema(schema),annotations:{readOnlyHint,untrustedContentHint:true},execute:(input:unknown)=>execute(schema.parse(input))});
  const receipt=(bridge:FilmBrowserBridge,project:Project)=>{bridge.replace(project);return filmSummary(project);};
  return [
    define('read_film_summary','Краткое состояние фильма','Текущий фильм, выбранные материалы, структура сцен, последние задачи. refresh=true перечитывает сохранённое состояние штатным GET, не запускает генерации. Без полной истории, секретов и фотографий.',z.object({refresh:z.boolean().optional()}).strict(),async input=>{const b=getBridge();let p=b.current();if(input.refresh){const projectId=b.activeProjectId();z.string().uuid().parse(projectId);p=await b.readCurrent(projectId);if(b.activeProjectId()!==projectId)throw Error('Проект сменился во время чтения.');b.replace(p);}return p?filmSummary(p):{error:'Проект не открыт'};},true),
    define('read_model_catalog','Модели и подключения','Каталог моделей и наличие сохранённого подключения, без API-ключей. configured означает только сохранённый ключ, не проверку баланса или доступа.',z.object({kind:z.enum(['text','image','audio','video']).optional()}).strict(),async input=>{const response:any=await getBridge().readConnections();const providers=Array.isArray(response?.providers)?response.providers.map((p:any)=>({id:String(p.id),name:typeof p.name==='string'?p.name:undefined,configured:p.configured===true})):[];return {providers,models:MODELS.filter(m=>!input.kind||m.kind===input.kind).map(m=>({id:m.id,name:m.name,kind:m.kind,provider:m.provider,configured:providers.some((p:any)=>p.id===m.provider&&p.configured),availableForDirecting:availableForDirecting(m.id),estimate:m.estimate,note:m.note}))};},true),
    define('create_film_project','Создать фильм','Создать и открыть отдельный фильм по прямому запросу пользователя. Настройки постановки обязательны. Генерацию не запускает.',createSchema,input=>{const b=getBridge();return b.run(async()=>{const p=await b.request('/api/projects','POST',input);b.replace(p);b.openProject(p.id);return filmSummary(p);});}),
    define('edit_current_film','Изменить текущий фильм','Выполнить явно выбранное действие создания, правки, выбора или утверждения в текущем фильме. Только штатные project/directing операции; run/scriptRun/publish могут создавать платные текстовые задания и требуют запроса пользователя.',editSchema,input=>{const b=getBridge();return b.run(async()=>{assertBrowserFilmTarget(b,input);const {projectId,operation,...body}=input;const next=await b.request(`/api/projects/${projectId}${operation==='directing'?'/directing':''}`,operation==='directing'?'POST':'PATCH',body);if(b.activeProjectId()!==projectId)throw Error('Проект сменился во время действия; обновите состояние.');return receipt(b,next);});}),
    define('cleanup_empty_film_item','Убрать пустую карточку','Удалить только пустую заготовку героя, стиля или локации без профиля, вариантов, истории и генераций. Заполненные и относящиеся к планам карточки запрещены. Сервер сохраняет обычные проверки.',targetSchema.extend({itemId:z.string().uuid()}).strict(),input=>{const b=getBridge();return b.run(async()=>{const p=assertBrowserFilmTarget(b,input);assertEmptyBrowserFilmItem(p,input.itemId);const next=await b.request(`/api/projects/${input.projectId}`,'PATCH',{revision:input.revision,action:'removeEmpty',itemId:input.itemId});if(b.activeProjectId()!==input.projectId)throw Error('Проект сменился во время действия.');return receipt(b,next);});}),
    define('generate_storyboard_images','Создать изображения раскадровки','По прямому запросу пользователя запустить платную серию изображений выбранных планов одной моделью. Использует штатные проверки утверждений, доступности ключей, бюджета и revision. batchId сохраняется для защиты от повторного запуска.',storyboardSchema,input=>{const b=getBridge();return b.run(async()=>{assertBrowserFilmTarget(b,input);const {projectId,...body}=input;const next=await b.request(`/api/projects/${projectId}/generate-storyboard`,'POST',body);if(b.activeProjectId()!==projectId)throw Error('Проект сменился во время запуска; проверьте журнал.');return receipt(b,next);});}),
    define('assemble_silent_animatic','Собрать аниматик без звука','Собрать MP4 в браузере, скачать и сохранить карточку аниматика штатным монтажным процессом. Требует заранее сохранённые настройки sound:silent, music:false и утверждённую раскадровку. Видео нейросетью не генерирует.',targetSchema.strict(),input=>{const b=getBridge();return b.run(async()=>{const p=assertBrowserFilmTarget(b,input);if(p.animaticSettings?.sound!=='silent'||p.animaticSettings?.music!==false)throw Error('Сначала сохраните настройки аниматика: sound="silent", music=false.');await b.assembleSilent(p);if(b.activeProjectId()!==input.projectId)throw Error('Проект сменился во время сборки; проверьте сохранение.');const current=b.current();if(!current)throw Error('Откройте проект.');return filmSummary(current);});}),
  ];
}
