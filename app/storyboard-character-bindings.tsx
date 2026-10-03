'use client';
import type {Project} from '@/lib/domain';
import {approvedCharacters} from '@/lib/characters';
import {boundCharacterId,characterNameKey} from '@/lib/character-bindings';
import {parseShots} from '@/lib/shots';

export function StoryboardCharacterBindings({project:p,disabled,onBind}:{project:Project;disabled:boolean;onBind:(name:string,id:string|null)=>void}){
  const source=p.items.find(i=>i.stage===4&&!i.removedAt&&!i.planArchive),variant=source?.variants.find(v=>v.id===source.approvedId);
  let shots:ReturnType<typeof parseShots>=[];try{if(variant)shots=parseShots(variant.text,p.seconds);}catch{return null;}
  const heroes=approvedCharacters(p);if(!heroes.length)return null;
  const names=[...new Map(shots.flatMap(shot=>(shot.cast??[]).map(name=>[characterNameKey(name),name] as const))).values()];
  const rows=names.filter(name=>boundCharacterId(p,name)||!shots.filter(shot=>shot.cast?.some(label=>characterNameKey(label)===characterNameKey(name))).every(shot=>heroes.some(hero=>shot.characterIds!==undefined?shot.characterIds.includes(hero.itemId):characterNameKey(hero.profile.name)===characterNameKey(name))));
  if(!rows.length)return null;
  return <section className="editor-surface p-4 mb-5 space-y-3" aria-label="Связь персонажей сценария с образами">
    <strong>Связь персонажей сценария с образами</strong>
    <p className="muted">Если имя в сценарии отличается от названия героя, укажите его утверждённый образ. Связь действует во всех планах этого фильма. Например, «Младший царевич» и «Царевич» могут быть одним персонажем. Уже созданные картинки не изменятся.</p>
    {rows.map(name=><label className="flex flex-wrap items-center gap-3" key={characterNameKey(name)}><span>{name}</span><select className="caption-select" aria-label={`Утверждённый образ для ${name}`} value={boundCharacterId(p,name)??''} disabled={disabled} onChange={e=>onBind(name,e.target.value||null)}>
      <option value="">Без сохранённого образа</option>
      {heroes.map(hero=><option key={hero.itemId} value={hero.itemId}>{hero.profile.name}</option>)}
    </select></label>)}
    <p className="muted small">При генерации отметьте изображение связанного героя в референсах. Не связывайте разные персонажи ради заполнения списка.</p>
  </section>;
}
