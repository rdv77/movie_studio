'use client';
import {useState} from 'react';
import type {Project} from '../lib/domain';
import {videoPreparationIssue} from '../lib/video-from-animatic';
import {videoFrameOptions} from '../lib/video';
export function VideoPreparationPanel({p,busy,submit}:{p:Project;busy:boolean;submit:(value:unknown)=>Promise<unknown>}){
 const [error,setError]=useState('');
 async function run(value:unknown){setError('');try{await submit(value);}catch(e){setError((e as Error).message);}}
 const selected=p.animatic?.variants.find(v=>v.id===p.animatic?.selectedId);
 return <section className="editor-surface p-5 space-y-4" aria-label="Подготовка видео из аниматика"><h2>Исходные кадры для видео</h2><p>Возьмите исходные изображения выбранного аниматика в полном качестве. Grok Video 1.5, MiniMax H3 и fal H3 Max получают первый и последний кадры. Другим моделям передаётся начало и описание конечного состояния; это видно в предпросмотре запроса.</p><button disabled={busy||!selected?.animaticManifest} onClick={()=>void run({revision:p.revision,action:'prepare',variantId:selected!.id})}>Подготовить видеопланы из аниматика</button>{!selected?.animaticManifest&&<p>Выберите аниматик с сохранённым составом или соберите новый.</p>}{error&&<p role="alert">{error}</p>}
 {p.items.filter(i=>i.stage===7&&!i.removedAt&&!i.planArchive&&i.videoPreparation).map(i=><details key={i.id}><summary>{i.title} · {i.videoPreparation!.duration.toFixed(2)} сек</summary>{videoPreparationIssue(p,i)&&<p role="alert">{videoPreparationIssue(p,i)}</p>}<div className="row wrap">{(['start','end'] as const).map(role=>{const f=role==='start'?i.videoPreparation!.startFrame:i.videoPreparation!.endFrame;if(!f)return null;const frames=p.items.find(s=>s.stage===5&&!s.planArchive&&!s.removedAt&&(i.sourceShot?.shotId?s.sourceShot?.shotId===i.sourceShot.shotId:s.title===i.title))?.variants.filter(v=>v.kind==='image'&&v.assetId&&(v.keyframe??'start')===role)??[];return <figure key={role}><img src={'/api/assets/'+f.assetId} alt={`${i.title}: ${role}`} style={{width:190}}/><figcaption>{role==='start'?'Начало':'Окончание'}</figcaption><select disabled={busy} aria-label={`${i.title}: ${role==='start'?'первый':'последний'} кадр`} value={f.variantId} onChange={e=>void run({revision:p.revision,action:'override',itemId:i.id,role,variantId:e.target.value})}>{frames.map(v=><option value={v.id} key={v.id}>{v.title} · {v.model}</option>)}</select></figure>;})}</div></details>)}
 </section>;
}
