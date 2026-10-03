'use client';
import {useState} from 'react';
import type {Project} from '../lib/domain';
import {MODELS} from '../lib/models';
import {readVoiceStudio,type VoiceStudioProject} from '../lib/voice-direction';
import {Button} from '@/components/ui/button';
import {VoiceStudioEditor} from './voice-studio-editor';
export function VoiceStudioShell({p,busy,connections,submit,soundStage=false,onOpenCatalog}:{p:Project;busy:boolean;connections?:{providers?:{id:string;configured:boolean}[]};submit:(action:string,data:Record<string,unknown>)=>Promise<void>;soundStage?:boolean;onOpenCatalog?:()=>void}){
 const choices=MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)&&connections?.providers?.some(c=>c.id===m.provider&&c.configured));
 const [selected,setSelected]=useState(''),model=choices.some(m=>m.id===selected)?selected:choices[0]?.id??'';
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 const mode=readVoiceStudio(p as VoiceStudioProject).characterAudioMode??'skip';
 const editor=<><label>Модель для агента по исполнению <select value={model} disabled={busy||working} onChange={e=>setSelected(e.target.value)}><option value="">Выберите подключённую текстовую модель</option>{choices.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><VoiceStudioEditor p={p} model={model} busy={busy||working} submit={submit} allowDesign={soundStage&&mode==='design'}/></>;
 if(!soundStage)return <details className="editor-surface p-5 mb-5"><summary>Сохранённые голоса и исполнение реплик</summary><p>Новый голос по описанию создаётся на этапе «Звуки». Здесь выберите сохранённый профиль и настройте исполнение реплики.</p>{editor}</details>;
 return <section className="editor-surface p-5 mb-5 space-y-4" aria-label="Звуки и голоса героев"><h3>Звуки и голоса героев · необязательно</h3><p>Внешний образ героя и его голос создаются отдельно. Выберите способ; если герои не разговаривают, создание голоса можно пропустить.</p>
  <label className="block">Тип озвучки героя<select className="w-full rounded border p-2 bg-background" aria-label="Тип озвучки героя" value={mode} disabled={busy||working} onChange={async e=>{setWorking(true);setError('');try{await submit('setCharacterAudioMode',{mode:e.target.value});}catch(err){setError(err instanceof Error?err.message:String(err));}finally{setWorking(false);}}}><option value="skip">Пропустить создание голосов героев</option><option value="catalog">Готовые голоса из каталога или сохранённые профили</option><option value="design">Создать новый голос по описанию с ИИ</option><option value="nonverbal">Звуки героя без слов: смех, вздохи, кваканье</option></select></label>
  {error&&<p role="alert">{error}</p>}
  {mode==='skip'&&<p>Новые голоса не создаются. Существующие записи и закадровый рассказ сохраняются; вид речи каждого плана задаётся в сценарии.</p>}
  {mode==='nonverbal'&&<p>Ниже добавьте слой типа «Звуки героя без слов», привяжите к сцене или плану. Загрузите свой звук либо создайте варианты с ElevenLabs Sound Effects. Для произносимых реплик используйте готовый или новый голос.</p>}
  {mode==='catalog'&&onOpenCatalog&&<Button variant="outline" disabled={busy||working} onClick={onOpenCatalog}>Сравнить готовые голоса в каталоге</Button>}
  {['catalog','design'].includes(mode)&&editor}
 </section>;
}
