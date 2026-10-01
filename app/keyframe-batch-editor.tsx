'use client';
import {useState} from 'react';
import {BatchScopeSelector} from './batch-scope-selector';
import {queueAdmissionIssue} from '@/lib/queue-policy';
import {availableForDirecting} from '@/lib/model-capabilities';
import {Button} from '@/components/ui/button';
import type {Project} from '@/lib/domain';
import {participates,money,variantCurrent} from '@/lib/domain';
import {model,MODELS} from '@/lib/models';
import {planReferenceIds} from '@/lib/plan-references';
import {storyboardPrompt} from '@/lib/storyboard';
import {planKeyframeMode,requiredKeyframeRoles,selectedKeyframe,prepareKeyframeGeneration} from '@/lib/keyframes';
import {compilePrompt} from '@/lib/prompt-compiler';
import {grokImageEstimate,GROK_IMAGE_MODEL} from '@/lib/image-quality';
export function KeyframeBatchEditor({p,busy,submit}:{p:Project;busy:boolean;submit:(data:unknown)=>Promise<unknown>}){
  const [role,setRole]=useState<'end'|'middle'>('end');
  const [opened,setOpened]=useState(false),[included,setIncluded]=useState<string[]>([]),[working,setWorking]=useState(false),[error,setError]=useState(''),[fallback,setFallback]=useState(GROK_IMAGE_MODEL);
  const rows=p.items.filter(i=>i.stage===5&&participates(p,i)&&requiredKeyframeRoles(planKeyframeMode(p,i)).includes(role)).map(item=>{
    const first=selectedKeyframe(item,'start');let reason=queueAdmissionIssue(p,item.id),estimate:string|null=null;
    try{const m=model(first?.jobId?first.model:fallback),prepared=prepareKeyframeGeneration(p,item.id,role,{model:m.id,refs:planReferenceIds(p,item)});const compiled=compilePrompt(p,item,m.id,{kind:'image',keyframe:role,prompt:storyboardPrompt(p,item),keyframeInstruction:prepared.roleInstruction,references:prepared.refs,allowLegacyModel:!p.directing});estimate=m.id===GROK_IMAGE_MODEL?grokImageEstimate(prepared.imageSettings,compiled.references.length):m.estimate;}
    catch(e){reason=(e as Error).message;}
    return {item,first,reason,estimate};
  });
  const selected=rows.filter(r=>included.includes(r.item.id)&&!r.reason),total=selected.every(r=>r.estimate!==null)?selected.reduce((n,r)=>n+BigInt(r.estimate!),0n).toString():null;
  if(!p.items.some(i=>i.stage===5&&participates(p,i)&&requiredKeyframeRoles(planKeyframeMode(p,i)).includes('end')))return null;
  return <section className="editor-surface p-4 my-4 space-y-3"><Button variant="outline" disabled={busy} onClick={()=>{setOpened(!opened);setIncluded(rows.filter(r=>!r.reason&&!selectedKeyframe(r.item,role)).map(r=>r.item.id));}}>Ключевые кадры · массовая генерация</Button>{opened&&<>
    <p>По одному выбранному ключевому кадру для отмеченных планов. Модель, качество и исходный файл берутся из выбранного первого кадра; результат появится в карточке плана для просмотра.</p>
    <label className="block">Если первый кадр загружен вручную <select className="caption-select" value={fallback} onChange={e=>setFallback(e.target.value)}>{MODELS.filter(m=>m.kind==='image'&&availableForDirecting(m.id)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <label className="block">Роль кадра <select aria-label="Роль ключевого кадра серии" value={role} onChange={e=>{setRole(e.target.value as 'end'|'middle');setIncluded([]);}}><option value="end">Конечный</option><option value="middle">Промежуточный · для тройного набора</option></select></label>
    <BatchScopeSelector rows={rows.map(r=>{const frame=selectedKeyframe(r.item,role);return {id:r.item.id,remaining:!frame,needsAttention:!frame||!variantCurrent(p,r.item,frame),blocked:r.reason};})} selected={included} disabled={busy||working} onChange={setIncluded}/>
    {!rows.length&&<p>Нет планов с этой ролью кадра. Промежуточный кадр нужен только для тройного набора.</p>}
    {rows.map(r=><label className="flex gap-3 border rounded p-3" key={r.item.id}><input type="checkbox" disabled={busy||working||!!r.reason} checked={included.includes(r.item.id)&&!r.reason} onChange={e=>setIncluded(ids=>e.target.checked?[...ids,r.item.id]:ids.filter(id=>id!==r.item.id))}/><span>{r.item.title} · {r.first?.model??'Сначала выберите первый кадр'}<small className="block">{r.reason||money(r.estimate)}</small></span></label>)}
    <p>Оценка серии: {money(total)}. Каждая попытка сохранится в журнале; автоматического утверждения нет.</p>
    <Button disabled={busy||working||!selected.length||p.limit!==null&&total===null} onClick={async()=>{setWorking(true);setError('');try{await submit({revision:p.revision,batchId:crypto.randomUUID(),keyframe:role,model:fallback,refs:[],referenceMode:'selected',estimate:null,plans:selected.map(r=>({itemId:r.item.id,prompt:storyboardPrompt(p,r.item),refs:planReferenceIds(p,r.item)}))});setOpened(false);}catch(e){setError((e as Error).message);}finally{setWorking(false);}}}>Создать ключевые кадры · {selected.length}</Button>{error&&<p role="alert">{error}</p>}
  </>}</section>;
}
