'use client';
import {useEffect,useState, type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import type {Item,Project} from '@/lib/domain';
import {money} from '@/lib/domain';
import type {Scene} from '@/lib/directing';
import {MODELS} from '@/lib/models';
import {availableForDirecting} from '@/lib/model-capabilities';
import {createLocationImageJobs,locationImageItems,hasLocationImage} from '@/lib/scene-locations';
import {VersionComparison} from './version-comparison';
import {
  actorForItem,actorProfileText,actorDraftPrompt,emptyActorProfile,emptyLocation,emptyLocationState,
  locationDraftForItem,locationForItem,locationItems,locationProfileSchema,locationStateSchema,actorProfileSchema,
  type LocationProfile,type LocationState,type ActorProfile,
} from '@/lib/world-assets';

const Field=({label,children}:{label:string;children:ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;
const message=(error:unknown)=>error instanceof Error?error.message:'Не удалось сохранить изменения.';
function imageChoices(p:Project){
  const seen=new Set<string>();const rows:{id:string;label:string}[]=[];
  const add=(id:string,label:string)=>{if(!seen.has(id)&&!p.hiddenReferenceIds?.includes(id)){seen.add(id);rows.push({id,label});}};
  for(const i of p.items.filter(i=>!i.removedAt&&!i.planArchive)){
    for(const [n,id] of (i.character?.refs??[]).entries())add(id,`${i.title} · исходное фото ${n+1}`);
    for(const v of i.variants)if(v.kind==='image'&&v.assetId)add(v.assetId,`${i.title} · ${v.title}`);
    const location=locationDraftForItem(i);if(location){for(const id of location.refs)add(id,location.name);for(const a of location.approvedAngles)for(const id of a.refs)add(id,`${location.name} · ${a.name}`);}
  }
  return rows;
}
function ImagePicker({p,value,onChange,disabled,onUpload}:{p:Project;value:string[];onChange:(refs:string[])=>void;disabled:boolean;onUpload?:(file:File)=>Promise<string>}){
  const [error,setError]=useState(''),[uploading,setUploading]=useState(false);const choices=imageChoices(p);
  const extra=value.filter(id=>!choices.some(c=>c.id===id)).map((id,n)=>({id,label:`Сохранённый референс ${n+1}`}));
  return <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-3">
    {[...extra,...choices].map(row=><label key={row.id} className="border rounded p-2 text-xs space-y-2"><img src={'/api/assets/'+row.id} className="w-full h-24 object-contain" alt={row.label} loading="lazy"/><span className="flex items-start gap-2"><input type="checkbox" disabled={disabled||uploading} checked={value.includes(row.id)} onChange={e=>onChange(e.target.checked?[...value,row.id]:value.filter(id=>id!==row.id))}/>{row.label}</span></label>)}
  </div>{!choices.length&&!extra.length&&<p className="text-sm text-muted-foreground">В этом проекте пока нет изображений. Описание локации можно сохранить без референсов.</p>}
  {!!onUpload&&<label className="block text-sm">Добавить изображение локации<input className="block" type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||uploading} onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;setUploading(true);setError('');try{const id=await onUpload(file);if(!value.includes(id))onChange([...value,id]);}catch(err){setError(message(err));}finally{setUploading(false);}
  }}/></label>}{error&&<p role="alert">{error}</p>}</div>;
}

export type LocationLibraryEditorProps={p:Project;busy:boolean;onSave:(itemId:string|undefined,profile:LocationProfile)=>Promise<unknown>;onRemove?:(itemId:string)=>Promise<unknown>;onRestore?:(itemId:string)=>Promise<unknown>;onUpload?:(file:File)=>Promise<string>;onPrepare?:()=>Promise<unknown>;onGenerate?:(data:{revision:number;batchId:string;model:string;itemIds:string[];count:number;estimate:string|null})=>Promise<unknown>;onSaveScene?:SceneLocationEditorProps['onSave'];connections?:{providers?:{id:string;configured:boolean}[]}};
export function LocationLibraryEditor(props:LocationLibraryEditorProps){
  const [id,setId]=useState(locationItems(props.p)[0]?.id??'new');const item=props.p.items.find(i=>i.id===id&&!i.removedAt&&!i.planArchive);
  const [newForm,setNewForm]=useState(0),[pending,setPending]=useState<{profile:LocationProfile;previousIds:string[]}>();
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(id==='new'&&newForm===0&&!dirty&&!pending&&locationItems(props.p).length)setId(locationItems(props.p)[0].id);},[props.p.items,id,newForm,dirty,pending]);
  useEffect(()=>{if(!pending)return;const matches=locationItems(props.p).filter(i=>!pending.previousIds.includes(i.id)&&JSON.stringify(locationDraftForItem(i))===JSON.stringify(pending.profile));if(matches.length===1){setId(matches[0].id);setPending(undefined);}},[props.p.items,pending]);
  const save=async(itemId:string|undefined,profile:LocationProfile)=>{await props.onSave(itemId,profile);if(!itemId)setPending({profile,previousIds:props.p.items.map(i=>i.id)});};
  return <section className="editor-surface p-5 space-y-4" aria-label="Библиотека постоянных локаций"><h3>Постоянные локации фильма</h3><p className="text-sm text-muted-foreground">Сохраните место один раз. Свет, погоду, время суток и состояние декораций задавайте отдельно для сцены. Новые версии и изображения сохраняются в карточке локации.</p>
    {!!props.onPrepare&&<Button variant="outline" disabled={props.busy||dirty||!!pending} onClick={()=>void props.onPrepare!()}>Выделить недостающие локации из сцен</Button>}
    <div className="space-y-2">{locationItems(props.p).map(i=><div key={i.id} className="border rounded p-3"><strong>{locationDraftForItem(i)?.name??i.title}</strong><p className="text-sm">Сцены: {props.p.directing?.scenes.filter(s=>s.locationIds?.includes(i.id)).map(s=>s.title).join('; ')||'не привязана'} · {hasLocationImage(i)?'изображение создано':'нужно изображение'}</p></div>)}</div>
    <div className="flex flex-wrap gap-2"><select className="rounded border p-2 bg-background" value={item?.id??'new'} aria-label="Локация для редактирования" onChange={e=>{setId(e.target.value);setDirty(false);if(e.target.value==='new')setNewForm(n=>n+1);}} disabled={props.busy||!!pending||dirty}><option value="new">Новая локация</option>{locationItems(props.p).map(i=><option key={i.id} value={i.id}>{locationDraftForItem(i)?.name??i.title}</option>)}</select><Button variant="outline" disabled={props.busy||!!pending||dirty} onClick={()=>{setId('new');setNewForm(n=>n+1);}}>Добавить локацию</Button></div>
    <LocationForm key={props.p.id+':'+(item?.id??'new:'+newForm)} {...props} busy={props.busy||!!pending} onSave={save} item={item} onDirty={setDirty}/>
    {dirty&&<p role="status">Сохраните правки локации перед переключением или запуском серии.</p>}
    {!!props.onGenerate&&<LocationGenerationEditor {...props} busy={props.busy||dirty||!!pending} onGenerate={props.onGenerate}/>}
    {!!props.onSaveScene&&!!props.p.directing?.scenes.length&&<details><summary>Привязка локаций, свет и состояние по сценам</summary><div className="space-y-4 mt-4">{props.p.directing.scenes.map(scene=><SceneLocationEditor key={props.p.id+':'+scene.id+':'+JSON.stringify([scene.locationIds,scene.locationState])} p={props.p} scene={scene} busy={props.busy||dirty} onSave={props.onSaveScene!}/>)}</div></details>}
    {!!props.onRestore&&props.p.items.some(i=>i.stage===3&&i.removedAt)&&<details><summary>Удалённые локации</summary>{props.p.items.filter(i=>i.stage===3&&i.removedAt).map(i=><div key={i.id} className="flex items-center justify-between gap-2 py-2"><span>{i.title}</span><Button type="button" size="sm" variant="outline" disabled={props.busy} onClick={()=>void props.onRestore!(i.id)}>Восстановить локацию</Button></div>)}</details>}
  </section>;
}
function LocationForm({p,item,busy,onSave,onRemove,onUpload,onDirty}:LocationLibraryEditorProps&{item?:Item;onDirty?:(dirty:boolean)=>void}){
  const [draft,setDraft]=useState<LocationProfile>(()=>structuredClone(item?locationDraftForItem(item)??emptyLocation(item.title):emptyLocation()));
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const disabled=busy||working;
  const patch=<K extends keyof LocationProfile>(key:K,value:LocationProfile[K])=>{setDraft(d=>({...d,[key]:value}));setNotice('');onDirty?.(true);};
  async function save(){setWorking(true);setError('');try{const profile=locationProfileSchema.parse(draft);await onSave(item?.id,profile);onDirty?.(false);setNotice('Локация сохранена новой версией. Изображения создаются из этого описания; утвердите подходящий вариант в карточке материалов.');}catch(err){setError(message(err));}finally{setWorking(false);}}
  return <div className="space-y-4"><fieldset disabled={disabled} className="space-y-4">
    <Field label="Название локации"><Input value={draft.name} maxLength={100} onChange={e=>patch('name',e.target.value)}/></Field>
    {(['identity','geography','permanentProps'] as const).map((key,n)=><Field key={key} label={['Неизменные признаки места','География и пространственные связи','Постоянные предметы и декорации'][n]}><Textarea rows={3} maxLength={2000} value={draft[key]} onChange={e=>patch(key,e.target.value)}/></Field>)}
    <details><summary>Основные референсы места · {draft.refs.length}</summary><ImagePicker p={p} value={draft.refs} onChange={refs=>patch('refs',refs)} disabled={disabled} onUpload={onUpload}/></details>
    <div className="space-y-3"><h4>Утверждённые ракурсы</h4><p className="text-sm text-muted-foreground">Добавляйте только проверенные виды этого места. Сцена выберет нужный ракурс; остальные изображения к её генерации автоматически не прикрепляются.</p>
      {draft.approvedAngles.map((angle,n)=><article className="rounded border p-3 space-y-2" key={angle.id}><Field label="Название ракурса"><Input value={angle.name} maxLength={100} onChange={e=>patch('approvedAngles',draft.approvedAngles.map((a,j)=>j===n?{...a,name:e.target.value}:a))}/></Field><Field label="Описание геометрии и точки съёмки"><Textarea value={angle.description} maxLength={2000} onChange={e=>patch('approvedAngles',draft.approvedAngles.map((a,j)=>j===n?{...a,description:e.target.value}:a))}/></Field><details><summary>Изображения ракурса · {angle.refs.length}</summary><ImagePicker p={p} value={angle.refs} onChange={refs=>patch('approvedAngles',draft.approvedAngles.map((a,j)=>j===n?{...a,refs}:a))} disabled={disabled} onUpload={onUpload}/></details><Button type="button" variant="ghost" onClick={()=>patch('approvedAngles',draft.approvedAngles.filter(a=>a.id!==angle.id))}>Удалить ракурс</Button></article>)}
      <Button type="button" variant="outline" disabled={draft.approvedAngles.length>=24} onClick={()=>patch('approvedAngles',[...draft.approvedAngles,{id:crypto.randomUUID(),name:'Новый ракурс',description:'',refs:[]}])}>Добавить проверенный ракурс</Button>
    </div><div className="flex flex-wrap gap-2"><Button type="button" onClick={()=>void save()}>Сохранить локацию</Button>{item&&onRemove&&<Button type="button" variant="ghost" onClick={async()=>{setWorking(true);setError('');try{await onRemove(item.id);}catch(err){setError(message(err));}finally{setWorking(false);}}}>Удалить локацию</Button>}</div>
  </fieldset>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}</div>;
}

function LocationGenerationEditor({p,busy,connections,onGenerate}:LocationLibraryEditorProps&{onGenerate:NonNullable<LocationLibraryEditorProps['onGenerate']>}){
  const models=MODELS.filter(m=>m.kind==='image'&&availableForDirecting(m.id)&&connections?.providers?.some(c=>c.id===m.provider&&c.configured));
  const [modelId,setModelId]=useState(models[0]?.id??''),[count,setCount]=useState(1),[scope,setScope]=useState<'remaining'|'all'>('remaining');
  useEffect(()=>{if(!modelId&&models.length)setModelId(models[0].id);},[modelId,models[0]?.id]);
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[batchId,setBatchId]=useState(()=>crypto.randomUUID());
  const m=models.find(m=>m.id===modelId),rows=locationImageItems(p).filter(i=>scope==='all'||!hasLocationImage(i));
  let preview:ReturnType<typeof createLocationImageJobs>=[],issue='';
  try{if(rows.length&&m)preview=createLocationImageJobs(p,{batchId,model:m.id,count,itemIds:rows.map(i=>i.id),estimate:m.estimate});}catch(err){issue=message(err);}
  const total=preview.some(j=>j.estimate===null)?null:preview.reduce((sum,j)=>sum+BigInt(j.estimate??'0'),0n).toString();
  return <section className="border rounded p-4 space-y-3" aria-label="Генерация изображений локаций"><h4>Создать изображения локаций одним запуском</h4>
    <fieldset disabled={busy||working} className="space-y-3">
      <Field label="Модель изображений локаций"><select className="w-full rounded border p-2 bg-background" value={modelId} onChange={e=>{setModelId(e.target.value);setBatchId(crypto.randomUUID());setError('');}}>{models.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></Field>
      {!models.length&&<p>Добавьте API-ключ модели изображений в «Подключениях».</p>}
      <Field label="Набор локаций"><select className="w-full rounded border p-2 bg-background" value={scope} onChange={e=>{setScope(e.target.value as typeof scope);setBatchId(crypto.randomUUID());}}><option value="remaining">Только без изображений</option><option value="all">Все локации сцен — новые варианты</option></select></Field>
      <Field label="Вариантов для каждой локации"><Input type="number" min={1} max={4} value={count} onChange={e=>{setCount(Number(e.target.value));setBatchId(crypto.randomUUID());}}/></Field>
      <p>Локаций: {rows.length} · Изображений: {rows.length*count} · Оценка серии: {money(total)}. Повторная генерация оплачивается отдельно. Результаты сохраняются без автоматического утверждения.</p>
      {!!preview.length&&<details><summary>Проверить промпты и смету</summary>{preview.map((job,n)=><article key={job.id} className="space-y-2 py-3"><strong>{p.items.find(i=>i.id===job.itemId)?.title} · вариант {n%count+1} · {money(job.estimate)}</strong><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{job.prompt}</pre></article>)}</details>}
      {issue&&<p role="status">{issue}</p>}
      <Button disabled={!m||!rows.length||!!issue} onClick={async()=>{setWorking(true);setError('');setNotice('');try{await onGenerate({revision:p.revision,batchId,model:modelId,count,itemIds:rows.map(i=>i.id),estimate:m!.estimate});setBatchId(crypto.randomUUID());setNotice('Изображения добавлены в общую параллельную очередь. Выберите и утвердите результаты в карточках локаций ниже.');}catch(err){setError(message(err));}finally{setWorking(false);}}}>Создать изображения {rows.length} локаций</Button>
    </fieldset>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>;
}

export type SceneLocationEditorProps={p:Project;scene:Scene&{locationState?:LocationState};busy:boolean;onSave:(sceneId:string,data:{locationIds:string[];locationState:LocationState})=>Promise<unknown>};
export function SceneLocationEditor({p,scene,busy,onSave}:SceneLocationEditorProps){
  const [ids,setIds]=useState(scene.locationIds??[]),[state,setState]=useState<LocationState>(()=>structuredClone(scene.locationState??emptyLocationState()));
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const disabled=busy||working;
  const locations=locationItems(p),angles=locations.filter(i=>ids.includes(i.id)).flatMap(i=>locationForItem(i)!.approvedAngles.map(a=>({...a,location:locationForItem(i)!.name})));
  function toggle(id:string,on:boolean){const next=on?[...ids,id]:ids.filter(v=>v!==id);setIds(next);const valid=new Set(locations.filter(i=>next.includes(i.id)).flatMap(i=>locationForItem(i)!.approvedAngles.map(a=>a.id)));setState(s=>({...s,angleIds:s.angleIds?.filter(id=>valid.has(id))}));setNotice('');}
  return <section className="space-y-4 border rounded p-4" aria-label={`Локация и состояние сцены ${scene.title}`}><h4>Локация и состояние: {scene.title}</h4><fieldset disabled={disabled} className="space-y-4">
    <div className="flex flex-wrap gap-3">{locations.map(i=><label key={i.id} className="flex items-center gap-2"><input type="checkbox" checked={ids.includes(i.id)} onChange={e=>toggle(i.id,e.target.checked)}/>{locationForItem(i)!.name}</label>)}</div>{!locations.length&&<p>Сначала сохраните постоянную локацию на этапе «Образы и локации».</p>}
    {(['time','light','weather','layout','allowedChanges','artDirection'] as const).map((key,n)=><Field key={key} label={['Время суток','Свет','Погода','Расположение декораций в сцене','Разрешённые изменения места','Художественное решение сцены'][n]}><Textarea rows={2} maxLength={key==='time'?300:key==='weather'?1000:2000} value={state[key]} onChange={e=>{setState(s=>({...s,[key]:e.target.value}));setNotice('');}}/></Field>)}
    {!!angles.length&&<div className="space-y-2"><h5>Ракурсы для этой сцены</h5>{angles.map(a=><label key={a.id} className="flex items-center gap-2"><input type="checkbox" checked={state.angleIds?.includes(a.id)??false} onChange={e=>setState(s=>({...s,angleIds:e.target.checked?[...(s.angleIds??[]),a.id]:(s.angleIds??[]).filter(id=>id!==a.id)}))}/>{a.location} · {a.name}</label>)}</div>}
    <Button type="button" onClick={async()=>{setWorking(true);setError('');try{await onSave(scene.id,{locationIds:ids,locationState:locationStateSchema.parse(state)});setNotice('Состояние сцены сохранено. Постоянная локация остаётся общей для фильма.');}catch(err){setError(message(err));}finally{setWorking(false);}}}>Сохранить локацию и состояние сцены</Button>
  </fieldset>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}</section>;
}

export type ActorProfileEditorProps={p:Project;item:Item;busy:boolean;onSave:(itemId:string,profile:ActorProfile)=>Promise<unknown>;onGenerate:(itemId:string,data:{model:string;instruction:string;actorProfile:ActorProfile})=>Promise<unknown>;onChooseDraft?:(itemId:string,variantId:string)=>Promise<unknown>};
export function ActorProfileEditor({p,item,busy,onSave,onGenerate,onChooseDraft}:ActorProfileEditorProps){
  const [draft,setDraft]=useState<ActorProfile>(()=>structuredClone(actorForItem(item)??emptyActorProfile()));
  const [instruction,setInstruction]=useState('Уточни образ героя в контексте фильма: мотивацию, внутреннее противоречие, манеру поведения и наблюдаемое выражение заданных особенностей. Сохрани исходную внешность.');
  const textModels=MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)&&(!item.character?.refs.length||m.provider!=='minimax'));const [modelChoice,setModel]=useState(textModels[0]?.id??'');const model=textModels.find(m=>m.id===modelChoice)?.id??textModels[0]?.id??'';
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const disabled=busy||working;
  let preview='';try{preview=actorDraftPrompt(p,item,instruction,draft);}catch(err){preview=message(err);}
  const candidates=item.variants.filter(v=>v.characterDraft&&!!(v.character as (typeof v.character&{actorProfile?:ActorProfile}))?.actorProfile);
  async function act(callback:()=>Promise<unknown>,success:string){setWorking(true);setError('');try{await callback();setNotice(success);}catch(err){setError(message(err));}finally{setWorking(false);}}
  return <section className="border rounded p-4 space-y-4" aria-label={`Актёрский образ ${item.title}`}><h4>Актёрский образ: {item.character?.name??item.title}</h4><p className="text-sm text-muted-foreground">Постоянная внешность хранится отдельно от костюма и эмоций сцены. ИИ получает фотографии героя, исходное описание, запреты на изменения, утверждённый сценарий, стиль и локации. Голос выбирается отдельно на этапе «Звуки».</p><fieldset disabled={disabled} className="space-y-4">
    {(['identity','role','motivation','contradiction','mannerisms'] as const).map((key,n)=><Field key={key} label={['Неизменная физическая идентичность','Роль в картине','Чего добивается герой','Внутреннее противоречие','Привычки, жесты и манера поведения'][n]}><Textarea rows={2} value={draft[key]} maxLength={2000} onChange={e=>{setDraft(d=>({...d,[key]:e.target.value}));setNotice('');}}/></Field>)}
    <div className="space-y-3"><h5>Выраженность особенностей</h5>{draft.traits.map((trait,n)=><article className="border rounded p-3 space-y-2" key={n}><Field label="Особенность"><Input maxLength={100} value={trait.name} onChange={e=>setDraft(d=>({...d,traits:d.traits.map((t,j)=>j===n?{...t,name:e.target.value}:t)}))}/></Field><Field label={`Выраженность · ${trait.intensity}/10`}><input type="range" min={0} max={10} step={1} value={trait.intensity} onChange={e=>setDraft(d=>({...d,traits:d.traits.map((t,j)=>j===n?{...t,intensity:Number(e.target.value)}:t)}))}/></Field><Field label="Как показать особенность действием или внешностью"><Textarea value={trait.instruction} maxLength={1000} onChange={e=>setDraft(d=>({...d,traits:d.traits.map((t,j)=>j===n?{...t,instruction:e.target.value}:t)}))}/></Field><Button variant="ghost" type="button" onClick={()=>setDraft(d=>({...d,traits:d.traits.filter((_,j)=>j!==n)}))}>Удалить особенность</Button></article>)}
      <Button type="button" variant="outline" disabled={draft.traits.length>=20} onClick={()=>setDraft(d=>({...d,traits:[...d.traits,{name:'Новая особенность',intensity:5,instruction:''}]}))}>Добавить особенность</Button><p className="text-sm text-muted-foreground">0 — не усиливать эту особенность; 10 — ярко выражать её, сохраняя идентичность героя.</p>
    </div><Button type="button" onClick={()=>void act(()=>onSave(item.id,actorProfileSchema.parse(draft)),'Актёрский профиль сохранён. Изображение героя утверждается отдельно.')}>Сохранить актёрский профиль</Button>
    <Field label="Текстовая модель агента героя"><select className="w-full rounded border p-2 bg-background" value={model} onChange={e=>setModel(e.target.value)}>{textModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    <Field label="Задача агенту героя"><Textarea rows={3} value={instruction} maxLength={3000} onChange={e=>setInstruction(e.target.value)}/></Field>
    <details><summary>Фактический промпт агента · предпросмотр следующего запроса</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{preview}</pre></details>
    <p className="text-sm text-muted-foreground">Это отдельный запрос к модели. Его расход сохранится в журнале. Результат добавится вариантом описания; текущий образ автоматически не заменяется.</p>
    <Button type="button" disabled={!model||!item.character} onClick={()=>void act(()=>onGenerate(item.id,{model,instruction,actorProfile:actorProfileSchema.parse(draft)}),'Проработка запущена. Результат появится среди вариантов описания.')}>Предложить описание агентом героя</Button>
  </fieldset>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
    {!!candidates.length&&<VersionComparison title="Сравнение описаний героя" disabled={disabled} versions={[
      {id:'current:'+item.id,label:'Текущее описание',text:[item.character?.description,actorProfileText(actorForItem(item)??emptyActorProfile())].filter(Boolean).join('\n\n'),selectable:false},
      ...candidates.map(v=>({id:v.id,label:v.title,text:[v.character!.description,actorProfileText((v.character as typeof v.character&{actorProfile:ActorProfile}).actorProfile)].join('\n\n'),metadata:{created:v.created,model:v.model,origin:v.versionInfo?.reason??'Актёрская проработка',actualCost:v.jobId?money(p.jobs.find(j=>j.id===v.jobId)?.actual):'Без генерации'}})),
    ]} onChoose={onChooseDraft?async v=>{await onChooseDraft(item.id,v.id);const c=candidates.find(c=>c.id===v.id);if(c)setDraft(structuredClone((c.character as typeof c.character&{actorProfile:ActorProfile}).actorProfile));}:undefined}/>} 
    {p.jobs.filter(j=>j.itemId===item.id&&j.purpose==='directing'&&j.character).map(job=><details key={job.id}><summary>{new Date(job.created).toLocaleString('ru')} · {job.brief} · {job.status} · расход: {money(job.actual)}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{job.prompt}</pre>{job.error&&<p role="alert">{job.error}</p>}</details>)}
  </section>;
}
