'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog,DialogContent,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs';
import type { Project } from '@/lib/domain';
import { money } from '@/lib/domain';
import { MODELS } from '@/lib/models';
import { DEFAULT_BRIEF,DIRECTOR_PRESETS,ROLE_NAMES,shotApproved,scenesBasis,type Scene,type DirectingShot,type DirectorRole } from '@/lib/directing';

type Props={p:Project;stage:number;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;open:(stage:number)=>void};
const F=({label,children}:{label:string;children:React.ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;
export function DirectingEditor({p,stage,busy,submit,open}:Props){
  const d=p.directing;
  const [brief,setBrief]=useState(d?.brief??{...DEFAULT_BRIEF,targetSeconds:Math.max(10,p.seconds)});
  const [order,setOrder]=useState(p.productionOrder??'voice-first');
  const [model,setModel]=useState(MODELS.find(m=>m.kind==='text'&&m.provider==='openai')!.id);
  const [sceneId,setSceneId]=useState(d?.scenes[0]?.id??'');
  const [editing,setEditing]=useState<Scene>();
  const [shotEdit,setShotEdit]=useState<{sceneId:string;shot:DirectingShot}>();
  const [resolution,setResolution]=useState('');
  const [continuityText,setContinuityText]=useState('');
  const [castText,setCastText]=useState('');
  const editScene=(scene:Scene)=>{setEditing(structuredClone(scene));setContinuityText(scene.continuity.map(c=>`${c.character} | ${c.outfit} | ${c.props}`).join('\n'));};
  const editShot=(sceneId:string,shot:DirectingShot)=>{setShotEdit({sceneId,shot:structuredClone(shot)});setCastText(shot.cast.join(', '));};
  const scenes=d?.scenes??[],scene=scenes.find(s=>s.id===sceneId)??scenes[0];
  const run=d?.runs.at(-1),running=!!run&&!run.stopped&&run.tasks.some(t=>!t.result&&!t.error);
  const locked=busy||running;
  const call=(action:string,data?:unknown)=>submit(action,data);
  const generate=(mode:string,extra:Record<string,unknown>={})=>call('run',{model,mode,...extra});
  const roles:{id:DirectorRole;label:string}[]=[{id:'story',label:'Сценарий'},{id:'camera',label:'Оператор'},{id:'art',label:'Художник'},{id:'dialogue',label:'Реплики'}];
  const shotField=(key:keyof DirectingShot,value:unknown)=>setShotEdit(e=>e?{...e,shot:{...e.shot,[key]:value}}:e);
  return <section className="editor-surface p-5 mb-6 space-y-5" aria-label="Команда сценаристов и режиссёров">
    <div className="row spread wrap"><div><div className="eyebrow">РЕЖИССЁРСКАЯ ГРУППА</div><h2>{stage===0?'Творческое задание и рецензия':stage===12?'Структура сцен':'Проработка всех планов'}</h2></div>
      <F label="Модель команды"><select className="rounded border p-2 bg-background" aria-label="Модель режиссёрской группы" value={model} disabled={locked} onChange={e=>setModel(e.target.value)}>{MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></F></div>
    <p className="muted">Один вариант по умолчанию. Специалисты работают параллельно; утверждение остаётся за вами. Стоимость каждого вызова — в журнале проекта.</p>
    {stage===0&&<>
      <div className="grid gap-4 md:grid-cols-2">
        <F label="Жанр"><Input list="director-genres" value={brief.genre} onChange={e=>setBrief({...brief,genre:e.target.value})}/><datalist id="director-genres">{['Комедия','Приключение','Блокбастер','Хоррор','Драма','Неигровое кино','Сказка'].map(s=><option key={s} value={s}/>)}</datalist></F>
        <F label="Режиссёрский подход"><select className="w-full rounded border p-2 bg-background" value={brief.director} onChange={e=>setBrief({...brief,director:e.target.value,techniques:DIRECTOR_PRESETS[e.target.value]})}>{Object.keys(DIRECTOR_PRESETS).map(s=><option key={s}>{s}</option>)}</select></F>
        <F label="Аудитория"><Input value={brief.audience} onChange={e=>setBrief({...brief,audience:e.target.value})}/></F>
        <F label="Ориентир длительности, сек"><Input type="number" min={10} max={3600} value={brief.targetSeconds} onChange={e=>setBrief({...brief,targetSeconds:Number(e.target.value)})}/></F>
        <F label="Какое чувство должен вызвать фильм"><Textarea value={brief.effect} onChange={e=>setBrief({...brief,effect:e.target.value})}/></F>
        <F label="Приёмы — можно изменить"><Textarea value={brief.techniques} onChange={e=>setBrief({...brief,techniques:e.target.value})}/></F>
        <F label="Что нельзя менять"><Textarea value={brief.locked} onChange={e=>setBrief({...brief,locked:e.target.value})}/></F>
        <F label="Порядок производства"><select className="w-full rounded border p-2 bg-background" value={order} onChange={e=>setOrder(e.target.value as typeof order)}><option value="voice-first">Сначала голоса и аниматик, затем видео</option><option value="video-first">Сначала видео, затем голоса под его длительность</option></select><small>При озвучке после видео проверяем фактическую длину файлов. Речь не обрезается и не ускоряется.</small></F>
      </div>
      <label className="row"><input type="checkbox" checked={brief.factual} onChange={e=>setBrief({...brief,factual:e.target.checked})}/>Неигровое кино: сохранять факты, отмечать сведения для проверки</label>
      <div className="row wrap"><Button disabled={locked} onClick={()=>call('brief',{brief,productionOrder:order})}>Сохранить творческое задание</Button><Button variant="outline" disabled={locked||!d} onClick={()=>generate('critic')}>Рецензия сценария</Button><Button variant="outline" onClick={()=>open(12)}>Перейти к сценам</Button></div>
      {d?.critic&&<div className="space-y-3"><h3>Рецензия</h3><p className="whitespace-pre-wrap">{d.critic.review}</p>{d.critic.alternatives.map((a,index)=><details key={index}><summary>{a.title}</summary><p className="whitespace-pre-wrap">{a.text}</p><Button disabled={locked} variant="outline" onClick={()=>call('useAlternative',{index})}>Добавить как вариант сценария</Button></details>)}</div>}
    </>}
    {stage===12&&<>
      {!scenes.length&&<Button variant="outline" disabled={locked} onClick={()=>call('importScript')}>Перенести текущий подробный сценарий без генерации</Button>}
      <div className="row wrap"><Button disabled={locked} onClick={()=>generate('scenes',{replaceScenes:!!scenes.length})}>{scenes.length?'Заново разделить сценарий на сцены':'Создать весь этап · разделить на сцены'}</Button><Button variant="outline" disabled={locked} onClick={()=>editScene({id:'new',title:'Новая сцена',purpose:'',location:'',conflict:'',turn:'',stateIn:'',stateOut:'',continuity:[],shots:[]})}>Добавить сцену вручную</Button><Button disabled={locked||!scenes.length} variant="outline" onClick={()=>call('approveScenes')}>{d?.scenesApproved===scenesBasis(p)?'✓ Структура сцен утверждена':'Утвердить структуру сцен'}</Button></div>
      {scenes.length>0&&<p className="muted">Повторное разбиение создаёт новую структуру для проработки. Опубликованный сценарий и готовые файлы остаются в истории проекта.</p>}
      {scenes.map((s,n)=><article key={s.id} className="border rounded p-4 space-y-2"><strong>{n+1}. {s.title}</strong><p>{s.purpose}</p><p><b>Локация:</b> {s.location}</p><p><b>Конфликт:</b> {s.conflict} <b>Поворот:</b> {s.turn}</p><p><b>Начало:</b> {s.stateIn} <b>Конец:</b> {s.stateOut}</p>{s.continuity.map((c,n)=><p key={n}><b>{c.character}:</b> {c.outfit} · {c.props}</p>)}<div className="row"><Button size="sm" variant="outline" disabled={locked} onClick={()=>editScene(s)}>Правки</Button><Button size="sm" variant="ghost" disabled={locked} onClick={()=>call('removeScene',{sceneId:s.id})}>Удалить сцену</Button></div></article>)}
      <Dialog open={!!editing} onOpenChange={value=>{if(!value)setEditing(undefined);}}><DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
      {editing&&<><DialogHeader><DialogTitle>Правки сцены: {editing.title}</DialogTitle></DialogHeader>{(['title','purpose','location','conflict','turn','stateIn','stateOut'] as const).map((key,n)=><F key={key} label={['Название','Задача сцены','Локация','Конфликт','Поворот','Состояние в начале','Состояние в конце'][n]}><Textarea value={editing[key]} onChange={e=>setEditing({...editing,[key]:e.target.value})}/></F>)}
        <F label="Постоянные одежда и реквизит — строка на героя: имя | одежда | предметы"><Textarea rows={5} value={continuityText} onChange={e=>setContinuityText(e.target.value)}/></F>
        <div className="row sticky bottom-0 bg-popover py-3"><Button disabled={locked} onClick={async()=>{await call('saveScene',{scene:{...editing,continuity:continuityText.split('\n').filter(line=>line.trim()).map(line=>{const [character='',outfit='',...props]=line.split('|');return {character:character.trim(),outfit:outfit.trim(),props:props.join('|').trim()};})}});setEditing(undefined);}}>Сохранить сцену</Button><Button variant="ghost" onClick={()=>setEditing(undefined)}>Закрыть</Button></div></>}
      </DialogContent></Dialog>
      <Button variant="outline" onClick={()=>open(2)}>Перейти к визуальному стилю</Button>
    </>}
    {stage===4&&<>
      {!d?.scenes.length?<p>Для работы команды сначала подготовьте и утвердите <Button variant="link" onClick={()=>open(12)}>структуру сцен</Button>. Прежний способ создания сценария остаётся ниже.</p>:<>
        <div className="row wrap"><Button disabled={locked||d.scenesApproved!==scenesBasis(p)} onClick={()=>generate('develop')}>Создать весь этап · все сцены и специалисты</Button><Button variant="outline" disabled={locked||!scenes.some(s=>s.shots.length)} onClick={()=>generate('editor')}>Проверить весь фильм редактором</Button></div>
        <p className="muted">Оператор, художник и автор реплик работают после режиссёра сцены. Редактор проверяет переходы, одежду и реквизит по всему фильму.</p>
        <F label="Сцена"><select className="w-full rounded border p-2 bg-background" value={scene?.id??''} onChange={e=>setSceneId(e.target.value)}>{scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></F>
        {scene&&<><p><b>Постоянные образы:</b> {scene.continuity.map(c=>`${c.character}: ${c.outfit}; ${c.props}`).join(' · ')}</p><div className="row wrap">{roles.map(r=><Button key={r.id} size="sm" variant="outline" disabled={locked||(r.id!=='story'&&!scene.shots.length)} onClick={()=>generate('role',{sceneId:scene.id,role:r.id})}>Доработать: {r.label}</Button>)}</div>
          {scene.shots.map((s,n)=><article className="border rounded p-4 space-y-3" key={s.id}><div className="row spread"><strong>{n+1}. {s.title} · {s.duration} сек</strong><span>{shotApproved(scene,s,p)?'✓ Утверждён':'На рассмотрении'}</span></div>
            <Tabs defaultValue="story"><TabsList className="flex flex-wrap h-auto"><TabsTrigger value="story">Сценарий</TabsTrigger><TabsTrigger value="camera">Оператор</TabsTrigger><TabsTrigger value="art">Художник</TabsTrigger><TabsTrigger value="dialogue">Реплики и звук</TabsTrigger></TabsList>
              <TabsContent value="story"><p className="whitespace-pre-wrap">{s.story}</p><p>В начале: {s.stateIn}</p><p>В конце: {s.stateOut}</p><p>Изменения одежды / предметов: {s.continuityChanges||'Нет'}</p></TabsContent>
              <TabsContent value="camera"><p className="whitespace-pre-wrap">{s.cinematography}</p></TabsContent><TabsContent value="art"><p className="whitespace-pre-wrap">{s.productionDesign}</p></TabsContent><TabsContent value="dialogue"><p>{s.dialogue.speechType==='none'?'Без речи':s.dialogue.speechType==='voiceover'?'За кадром':'В кадре'} · {s.dialogue.speaker}</p><p className="whitespace-pre-wrap">{s.dialogue.text}</p><p className="muted">{s.dialogue.delivery}</p></TabsContent>
            </Tabs><div className="row wrap"><Button size="sm" variant="outline" disabled={locked} onClick={()=>editShot(scene.id,s)}>Правки четырёх частей</Button><Button size="sm" disabled={locked||shotApproved(scene,s,p)} onClick={()=>call('approveShots',{ids:[s.id]})}>Утвердить план</Button></div>
          </article>)}
        </>}
        {shotEdit&&<div className="border rounded p-4 space-y-3"><h3>Правки плана</h3><div className="grid gap-3 md:grid-cols-2"><F label="Название"><Input value={shotEdit.shot.title} onChange={e=>shotField('title',e.target.value)}/></F><F label="Секунды (ориентир)"><Input type="number" min={.5} max={60} step={.1} value={shotEdit.shot.duration} onChange={e=>shotField('duration',Number(e.target.value))}/></F></div>
          <F label="Участники через запятую"><Input value={castText} onChange={e=>setCastText(e.target.value)}/></F>
          {(['story','stateIn','stateOut','cinematography','productionDesign','continuityChanges'] as const).map((key,n)=><F key={key} label={['Сценарий','Начальное состояние','Конечное состояние','Операторская работа','Художественное решение','Обоснованные изменения одежды / реквизита'][n]}><Textarea rows={4} value={shotEdit.shot[key]} onChange={e=>shotField(key,e.target.value)}/></F>)}
          <F label="Режим речи"><select className="rounded border p-2 bg-background" value={shotEdit.shot.dialogue.speechType} onChange={e=>shotField('dialogue',{...shotEdit.shot.dialogue,speechType:e.target.value,...(e.target.value==='none'?{text:'',speaker:''}:{})})}><option value="none">Без речи</option><option value="voiceover">Закадровый голос</option><option value="character">Герой в кадре</option></select></F>
          {(['speaker','text','delivery'] as const).map((key,n)=><F key={key} label={['Говорящий','Только произносимые слова','Подача, паузы и звуки'][n]}><Textarea value={shotEdit.shot.dialogue[key]} onChange={e=>shotField('dialogue',{...shotEdit.shot.dialogue,[key]:e.target.value})}/></F>)}
          <div className="row"><Button disabled={locked} onClick={async()=>{await call('saveShot',{...shotEdit,shot:{...shotEdit.shot,cast:castText.split(',').map(s=>s.trim()).filter(Boolean)}});setShotEdit(undefined);}}>Сохранить план</Button><Button variant="ghost" onClick={()=>setShotEdit(undefined)}>Закрыть</Button></div>
        </div>}
        <div className="row wrap"><Button variant="outline" disabled={locked} onClick={()=>call('approveShots',{ids:scenes.flatMap(s=>s.shots.filter(shot=>!shotApproved(s,shot,p)).map(s=>s.id))})}>Утвердить все готовые планы</Button><Button disabled={locked||scenes.some(s=>!s.shots.length||s.shots.some(shot=>!shotApproved(s,shot,p)))} onClick={()=>call('publish',{model})}>Подготовить промпты и применить сценарий</Button></div>
      </>}
    </>}
    {!!d?.issues.length&&<div className="space-y-3"><h3>Проверка редактора</h3><F label="Как разрешён конфликт (исправление или обоснованное решение)"><Input value={resolution} onChange={e=>setResolution(e.target.value)} placeholder="Например: герой снимает плащ в конце предыдущего плана"/></F>{d.issues.map(i=><div key={i.id} className="border rounded p-3"><p>{i.resolved?'✓':i.severity==='conflict'?'Конфликт':'Замечание'}: {i.message}</p>{i.resolution&&<small>{i.resolution}</small>}{!i.resolved&&<Button size="sm" variant="outline" disabled={locked||!resolution.trim()} onClick={()=>call('resolveIssue',{issueId:i.id,resolution})}>Зафиксировать решение</Button>}</div>)}</div>}
    {!!d?.patches.length&&<div className="space-y-3"><h3>Предлагаемые правки</h3>{d.patches.map(patch=><details key={patch.id}><summary>{patch.reason} {patch.applied&&'✓ Применено'}</summary><p className="whitespace-pre-wrap"><b>Было:</b> {patch.before}</p><p className="whitespace-pre-wrap"><b>Предложение:</b> {patch.after}</p><Button size="sm" disabled={locked||patch.applied} onClick={()=>call('applyPatch',{patchId:patch.id})}>Применить правку</Button></details>)}</div>}
    {run&&<details open={running}><summary>Работа команды · {run.tasks.filter(t=>t.applied).length}/{run.tasks.length}</summary><p className="muted">На этом сайте оставьте студию открытой. Сохранённая очередь продолжается при возвращении. В самостоятельной серверной версии обработка работает в фоне.</p>
      <div className="space-y-2">{run.tasks.map(t=>{const job=p.jobs.find(j=>j.id===t.jobId);return <div key={t.id} className="border rounded p-3"><b>{ROLE_NAMES[t.role]}</b> {scenes.find(s=>s.id===t.sceneId)?.title} · {t.error?'Требует внимания':t.applied?'Готово':job?'В работе':'Ожидает'}{job&&<small> · расход: {money(job.actual)}</small>}{t.error&&<p role="alert">{t.error}</p>}{t.error&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>call('retry',{runId:run.id,taskId:t.id,acknowledgeCost:true})}>{job?.status==='unknown'?'Повторить с возможным повторным списанием':'Повторить только это задание'}</Button>}</div>;})}</div>
      {!run.stopped&&<Button className="mt-3" variant="outline" disabled={busy} onClick={()=>call('stop',{runId:run.id})}>Остановить дальнейшую проработку</Button>}
    </details>}
  </section>;
}
