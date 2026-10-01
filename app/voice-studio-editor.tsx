'use client';
import {useState} from 'react';
import {chosen,type Project} from '@/lib/domain';
import {VoiceDirectionEditor,type VoiceEditorProps} from './voice-direction-editor';

export type VoiceStudioEditorProps=Omit<VoiceEditorProps,'itemId'>&{initialItemId?:string};
/** The library and design previews are shown once; switching a plan never creates a request. */
export function VoiceStudioEditor({p,initialItemId,...props}:VoiceStudioEditorProps){
  const plans=p.items.filter(i=>i.stage===6&&!i.removedAt&&!i.excludedAt&&!i.planArchive);
  const [selected,setSelected]=useState(initialItemId??plans.find(i=>chosen(i)?.dialogue.trim())?.id??plans[0]?.id??'');
  const item=plans.find(i=>i.id===selected),itemId=item?.id;
  return <section className="space-y-4" aria-label="Студия голосов">
    <div className="editor-surface p-5 space-y-3"><h2>Студия голосов</h2>
      <p>Создайте и сравните голоса, сохраните нужный профиль, затем настройте исполнение реплики выбранного плана. Готовые записи меняются только после новой озвучки.</p>
      <label className="block space-y-1"><span>План для постановки реплики</span>
        <select className="w-full rounded border p-2 bg-background" aria-label="План для постановки реплики" value={itemId??''} disabled={props.busy} onChange={e=>setSelected(e.target.value)}>
          <option value="">Только библиотека голосов</option>{plans.map(i=><option key={i.id} value={i.id}>{i.title}{chosen(i)?.dialogue.trim()?'':' · без реплики'}</option>)}
        </select>
      </label>
    </div>
    <VoiceDirectionEditor key={`${p.id}:${itemId??'library'}`} p={p} itemId={itemId} {...props}/>
  </section>;
}
