'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {MODELS} from '@/lib/models';
import {ticks,money,type Project} from '@/lib/domain';
import {MUSIC_LIBRARY,musicSettings,musicIssue,libraryUrl,libraryAudio,libraryCredit,type MusicSettings} from '@/lib/music';

export function MusicEditor({p,busy,connections,submit,upload,onContinue}:{p:Project;busy:boolean;connections:any;submit:(action:string,data:unknown)=>Promise<Project>;upload:(f:File)=>Promise<{id:string}>;onContinue:()=>void}){
  const configured=(provider:string)=>connections?.providers?.some((x:any)=>x.id===provider&&x.configured);
  const textModels=MODELS.filter(m=>m.kind==='text'&&configured(m.provider));
  const suggestedSeconds=()=>{
    const plans=p.items.filter(i=>i.stage===7&&!i.planArchive&&!i.removedAt);
    const length=plans.reduce((sum,i)=>{const v=i.variants.find(v=>v.id===i.approvedId);if(!v)return sum;const cut=p.assemblyCuts?.find(c=>c.itemId===i.id&&c.variantId===v.id);return sum+(cut?.duration??v.duration);},0);
    return Math.min(600,Math.max(3,Math.ceil(length||p.animatic?.variants.find(v=>v.id===p.animatic?.approvedId)?.duration||p.seconds)));
  };
  const [textModel,setTextModel]=useState(''),[wishes,setWishes]=useState(''),[prompt,setPrompt]=useState(''),[count,setCount]=useState(3),[seconds,setSeconds]=useState(suggestedSeconds),[estimate,setEstimate]=useState('');
  const [draft,setDraft]=useState<MusicSettings>(()=>musicSettings(p)),[working,setWorking]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[speechPreview,setSpeechPreview]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const persisted=JSON.stringify(musicSettings(p));
  useEffect(()=>{setDraft(JSON.parse(persisted));},[persisted]);
  useEffect(()=>{root.current?.querySelectorAll('audio').forEach(a=>a.volume=speechPreview?draft.speechVolume:draft.volume);},[speechPreview,draft.volume,draft.speechVolume,p.music?.variants.length]);
  const jobs=p.jobs.filter(j=>j.purpose==='music'||j.purpose==='music-ideas'),active=p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status));
  const disabled=busy||working,dirty=JSON.stringify(draft)!==persisted;
  const run=async(fn:()=>Promise<unknown>,success='Сохранено')=>{setWorking(true);setError('');setMessage('');try{await fn();setMessage(success);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}};
  const send=(action:string,data:unknown={},success?:string)=>run(()=>submit(action,data),success);
  const field=(key:keyof MusicSettings,value:number|boolean)=>setDraft({...draft,[key]:value});
  const suggested=new Set(p.music?.ideas?.flatMap(i=>i.libraryIds)??[]);
  return <div ref={root} className="space-y-6" onPlayCapture={e=>{const target=e.target as HTMLAudioElement;if(target.tagName==='AUDIO'){root.current?.querySelectorAll('audio').forEach(a=>{if(a!==target)a.pause();});target.volume=speechPreview?draft.speechVolume:draft.volume;}}}>
    {error&&<p className="note" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <section className="editor-surface p-5 space-y-3"><h2>Музыкальное направление по сценарию</h2><p>ИИ прочитает утверждённый сценарий и визуальный стиль и предложит три разных подхода. Затем выберите описание для генерации или трек из библиотеки.</p>
      <label className="field">Модель для анализа<select aria-label="Модель для анализа музыки" className="border rounded p-2 bg-background" value={textModel||textModels[0]?.id||''} onChange={e=>setTextModel(e.target.value)}>{textModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <Textarea aria-label="Пожелания к музыке" placeholder="Например: сдержанное напряжение, дух 1930-х, без вокала и резких ударов" value={wishes} onChange={e=>setWishes(e.target.value)} maxLength={4100}/>
      <label className="field">Оценка одного запроса, USD (необязательно без лимита бюджета)<Input aria-label="Оценка музыкального запроса" value={estimate} onChange={e=>setEstimate(e.target.value)} placeholder="Например 0.50"/></label>
      <p className="muted small">Стоимость анализа и генерации учитывается в журнале. Если API не сообщает сумму, она останется «Неизвестно» до сверки. Оценка выше применяется к каждому запросу следующей серии.</p>
      <Button disabled={disabled||active||!textModels.length} onClick={()=>void run(async()=>{const value=estimate.trim()?ticks(estimate.trim()):null;await submit('ideas',{batchId:crypto.randomUUID(),model:textModel||textModels[0].id,prompt:wishes,duration:seconds,count:1,estimate:value});},'ИИ читает сценарий. Три направления появятся ниже.')}>Предложить 3 направления с ИИ</Button>
      {!textModels.length&&<p>Добавьте ключ текстовой модели в «Подключениях».</p>}
      <div className="grid gap-4 md:grid-cols-3">{p.music?.ideas?.map(i=><article className="editor-surface p-4 space-y-3" key={i.id}><h3>{i.title}</h3><p>{i.description}</p><details><summary>Описание для генерации</summary><p>{i.prompt}</p></details><Button variant="outline" onClick={()=>{setPrompt(i.prompt);setMessage('Описание перенесено в блок генерации.');}}>Использовать это направление</Button>{i.libraryIds.length>0&&<p className="muted small">Из библиотеки: {i.libraryIds.map(id=>MUSIC_LIBRARY.find(t=>t.id===id)?.title).join(', ')}</p>}</article>)}</div>
    </section>
    <section className="editor-surface p-5 space-y-3"><h2>Сгенерировать музыку</h2><p>ElevenLabs Music · инструментальный трек · используется ключ ElevenLabs из «Подключений».</p>
      <Textarea aria-label="Описание музыки для генерации" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Выберите направление выше или опишите музыку самостоятельно" maxLength={4100}/>
      <div className="grid gap-3 md:grid-cols-2"><label className="field">Длительность трека, сек<Input type="number" min={3} max={600} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label><label className="field">Количество вариантов<Input type="number" min={1} max={4} value={count} onChange={e=>setCount(Number(e.target.value))}/></label></div>
      <Button disabled={disabled||active||!prompt.trim()||!configured('elevenlabs')} onClick={()=>void run(async()=>{await submit('generate',{batchId:crypto.randomUUID(),model:'music_v1',prompt,duration:seconds,count,estimate:estimate.trim()?ticks(estimate.trim()):null});},'Варианты добавлены в очередь. Оставьте студию открытой до завершения.')}>Создать музыкальные варианты</Button>
      {!configured('elevenlabs')&&<p>Для генерации добавьте ключ ElevenLabs. Свой файл и библиотека доступны без ключа.</p>}
      {jobs.slice(-8).reverse().map(j=><p className="text-sm" key={j.id}>{j.purpose==='music-ideas'?'Анализ сценария':'Музыка'} · {({queued:'В очереди',dispatching:'Генерация',pending:'Обработка',saving:'Сохранение',done:'Готово',failed:'Ошибка',unknown:'Исход неизвестен',cancelled:'Отменено'})[j.status]} · расход: {money(j.actual)}{j.error&&' · '+j.error}</p>)}
    </section>
    <section className="editor-surface p-5 space-y-3"><h2>Своя музыка</h2><Input aria-label="Загрузить музыкальный файл" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg" disabled={disabled} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async()=>{
      const url=URL.createObjectURL(f);let duration:number;
      try{duration=await new Promise<number>((resolve,reject)=>{const a=new Audio();a.preload='metadata';const timer=setTimeout(()=>{a.src='';reject(Error('Не удалось прочитать длительность файла.'));},15000);a.onloadedmetadata=()=>{clearTimeout(timer);const n=a.duration;a.src='';Number.isFinite(n)&&n>0?resolve(n):reject(Error('Не удалось определить длительность музыки.'));};a.onerror=()=>{clearTimeout(timer);reject(Error('Браузер не поддерживает этот аудиофайл.'));};a.src=url;});}finally{URL.revokeObjectURL(url);}
      const a=await upload(f);await submit('upload',{assetId:a.id,title:f.name.slice(0,120),duration});
    },'Музыка загружена. Прослушайте и утвердите выбранный трек.');}}/></section>
    <section className="editor-surface p-5 space-y-3"><h2>Библиотека · Kevin MacLeod / Incompetech</h2><p>Шесть готовых треков для начала. CC BY 4.0: при публикации фильма укажите автора и лицензию; готовый текст сохранится с треком. <a href="https://incompetech.com/music/royalty-free/music.html" target="_blank" rel="noreferrer">Полный каталог</a> — другие треки можно скачать и загрузить выше.</p>
      <div className="grid gap-4 md:grid-cols-2">{[...MUSIC_LIBRARY].sort((a,b)=>Number(suggested.has(b.id))-Number(suggested.has(a.id))).map(t=><article className="editor-surface p-4 space-y-2" key={t.id}><h3>{t.title}{suggested.has(t.id)?' · предложен ИИ':''}</h3><p>{t.description}</p><audio controls preload="none" src={libraryAudio(t.file)} aria-label={'Прослушать '+t.title} className="w-full"/><div className="row wrap"><Button variant="outline" disabled={disabled} onClick={()=>send('library',{trackId:t.id},'Трек добавлен к вариантам. Прослушайте и утвердите его.')}>Добавить к вариантам</Button><a href={libraryUrl(t.id)} target="_blank" rel="noreferrer">Источник</a></div><details><summary>Автор и лицензия</summary><p>{libraryCredit(t.title)}</p></details></article>)}</div>
    </section>
    <section className="editor-surface p-5 space-y-4"><h2>Сведение и утверждение</h2><label className="row"><input type="checkbox" checked={draft.enabled} onChange={e=>field('enabled',e.target.checked)}/>Добавить музыку в итоговый фильм</label>
      <div className="grid gap-3 md:grid-cols-2">{(['volume','speechVolume'] as const).map(key=><label className="field" key={key}>{key==='volume'?'Без речи':'Во время речи, включая закадровую'} · {Math.round(draft[key]*100)}%<input aria-label={key==='volume'?'Громкость музыки без речи':'Громкость музыки при речи'} type="range" min="0" max="100" value={draft[key]*100} onChange={e=>field(key,Number(e.target.value)/100)}/></label>)}<label className="field">Начать музыку с секунды<Input type="number" min={0} max={3600} step={0.1} value={draft.trim} onChange={e=>field('trim',Number(e.target.value))}/></label><label className="field">Плавное начало и окончание, сек<Input type="number" min={0} max={10} step={0.1} value={draft.fade} onChange={e=>field('fade',Number(e.target.value))}/></label></div>
      <label className="row"><input type="checkbox" checked={draft.loop} onChange={e=>field('loop',e.target.checked)}/>Повторять трек, если он короче фильма</label><p className="muted small">Музыка становится тише перед репликой и плавно возвращается после неё. При нуле в поле «Во время речи» музыка в этот момент замолкает. Трек заканчивается вместе с фильмом. Аниматик остаётся проверкой кадров и речи.</p>
      <Button variant="outline" disabled={disabled||!dirty} onClick={()=>send('settings',draft,'Настройки сохранены. Утвердите выбранный трек.')}>Сохранить настройки музыки</Button>
      <label className="row"><input type="checkbox" checked={speechPreview} onChange={e=>setSpeechPreview(e.target.checked)}/>Прослушивать на громкости «Во время речи»</label><p className="muted small">Плееры дают предварительное сравнение громкости. При сборке трек нормализуется и сводится с голосами.</p>
      <div className="grid gap-4 md:grid-cols-2">{[...p.music?.variants??[]].reverse().map(v=><article key={v.id} className="editor-surface p-4 space-y-3"><h3>{v.title}</h3><audio controls preload="metadata" src={'/api/assets/'+v.assetId} className="w-full" aria-label={'Музыкальный вариант '+v.title}/><p>{p.music?.selectedId===v.id?'✓ Выбран · ':''}{p.music?.approvedId===v.id&&!musicIssue(p)&&p.music.settings.enabled?'Утверждён':''}</p><p className="text-sm whitespace-pre-wrap">{v.text}</p><div className="row wrap"><Button variant="outline" disabled={disabled} onClick={()=>send('select',{variantId:v.id})}>{p.music?.selectedId===v.id?'✓ Выбран':'Выбрать'}</Button><Button variant="ghost" disabled={disabled} onClick={()=>send('delete',{variantId:v.id})}>Удалить</Button></div></article>)}</div>
      {musicIssue(p)&&<p>{musicIssue(p)}</p>}{dirty&&<p>Сохраните настройки перед утверждением.</p>}
      <div className="row wrap"><Button disabled={disabled||dirty||!draft.enabled||!p.music?.selectedId} onClick={()=>send('approve',{},'Музыкальное сопровождение утверждено. Теперь пересоберите итоговый фильм.')}>Утвердить музыкальное сопровождение</Button><Button variant="outline" disabled={disabled||dirty||!!musicIssue(p)} onClick={onContinue}>Далее: титры</Button></div>
      {!!p.music?.removedVariants?.length&&<details><summary>Удалённые музыкальные варианты</summary>{p.music.removedVariants.map(v=><p key={v.id}>{v.title} <Button variant="ghost" disabled={disabled} onClick={()=>send('restore',{variantId:v.id})}>Восстановить</Button></p>)}</details>}
    </section>
  </div>;
}
