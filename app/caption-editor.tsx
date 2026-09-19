'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {chosen,participates,type Project} from '@/lib/domain';
import {CAPTION_FONTS,defaultCaption,drawCaption,sameCaptionPlan,type PlanCaption} from '@/lib/captions';

export function CaptionEditor({p,busy,save,onContinue}:{p:Project;busy:boolean;save:(c:PlanCaption)=>Promise<unknown>;onContinue:()=>void}) {
  const plans=p.items.filter(i=>i.stage===5&&participates(p,i));
  const [planId,setPlanId]=useState(plans[0]?.id??'');
  const item=plans.find(i=>i.id===planId)??plans[0];
  if(!item)return <p className="note">Сначала подготовьте карточки раскадровки. Титры можно добавить к любому плану.</p>;
  return <CaptionForm key={p.id+':'+item.id} p={p} planId={item.id} busy={busy} save={save} select={setPlanId} onContinue={onContinue}/>;
}
function CaptionForm({p,planId,busy,save,select,onContinue}:{p:Project;planId:string;busy:boolean;save:(c:PlanCaption)=>Promise<unknown>;select:(id:string)=>void;onContinue:()=>void}) {
  const stored=()=>p.captions?.find(c=>c.planId===planId)??defaultCaption(planId);
  const [draft,setDraft]=useState<PlanCaption>(stored),[saved,setSaved]=useState(()=>JSON.stringify(stored()));
  const [message,setMessage]=useState(''),[error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null);
  const dirty=JSON.stringify(draft)!==saved;
  const width=p.format==='16:9'?1920:1080,height=p.format==='16:9'?1080:1920;
  const plans=p.items.filter(i=>i.stage===5&&participates(p,i)),item=plans.find(i=>i.id===planId)!;
  const video=p.items.find(i=>i.stage===7&&participates(p,i)&&sameCaptionPlan(i,item));
  const clip=video?.variants.find(v=>v.id===video.approvedId&&v.kind==='video'&&v.assetId);
  const frame=item.variants.find(v=>v.id===item.approvedId)??chosen(item);
  const media=clip??(frame?.kind==='image'?frame:undefined);
  useEffect(()=>{
    let live=true;
    void document.fonts.ready.then(()=>{if(!live||!canvas.current)return;try{drawCaption(canvas.current,draft,width,height);setError('');}catch(e){setError((e as Error).message);}});
    return ()=>{live=false;};
  },[draft,width,height]);
  function update<K extends keyof PlanCaption>(key:K,value:PlanCaption[K]){setDraft(c=>({...c,[key]:value}));setMessage('');}
  async function persist(c:PlanCaption){await save(c);setDraft(c);setSaved(JSON.stringify(c));setMessage(c.enabled&&c.text.trim()?'Титр сохранён. Пересоберите фильм, чтобы увидеть его в MP4.':'Титр убран. При новой сборке этот план будет без надписи.');}
  const positions=[['Слева сверху',10,10],['Сверху по центру',50,10],['Справа сверху',90,10],['Слева по центру',10,50],['По центру',50,50],['Справа по центру',90,50],['Слева снизу',10,90],['Снизу по центру',50,90],['Справа снизу',90,90]] as const;
  return <section className="editor-surface p-5 space-y-5" aria-label="Редактор титров">
    <p>Надпись показывается весь выбранный план. Она добавится в аниматик и финальный MP4 при новой сборке. Исходные изображения и ролики сохраняются.</p>
    <fieldset disabled={busy} className="space-y-5">
    <label className="block">План<select className="caption-select" aria-label="План для титра" value={planId} disabled={dirty||busy} onChange={e=>{select(e.target.value);}}>{plans.map(i=><option key={i.id} value={i.id}>{i.title}{p.captions?.some(c=>c.planId===i.id&&c.enabled&&c.text.trim())?' · есть титр':''}</option>)}</select></label>
    {dirty&&<p className="muted small">Сохраните изменения или нажмите «Сбросить правки», прежде чем выбрать другой план.</p>}
    <div className="caption-preview" style={{aspectRatio:`${width} / ${height}`}}>
      {media?.assetId ? media.kind==='video'?<video src={'/api/assets/'+media.assetId} controls preload="metadata"/>:<img src={'/api/assets/'+media.assetId} alt={item.title}/>:<span>Изображения пока нет — титр можно подготовить заранее</span>}
      <canvas ref={canvas} aria-label="Предпросмотр титра"/>
    </div>
    <label className="row"><input type="checkbox" checked={draft.enabled} onChange={e=>update('enabled',e.target.checked)}/>Показывать титр в этом плане</label>
    <label className="block">Текст титра<Textarea aria-label="Текст титра" value={draft.text} maxLength={300} rows={3} placeholder="Завод «Шкода»" onChange={e=>update('text',e.target.value)}/></label>
    <div className="form-grid">
      <label>Шрифт<select className="caption-select" aria-label="Шрифт титра" value={draft.font} onChange={e=>update('font',e.target.value as PlanCaption['font'])}>{Object.keys(CAPTION_FONTS).map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Размер, px<Input aria-label="Размер титра" type="number" min={16} max={160} step={1} value={draft.size} onChange={e=>update('size',Number(e.target.value))}/></label>
      <label>Положение<select className="caption-select" aria-label="Положение титра" value={positions.findIndex(([,x,y])=>draft.x===x&&draft.y===y)} onChange={e=>{const pos=positions[Number(e.target.value)];if(pos)setDraft(c=>({...c,x:pos[1],y:pos[2]}));}}><option value={-1} disabled>Свои координаты</option>{positions.map(([label],n)=><option key={label} value={n}>{label}</option>)}</select></label>
      <label>Цвет<select className="caption-select" aria-label="Цвет титра" value={draft.color} onChange={e=>update('color',e.target.value as PlanCaption['color'])}><option value="white">Белый</option><option value="black">Чёрный</option></select></label>
      <label>По горизонтали, %<Input aria-label="Титр по горизонтали" type="number" min={0} max={100} value={draft.x} onChange={e=>update('x',Number(e.target.value))}/></label>
      <label>По вертикали, %<Input aria-label="Титр по вертикали" type="number" min={0} max={100} value={draft.y} onChange={e=>update('y',Number(e.target.value))}/></label>
    </div>
    <label className="row"><input type="checkbox" checked={draft.background} onChange={e=>update('background',e.target.checked)}/>Подложка для читаемости</label>
    <p className="muted small">Координаты задают центр надписи; у края она сдвигается внутрь, чтобы текст оставался видимым. Размер указан для полного кадра.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <div className="row wrap">
      <Button disabled={busy||!!error||!Number.isInteger(draft.size)||draft.size<16||draft.size>160||draft.x<0||draft.x>100||draft.y<0||draft.y>100} onClick={()=>void persist(draft).catch(()=>{})}>Сохранить титр</Button>
      <Button variant="outline" disabled={busy||!dirty} onClick={()=>{setDraft(stored());setSaved(JSON.stringify(stored()));setMessage('');}}>Сбросить правки</Button>
      <Button variant="outline" disabled={busy||!p.captions?.some(c=>c.planId===planId&&c.enabled&&c.text)} onClick={()=>void persist({...draft,text:'',enabled:false}).catch(()=>{})}>Убрать титр</Button>
      <Button variant="outline" disabled={busy||dirty} onClick={onContinue}>К финальной сборке</Button>
    </div>
    </fieldset>
  </section>;
}
