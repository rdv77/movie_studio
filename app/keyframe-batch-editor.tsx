'use client';
import {ImageRetrySettings} from './image-retry-settings';
import type {ImageRetryOptions} from '@/lib/image-retries';
import {useMemo,useState} from 'react';
import {additionalFrameItems,additionalFrameAdmission,type AdditionalFrameRole} from '@/lib/keyframe-batch';
import {availableForDirecting} from '@/lib/model-capabilities';
import {Button} from '@/components/ui/button';
import type {Project} from '@/lib/domain';
import {money} from '@/lib/domain';
import {model,MODELS} from '@/lib/models';
import {planReferenceIds} from '@/lib/plan-references';
import {storyboardPrompt} from '@/lib/storyboard';
import {selectedKeyframe,prepareKeyframeGeneration,KEYFRAME_ROLE_NAMES} from '@/lib/keyframes';
import {compilePrompt} from '@/lib/prompt-compiler';
import {grokImageEstimate,GROK_IMAGE_MODEL} from '@/lib/image-quality';

export function KeyframeBatchEditor({p,busy,submit,permitMissingFrames,openPlan,connections,initiallyOpen=false}:{
  p:Project;busy:boolean;submit:(data:unknown)=>Promise<unknown>;
  permitMissingFrames?:(role:AdditionalFrameRole,itemIds:string[])=>Promise<Project>;openPlan?:(itemId:string)=>void;
  initiallyOpen?:boolean;connections?:{providers?:{id:string;configured:boolean}[]};
}){
  const [imageRetry,setImageRetry]=useState<ImageRetryOptions>({maxAttempts:3});
  const [role,setRole]=useState<AdditionalFrameRole>('end');
  const [opened,setOpened]=useState(initiallyOpen),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[fallback,setFallback]=useState(GROK_IMAGE_MODEL);
  const [view,setView]=useState<'missing'|'all'>('missing');
  const rows=useMemo(()=>additionalFrameItems(p,role).map(item=>{
    const admission=additionalFrameAdmission(p,item,role),first=selectedKeyframe(item,'start');
    let reason=admission.blocked,estimate:string|null=null;const modelId=first?.jobId?first.model:fallback;
    try{const m=model(modelId),prepared=prepareKeyframeGeneration(p,item.id,role,{model:m.id,refs:planReferenceIds(p,item)});const compiled=compilePrompt(p,item,m.id,{kind:'image',keyframe:role,prompt:storyboardPrompt(p,item),keyframeInstruction:prepared.roleInstruction,references:prepared.refs,allowLegacyModel:!p.directing});estimate=m.id===GROK_IMAGE_MODEL?grokImageEstimate(prepared.imageSettings,compiled.references.length):m.estimate;}
    catch(e){reason=(e as Error).message;}
    return {item,first,...admission,reason,estimate,modelId};
  }),[p,role,fallback]);
  const [included,setIncluded]=useState<string[]>(()=>initiallyOpen?rows.filter(r=>!r.reason&&r.missing).map(r=>r.item.id):[]);
  const missing=rows.filter(r=>r.missing),visible=view==='missing'?missing:rows;
  const selected=rows.filter(r=>included.includes(r.item.id)&&!r.reason),needsPermission=selected.filter(r=>r.retryJobs.length);
  const total=selected.every(r=>r.estimate!==null)?selected.reduce((n,r)=>n+BigInt(r.estimate!),0n).toString():null;
  const disabled=busy||working;
  if(!additionalFrameItems(p,'end').length)return null;
  return <section id="storyboard-keyframe-batch" tabIndex={-1} className="editor-surface p-4 my-4 space-y-3">
    <Button variant="outline" disabled={disabled} onClick={()=>{setOpened(!opened);setView('missing');setIncluded(rows.filter(r=>!r.reason&&r.missing).map(r=>r.item.id));}}>Ключевые кадры · массовая генерация</Button>
    {opened&&<>
      <p>По одному выбранному ключевому кадру для отмеченных планов. Модель, качество и исходный файл берутся из выбранного первого кадра.</p>
      <label className="block">Роль кадра <select disabled={disabled} aria-label="Роль ключевого кадра серии" value={role} onChange={e=>{const next=e.target.value as AdditionalFrameRole;setRole(next);setView('missing');setIncluded(additionalFrameItems(p,next).filter(i=>{const r=additionalFrameAdmission(p,i,next);return r.missing&&!r.blocked;}).map(i=>i.id));setNotice('');setError('');}}><option value="end">Конечный</option><option value="middle">Промежуточный · для тройного набора</option></select></label>
      <p role="status"><strong>Недостающих изображений: {missing.length}.</strong> Из них требуют разрешения повтора: {missing.filter(r=>!r.reason&&r.retryJobs.length).length}. Выбрано для серии: {selected.length}.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Показать ключевые кадры">
        <Button variant={view==='missing'?'secondary':'outline'} aria-pressed={view==='missing'} onClick={()=>setView('missing')}>Недостающие · {missing.length}</Button>
        <Button variant={view==='all'?'secondary':'outline'} aria-pressed={view==='all'} onClick={()=>setView('all')}>Все планы · {rows.length}</Button>
        <Button variant="outline" disabled={disabled||!visible.some(r=>!r.reason)} onClick={()=>setIncluded(visible.filter(r=>!r.reason).map(r=>r.item.id))}>{view==='missing'?'Выбрать все недостающие':'Выбрать все показанные'} · {visible.filter(r=>!r.reason).length}</Button>
        <Button variant="ghost" disabled={disabled||!included.length} onClick={()=>setIncluded([])}>Снять все отметки</Button>
      </div>
      {view==='all'&&<p className="muted">Отметка плана с готовым изображением создаст дополнительный платный вариант. Для заполнения пропусков используйте «Недостающие».</p>}
      {!visible.length&&<p>{view==='missing'?'Все изображения этой роли уже созданы. Выберите и утвердите готовые варианты.':'Нет планов с этой ролью кадра.'}</p>}
      {!!needsPermission.length&&<section className="note space-y-2" aria-label="Разрешение повторов ключевых кадров">
        <strong>Разрешите повтор для {needsPermission.length} выбранных планов</strong>
        <p>Провайдер мог выполнить прежние запросы и списать оплату. Сначала проверьте журнал и восстановление сохранённых картинок. Кнопка ниже разрешает новую серию для перечисленных неизвестных запросов; сама генерацию не запускает. История и расходы сохраняются.</p>
        <Button variant="outline" disabled={disabled||!permitMissingFrames} onClick={async()=>{setWorking(true);setError('');setNotice('');try{await permitMissingFrames!(role,needsPermission.map(r=>r.item.id));setNotice('Повтор разрешён. Проверьте состав и нажмите «Создать ключевые кадры».');}catch(e){setError((e as Error).message);}finally{setWorking(false);}}}>Разрешить повтор для выбранных · {needsPermission.length}</Button>
      </section>}
      {visible.map(r=><article className="border rounded p-3 space-y-2" key={r.item.id} aria-label={'Ключевой кадр · '+r.item.title}>
        <label className="flex gap-3"><input type="checkbox" aria-label={'Создать '+KEYFRAME_ROLE_NAMES[role].toLowerCase()+' · '+r.item.title} disabled={disabled||!!r.reason} checked={included.includes(r.item.id)&&!r.reason} onChange={e=>setIncluded(ids=>e.target.checked?[...ids.filter(id=>id!==r.item.id),r.item.id]:ids.filter(id=>id!==r.item.id))}/><span><strong>{r.item.title}</strong><small className="block">{MODELS.find(m=>m.id===r.modelId)?.name??r.modelId} · оценка: {money(r.estimate)}</small></span></label>
        <div className="grid grid-cols-2 gap-3">
          <div>{r.first?.assetId&&<img loading="lazy" className="h-24 w-full object-contain" src={'/api/assets/'+r.first.assetId} alt={'Первый кадр · '+r.item.title}/>}<small>Выбранный первый кадр</small></div>
          <div>{r.images.length?<><img loading="lazy" className="h-24 w-full object-contain" src={'/api/assets/'+(r.selected??r.images.at(-1))!.assetId} alt={KEYFRAME_ROLE_NAMES[role]+' · '+r.item.title}/><small>{r.selected?'Изображение выбрано':`Есть вариантов: ${r.images.length} · выберите в карточке`}</small></>:<p className="border border-dashed rounded p-4">{KEYFRAME_ROLE_NAMES[role]}: изображения нет</p>}</div>
        </div>
        {r.reason?<p role="status">{r.reason}</p>:!!r.retryJobs.length&&<p>Можно отметить для новой серии. Сначала разрешите повтор кнопкой над списком: прежний запрос имеет неизвестный исход.</p>}
        {!!r.retryJobs.length&&<details><summary>Неизвестные запросы этого плана · {r.retryJobs.length}</summary>{r.retryJobs.map(j=><p key={j.id} className="text-sm">{MODELS.find(m=>m.id===j.model)?.name??j.model} · {KEYFRAME_ROLE_NAMES[j.keyframe??'start']} · {new Date(j.created).toLocaleString('ru-RU')}</p>)}</details>}
        {openPlan&&<Button variant="outline" disabled={disabled} onClick={()=>openPlan(r.item.id)}>Открыть план</Button>}
      </article>)}
      <details><summary>Модель для первых кадров, загруженных вручную</summary><label className="block">Если первый кадр загружен вручную <select disabled={disabled} className="caption-select" value={fallback} onChange={e=>setFallback(e.target.value)}>{MODELS.filter(m=>m.kind==='image'&&availableForDirecting(m.id)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label></details>
      <fieldset disabled={disabled}><ImageRetrySettings value={imageRetry} onChange={setImageRetry} choices={MODELS.filter(m=>m.kind==='image'&&availableForDirecting(m.id)&&connections?.providers?.some(c=>c.id===m.provider&&c.configured))} initialEstimate={total} count={selected.filter(r=>r.modelId!==imageRetry.fallbackModel).length} referenceCount={5}/></fieldset>
      <p>Оценка серии: {money(total)}. Каждая попытка сохранится в журнале; автоматического утверждения нет.</p>
      <Button disabled={disabled||!selected.length||!!needsPermission.length||p.limit!==null&&total===null} onClick={async()=>{setWorking(true);setError('');try{await submit({revision:p.revision,batchId:crypto.randomUUID(),keyframe:role,model:fallback,imageRetry,refs:[],referenceMode:'selected',estimate:null,plans:selected.map(r=>({itemId:r.item.id,prompt:storyboardPrompt(p,r.item),refs:planReferenceIds(p,r.item)}))});setOpened(false);}catch(e){setError((e as Error).message);}finally{setWorking(false);}}}>Создать ключевые кадры · {selected.length}</Button>
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    </>}
  </section>;
}
