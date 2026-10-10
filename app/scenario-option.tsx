'use client';
import {useId,useState,type ReactNode} from 'react';

/** Header controls stay available while content is collapsed; no nested interactive summary. */
export function ScenarioOption({title,enabled,status,busy,onToggle,children,error}:{title:string;enabled:boolean;status:string;busy:boolean;onToggle:()=>void;children:ReactNode;error?:string}){
  const [open,setOpen]=useState(false),id=useId();
  return <section className="editor-surface p-5 space-y-4" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className="text-left font-semibold flex-1 min-w-48" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>{open?'▾':'▸'} {title}</button>
      <span className="text-sm text-muted-foreground" role="status">{status}</span>
      <button type="button" role="switch" aria-checked={enabled} aria-label={`Подготовить с ИИ и использовать: ${title}`} disabled={busy} onClick={onToggle} className="flex items-center gap-2 text-sm disabled:opacity-50">
        <span className={`inline-flex w-10 h-6 rounded-full items-center px-1 transition-colors ${enabled?'bg-primary':'bg-muted border'}`}><span className={`block h-4 w-4 rounded-full bg-background transition-transform ${enabled?'translate-x-4':''}`}/></span>
        Сгенерировать ИИ
      </button>
    </div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <div id={id} hidden={!open} className="space-y-4">{children}</div>
  </section>;
}
