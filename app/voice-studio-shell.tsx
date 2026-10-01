'use client';
import {useState} from 'react';
import type {Project} from '../lib/domain';
import {MODELS} from '../lib/models';
import {VoiceStudioEditor} from './voice-studio-editor';
export function VoiceStudioShell({p,busy,connections,submit}:{p:Project;busy:boolean;connections?:{providers?:{id:string;configured:boolean}[]};submit:(action:string,data:Record<string,unknown>)=>Promise<void>}){
 const choices=MODELS.filter(m=>m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)&&connections?.providers?.some(c=>c.id===m.provider&&c.configured));
 const [selected,setSelected]=useState(''),model=choices.some(m=>m.id===selected)?selected:choices[0]?.id??'';
 return <details className="editor-surface p-5 mb-5"><summary>Голосовые образы и актёрская постановка</summary><label>Модель для агента по исполнению <select value={model} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">Выберите подключённую текстовую модель</option>{choices.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><VoiceStudioEditor p={p} model={model} busy={busy} submit={submit}/></details>;
}
