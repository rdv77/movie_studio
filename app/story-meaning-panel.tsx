'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import type {Project} from '@/lib/domain';
import {MODELS} from '@/lib/models';
import {meaningCoverage,storyMeaningsApproved,storyMeaningsSchema,type StoryMeaning} from '@/lib/story-meaning';

const KINDS={setup:'Завязка / ожидание',turn:'Поворот',climax:'Кульминация',resolution:'Развязка / решение',support:'Поддерживающий смысл'} as const;
const FIELDS={viewerBefore:'Что зритель уже должен знать',viewerAfter:'Что зритель должен понять',event:'Событие, которое это показывает',stakes:'Почему это важно для героя'} as const;
export function MeaningLinks({p,value,onChange,disabled=false}:{p:Project;value?:string[];onChange:(value:string[])=>void;disabled?:boolean}){
  const meanings=p.directing?.storyMeanings??[];
  if(!meanings.length)return null;
  return <fieldset disabled={disabled} className="rounded border p-3 space-y-2"><legend className="px-1 font-medium">Какие смыслы раскрывает этот материал</legend><p className="text-sm text-muted-foreground">Отметьте только относящиеся к этой сцене или плану. Связь с сюжетом не заменяет описание видимого действия.</p>{meanings.map(m=><label className="flex gap-2 items-start" key={m.id}><input type="checkbox" checked={value?.includes(m.id)??false} onChange={e=>onChange(e.target.checked?[...new Set([...(value??[]),m.id])]:(value??[]).filter(id=>id!==m.id))}/><span>{m.title} {m.priority==='required'&&'· обязательный'}</span></label>)}</fieldset>;
}
export function MeaningSummary({p,ids}:{p:Project;ids?:string[]}){
  const meanings=p.directing?.storyMeanings?.filter(m=>ids?.includes(m.id))??[];
  if(!meanings.length)return null;
  return <div className="rounded border p-3 space-y-2" aria-label="Главное для зрителя">{meanings.map(m=><div key={m.id}><p><b>Главное для зрителя:</b> {m.viewerAfter}</p><p className="text-sm">На экране: {m.evidence.join('; ')}</p></div>)}</div>;
}
export function StoryMeaningPanel({p,busy,submit,editable=false,showCoverage=true,onOpenShot}:{p:Project;busy:boolean;submit:(action:string,data?:unknown)=>Promise<void>;editable?:boolean;showCoverage?:boolean;onOpenShot?:(sceneId:string,shotId:string)=>void}){
  const saved=JSON.stringify(p.directing?.storyMeanings??[]);
  const [draft,setDraft]=useState<StoryMeaning[]>(()=>structuredClone(p.directing?.storyMeanings??[]));
  const [dirty,setDirty]=useState(false),[message,setMessage]=useState(''),[working,setWorking]=useState(false);
  const [model,setModel]=useState('gpt-6-astra');
  useEffect(()=>{if(!dirty)setDraft(JSON.parse(saved));},[saved,dirty]);
  useEffect(()=>{setDirty(false);setDraft(JSON.parse(saved));setMessage('');},[p.id]);
  const coverage=meaningCoverage(p),approved=storyMeaningsApproved(p),locked=busy||working;
  const meaningCount=p.directing?.storyMeanings?.length??0;
  const status=approved?'утверждено':meaningCount||p.directing?.storyMeaningsApproved?'сохранено':'не используется';
  const change=(next:StoryMeaning[])=>{setDraft(next);setDirty(true);setMessage('');};
  const patch=(index:number,values:Partial<StoryMeaning>)=>change(draft.map((m,n)=>n===index?{...m,...values}:m));
  const call=async(action:string,data?:unknown)=>{setWorking(true);setMessage('');try{await submit(action,data);return true;}catch(e){setMessage((e as Error).message);return false;}finally{setWorking(false);}};
  const parsed=storyMeaningsSchema.safeParse(draft);
  const hasScript=p.items.some(i=>i.stage===0&&!i.removedAt&&!i.planArchive&&i.variants.some(v=>v.id===i.approvedId&&v.text.trim()));
  return <details className="rounded border p-4 space-y-3"><summary className="cursor-pointer font-semibold">Что должен понять зритель · {status}{meaningCount>0&&` · ${meaningCount}`}{dirty&&' · есть несохранённые правки'}</summary><p className="text-sm text-muted-foreground">Необязательный этап: если карта смыслов ещё не используется, можно оставить блок свёрнутым и продолжить без генерации. Уже сохранённую карту нужно проверить и утвердить для текущего сценария.</p><p className="text-sm text-muted-foreground">Обязательные смыслы связывают сценарий, сцены, планы и визуальную проверку. Наличие текста в промпте ещё не доказывает, что смысл виден на экране.</p>
    {editable&&<><div className="flex flex-wrap gap-2 items-center"><label>Модель драматурга <select className="rounded border p-2 bg-background" aria-label="Модель выделения смыслов" disabled={locked} value={model} onChange={e=>setModel(e.target.value)}>{MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><Button type="button" variant="outline" disabled={locked||dirty||!hasScript} onClick={()=>call('run',{model,mode:'role',role:'story-meaning'})}>Выделить смыслы с ИИ</Button></div><p className="text-sm text-muted-foreground">По умолчанию выбран GPT-6 Astra. Выбор модели и раскрытие блока не запускают запрос. Кнопка «Выделить смыслы с ИИ» запускает платный разбор утверждённого общего сценария; полученную карту нужно проверить и утвердить.</p>
    <fieldset disabled={locked} className="space-y-3">{draft.map((m,n)=><article key={m.id} className="border rounded p-3 space-y-3"><div className="grid gap-3 md:grid-cols-2"><label>Название смысла<Input value={m.title} maxLength={100} onChange={e=>patch(n,{title:e.target.value})}/></label><label>Роль в истории<select className="w-full rounded border p-2 bg-background" value={m.kind} onChange={e=>patch(n,{kind:e.target.value as StoryMeaning['kind']})}>{Object.entries(KINDS).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label></div><label className="flex gap-2"><input type="checkbox" checked={m.priority==='required'} onChange={e=>patch(n,{priority:e.target.checked?'required':'supporting'})}/>Обязателен для понимания сюжета</label><div className="grid gap-3 md:grid-cols-2">{Object.entries(FIELDS).map(([key,label])=><label key={key}>{label}<Textarea rows={2} value={m[key as keyof typeof FIELDS]} maxLength={400} onChange={e=>patch(n,{[key]:e.target.value})}/></label>)}</div><label className="block">Видимые признаки — по одному на строку<Textarea rows={3} value={m.evidence.join('\n')} onChange={e=>patch(n,{evidence:e.target.value.split('\n')})}/></label><Button type="button" size="sm" variant="ghost" disabled={locked} onClick={()=>change(draft.filter((_,i)=>i!==n))}>Удалить смысл</Button></article>)}</fieldset>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={locked||draft.length>=20} onClick={()=>change([...draft,{id:crypto.randomUUID(),title:'',kind:'turn',priority:'required',viewerBefore:'',viewerAfter:'',event:'',stakes:'',evidence:[]}])}>Добавить смысл</Button><Button type="button" disabled={locked||!dirty||!parsed.success} onClick={async()=>{if(await call('saveStoryMeanings',{meanings:draft}))setDirty(false);}}>Сохранить смыслы</Button><Button type="button" variant="outline" disabled={locked||dirty||!draft.length||approved||!hasScript} onClick={()=>call('approveStoryMeanings')}>{approved?'✓ Смыслы утверждены':'Утвердить смыслы'}</Button>{dirty&&<Button type="button" variant="ghost" disabled={locked} onClick={()=>{setDirty(false);setDraft(JSON.parse(saved));}}>Отменить несохранённые правки</Button>}</div>{dirty&&!parsed.success&&<p className="text-sm" role="status">{parsed.error.issues[0]?.message}</p>}{dirty&&<p role="status">Есть несохранённые правки. Сохраните их перед утверждением или новым запросом к ИИ.</p>}</>}
    {!editable&&<div className="space-y-2">{(p.directing?.storyMeanings??[]).map(m=><p key={m.id}><b>{m.title}</b> · {m.viewerAfter}</p>)}</div>}
    {meaningCount>0&&!approved&&<p role="status">Карту смыслов нужно утвердить для текущего сценария на этапе «Общий сценарий».</p>}
    {meaningCount>0&&showCoverage&&<><p><b>Распределено по планам: {coverage.covered} из {coverage.required} обязательных смыслов.</b> Это проверка описаний, не готовых изображений.</p>{coverage.rows.map(row=><div className="border rounded p-2" key={row.meaningId}><b>{row.title}</b> · {row.covered?'есть постановка':'нужна постановка'}<div className="flex flex-wrap gap-1">{row.shotIds.map(id=>{const scene=p.directing?.scenes.find(s=>s.shots.some(shot=>shot.id===id)),shot=scene?.shots.find(s=>s.id===id);return onOpenShot&&scene?<Button type="button" size="sm" variant="link" key={id} onClick={()=>onOpenShot(scene.id,id)}>{shot?.title??id}</Button>:<span key={id}>{shot?.title??id}</span>;})}</div></div>)}{coverage.issues.map((i,n)=><p className="text-sm" key={n}>{i.message}</p>)}</>}
    {message&&<p role="alert">{message}</p>}
  </details>;
}
