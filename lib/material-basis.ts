import type { Project,Item,Variant } from './domain';
// Semantic dependencies are used only for newly created production materials.
// Existing snapshots keep their original approval behaviour until reviewed.
function stable(v:any):string{return Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v)??'null';}
export function materialBasis(p:Project,item:Item,variant?:Partial<Variant>){
  const script=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive),v=script?.variants.find(v=>v.id===script.approvedId);
  let shot:any;
  try{shot=JSON.parse(v?.text??'').shots?.find((s:any)=>item.sourceShot?.shotId?s.id===item.sourceShot.shotId:s.title===(item.sourceShot?.title??item.title));}catch{}
  if(!shot)return '';
  const speech={text:shot.dialogue??'',type:shot.speechType??(shot.dialogue?'voiceover':'none'),speaker:shot.speaker??''};
  if(item.stage===6)return stable({speech});
  const heroes=p.items.filter(i=>i.stage===1&&!i.removedAt&&!i.planArchive).flatMap(i=>{const v=i.variants.find(v=>v.id===i.approvedId);return v&&(!v.character||!shot.cast?.length||shot.cast.includes(v.character.name))?[{text:v.text,character:v.character,asset:v.assetId}]:[];});
  const world=p.items.filter(i=>[2,3].includes(i.stage)&&!i.removedAt&&!i.planArchive).map(i=>{const v=i.variants.find(v=>v.id===i.approvedId);return {text:v?.text,asset:v?.assetId};});
  const frame=p.items.find(i=>i.stage===5&&!i.planArchive&&(item.sourceShot?.shotId?i.sourceShot?.shotId===item.sourceShot.shotId:i.sourceShot?.title===item.sourceShot?.title));
  return stable({format:p.format,cast:shot.cast,story:shot.description,camera:shot.camera,design:shot.productionDesign,continuity:shot.continuity,heroes,world,
    speech:{type:speech.type,speaker:speech.type==='character'?speech.speaker:''},
    ...(item.stage===7?{duration:shot.duration,frame:frame?.variants.find(v=>v.id===frame.approvedId)?.assetId,lipsync:variant?.lipsync}:{}),
  });
}
