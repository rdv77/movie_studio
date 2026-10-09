'use client';

import {useEffect,useRef,useState} from 'react';
import type {Project} from '@/lib/domain';
import {DEFAULT_BRIEF,DIRECTOR_PRESETS,directorRunActive} from '@/lib/directing';
import {GENRE_OPTIONS,renderCreativeInstructions} from '@/lib/creative-brief';
import {runtimeMode} from '@/lib/runtime-policy';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {CreativeStrengthControls} from './creative-controls';
import {FacialExpressionControl} from './facial-expression-control';
import {CameraPolicyControl} from './camera-policy-control';
import {StagingModeControl,FramePolicyControl} from './staging-policy-controls';

type Props={p:Project;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;generateScenario?:()=>void};
const F=({label,children}:{label:string;children:React.ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;

/** One shared draft keeps existing brief fields intact when either section is saved. */
export function GeneralScenarioBrief({p,busy,submit,generateScenario}:Props){
  const d=p.directing;
  const [brief,setBriefState]=useState(d?.brief??{...DEFAULT_BRIEF,targetSeconds:Math.max(10,p.seconds)});
  const [order,setOrderState]=useState(p.productionOrder??'voice-first');
  const [dirty,setDirty]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState('');
  const draftVersion=useRef(0);
  const savedBrief=JSON.stringify(d?.brief);
  useEffect(()=>{if(!dirty&&d){setBriefState(d.brief);setOrderState(p.productionOrder??'voice-first');}},[savedBrief,p.productionOrder,dirty]);
  const change=(next:typeof brief)=>{draftVersion.current++;setDirty(true);setBriefState(next);};
  const changeOrder=(next:typeof order)=>{draftVersion.current++;setDirty(true);setOrderState(next);};
  const locked=busy||working||!!d?.runs.some(directorRunActive);
  const save=async()=>{const version=draftVersion.current;await submit('brief',{brief,productionOrder:order});if(version===draftVersion.current)setDirty(false);};
  const perform=async(action:()=>Promise<void>)=>{setWorking(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить настройки.');}finally{setWorking(false);}};
  const status=dirty?'есть правки':d?'сохранено':'настройки по умолчанию';
  const saveControls=<div className="space-y-2"><Button type="button" disabled={locked} onClick={()=>perform(save)}>Сохранить творческое задание</Button><p className="text-sm text-muted-foreground">Технические и творческие поля сохраняются вместе. Сохранение настроек не запускает генерацию и не создаёт новый вариант сценария.</p></div>;
  return <div className="space-y-4 mb-5" aria-label="Настройки общего сценария">
    <p className="text-sm text-muted-foreground">Блоки ниже необязательны: можно оставить текущие настройки и перейти к выбору сценария. Разверните нужный блок, чтобы настроить его. Сворачивание не отключает уже сохранённые настройки.</p>
    {dirty&&<p role="status">Есть несохранённые настройки задания. Они сохранятся вместе из любого из двух блоков.</p>}
    <details className="editor-surface p-5 space-y-4" aria-label="Технические параметры фильма">
      <summary className="cursor-pointer font-semibold">Творческое задание · технические параметры · {status}</summary>
      <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2 mt-4">
        <F label="Режим хронометража"><select className="w-full rounded border p-2 bg-background" value={runtimeMode(p)} onChange={e=>{const mode=e.target.value;void perform(()=>submit('runtimePolicy',{mode}));}}><option value="free">Свободная длительность — ориентир без ограничения</option><option value="strict">Строгий хронометраж — не более ориентира</option></select><small>Режим применяется сразу. В свободном режиме ориентир не ограничивает длительность готового фильма.</small></F>
        <F label="Ориентир длительности, сек"><Input type="number" min={10} max={3600} value={brief.targetSeconds} onChange={e=>change({...brief,targetSeconds:Number(e.target.value)})}/></F>
        <F label="Порядок производства"><select className="w-full rounded border p-2 bg-background" value={order} onChange={e=>changeOrder(e.target.value as typeof order)}><option value="voice-first">Сначала голоса и аниматик, затем видео</option><option value="video-first">Сначала видео, затем голоса под его длительность</option></select></F>
      </fieldset>
      <FramePolicyControl value={brief.framePolicy} disabled={locked} onChange={framePolicy=>change({...brief,framePolicy})}/>
      <p className="text-sm text-muted-foreground">Утверждённые материалы и выбранные комплекты кадров сохраняются. Новый режим применяется при следующей подготовке; зависимые материалы могут потребовать пересмотра.</p>
      {saveControls}
    </details>
    <details className="editor-surface p-5 space-y-4" aria-label="Жанр и режиссёрский подход">
      <summary className="cursor-pointer font-semibold">Жанр, режиссёрский подход и выразительность · {status}</summary>
      <p className="text-sm text-muted-foreground">Эти настройки определяют новые варианты сценария. Существующие тексты меняются только после отдельной генерации или вашей правки.</p>
      <fieldset disabled={locked} className="grid gap-4 md:grid-cols-2">
        <F label="Жанр"><Input list="general-scenario-genres" value={brief.genre} onChange={e=>change({...brief,genre:e.target.value})}/><datalist id="general-scenario-genres">{GENRE_OPTIONS.map(s=><option key={s} value={s}/>)}</datalist></F>
        <F label="Режиссёрский подход"><select className="w-full rounded border p-2 bg-background" value={brief.director} onChange={e=>change({...brief,director:e.target.value,techniques:DIRECTOR_PRESETS[e.target.value]})}>{Object.keys(DIRECTOR_PRESETS).map(s=><option key={s}>{s}</option>)}</select></F>
        <F label="Аудитория"><Input value={brief.audience} onChange={e=>change({...brief,audience:e.target.value})}/></F>
        <F label="Какое чувство должен вызвать фильм"><Textarea value={brief.effect} onChange={e=>change({...brief,effect:e.target.value})}/></F>
        <F label="Приёмы — можно изменить"><Textarea value={brief.techniques} onChange={e=>change({...brief,techniques:e.target.value})}/></F>
        <F label="Что нельзя менять"><Textarea value={brief.locked} onChange={e=>change({...brief,locked:e.target.value})}/></F>
      </fieldset>
      <CreativeStrengthControls value={brief.strengths} disabled={locked} onChange={strengths=>change({...brief,strengths})}/>
      <StagingModeControl value={brief.stagingMode} disabled={locked} onChange={stagingMode=>change({...brief,stagingMode})}/>
      <CameraPolicyControl value={brief.cameraPolicy} disabled={locked} onChange={cameraPolicy=>change({...brief,cameraPolicy})}/>
      <FacialExpressionControl value={brief.facialExpression} disabled={locked} onChange={facialExpression=>change({...brief,facialExpression})}/>
      <fieldset disabled={locked} className="space-y-4"><F label="Дополнительные инструкции для сценаристов"><Textarea value={brief.promptNotes??''} onChange={e=>change({...brief,promptNotes:e.target.value})}/></F><label className="row"><input type="checkbox" checked={brief.factual} onChange={e=>change({...brief,factual:e.target.checked})}/>Неигровое кино: сохранять факты, отмечать сведения для проверки</label></fieldset>
      {saveControls}
      {generateScenario&&<Button type="button" disabled={locked} onClick={()=>perform(async()=>{if(!d||dirty)await save();generateScenario();})}>Создать варианты по этим настройкам</Button>}
      <p className="text-sm text-muted-foreground">Откроется выбор моделей и количества вариантов. Платный запрос запускается отдельно.</p>
      <details><summary>Инструкции по текущим настройкам</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">{renderCreativeInstructions(brief,undefined,'scenario')}</pre></details>
    </details>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
