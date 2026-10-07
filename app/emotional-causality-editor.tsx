'use client';
import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NARRATIVE_BEAT_LABELS,type NarrativeBeat,type SceneCausalLink} from '@/lib/emotional-dramaturgy';

const Field=({label,children}:{label:string;children:ReactNode})=><label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>;
const FIELDS={trigger:'Что происходит: причина реакции',meaning:'Что это означает для героя',emotionStart:'Эмоция до события',emotionEnd:'Эмоция после события',decision:'К какому решению приходит герой',visibleEvidence:'Как зритель увидит перемену'} as const;
const emptyEvent=()=>({trigger:'',meaning:'',emotionStart:'',emotionEnd:'',decision:'',visibleEvidence:''});

/** A user must choose a role before this optional block is created. */
export function chooseNarrativeRole(value:NarrativeBeat|undefined,role:NarrativeBeat['role']|undefined):NarrativeBeat|undefined {
  return role?{...emptyEvent(),...structuredClone(value),role}:undefined;
}
export function addSceneCausalLink(value:SceneCausalLink[]|undefined):SceneCausalLink[]{return [...structuredClone(value??[]),{character:'',expectation:'',...emptyEvent()}];}
export function sceneCausalIssues(value:SceneCausalLink[]|undefined):string[]{return (value??[]).flatMap((link,n)=>link.character.trim()?[]:[`Перемена ${n+1}: укажите героя.`]);}

function EventSummary({value}:{value:Pick<NarrativeBeat,keyof typeof FIELDS>}){
  return <div className="space-y-1 text-sm">{Object.entries(FIELDS).map(([key,label])=>value[key as keyof typeof FIELDS]&&<p className="whitespace-pre-wrap" key={key}><b>{label}:</b> {value[key as keyof typeof FIELDS]}</p>)}</div>;
}

export function SceneCausalSummary({value}:{value?:SceneCausalLink[]}){
  if(!value?.length)return null;
  return <details className="rounded border p-3 space-y-3"><summary className="cursor-pointer font-medium">Эмоциональная логика сцены · {value.length}</summary><ol className="space-y-3 pt-2">{value.map((link,n)=><li key={n} className="rounded border p-3 space-y-2"><strong>{n+1}. {link.character||'Герой не указан'}</strong>{link.expectation&&<p><b>Чего ожидает:</b> {link.expectation}</p>}<EventSummary value={link}/></li>)}</ol></details>;
}

export function SceneCausalEditor({value,onChange,disabled=false}:{value?:SceneCausalLink[];onChange:(value:SceneCausalLink[]|undefined)=>void;disabled?:boolean}){
  const update=(n:number,key:keyof SceneCausalLink,text:string)=>onChange(value?.map((link,j)=>j===n?{...link,[key]:text}:link));
  const move=(n:number,to:number)=>{const next=structuredClone(value??[]);[next[n],next[to]]=[next[to],next[n]];onChange(next);};
  return <section className="rounded border p-4 space-y-3" aria-label="Эмоциональная логика сцены"><h4>Эмоциональная логика сцены</h4><p className="text-sm text-muted-foreground">Ожидание → событие → его смысл для героя → переживание → решение. Опишите видимую реакцию, чтобы перемена читалась без пояснений рассказчика. Можно добавить несколько последовательных перемен или разных героев.</p><fieldset disabled={disabled} className="space-y-3">
    {!value?.length&&<p className="text-sm text-muted-foreground">Цепочка не задана. Старое описание сцены сохранится, пока вы не добавите перемену.</p>}
    {(value??[]).map((link,n)=><article key={n} className="rounded border p-3 space-y-3"><h5>Перемена {n+1}</h5><Field label={`Герой · перемена ${n+1}`}><Input value={link.character} maxLength={100} onChange={e=>update(n,'character',e.target.value)}/></Field><Field label="Чего герой ожидает перед событием"><Textarea rows={2} value={link.expectation} maxLength={1000} onChange={e=>update(n,'expectation',e.target.value)}/></Field>
      <div className="grid gap-3 md:grid-cols-2">{Object.entries(FIELDS).map(([key,label])=><Field key={key} label={label}><Textarea rows={2} value={link[key as keyof typeof FIELDS]} maxLength={1000} onChange={e=>update(n,key as keyof typeof FIELDS,e.target.value)}/></Field>)}</div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={n===0} onClick={()=>move(n,n-1)}>Раньше в сцене</Button><Button type="button" size="sm" variant="outline" disabled={n===value!.length-1} onClick={()=>move(n,n+1)}>Позже в сцене</Button><Button type="button" size="sm" variant="ghost" onClick={()=>{const next=value!.filter((_,j)=>j!==n);onChange(next.length?next:undefined);}}>Удалить перемену</Button></div>
    </article>)}
    <Button type="button" variant="outline" disabled={(value?.length??0)>=20} onClick={()=>onChange(addSceneCausalLink(value))}>Добавить эмоциональную перемену</Button>
  </fieldset>{sceneCausalIssues(value).map(message=><p role="alert" className="text-sm text-destructive" key={message}>{message}</p>)}</section>;
}

export function NarrativeBeatSummary({value}:{value?:NarrativeBeat}){
  if(!value)return null;
  return <div className="rounded border p-3 space-y-2" aria-label="Действие и реакция плана"><p><b>Роль плана:</b> {NARRATIVE_BEAT_LABELS[value.role]}{value.character&&` · ${value.character}`}</p><EventSummary value={value}/></div>;
}
export function NarrativeBeatEditor({value,onChange,disabled=false}:{value?:NarrativeBeat;onChange:(value:NarrativeBeat|undefined)=>void;disabled?:boolean}){
  return <section className="rounded border p-3 space-y-3" aria-label="Действие и реакция плана"><h4>Действие и реакция</h4><p className="text-sm text-muted-foreground">Укажите, что зритель узнаёт и какую перемену героя видит в этом плане. Реакция должна иметь понятную причину; отдельный план реакции нужен только там, где её нельзя ясно показать вместе с действием.</p><fieldset disabled={disabled} className="space-y-3">
    <Field label="Роль плана в сцене"><select className="w-full rounded border p-2 bg-background" value={value?.role??''} onChange={e=>onChange(chooseNarrativeRole(value,(e.target.value||undefined) as NarrativeBeat['role']|undefined))}><option value="">Не задано · сохранить прежнюю постановку</option>{Object.entries(NARRATIVE_BEAT_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
    {value&&<><Field label="Кто переживает событие"><Input value={value.character??''} maxLength={100} onChange={e=>onChange({...value,character:e.target.value||undefined})} placeholder="Для перехода или предметного плана можно оставить пустым"/></Field><div className="grid gap-3 md:grid-cols-2">{Object.entries(FIELDS).map(([key,label])=><Field key={key} label={label}><Textarea rows={2} value={value[key as keyof typeof FIELDS]} maxLength={1000} onChange={e=>onChange({...value,[key]:e.target.value})}/></Field>)}</div></>}
  </fieldset></section>;
}

export function sceneCausalText(value:SceneCausalLink[]|undefined):string {
  return value?.length?['Эмоциональная логика сцены',...value.map((link,n)=>`${n+1}. ${link.character}. Ожидание: ${link.expectation}. ${Object.entries(FIELDS).map(([key,label])=>`${label}: ${link[key as keyof typeof FIELDS]}`).join('. ')}`)].join('\n'):'';
}
