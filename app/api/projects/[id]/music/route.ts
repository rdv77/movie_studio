import {z} from 'zod';
import {api,owner,loadProject,saveProject,getKey,asset,storeAsset} from '@/lib/server';
import {id,now,makeVariant,assertBudget,type Job} from '@/lib/domain';
import {model,MODELS} from '@/lib/models';
import {DEFAULT_MUSIC,MUSIC_MODELS,MUSIC_LIBRARY,musicIdeasPrompt,musicBasis,musicSettings,libraryAudio,libraryCredit} from '@/lib/music';
import {retrieve} from '@/lib/providers';

const settings=z.object({enabled:z.boolean(),volume:z.number().min(0).max(1),speechVolume:z.number().min(0).max(1),trim:z.number().min(0).max(3600),loop:z.boolean(),fade:z.number().min(0).max(10)});
export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const body=z.object({revision:z.number().int(),action:z.enum(['ideas','generate','upload','library','settings','select','approve','delete','restore']),data:z.unknown()}).parse(await req.json());
  if(body.revision!==p.revision)throw Error('Проект изменился. Обновите данные и повторите действие.');
  p.music??={variants:[],settings:{...DEFAULT_MUSIC}};
  const m=p.music,d=body.data;
  if(body.action==='ideas'||body.action==='generate'){
    const s=z.object({batchId:z.string().uuid(),model:z.string(),prompt:z.string().trim().max(4100),duration:z.number().min(3).max(600).default(60),count:z.number().int().min(1).max(4).default(1),estimate:z.string().regex(/^\d+$/).nullable().default(null)}).parse(d);
    if(p.jobs.some(j=>j.batchId===s.batchId))return Response.json(p);
    if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))throw Error('Дождитесь текущей серии перед созданием музыки.');
    const ideas=body.action==='ideas',selected=model(s.model);
    if(ideas?!MODELS.some(x=>x.id===s.model&&x.kind==='text'):!MUSIC_MODELS.some(x=>x.id===s.model))throw Error('Выберите подходящую модель.');
    if(!ideas&&!s.prompt)throw Error('Добавьте описание музыки.');
    if(ideas&&!p.items.some(i=>[0,4].includes(i.stage)&&i.approvedId))throw Error('Сначала утвердите сценарий.');
    await getKey(user,selected.provider);
    const jobs:Job[]=Array.from({length:ideas?1:s.count},()=>({id:id(),batchId:s.batchId,itemId:p.id,purpose:ideas?'music-ideas':'music',model:s.model,kind:ideas?'text':'audio',prompt:ideas?musicIdeasPrompt(p,s.prompt):s.prompt,brief:s.prompt,camera:'',continuity:'',dialogue:'',refs:[],voiceId:'',duration:s.duration,offset:0,volume:1,deps:musicBasis(p),created:now(),status:'queued',estimate:s.estimate,actual:null}));
    assertBudget(p,jobs);p.jobs.push(...jobs);if(!ideas)m.settings.enabled=true;
  } else if(body.action==='settings'){
    const value=settings.parse(d);
    if(value.speechVolume>value.volume)throw Error('Громкость при речи должна быть не выше громкости без речи.');
    m.settings=value;
  } else if(body.action==='select'||body.action==='delete'||body.action==='restore'){
    const {variantId}=z.object({variantId:z.string().uuid()}).parse(d);
    const list=body.action==='restore'?m.removedVariants??[]:m.variants,v=list.find(v=>v.id===variantId);
    if(!v)throw Error('Музыкальный вариант не найден.');
    if(body.action==='select')m.selectedId=v.id;
    if(body.action==='delete'){m.variants=m.variants.filter(x=>x.id!==v.id);(m.removedVariants??=[]).push(v);if(m.selectedId===v.id)m.selectedId=undefined;if(m.approvedId===v.id)m.approvedId=undefined;}
    if(body.action==='restore'){m.removedVariants=list.filter(x=>x.id!==v.id);m.variants.push(v);}
  } else if(body.action==='approve'){
    const v=m.variants.find(v=>v.id===m.selectedId);
    if(!m.settings.enabled)throw Error('Включите музыкальное сопровождение.');
    if(!v?.assetId||v.kind!=='audio')throw Error('Выберите аудиотрек.');
    if(m.settings.trim>=v.duration)throw Error('Начало фрагмента должно быть раньше конца трека.');
    if(!(await asset(user,v.assetId,p)).mime.startsWith('audio/'))throw Error('Файл музыки недоступен.');
    m.approvedId=v.id;m.approvedSettings=JSON.stringify(musicSettings(p));
  } else {
    let assetId:string,title:string,duration:number,text='',source='Загрузка';
    if(body.action==='library'){
      const s=z.object({trackId:z.string()}).parse(d),track=MUSIC_LIBRARY.find(t=>t.id===s.trackId);
      if(!track)throw Error('Выберите трек из каталога.');
      const file=await retrieve(libraryAudio(track.file));
      const b=file.bytes,mp3=b.length>3&&((b[0]===73&&b[1]===68&&b[2]===51)||(b[0]===255&&(b[1]&224)===224));
      if(!mp3)throw Error('Библиотека не вернула MP3-файл.');
      assetId=await storeAsset(user,id(),track.title,'audio/mpeg',file.bytes,p.id);title=track.title;duration=track.seconds;text=libraryCredit(track.title);source='Incompetech · Kevin MacLeod';
    } else {
      const s=z.object({assetId:z.string().uuid(),title:z.string().trim().min(1).max(120),duration:z.number().min(0.2).max(14400)}).parse(d);
      if(!(await asset(user,s.assetId,p)).mime.startsWith('audio/'))throw Error('Загрузите аудиофайл этого проекта.');
      ({assetId,title,duration}=s);
    }
    const v=makeVariant(p,{id:p.id,stage:0,title:'Музыка',variants:[]},{assetId,title,duration,text,model:source,kind:'audio'});
    m.variants.push(v);m.selectedId=v.id;m.settings.enabled=true;
  }
  return Response.json(await saveProject(user,p,body.revision));
});
