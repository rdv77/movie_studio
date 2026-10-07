'use client';
import {useEffect,useId,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Item,Project} from '@/lib/domain';
import {KEYFRAME_ROLE_NAMES,keyframeIssues,keyframeOptions,keyframeSelection,keyframesApproved,planKeyframeMode,requiredKeyframeRoles,selectedKeyframe,
  type KeyframeItem,type KeyframeMode,type KeyframeRole,type KeyframeSelection} from '@/lib/keyframes';

export type KeyframeEditorProps={
  p:Project;item:Item;busy:boolean;
  saveConfig:(mode:KeyframeMode)=>Promise<void>;
  select:(role:KeyframeRole,variantId:string)=>Promise<void>;
  approve:(selection:KeyframeSelection,reviewChanged:boolean)=>Promise<void>;
  runFrame:(role:KeyframeRole)=>void|Promise<void>;
  reviewFrame?:(role:KeyframeRole,variantId:string)=>Promise<void>;
};
/** All callbacks are explicit actions. Viewing the gallery never changes choice, approval or paid jobs. */
export function KeyframeEditor({p,item:raw,busy,saveConfig,select,approve,runFrame,reviewFrame}:KeyframeEditorProps){
  const item=raw as KeyframeItem,uid=useId(),mode=planKeyframeMode(p,item),roles=requiredKeyframeRoles(mode),selection=keyframeSelection(item);
  const issues=keyframeIssues(p,item),approved=keyframesApproved(p,item),first=selectedKeyframe(item,'start');
  const [operation,setOperation]=useState(false),[error,setError]=useState(''),[reviewChanged,setReviewChanged]=useState(false);
  useEffect(()=>{setError('');setReviewChanged(false);},[p.id,item.id,mode,selection.startId,selection.middleId,selection.endId]);
  const locked=busy||operation;
  const perform=async(fn:()=>void|Promise<void>)=>{setError('');setOperation(true);try{await fn();}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');}finally{setOperation(false);}};
  const hard=issues.filter(issue=>issue.code!=='foundation_changed'),foundationChanged=issues.some(issue=>issue.code==='foundation_changed');
  const firstStale=issues.some(issue=>issue.role==='start'&&(issue.code==='foundation_changed'||issue.code==='missing_basis'));
  return <section className="space-y-4 rounded border border-border p-4" aria-label={`Ключевые кадры: ${item.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Ключевые кадры плана</h3>{approved&&<span className="text-sm text-primary">✓ Комплект утверждён</span>}</div>
    <label htmlFor={`${uid}-mode`} className="block space-y-2"><span className="text-sm">Как показать действие в раскадровке и аниматике</span><select id={`${uid}-mode`} className="w-full rounded border border-input bg-background p-2 text-sm" disabled={locked} value={mode} onChange={event=>perform(()=>saveConfig(event.target.value as KeyframeMode))}>
      <option value="single">Один кадр · действие по описанию</option><option value="pair">Два кадра · начало и окончание</option><option value="triple">Три кадра · начало, середина и окончание</option>
    </select></label>
    <p className="text-xs text-muted-foreground">Первый кадр задаёт образ плана. Остальные создаются по выбранному первому изображению с сохранением модели и качества. Выбор картинки и утверждение комплекта — отдельные действия.</p>
    {mode==='single'&&<p className="text-xs text-muted-foreground">В аниматике показано одно изображение, а видео получит описание действия и конечного состояния. Один кадр не означает неподвижность героя или камеры.</p>}
    {operation&&<p role="status" className="text-sm">Сохраняем изменения… Отметка обновится после ответа сервера.</p>}
    <div className={`grid gap-4 ${roles.length>1?'md:grid-cols-2':''}`}>
      {roles.map(role=>{const options=keyframeOptions(item,role),current=selectedKeyframe(item,role);return <article key={role} className="space-y-3 rounded border border-border p-3">
        <h4 className="text-sm font-medium">{KEYFRAME_ROLE_NAMES[role]}</h4>
        {current?.assetId?<a className="block" href={`/api/assets/${encodeURIComponent(current.assetId)}`} target="_blank" rel="noreferrer"><img className="aspect-video w-full rounded bg-muted object-contain" src={`/api/assets/${encodeURIComponent(current.assetId)}`} alt={`${item.title}: ${KEYFRAME_ROLE_NAMES[role]}`} loading="lazy"/></a>:<div className="flex aspect-video items-center justify-center rounded bg-muted p-4 text-center text-sm text-muted-foreground">Изображение ещё не выбрано</div>}
        <label className="block space-y-1" htmlFor={`${uid}-${role}`}><span className="text-xs">Вариант изображения</span><select id={`${uid}-${role}`} className="w-full rounded border border-input bg-background p-2 text-sm" value={current?.id??''} disabled={locked||!options.length} onChange={event=>perform(()=>select(role,event.target.value))}>
          <option value="" disabled>Выберите готовую картинку</option>{options.map((v,n)=><option key={`${v.id}-${n}`} value={v.id}>{v.title} · {v.model}</option>)}
        </select></label>
        {options.length>1&&<details><summary className="cursor-pointer text-xs">Все варианты этого момента · {options.length}</summary><div className="mt-2 grid grid-cols-2 gap-2">{options.map((v,n)=><button type="button" className={`space-y-1 rounded border p-2 text-left text-xs ${current?.id===v.id?'border-primary':'border-border'}`} key={`${v.id}-${n}`} disabled={locked} onClick={()=>perform(()=>select(role,v.id))}><img className="aspect-video w-full object-contain" src={`/api/assets/${encodeURIComponent(v.assetId!)}`} loading="lazy" alt={v.title}/><span className="block">{current?.id===v.id?'✓ ':''}{v.title}</span><span className="block text-muted-foreground">{v.model}</span></button>)}</div></details>}
        {issues.filter(issue=>issue.role===role).map((issue,n)=><p key={`${issue.code}-${n}`} className="text-xs text-amber-600">{issue.message}</p>)}
        {role==='start'&&firstStale&&current&&reviewFrame&&<Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>perform(()=>reviewFrame(role,current.id))}>Проверил первый кадр · сохранить для текущей основы</Button>}
        <Button type="button" size="sm" variant="outline" disabled={locked||role!=='start'&&(!first||firstStale)} onClick={()=>perform(()=>runFrame(role))}>Создать {role==='start'?'первый':role==='end'?'последний':'промежуточный'} кадр</Button>
      </article>;})}
    </div>
    {foundationChanged&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewChanged} disabled={locked} onChange={event=>setReviewChanged(event.target.checked)}/><span>Просмотрел кадры: они подходят изменившейся основе фильма</span></label>}
    <Button type="button" disabled={locked||approved||hard.length>0||foundationChanged&&!reviewChanged} onClick={()=>perform(()=>approve({...selection},reviewChanged))}>{approved?'✓ Комплект утверждён':mode==='single'?'Утвердить выбранный кадр':'Утвердить выбранные ключевые кадры'}</Button>
    {roleMissingFirst(first,mode)&&<p className="text-xs text-muted-foreground">Сначала создайте и выберите первый кадр, затем создавайте остальные моменты плана.</p>}
    {!!error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
function roleMissingFirst(first:unknown,mode:KeyframeMode){return mode!=='single'&&!first;}
