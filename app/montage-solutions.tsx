'use client';
import type {Project} from '@/lib/domain';
import type {EditorMontageOperation} from '@/lib/directing-solutions';
import {ShotDirectionSummary} from './shot-direction-editor';
import type {ShotDirection} from '@/lib/shot-direction';

const NAMES={duration:'Изменить длительность',remove:'Исключить план',reorder:'Переставить планы',merge:'Объединить соседние планы'} as const;
export function MontageOperationPreview({p,operation}:{p:Project;operation:EditorMontageOperation}){
  const scene=p.directing?.scenes.find(s=>s.id===operation.sceneId),title=(key:string)=>operation.beforeTitles?.find(s=>s.id===key)?.title??scene?.shots.find(s=>s.id===key)?.title??key;
  const after=operation.type==='merge'?operation.after:undefined;
  return <details className="border rounded p-3 space-y-3"><summary>{scene?.title??'Сцена'} · {NAMES[operation.type]} {operation.applied&&'✓ Применено'}</summary><p>{operation.reason}</p>
    {operation.type==='duration'&&<><p><b>План:</b> {title(operation.shotId)}</p><p><b>Было:</b> {operation.before} сек</p><p><b>Предложение:</b> {operation.after} сек</p></>}
    {operation.type==='remove'&&<><p><b>Исключить:</b> {title(operation.shotId)}</p><p>План уйдёт из сценария. При публикации его производственные карточки перейдут в архив; исходные файлы и расходы сохранятся.</p></>}
    {operation.type==='reorder'&&<><p><b>Было:</b> {operation.before.map(title).join(' → ')}</p><p><b>Предложение:</b> {operation.after.map(title).join(' → ')}</p></>}
    {operation.type==='merge'&&<><p><b>Было:</b> {operation.shotIds.map(title).join(' → ')}</p><p><b>Сохраняется ID:</b> {title(operation.keepShotId)}</p><p><b>Предложение:</b> {String(after?.title??'Объединённый план')} · {after?.duration} сек</p>{(['story','cinematography','productionDesign'] as const).map((key,n)=>after?.[key]!==undefined&&<p className="whitespace-pre-wrap" key={key}><b>{['Сценарий','Оператор','Художник'][n]}:</b> {String(after[key])}</p>)}{after?.dialogue!==undefined&&<pre className="whitespace-pre-wrap text-sm">{JSON.stringify(after.dialogue,null,2)}</pre>}<ShotDirectionSummary direction={after?.direction as ShotDirection|undefined} duration={after?.duration}/></>}
    {!operation.applied&&<p className="text-sm text-muted-foreground">Предложение проверяется по исходной версии, прежнему времени и составу планов. Утверждения и готовые материалы не меняются до вашего выбора.</p>}
  </details>;
}
