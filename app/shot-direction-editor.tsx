'use client';
import {useId,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {FRAMING_NAMES,validateShotDirection,type ShotDirection,type DirectionIssue} from '@/lib/shot-direction';
import {FacialExpressionControl} from './facial-expression-control';
import {FACIAL_EXPRESSION_LABELS,type FacialExpressionMode} from '@/lib/facial-expression';
import {StagingModeControl} from './staging-policy-controls';
import {STAGING_MODE_LABELS,type StagingMode} from '@/lib/staging-policy';

const ANGLE_NAMES={ 'eye-level':'На уровне глаз',low:'Снизу',high:'Сверху',overhead:'Вертикально сверху',dutch:'Наклонённый горизонт','point-of-view':'Взгляд героя',custom:'Свой ракурс'} as const;
const MOVEMENT_NAMES={static:'Статичная камера',pan:'Панорама по горизонтали',tilt:'Наклон камеры', 'push-in':'Наезд','pull-out':'Отъезд',dolly:'Перемещение камеры',tracking:'Сопровождение',orbit:'Обход вокруг',handheld:'Ручная камера',crane:'Подъём или спуск',zoom:'Изменение фокусного расстояния',custom:'Свое движение'} as const;
const TRANSITION_NAMES={cut:'Прямая склейка','match-cut':'Склейка по соответствию',dissolve:'Наплыв',fade:'Плавное появление или исчезновение',black:'Через чёрный кадр',custom:'Свой переход'} as const;
const SCREEN_NAMES={'left-to-right':'Слева направо','right-to-left':'Справа налево','toward-camera':'К камере','away-from-camera':'От камеры',static:'Без перемещения',custom:'Своё направление'} as const;
const Field=({label,children}:{label:string;children:ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;
const Group=({label,children}:{label:string;children:ReactNode})=><details className="border rounded p-3 space-y-3"><summary className="cursor-pointer font-medium">{label}</summary><div className="space-y-3 pt-2">{children}</div></details>;
type EditorProps={direction?:ShotDirection;duration:number;inheritedFacialExpression?:FacialExpressionMode;inheritedStagingMode?:StagingMode;onChange:(direction:ShotDirection|undefined)=>void;disabled?:boolean};

/** No hydration migration or implicit camera choice; only an explicit edit emits a change. */
export function patchShotDirection(direction:ShotDirection|undefined,patch:Partial<ShotDirection>):ShotDirection|undefined {
  const next={...structuredClone(direction??{}),...structuredClone(patch)};
  for(const key of Object.keys(next) as (keyof ShotDirection)[])if(next[key]===undefined)delete next[key];
  return Object.keys(next).length?next:undefined;
}
function withoutEmpty<T extends object>(value:T):T|undefined {
  const next={...value};for(const key of Object.keys(next) as (keyof T)[])if(next[key]===undefined)delete next[key];
  return Object.keys(next).length?next:undefined;
}
export function optionalDirectionSecond(value:string):number|undefined {return value.trim()===''?undefined:Number(value);}
export function directionEditorIssues(direction:ShotDirection|undefined,duration:number):DirectionIssue[]{
  return validateShotDirection({id:'editing',duration,direction}).map(issue=>{
    if(issue.code!=='direction_schema')return issue;
    const field=issue.field??'';const row=(pattern:RegExp)=>{const n=pattern.exec(field)?.[1];return n===undefined?'':String(Number(n)+1);};
    let message='Проверьте заполнение поля постановки.';
    if(/actionBeats\.\d+\.action$/.test(field))message=`Действие ${row(/actionBeats\.(\d+)/)}: опишите, что происходит.`;
    else if(/positions\.\d+\.subject$/.test(field))message=`Положение ${row(/positions\.(\d+)/)}: укажите героя или предмет.`;
    else if(/performance\.\d+\.character$/.test(field))message=`Актёрская задача ${row(/performance\.(\d+)/)}: укажите героя.`;
    else if(/sound\.effects\.\d+\.description$/.test(field))message=`Звук ${row(/effects\.(\d+)/)}: добавьте описание эффекта.`;
    else if(/(?:actionBeats\.\d+\.(?:start|end)|timing\.(?:openingHold|endingHold|revealAt)|effects\.\d+\.at)$/.test(field))message='Время должно быть числом от 0 до 60 секунд.';
    else if(/(?:subjectId|characterId|toShotId|\.id)$/.test(field))message='Идентификатор должен быть непустым и не длиннее 100 символов.';
    return {...issue,message};
  });
}

export function ShotDirectionEditor({direction,duration,inheritedFacialExpression,inheritedStagingMode,onChange,disabled=false}:EditorProps){
  const uid=useId(),d=direction??{};
  const change=<K extends keyof ShotDirection>(key:K,value:ShotDirection[K])=>onChange(patchShotDirection(direction,{[key]:value} as Partial<ShotDirection>));
  const text=<K extends keyof ShotDirection>(key:K,value:string)=>change(key,(value===''?undefined:value) as ShotDirection[K]);
  const issues=directionEditorIssues(direction,duration),conflicts=issues.filter(i=>i.severity==='conflict'),notes=issues.filter(i=>i.severity==='note');
  const seconds=(label:string,value:number|undefined,update:(value:number|undefined)=>void,required=false)=><Field label={label}><Input type="number" min={0} max={60} step={.1} value={value??''} onChange={e=>update(required?Number(e.target.value):optionalDirectionSecond(e.target.value))}/></Field>;
  const select=<T extends string>(label:string,value:T|undefined,names:Record<T,string>,update:(value:T|undefined)=>void)=><Field label={label}><select className="w-full rounded border p-2 bg-background" value={value??''} onChange={e=>update((e.target.value||undefined) as T|undefined)}><option value="">Не задано</option>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{String(name)}</option>)}</select></Field>;
  return <section className="space-y-4" aria-label="Структурированная постановка плана"><h4>Постановка плана · {Number.isFinite(duration)?duration:'—'} сек</h4>
    <p className="text-sm text-muted-foreground">Можно описать только ключевые кадры. Дополнительные поля раскройте при необходимости. Всё сохраняется вместе с четырьмя частями плана и утверждается одной кнопкой.</p>
    <fieldset disabled={disabled} className="space-y-4">
      <StagingModeControl shot value={d.stagingMode} inherited={inheritedStagingMode} disabled={disabled} onChange={value=>change('stagingMode',value)}/>
      <FacialExpressionControl shot value={d.facialExpression} inherited={inheritedFacialExpression} disabled={disabled} onChange={value=>change('facialExpression',value)}/>
      <p className="text-sm text-muted-foreground">После изменения сохраните и утвердите план, затем примените подробный сценарий. Новые кадры и видео получат эту настройку; уже созданные файлы не меняются.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {select('Начальная крупность',d.framingStart,FRAMING_NAMES,value=>change('framingStart',value))}
        {select('Конечная крупность',d.framingEnd,FRAMING_NAMES,value=>change('framingEnd',value))}
        <Field label="Начальный ключевой кадр"><Textarea rows={3} maxLength={3000} value={d.startFrame??''} onChange={e=>text('startFrame',e.target.value)} placeholder="Что зритель видит в первый момент плана"/></Field>
        <Field label="Конечный ключевой кадр"><Textarea rows={3} maxLength={3000} value={d.endFrame??''} onChange={e=>text('endFrame',e.target.value)} placeholder="Как выглядит план после завершения действия"/></Field>
      </div>
      <Field label="Нужна точная конечная композиция"><select className="w-full rounded border p-2 bg-background" value={d.requiresEndFrame===undefined?'':String(d.requiresEndFrame)} onChange={e=>change('requiresEndFrame',e.target.value===''?undefined:e.target.value==='true')}><option value="">Не задано</option><option value="false">Нет · достаточно описать результат действия</option><option value="true">Да · нужен отдельный конечный кадр</option></select><small>При автоматическом выборе опорных изображений второй кадр предлагается только для отмеченной точной композиции. Движение камеры или смена эмоции сами по себе его не требуют. Для готовой раскадровки комплект можно изменить в «Ключевых кадрах плана».</small></Field>
      <Group label="Ракурс, композиция и внимание зрителя">
        {select('Ракурс',d.angle?.type,ANGLE_NAMES,type=>change('angle',type?{...d.angle,type}:undefined))}
        {d.angle&&<Field label="Описание ракурса"><Textarea value={d.angle.description??''} maxLength={3000} onChange={e=>change('angle',{...d.angle!,description:e.target.value||undefined})}/></Field>}
        <Field label="Композиция"><Textarea value={d.composition??''} rows={3} maxLength={3000} onChange={e=>text('composition',e.target.value)}/></Field>
        <div className="grid gap-3 md:grid-cols-2">{(['start','end'] as const).map((key,n)=><Field key={key} label={n?'На что направлено внимание в конце':'На что направлено внимание в начале'}><Textarea value={d.attention?.[key]??''} maxLength={3000} onChange={e=>{const next={start:d.attention?.start??'',end:d.attention?.end??'',[key]:e.target.value};change('attention',next.start||next.end?next:undefined);}}/></Field>)}</div>
      </Group>
      <Group label="Движение камеры">
        {select('Тип движения',d.cameraMovement?.type,MOVEMENT_NAMES,type=>change('cameraMovement',type?{...d.cameraMovement,type,description:d.cameraMovement?.description??''}:undefined))}
        {d.cameraMovement&&<><Field label="Описание движения"><Textarea value={d.cameraMovement.description} rows={3} maxLength={3000} onChange={e=>change('cameraMovement',{...d.cameraMovement!,description:e.target.value})}/></Field><div className="grid gap-3 md:grid-cols-2">{(['from','to'] as const).map((key,n)=><Field key={key} label={n?'Куда приходит камера':'Откуда начинается движение'}><Textarea value={d.cameraMovement?.[key]??''} maxLength={3000} onChange={e=>change('cameraMovement',{...d.cameraMovement!,[key]:e.target.value||undefined})}/></Field>)}</div></>}
      </Group>
      <Group label={`Действия и время · ${d.actionBeats?.length??0}`}>
        <p className="text-sm text-muted-foreground">Время считается от начала этого плана. Действия перечисляются по времени начала; речь и физическое действие не ускоряются автоматически.</p>
        {(d.actionBeats??[]).map((beat,n)=><article className="rounded border p-3 space-y-3" key={beat.id??n}><strong>Действие {n+1}</strong><div className="grid gap-3 md:grid-cols-2">{seconds('Начало, сек',beat.start,value=>change('actionBeats',d.actionBeats!.map((b,j)=>j===n?{...b,start:value??0}:b)),true)}{seconds('Конец, сек',beat.end,value=>change('actionBeats',d.actionBeats!.map((b,j)=>j===n?{...b,end:value??0}:b)),true)}</div><Field label="Действие"><Textarea value={beat.action} maxLength={3000} onChange={e=>change('actionBeats',d.actionBeats!.map((b,j)=>j===n?{...b,action:e.target.value}:b))}/></Field><Field label="Эмоциональное изменение"><Textarea value={beat.emotionalChange??''} maxLength={3000} onChange={e=>change('actionBeats',d.actionBeats!.map((b,j)=>j===n?{...b,emotionalChange:e.target.value||undefined}:b))}/></Field><Button type="button" variant="ghost" onClick={()=>{const rows=d.actionBeats!.filter((_,j)=>j!==n);change('actionBeats',rows.length?rows:undefined);}}>Удалить действие</Button></article>)}
        <Button type="button" variant="outline" disabled={(d.actionBeats?.length??0)>=30} onClick={()=>{const last=d.actionBeats?.at(-1),limit=Number.isFinite(duration)?duration:1,start=last?.end&&last.end<limit?last.end:last?.start??0;change('actionBeats',[...d.actionBeats??[],{id:crypto.randomUUID(),start,end:Math.min(limit,start+.5),action:''}]);}}>Добавить действие</Button>
      </Group>
      <Group label="Паузы и момент раскрытия">
        <div className="grid gap-3 md:grid-cols-3">{(['openingHold','endingHold','revealAt'] as const).map((key,n)=><div key={key}>{seconds(['Пауза в начале, сек','Пауза в конце, сек','Момент раскрытия, сек'][n],d.timing?.[key],value=>change('timing',withoutEmpty({...d.timing,[key]:value})))}</div>)}</div>
      </Group>
      <Group label={`Положения героев и предметов · ${d.positions?.length??0}`}>
        {(d.positions??[]).map((position,n)=><article className="rounded border p-3 space-y-3" key={position.subjectId??n}><Field label="Герой или предмет"><Input maxLength={100} value={position.subject} onChange={e=>change('positions',d.positions!.map((p,j)=>j===n?{...p,subject:e.target.value}:p))}/></Field><div className="grid gap-3 md:grid-cols-2">{(['start','end'] as const).map((key,j)=><Field key={key} label={j?'Положение в конце':'Положение в начале'}><Textarea value={position[key]} maxLength={3000} onChange={e=>change('positions',d.positions!.map((p,j)=>j===n?{...p,[key]:e.target.value}:p))}/></Field>)}</div>{select('Направление в кадре',position.screenDirection,SCREEN_NAMES,value=>change('positions',d.positions!.map((p,j)=>j===n?{...p,screenDirection:value}:p)))}<details><summary>Идентификатор героя или предмета</summary><Input value={position.subjectId??''} maxLength={100} onChange={e=>change('positions',d.positions!.map((p,j)=>j===n?{...p,subjectId:e.target.value||undefined}:p))}/></details><Button type="button" variant="ghost" onClick={()=>{const rows=d.positions!.filter((_,j)=>j!==n);change('positions',rows.length?rows:undefined);}}>Удалить положение</Button></article>)}
        <Button type="button" variant="outline" disabled={(d.positions?.length??0)>=30} onClick={()=>change('positions',[...d.positions??[],{subject:'',start:'',end:''}])}>Добавить героя или предмет</Button>
      </Group>
      <Group label="Склейка со следующим планом">
        {select('Тип перехода',d.transition?.type,TRANSITION_NAMES,type=>change('transition',type?{...d.transition,type,description:d.transition?.description??''}:undefined))}
        {d.transition&&<><Field label="Как происходит склейка"><Textarea value={d.transition.description} maxLength={3000} onChange={e=>change('transition',{...d.transition!,description:e.target.value})}/></Field><Field label="ID следующего плана, если указан"><Input maxLength={100} value={d.transition.toShotId??''} onChange={e=>change('transition',{...d.transition!,toShotId:e.target.value||undefined})}/></Field></>}
      </Group>
      <Group label="Атмосфера, звуковые события и музыка">
        {(['ambience','music'] as const).map((key,n)=><Field key={key} label={n?'Музыкальная задача':'Звуковая атмосфера'}><Textarea value={d.sound?.[key]??''} maxLength={3000} onChange={e=>change('sound',withoutEmpty({...d.sound,[key]:e.target.value||undefined}))}/></Field>)}
        <Field label="Тишина"><select className="w-full rounded border p-2 bg-background" value={d.sound?.silence===undefined?'':String(d.sound.silence)} onChange={e=>change('sound',withoutEmpty({...d.sound,silence:e.target.value===''?undefined:e.target.value==='true'}))}><option value="">Не задано</option><option value="true">Намеренная тишина</option><option value="false">Звук допустим</option></select></Field>
        {(d.sound?.effects??[]).map((effect,n)=><article className="rounded border p-3 space-y-3" key={n}>{seconds(`Звук ${n+1} · момент, сек`,effect.at,value=>change('sound',{...d.sound,effects:d.sound!.effects!.map((e,j)=>j===n?{...e,at:value??0}:e)}),true)}<Field label="Описание звука"><Textarea value={effect.description} maxLength={3000} onChange={e=>change('sound',{...d.sound,effects:d.sound!.effects!.map((s,j)=>j===n?{...s,description:e.target.value}:s)})}/></Field><Button type="button" variant="ghost" onClick={()=>{const rows=d.sound!.effects!.filter((_,j)=>j!==n);change('sound',withoutEmpty({...d.sound,effects:rows.length?rows:undefined}));}}>Удалить звук</Button></article>)}
        <Button type="button" variant="outline" disabled={(d.sound?.effects?.length??0)>=30} onClick={()=>change('sound',{...d.sound,effects:[...d.sound?.effects??[],{at:0,description:''}]})}>Добавить звуковое событие</Button>
      </Group>
      <Group label={`Актёрские задачи · ${d.performance?.length??0}`}>
        {(d.performance??[]).map((performance,n)=><article className="rounded border p-3 space-y-3" key={performance.characterId??n}><Field label="Герой"><Input value={performance.character} maxLength={100} onChange={e=>change('performance',d.performance!.map((p,j)=>j===n?{...p,character:e.target.value}:p))}/></Field>{(['objective','subtext','visibleAction','emotionStart','emotionEnd'] as const).map((key,j)=><Field key={key} label={['Чего добивается','Подтекст','Наблюдаемое действие','Эмоция в начале','Эмоция в конце'][j]}><Textarea value={performance[key]} maxLength={3000} onChange={e=>change('performance',d.performance!.map((p,j)=>j===n?{...p,[key]:e.target.value}:p))}/></Field>)}<details><summary>Идентификатор героя</summary><Input maxLength={100} value={performance.characterId??''} onChange={e=>change('performance',d.performance!.map((p,j)=>j===n?{...p,characterId:e.target.value||undefined}:p))}/></details><Button type="button" variant="ghost" onClick={()=>{const rows=d.performance!.filter((_,j)=>j!==n);change('performance',rows.length?rows:undefined);}}>Удалить актёрскую задачу</Button></article>)}
        <Button type="button" variant="outline" disabled={(d.performance?.length??0)>=20} onClick={()=>change('performance',[...d.performance??[],{character:'',objective:'',subtext:'',visibleAction:'',emotionStart:'',emotionEnd:''}])}>Добавить актёрскую задачу</Button>
      </Group>
      {!!direction&&<Button type="button" variant="ghost" onClick={()=>onChange(undefined)}>Убрать структурированные поля</Button>}
    </fieldset>
    {!!conflicts.length&&<div role="alert" className="rounded border border-destructive p-3 space-y-1"><strong>Проверьте постановку</strong>{conflicts.map((issue,n)=><p className="text-sm" key={uid+':conflict:'+n}>{issue.message}</p>)}</div>}
    {!!notes.length&&<details><summary>Что можно уточнить · {notes.length}</summary>{notes.map((issue,n)=><p className="text-sm text-muted-foreground" key={uid+':note:'+n}>{issue.message}</p>)}</details>}
  </section>;
}

export function ShotDirectionSummary({direction,duration}:{direction?:ShotDirection;duration?:number}){
  if(!direction)return <p className="text-sm text-muted-foreground">Структурированная постановка не задана. Используются текстовые описания плана.</p>;
  const d=direction,conflicts=duration===undefined?[]:directionEditorIssues(d,duration).filter(i=>i.severity==='conflict');
  return <div className="space-y-2 text-sm" aria-label="Постановка и ключевые кадры">
    {d.stagingMode&&<p><b>Постановка:</b> {STAGING_MODE_LABELS[d.stagingMode]}</p>}
    {d.requiresEndFrame!==undefined&&<p><b>Точная конечная композиция:</b> {d.requiresEndFrame?'нужен конечный кадр':'достаточно описания действия'}</p>}
    {d.facialExpression&&<p><b>Мимика:</b> {FACIAL_EXPRESSION_LABELS[d.facialExpression]}</p>}
    {(d.framingStart||d.framingEnd)&&<p><b>Крупность:</b> {d.framingStart?FRAMING_NAMES[d.framingStart]:'не задана'} → {d.framingEnd?FRAMING_NAMES[d.framingEnd]:'не задана'}</p>}
    {d.startFrame&&<p className="whitespace-pre-wrap"><b>Начальный кадр:</b> {d.startFrame}</p>}{d.endFrame&&<p className="whitespace-pre-wrap"><b>Конечный кадр:</b> {d.endFrame}</p>}
    {d.angle&&<p><b>Ракурс:</b> {ANGLE_NAMES[d.angle.type]}{d.angle.description&&' · '+d.angle.description}</p>}{d.composition&&<p><b>Композиция:</b> {d.composition}</p>}
    {d.attention&&<p><b>Внимание:</b> {d.attention.start} → {d.attention.end}</p>}
    {d.cameraMovement&&<p><b>Камера:</b> {MOVEMENT_NAMES[d.cameraMovement.type]} · {d.cameraMovement.description}{d.cameraMovement.from&&' · от '+d.cameraMovement.from}{d.cameraMovement.to&&' · к '+d.cameraMovement.to}</p>}
    {d.actionBeats?.map((beat,n)=><p key={beat.id??n}><b>{beat.start}–{beat.end} сек:</b> {beat.action}{beat.emotionalChange&&' · '+beat.emotionalChange}</p>)}
    {d.timing&&<p><b>Ритм:</b> {[d.timing.openingHold!==undefined?`пауза в начале ${d.timing.openingHold} сек`:null,d.timing.revealAt!==undefined?`раскрытие на ${d.timing.revealAt} сек`:null,d.timing.endingHold!==undefined?`пауза в конце ${d.timing.endingHold} сек`:null].filter(Boolean).join(' · ')}</p>}
    {d.positions?.map((position,n)=><p key={position.subjectId??n}><b>{position.subject}:</b> {position.start} → {position.end}{position.screenDirection&&' · '+SCREEN_NAMES[position.screenDirection]}</p>)}
    {d.transition&&<p><b>Склейка:</b> {TRANSITION_NAMES[d.transition.type]} · {d.transition.description}{d.transition.toShotId&&' · к '+d.transition.toShotId}</p>}
    {d.sound&&<div>{d.sound.ambience&&<p><b>Атмосфера:</b> {d.sound.ambience}</p>}{d.sound.music&&<p><b>Музыка:</b> {d.sound.music}</p>}{d.sound.silence===true&&<p>Намеренная тишина</p>}{d.sound.effects?.map((sound,n)=><p key={n}><b>Звук на {sound.at} сек:</b> {sound.description}</p>)}</div>}
    {d.performance?.map((p,n)=><details key={p.characterId??n}><summary>Актёрская задача: {p.character}</summary><p>Цель: {p.objective}</p><p>Подтекст: {p.subtext}</p><p>Действие: {p.visibleAction}</p><p>Эмоция: {p.emotionStart} → {p.emotionEnd}</p></details>)}
    {!!conflicts.length&&<div role="alert">{conflicts.map((issue,n)=><p key={n}>{issue.message}</p>)}</div>}
  </div>;
}
