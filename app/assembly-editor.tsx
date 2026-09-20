'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {participates,type Project} from '@/lib/domain';

export function AssemblyEditor({p,busy,videoSeconds,speechSeconds,save,onDirty}:{p:Project;busy:boolean;videoSeconds?:number[];speechSeconds:number[];save:(cuts:NonNullable<Project['assemblyCuts']>)=>Promise<unknown>;onDirty:(dirty:boolean)=>void}) {
  const items=p.items.filter(i=>i.stage===7&&participates(p,i));
  const initial=items.flatMap(i=>{
    const v=i.variants.find(v=>v.id===i.approvedId);
    if(!v?.assetId)return [];
    return [p.assemblyCuts?.find(c=>c.itemId===i.id&&c.variantId===v.id)??{itemId:i.id,variantId:v.id,trim:v.trim,duration:null}];
  });
  const [draft,setDraft]=useState(initial),[saved,setSaved]=useState(JSON.stringify(initial));
  const [message,setMessage]=useState('');
  const dirty=JSON.stringify(draft,(_,v)=>typeof v==='number'&&!Number.isFinite(v)?'invalid-number':v)!==saved;
  useEffect(()=>{onDirty(dirty);return ()=>onDirty(false);},[dirty,onDirty]);
  function update(index:number,patch:Partial<(typeof draft)[number]>){setDraft(rows=>rows.map((r,n)=>n===index?{...r,...patch}:r));setMessage('');}
  const invalid=draft.some(c=>!Number.isFinite(c.trim)||c.trim<0||c.trim>600||(c.duration!==null&&(!Number.isFinite(c.duration)||c.duration<0.2||c.duration>3600)));
  return <section className="space-y-4 mb-5" aria-label="Длительность планов в сборке">
    <p>По умолчанию сохраняется весь доступный ролик, даже если речь закончилась раньше или её нет. Снимите «Весь ролик», чтобы задать длительность вручную. Озвучка следующего плана начнётся вместе с его видео.</p>
    <p className="text-sm">Длительности до сборки предварительные: встроенная звуковая дорожка файла иногда длиннее изображения. При сборке проверяется длина самого видео.</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {draft.map((c,n)=>{
        const item=items.find(i=>i.id===c.itemId)!,v=item.variants.find(v=>v.id===c.variantId)!;
        const index=items.indexOf(item),source=videoSeconds?.[index],available=source===undefined?undefined:Math.max(0,source-c.trim);
        const length=c.duration??available,speech=speechSeconds[index]??0;
        const issue=length!==undefined&&speech>length+0.001?`Речь ${speech.toFixed(2)} сек не помещается в ${length.toFixed(2)} сек.`:c.duration!==null&&available!==undefined&&c.duration>available+0.001?`Доступно только ${available.toFixed(2)} сек видео.`:'';
        return <div key={c.itemId} className="rounded-xl border p-4 space-y-3">
          <strong>{item.title}</strong>
          <p className="text-sm">Исходный файл: {source?.toFixed(2)??'проверяем…'} сек · Речь: {speech.toFixed(2)} сек</p>
          <details><summary>Посмотреть исходный ролик</summary><video className="w-full mt-2" controls preload="none" src={'/api/assets/'+v.assetId}/></details>
          <label className="block">Начало в исходном файле, сек<Input aria-label={`Начало — ${item.title}`} type="number" min={0} max={600} step={0.01} disabled={busy} value={Number.isNaN(c.trim)?'':c.trim} onChange={e=>update(n,{trim:e.target.value===''?NaN:Number(e.target.value)})}/></label>
          <label className="flex gap-2 items-center"><input type="checkbox" disabled={busy} checked={c.duration===null} onChange={e=>update(n,{duration:e.target.checked?null:Math.max(0.2,Math.floor((available??v.duration)*100)/100)})}/>Весь ролик</label>
          {c.duration!==null&&<label className="block">Оставить в фильме, сек<Input aria-label={`Оставить в фильме — ${item.title}`} type="number" min={0.2} max={3600} step={0.01} disabled={busy} value={Number.isNaN(c.duration)?'':c.duration} onChange={e=>update(n,{duration:e.target.value===''?NaN:Number(e.target.value)})}/></label>}
          <small>В сборке: {length===undefined?'…':(c.duration===null?Math.floor(length*24+1e-6)/24:Math.ceil(length*24-1e-8)/24).toFixed(2)} сек · точность 1/24 сек</small>
          {issue&&<p role="alert">{issue} Увеличьте участок, смените ролик или сократите озвучку.</p>}
        </div>;
      })}
    </div>
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy||!dirty||invalid} onClick={()=>void save(draft).then(()=>{setSaved(JSON.stringify(draft));setMessage('Длительности сохранены. Нажмите «Собрать MP4», чтобы применить их.');}).catch(()=>{})}>Сохранить длительности</Button>
      <Button variant="outline" disabled={busy||!dirty} onClick={()=>{setDraft(JSON.parse(saved));setMessage('');}}>Сбросить правки</Button>
    </div>
    {dirty&&<p role="status">Сохраните длительности перед сборкой. Утверждать планы и голоса заново не требуется.</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
