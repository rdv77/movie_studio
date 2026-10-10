'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {storyMeaningsSchema,type StoryMeaning} from '@/lib/story-meaning';

const kinds={setup:'Завязка',turn:'Поворот',climax:'Кульминация',resolution:'Развязка',support:'Поддерживающий смысл'};
export function ScenarioMeaningDraft({value,busy,save,onDirtyChange}:{value:StoryMeaning[];busy:boolean;save:(meanings:StoryMeaning[])=>Promise<void>;onDirtyChange?:(dirty:boolean)=>void}){
  const [draft,setDraft]=useState(value),[dirty,setDirty]=useState(false),[error,setError]=useState('');
  const saved=JSON.stringify(value);
  useEffect(()=>{if(!dirty)setDraft(JSON.parse(saved));},[saved,dirty]);
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  const change=(next:StoryMeaning[])=>{setDraft(next);setDirty(true);};
  const patch=(n:number,data:Partial<StoryMeaning>)=>change(draft.map((m,i)=>i===n?{...m,...data}:m));
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Здесь задаётся, что зритель должен понять из действия. Карта используется при разработке сцен и планов, подготовке промптов и визуальной проверке. Она станет основой фильма вместе с утверждённым новым сценарием.</p>
    <fieldset disabled={busy} className="space-y-3">{draft.map((m,n)=><article key={m.id} className="border rounded p-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2"><label>Название<Input value={m.title} onChange={e=>patch(n,{title:e.target.value})}/></label><label>Роль в сюжете<select className="w-full rounded border p-2 bg-background" value={m.kind} onChange={e=>patch(n,{kind:e.target.value as StoryMeaning['kind']})}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
      {Object.entries({viewerBefore:'Что зритель уже знает',viewerAfter:'Что зритель должен понять',event:'Какое событие это показывает',stakes:'Почему это важно герою'}).map(([key,label])=><label className="block" key={key}>{label}<Textarea value={m[key as 'event']} onChange={e=>patch(n,{[key]:e.target.value})}/></label>)}
      <label className="block">Что должно быть видно на экране<Textarea value={m.evidence.join('\n')} onChange={e=>patch(n,{evidence:e.target.value.split('\n')})}/></label>
      <div className="flex gap-3 items-center"><label><input type="checkbox" checked={m.priority==='required'} onChange={e=>patch(n,{priority:e.target.checked?'required':'supporting'})}/> Обязательный смысл</label><Button type="button" variant="ghost" onClick={()=>change(draft.filter((_,i)=>i!==n))}>Удалить</Button></div>
    </article>)}
    <Button type="button" variant="outline" onClick={()=>change([...draft,{id:crypto.randomUUID(),kind:'support',priority:'required',title:'',viewerBefore:'',viewerAfter:'',event:'',stakes:'',evidence:['']}])}>Добавить смысл</Button>
    </fieldset>
    {dirty&&<p role="status" className="text-sm">Есть несохранённые правки.</p>}
    <Button type="button" disabled={busy||!dirty} onClick={async()=>{setError('');const parsed=storyMeaningsSchema.safeParse(draft);if(!parsed.success){setError('Заполните название, событие и описание каждого смысла; уберите пустые строки в экранных признаках.');return;}try{await save(parsed.data);setDirty(false);}catch(e){setError((e as Error).message);}}}>Применить смыслы</Button>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
