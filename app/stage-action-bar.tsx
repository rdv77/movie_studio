'use client';
import {useState} from 'react';
import type {Project} from '@/lib/domain';
import {stageComplete,nextStage} from '@/lib/workflow';
import {stageEditing} from '@/lib/stage-review-state';
import {stageHasResult,stageSkipAllowed,stageWorking} from '@/lib/stage-actions';
import {Button} from '@/components/ui/button';

export function StageActionBar({p,stage,busy,onAction,onGenerate,onContinue,generationLabel='Сгенерировать этап с ИИ',canGenerate=true}: {
  p:Project;stage:number;busy:boolean;onAction:(operation:'rework'|'approve'|'skip')=>Promise<void>;
  onGenerate?:()=>void;onContinue:()=>void;generationLabel?:string;canGenerate?:boolean;
}){
  const [error,setError]=useState(''),[saving,setSaving]=useState(false);
  const complete=stageComplete(p,stage),editing=stageEditing(p,stage),result=stageHasResult(p,stage),working=stageWorking(p,stage),locked=busy||saving||working;
  const apply=async(operation:'rework'|'approve'|'skip')=>{setSaving(true);setError('');try{await onAction(operation);}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
  return <section className="editor-surface p-4 mb-5 space-y-3" aria-label="Действия этапа">
    <p role="status" className="font-medium">{working?'Идёт генерация':editing?'На доработке · требуется повторное утверждение':p.stageReviews?.[stage]?.status==='skipped'?'Этап пропущен':complete?'Этап утверждён':result?'Результат готов к рассмотрению':'Этап ещё не подготовлен'}</p>
    <div className="flex flex-wrap gap-2">
      {!complete&&result&&<Button type="button" disabled={locked} onClick={()=>void apply('approve')}>Утвердить</Button>}
      {result&&!editing&&<Button type="button" variant="outline" disabled={locked} onClick={()=>void apply('rework')}>Доработать</Button>}
      {onGenerate&&(!result||editing)&&<Button type="button" disabled={locked||!canGenerate} onClick={onGenerate}>{generationLabel}</Button>}
      {stageSkipAllowed(p,stage)&&<Button type="button" variant="outline" disabled={locked} onClick={()=>void apply('skip')}>Пропустить этап</Button>}
      {nextStage(stage,p)!==undefined&&<Button type="button" variant="outline" disabled={locked||!complete} onClick={onContinue}>Перейти дальше →</Button>}
    </div>
    {editing&&<p className="text-sm text-muted-foreground">Предыдущие материалы сохранены. Измените нужные настройки или материалы, затем нажмите «Утвердить». До этого переход дальше закрыт.</p>}
    {[10,11].includes(stage)&&<p className="text-xs text-muted-foreground">При пропуске {stage===10?'титры':'музыка и звуковые слои'} отключаются в сборке; сохранённые варианты остаются.</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
