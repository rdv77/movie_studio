'use client';
import {useEffect,useRef,useState} from 'react';
import type {Project} from '@/lib/domain';
import {MODELS} from '@/lib/models';
import {generalScriptSource,screenplayModel} from '@/lib/general-script-source';
import {stageEditing} from '@/lib/stage-review-state';
import {variantStoryMeanings} from '@/lib/story-meaning';
import {currentGeneralPreparation,GENERAL_SCENARIO_SECTIONS,type GeneralScenarioSection,type GeneralScenarioConfig,type GeneralPreparationResult} from '@/lib/general-scenario-workflow';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {GeneralScriptComparison} from './general-script-comparison';
import {GeneralScenarioBrief} from './general-scenario-brief';
import {CinemaReferencesPanel} from './cinema-references-panel';
import {ScenarioOption} from './scenario-option';
import {ScenarioMeaningDraft} from './scenario-meaning-draft';

type Props={p:Project;busy:boolean;submit:(action:string,data?:unknown)=>Promise<Project>;directingSubmit:(action:string,data?:unknown)=>Promise<void>;cinemaSubmit:(action:string,data:unknown)=>Promise<void>;onContinue:()=>void};
const labels:Record<GeneralScenarioSection,string>={creative:'Жанр, режиссёрский подход и выразительность',meaning:'Что должен понять зритель',cinema:'Кинореференсы: учиться у мастеров'};
const statuses:Record<string,string>={queued:'В очереди',running:'Идёт генерация',preparing:'Подготовка выбранных опций',generating:'Создание сценария',reviewing:'Проверка нового сценария',ready:'Готово',error:'Требует внимания'};

export function GeneralScenarioWorkspace({p,busy,submit,directingSubmit,cinemaSubmit,onContinue}:Props){
  const items=p.items.filter(i=>i.stage===0&&!i.removedAt&&!i.planArchive),variants=items.flatMap(i=>i.variants.filter(v=>v.kind==='text'&&v.text.trim()));
  const baseline=generalScriptSource(p),initialSource=baseline?.variant.id??'',editing=stageEditing(p,0);
  const [configDraft,setConfig]=useState<GeneralScenarioConfig>(()=>p.generalScenario?.config??{sourceVariantId:initialSource,model:screenplayModel(p),cinemaModel:'gpt-6-astra',options:{creative:false,meaning:false,cinema:false},question:''});
  const config={...configDraft,sourceVariantId:initialSource,model:screenplayModel(p)};
  const [initialText,setInitialText]=useState('');
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[briefDirty,setBriefDirty]=useState(false),[meaningDirty,setMeaningDirty]=useState(false),[creativeDirty,setCreativeDirty]=useState(false),[cinemaDirty,setCinemaDirty]=useState(false);
  const pending=useRef(false),requestKeys=useRef(new Map<string,string>());
  const lock=busy||working;
  const latest=p.generalScenario?.runs.at(-1),active=p.generalScenario?.runs.some(r=>['preparing','generating','reviewing'].includes(r.status));
  const source=variants.find(v=>v.id===config.sourceVariantId);
  const getPrep=(section:GeneralScenarioSection)=>source?currentGeneralPreparation(p,source.id,section,config.model,config.cinemaModel,config.question):undefined;
  const call=async(action:string,data?:unknown)=>{if(pending.current)throw Error('Дождитесь сохранения предыдущего действия.');pending.current=true;setWorking(true);setError('');try{return await submit(action,data);}catch(e){setError((e as Error).message);throw e;}finally{pending.current=false;setWorking(false);}};
  // Keep the same idempotency key after a lost response. A successful response
  // releases it so a later deliberate generation can create another variant.
  const request=async(action:string,data:Record<string,unknown>)=>{const key=action+JSON.stringify(data);const requestId=requestKeys.current.get(key)??crypto.randomUUID();requestKeys.current.set(key,requestId);const result=await call(action,{...data,requestId});requestKeys.current.delete(key);return result;};
  const update=(next:GeneralScenarioConfig)=>{setConfig(next);setDirty(true);};
  const saveConfig=async(next=config)=>{await call('configure',next);setDirty(false);};
  const prepare=async(section:GeneralScenarioSection,next=config)=>{
    if(briefDirty)throw Error('Сначала примените изменённые настройки задания.');
    await request('prepare',{section,sourceVariantId:next.sourceVariantId,model:next.model,cinemaModel:next.cinemaModel,question:next.question});
  };
  const toggle=async(section:GeneralScenarioSection)=>{const next={...config,options:{...config.options,[section]:!config.options[section]}};update(next);try{await saveConfig(next);if(next.options[section])await prepare(section,next);}catch(e){setError((e as Error).message);}};
  const saveResult=async(section:GeneralScenarioSection,result:GeneralPreparationResult)=>{
    await request('savePreparation',{section,sourceVariantId:config.sourceVariantId,model:config.model,cinemaModel:config.cinemaModel,question:config.question,result});
    if(!config.options[section]){const next={...config,options:{...config.options,[section]:true}};update(next);await saveConfig(next);}
  };
  const sectionStatus=(section:GeneralScenarioSection)=>{
    const prep=getPrep(section);
    if(!config.options[section])return prep?`${statuses[prep.status]} · не используется`:'Не используется';
    if(briefDirty||(section==='meaning'&&meaningDirty)||(section==='creative'&&creativeDirty)||(section==='cinema'&&cinemaDirty))return 'Есть правки';
    if(prep)return statuses[prep.status];
    return p.generalScenario?.preparations.some(x=>x.section===section&&x.input.source.id===config.sourceVariantId)?'Нужно обновить':'Не подготовлено';
  };
  const retryUnknown=(key:string)=>{const run=p.generalScenario?.runs.find(x=>x.id===key);const jobIds=[...p.generalScenario?.preparations.filter(x=>x.id===key||Object.values(run?.preparationIds??{}).includes(x.id)).map(x=>x.jobId)??[],...run?.scriptRun?.tasks.map(t=>t.jobId)??[]];return p.jobs.some(j=>jobIds.includes(j.id)&&j.status==='unknown');};
  const retry=(key:string)=>call('retry',{runId:key,acknowledgeCost:retryUnknown(key)});
  const sectionTools=(section:GeneralScenarioSection)=>{const prep=getPrep(section);return <div className="flex flex-wrap gap-2 items-center">
    <Button type="button" variant="outline" disabled={lock||briefDirty||!source||['queued','running','ready'].includes(prep?.status??'')} onClick={()=>{void (prep?.status==='error'?retry(prep.id):prepare(section)).catch(()=>{});}}>{prep?.status==='error'?(retryUnknown(prep.id)?'Повторить · возможна повторная оплата':'Повторить подготовку'):prep?.status==='ready'?'Подготовлено':'Подготовить с ИИ'}</Button>
    {prep?.jobId&&<details><summary className="cursor-pointer text-sm">Фактически отправленный промпт</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{p.jobs.find(j=>j.id===prep.jobId)?.prompt}</pre></details>}
  </div>;};
  const option=(section:GeneralScenarioSection,children:React.ReactNode)=><ScenarioOption title={labels[section]} enabled={config.options[section]} status={sectionStatus(section)} busy={lock||!source||briefDirty} onToggle={()=>void toggle(section)} error={getPrep(section)?.error}>{children}{sectionTools(section)}</ScenarioOption>;
  const meaningPrep=getPrep('meaning'),meaningResult=meaningPrep?.result;
  const meanings=meaningResult&&'meanings' in meaningResult?meaningResult.meanings:variantStoryMeanings(source)??(source?.id===items.find(i=>i.approvedId===source?.id)?.approvedId?p.directing?.storyMeanings??[]:[]);
  const creativePrep=getPrep('creative');
  const unsaved=briefDirty||(config.options.meaning&&meaningDirty)||(config.options.creative&&creativeDirty)||(config.options.cinema&&cinemaDirty);
  return <div className="space-y-5">
    <GeneralScriptComparison p={p} busy={lock||!!active||unsaved} onContinue={onContinue} onRework={async()=>{await call('rework');}} onAction={async(operation,target,data)=>{await call('candidate',{operation,target,...data});}}/>
    {!source&&<section className="editor-surface p-4 space-y-3" aria-label="Первый исходный текст"><label className="block">Исходный текст<Textarea rows={8} value={initialText} disabled={lock} onChange={e=>setInitialText(e.target.value)} placeholder="Опишите историю — этот текст станет исходным вариантом слева."/></label><Button type="button" disabled={lock||!initialText.trim()} onClick={()=>void call('initialText',{text:initialText}).catch(()=>{})}>Сохранить исходный вариант</Button></section>}
    <p className="text-sm text-muted-foreground">Включите нужные опции. Переключатель запускает подготовку с ИИ; общий запуск создаёт альтернативу на основе текста слева.</p>
    <GeneralScenarioBrief p={p} busy={lock} submit={directingSubmit} onDirtyChange={setBriefDirty} renderCreative={children=>option('creative',<>{children}<CreativeSupplement key={config.sourceVariantId} value={creativePrep?.result} busy={lock||briefDirty} save={result=>saveResult('creative',result)} onDirtyChange={setCreativeDirty}/></>)}/>
    {option('meaning',<ScenarioMeaningDraft key={config.sourceVariantId} value={meanings} busy={lock||briefDirty||!source} save={rows=>saveResult('meaning',{meanings:rows})} onDirtyChange={setMeaningDirty}/>)}
    {option('cinema',<>
      <div className="space-y-3"><label className="block">Модель киноведа<select className="block rounded border p-2 bg-background" disabled={lock} value={config.cinemaModel} onChange={e=>update({...config,cinemaModel:e.target.value as GeneralScenarioConfig['cinemaModel']})}><option value="gpt-6-astra">GPT-6 Astra · поиск в интернете</option><option value="grok-4.7">Grok 4.7 · поиск в интернете</option></select></label><label className="block">Какую задачу исследовать<Textarea disabled={lock} value={config.question} placeholder="Например: как показать, что удачный выстрел обернулся неожиданной проблемой" onChange={e=>update({...config,question:e.target.value})}/></label></div>
      <CinemaReferencesPanel p={p} stage={0} busy={lock} embedded sourceVariantId={config.sourceVariantId} submit={cinemaSubmit} onDirtyChange={setCinemaDirty}/>
      <Button type="button" variant="outline" disabled={lock||!dirty||!source} onClick={()=>{void saveConfig().catch(()=>{});}}>Применить настройки поиска</Button>
    </>)}
    <div className="editor-surface p-5 space-y-4">
      <p className="text-sm">В новый вариант войдут: {GENERAL_SCENARIO_SECTIONS.filter(s=>config.options[s]).map(s=>labels[s]).join(' · ')||'исходный сценарий и сохранённое творческое задание'}.</p>
      {unsaved&&<p role="status">Примените правки внутри изменённых разделов перед запуском.</p>}
      {(editing||!baseline?.item.approvedId&&variants.length<=1)?<Button type="button" size="lg" className="w-full h-auto min-h-12 whitespace-normal" disabled={lock||active||!source||unsaved} onClick={()=>{void request('generate',{...config}).then(()=>setDirty(false)).catch(()=>{});}}>Сгенерировать этап с ИИ</Button>:<p className="text-sm">Для нового прохода нажмите «Доработать» над настройками. Готовый вариант можно сразу утвердить в сравнении.</p>}
      <p className="text-xs text-muted-foreground">Модель: {MODELS.find(m=>m.id===config.model)?.name??config.model} · выбор в «Параметрах фильма». Запросы могут быть платными. Все предыдущие версии сохраняются.</p>
      {latest&&<div role="status" className="space-y-2"><strong>{statuses[latest.status]}</strong>{latest.status==='ready'&&<p>Новый вариант появился в сравнении справа. Проверьте его и утвердите, если он подходит.</p>}{latest.error&&<p role="alert">{latest.error}</p>}{latest.reviewWarnings?.map((w,n)=><p key={n}>{w}</p>)}
        {latest.status==='error'&&<div className="flex flex-wrap gap-2"><Button type="button" disabled={lock} onClick={()=>{void retry(latest.id).catch(()=>{});}}>{retryUnknown(latest.id)?'Повторить · возможна повторная оплата':'Повторить неудавшийся шаг'}</Button>{GENERAL_SCENARIO_SECTIONS.filter(s=>latest.preparationIds[s]&&!latest.omittedSections.includes(s)&&p.generalScenario?.preparations.find(x=>x.id===latest.preparationIds[s])?.status==='error').map(section=><Button key={section} type="button" variant="outline" disabled={lock} onClick={()=>{void call('continueWithout',{runId:latest.id,sections:[section]}).catch(()=>{});}}>Продолжить без «{labels[section]}»</Button>)}</div>}
      </div>}
      {error&&<p role="alert">{error}</p>}
    </div>
  </div>;
}

function CreativeSupplement({value,busy,save,onDirtyChange}:{value?:GeneralPreparationResult;busy:boolean;save:(value:GeneralPreparationResult)=>Promise<void>;onDirtyChange:(dirty:boolean)=>void}){
  const result=value&&'instructions'in value?value:undefined;
  const [text,setText]=useState(result?.instructions.join('\n\n')??''),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const saved=result?.instructions.join('\n\n')??'';
  useEffect(()=>{if(!dirty)setText(saved);},[saved,dirty]);
  useEffect(()=>{onDirtyChange(dirty);},[dirty,onDirtyChange]);
  return <div className="space-y-3"><label className="block">Конкретные предложения для нового сценария<Textarea value={text} disabled={busy} placeholder="После подготовки здесь появятся предложения ИИ. Можно написать свои." onChange={e=>{setText(e.target.value);setDirty(true);}}/></label><Button type="button" variant="outline" disabled={busy||!dirty||!text.trim()} onClick={async()=>{setError('');try{await save({summary:result?.summary??'Указания автора',instructions:text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean)});setDirty(false);}catch(e){setError((e as Error).message);}}}>Применить предложения</Button>{dirty&&<p className="text-sm" role="status">Есть несохранённые предложения.</p>}{error&&<p role="alert">{error}</p>}</div>;
}
