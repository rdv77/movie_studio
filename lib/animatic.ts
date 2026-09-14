import { chosen, dependencies, id, isApproved, makeVariant, participates, type Project, type Variant } from './domain';
import { editPlan } from './render';

// Capture the actual selected soundtrack, not just stage-6 dependencies (which
// contain only preceding stages). Never refresh this signature on approval.
export function animaticBasis(p: Project) {
  const plan=editPlan(p,true);
  const fields=(v:Variant)=>[v.id,v.assetId,v.duration,v.trim,v.offset,v.volume,v.speechType,v.speaker];
  return JSON.stringify([p.configVersion,p.format,p.seconds,p.speechMode??'track',plan.clips.map(fields),plan.audio.map(fields),plan.audioClipIndexes]);
}
export function animaticIssue(p:Project,v?:Variant) {
  if(!v?.assetId||v.kind!=='video')return 'Сначала соберите и выберите аниматик.';
  if(!v.animaticBasis)return 'Это прежний просмотр без списка источников. Соберите новый аниматик с текущими кадрами и голосами.';
  try {if(v.animaticBasis!==animaticBasis(p))return 'Кадры, голоса или монтаж изменились. Соберите новый аниматик: сохранённый файл содержит прежнюю версию.';}
  catch(e){return (e as Error).message;}
  const voices=p.items.filter(i=>i.stage===6&&participates(p,i)&&chosen(i)?.kind==='audio');
  if(voices.some(i=>i.selectedId!==i.approvedId||!isApproved(p,i)))return 'Сначала утвердите выбранные реплики на этапе «Голоса». Затем можно утвердить этот аниматик.';
  return '';
}
export function saveAnimatic(p:Project,data:Partial<Variant>,basis:string) {
  if(!basis||basis!==animaticBasis(p))throw new Error('Источники изменились во время сборки. Соберите аниматик заново с текущими голосами и кадрами.');
  if(data.kind!=='video'||!data.assetId)throw new Error('Для аниматика нужен видеофайл.');
  const v=makeVariant(p,{id:id(),stage:6,title:'Аниматик',variants:[]},{...data,animaticBasis:basis,deps:dependencies(p,6)});
  p.animatic??={variants:[]};p.animatic.variants.push(v);p.animatic.selectedId=v.id;
  return v;
}
export function approveAnimatic(p:Project,variantId:string) {
  const v=p.animatic?.variants.find(v=>v.id===variantId);
  if(p.animatic?.selectedId!==variantId)throw new Error('Выбор аниматика изменился. Выберите вариант снова.');
  const issue=animaticIssue(p,v);if(issue)throw new Error(issue);
  p.animatic!.approvedId=variantId;
}
export function animaticApproved(p:Project) {
  const v=p.animatic?.variants.find(v=>v.id===p.animatic?.approvedId);
  return !!v&&p.animatic?.selectedId===v.id&&!animaticIssue(p,v);
}
