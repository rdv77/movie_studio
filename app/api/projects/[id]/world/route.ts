import {z} from 'zod';
import {api,owner,loadProject,saveProject,asset,getKey} from '@/lib/server';
import {id,now,makeVariant,chosen} from '@/lib/domain';
import {model} from '@/lib/models';
import {ensureDirecting,signature,directorRunActive,scenesBasis,type DirectorRun} from '@/lib/directing';
import {prepareSceneLocations} from '@/lib/scene-locations';
import {captureVersionInfo,recordCreativeVersion,recordCharacterVersion} from '@/lib/creative-versions';
import {locationProfileSchema,locationStateSchema,actorProfileSchema,assertLocationAssets,assertSceneLocations,locationProfileText,actorDraftPrompt,chooseActorDraft} from '@/lib/world-assets';

export const POST=api(async(req,ctx)=>{
  const user=await owner(req,true),p=await loadProject(user,(await ctx.params).id);
  const b=z.object({revision:z.number().int(),action:z.enum(['prepareLocations','saveLocation','removeLocation','restoreLocation','saveSceneLocation','saveActorProfile','generateActor','chooseActorDraft']),data:z.any()}).parse(await req.json());
  if(b.revision!==p.revision)throw Object.assign(Error('Проект изменился. Обновите данные перед сохранением.'),{status:409});
  const v=b.data;
  const hero=()=>{const i=p.items.find(i=>i.id===v.itemId&&i.stage===1&&!i.removedAt);if(!i?.character)throw Error('Герой текущего проекта не найден.');return i;};
  switch(b.action){
    case 'prepareLocations':{
      const d=ensureDirecting(p);if(d.runs.some(directorRunActive))throw Error('Дождитесь завершения проработки сцен.');
      const approved=d.scenesApproved===scenesBasis(p);
      if(!prepareSceneLocations(p))return Response.json(p);
      if(approved)d.scenesApproved=scenesBasis(p);
      recordCreativeVersion(p,'Локации выделены из сцен');break;
    }
    case 'saveLocation':{
      const profile=locationProfileSchema.parse(v.profile),allowed=new Set<string>();
      for(const ref of [...new Set([...profile.refs,...profile.approvedAngles.flatMap(a=>a.refs)])]){const a=await asset(user,ref,p);if(!a.mime.startsWith('image/'))throw Error('Референс локации должен быть изображением.');allowed.add(ref);}
      assertLocationAssets(profile,allowed);
      let item=v.itemId?p.items.find(i=>i.id===v.itemId&&i.stage===3&&!i.removedAt&&!i.planArchive):undefined;
      if(v.itemId&&!item)throw Error('Локация текущего проекта не найдена.');
      if(!item){item={id:id(),stage:3,title:profile.name,variants:[]};p.items.push(item);}
      const previous=chosen(item),image=previous?.kind==='image'?previous.assetId:undefined,selectedId=item.selectedId;
      const candidate=makeVariant(p,item,{kind:image?'image':'text',assetId:image,title:profile.name,text:locationProfileText(profile),model:'Локация · правки',location:profile,refs:profile.refs,versionInfo:captureVersionInfo(p,item,{},undefined,'Версия локации')});
      item.location=profile;item.title=profile.name;item.variants.push(candidate);item.selectedId=image?selectedId:candidate.id;
      break;
    }
    case 'removeLocation':case 'restoreLocation':{
      const item=p.items.find(i=>i.id===v.itemId&&i.stage===3);if(!item)throw Error('Локация не найдена.');
      if(b.action==='removeLocation'&&p.jobs.some(j=>j.itemId===item.id&&['queued','dispatching','pending','saving'].includes(j.status)))throw Error('Дождитесь текущей генерации этой локации.');
      item.removedAt=b.action==='removeLocation'?now():undefined;break;
    }
    case 'saveSceneLocation':{
      const d=ensureDirecting(p),scene=d.scenes.find(s=>s.id===v.sceneId);if(!scene)throw Error('Сцена не найдена.');
      const data=z.object({locationIds:z.array(z.string().uuid()).max(20),locationState:locationStateSchema}).parse(v);
      const approved=d.scenesApproved===scenesBasis(p);
      assertSceneLocations(p,data);recordCreativeVersion(p,'До изменения локации сцены');Object.assign(scene,data);d.editorBasis=undefined;
      if(approved)d.scenesApproved=scenesBasis(p);
      recordCreativeVersion(p,'Локация сцены');break;
    }
    case 'saveActorProfile':{
      const item=hero(),profile=actorProfileSchema.parse(v.profile);recordCharacterVersion(item,'До актёрской проработки');
      item.character={...item.character!,actorProfile:profile};recordCharacterVersion(item,'Актёрский профиль');break;
    }
    case 'chooseActorDraft':{
      const item=hero();recordCharacterVersion(item,'До выбора актёрского описания');chooseActorDraft(p,item.id,z.string().uuid().parse(v.variantId));
      recordCharacterVersion(item,'Выбрано актёрское описание');break;
    }
    case 'generateActor':{
      const item=hero(),d=ensureDirecting(p),m=model(z.string().parse(v.model));if(m.kind!=='text'||!['openai','xai','minimax'].includes(m.provider))throw Error('Выберите текстовую модель.');
      await getKey(user,m.provider);if(p.limit!==null)throw Error('Для текстовой проработки расход определяется по токенам. Снимите лимит и сверяйте журнал.');
      if(d.runs.some(r=>r.characterInput?.itemId===item.id&&directorRunActive(r)))throw Error('Этот герой уже прорабатывается.');
      const actorProfile=actorProfileSchema.parse(v.actorProfile),instruction=z.string().max(3000).parse(v.instruction);
      if(item.character!.refs.length&&m.provider==='minimax')throw Error('Для проработки героя по фотографии выберите GPT или Grok. MiniMax здесь доступен для текстового исходника.');
      for(const ref of item.character!.refs){const a=await asset(user,ref,p);if(!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024)throw Error('Прообраз героя: PNG, JPEG или WebP до 10 МБ.');if(m.provider==='xai'&&a.mime==='image/webp')throw Error('Для анализа фотографии в Grok загрузите PNG или JPEG либо выберите GPT.');}
      const input={itemId:item.id,prompt:actorDraftPrompt(p,item,instruction,actorProfile),character:structuredClone(item.character!),actorProfile,versionInfo:captureVersionInfo(p,item,{}, {actorProfile},'Агент героя')};
      const run:DirectorRun={id:id(),created:now(),model:m.id,mode:'character',basis:signature(input),characterInput:input,sceneIds:[],tasks:[{id:id(),role:'actor-profile',requires:[]}]};
      d.runs.push(run);break;
    }
  }
  return Response.json(await saveProject(user,p,p.revision));
});
