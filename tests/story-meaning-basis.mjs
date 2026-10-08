import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as B from './lib/material-basis';export * as C from './lib/creative-versions';export * as K from './lib/keyframes';export * as S from './lib/story-meaning';export {ensureDirecting} from './lib/directing';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/story-meaning-basis.mjs'});
const {D,B,C,K,S,ensureDirecting}=await import('../work/tests/story-meaning-basis.mjs');
const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No provider calls in dependency checks.');};
try{
  const p=D.newProject('Связанные смыслы'),d=ensureDirecting(p);d.brief.framePolicy='single';
  const card=(stage,title)=>{const item={id:D.id(),stage,title,variants:[]};p.items.push(item);return item;};
  const approve=(item,data)=>{const v=D.makeVariant(p,item,data);item.variants.push(v);item.selectedId=item.approvedId=v.id;return v;};
  approve(p.items.find(i=>i.stage===0),{text:'Стрела проходит над дворами и улетает в лес. Герой удивлён.'});
  for(const item of p.items.filter(i=>[1,2,3].includes(i.stage)))approve(item,{text:'Утверждённая основа'});
  const meaning=id=>({id,title:'Смысл '+id,kind:'turn',priority:'required',viewerBefore:'Ожидание '+id,viewerAfter:'Понимание '+id,event:'Событие '+id,stakes:'Ставка '+id,evidence:['Признак '+id]});
  S.saveStoryMeanings(p,[meaning('arrow'),meaning('reaction')]);S.approveStoryMeanings(p);
  const shots=['arrow','reaction',undefined].map((meaningId,n)=>({id:D.id(),sceneId:'scene',title:'План '+n,duration:6,cast:[],characterIds:[],locationIds:[],...(meaningId?{meaningIds:[meaningId]}:{}),description:'Одно простое действие.',stateIn:'Исходное состояние.',stateOut:'Итоговое состояние.',camera:'Статичная камера',continuity:'Без изменений',continuityChanges:'',dialogue:'',speechType:'none',direction:{startFrame:'Исходная композиция',endFrame:'Конечная композиция'}}));
  d.scenes=[{id:'scene',title:'Сцена',purpose:'Показать',location:'Двор',conflict:'Ожидание',turn:'Изменение',stateIn:'Начало',stateOut:'Конец',continuity:[],meaningIds:['arrow','reaction'],shots:structuredClone(shots)}];
  const script=p.items.find(i=>i.stage===4);
  const publish=()=>approve(script,{text:JSON.stringify({storyMeaningBasis:S.storyMeaningBasis(p),shots})});publish();
  const frames=shots.map((shot,n)=>{const item=n?card(5,shot.title):p.items.find(i=>i.stage===5);item.sourceShot={scriptId:script.id,shotId:shot.id,sceneId:shot.sceneId,title:shot.title};return item;});
  const images=frames.map(item=>approve(item,{kind:'image',assetId:D.id(),text:'Кадр',duration:6}));
  const videos=shots.map((shot,n)=>{const item=n?card(7,shot.title):p.items.find(i=>i.stage===7);item.sourceShot={...frames[n].sourceShot};return item;});
  const clips=videos.map((item,n)=>approve(item,{kind:'video',assetId:D.id(),text:'Видео',duration:6,refs:[images[n].assetId]}));
  const voice=p.items.find(i=>i.stage===6);voice.sourceShot={...frames[0].sourceShot};const audio=approve(voice,{kind:'audio',assetId:D.id(),dialogue:'',text:'Звук'});
  const queued=frames.map((item,n)=>({id:D.id(),itemId:item.id,kind:'image',model:'grok-imagine-image-2.0',prompt:'Кадр',refs:[],deps:D.dependencies(p,5),status:'queued'}));
  queued.push(...videos.map((item,n)=>({id:D.id(),itemId:item.id,kind:'video',model:'MiniMax-H3',prompt:'Движение',refs:[images[n].assetId],deps:D.dependencies(p,7),status:'queued'})));
  C.stampGenerationVersions(p,queued);p.jobs.push(...queued);
  const basis=(item,v)=>B.materialBasis(p,item,v),baseImages=frames.map((f,n)=>basis(f,images[n])),baseClips=videos.map((v,n)=>basis(v,clips[n])),baseVoice=basis(voice,audio);
  const frameBases=['start','middle','end'].map(role=>K.keyframeFoundationBasis(p,frames[0],role,images[0]));
  const paid=JSON.stringify({items:p.items.map(i=>({id:i.id,variants:i.variants})),jobs:p.jobs});
  assert(images.every((v,n)=>D.variantCurrent(p,frames[n],v)));assert(clips.every((v,n)=>D.variantCurrent(p,videos[n],v)));assert(queued.every(j=>D.jobCurrent(p,D.getItem(p,j.itemId),j)));

  // A scene-wide edit must not invalidate material attached to another meaning.
  d.storyMeanings[1].viewerAfter='Новая реакция зрителя';
  assert.equal(basis(frames[0],images[0]),baseImages[0]);assert.equal(basis(videos[0],clips[0]),baseClips[0]);
  assert.notEqual(basis(frames[1],images[1]),baseImages[1]);assert.notEqual(basis(videos[1],clips[1]),baseClips[1]);
  d.storyMeanings[1]=meaning('reaction');

  // The protected prompt would change even with unchanged story/action fields.
  d.storyMeanings[0].evidence=['Доказательство с новым расположением стрелы над крышами.'];
  for(const [item,v] of [[frames[0],images[0]],[videos[0],clips[0]]])assert(!D.variantCurrent(p,item,v));
  for(const j of queued.filter(j=>[frames[0].id,videos[0].id].includes(j.itemId)))assert(!D.jobCurrent(p,D.getItem(p,j.itemId),j),'Queued outdated meaning cannot dispatch');
  for(const [n,role] of ['start','middle','end'].entries())assert.notEqual(K.keyframeFoundationBasis(p,frames[0],role,images[0]),frameBases[n],role);
  assert.equal(basis(voice,audio),baseVoice,'Meaning edits do not invalidate recorded speech');
  assert.equal(basis(frames[1],images[1]),baseImages[1]);assert.equal(basis(videos[1],clips[1]),baseClips[1]);
  assert.equal(basis(frames[2],images[2]),baseImages[2]);assert.equal(basis(videos[2],clips[2]),baseClips[2]);
  assert.equal(JSON.stringify({items:p.items.map(i=>({id:i.id,variants:i.variants})),jobs:p.jobs}),paid,'Detection preserves original assets, approvals and paid request snapshots');

  S.approveStoryMeanings(p);publish();
  assert(!D.variantCurrent(p,frames[0],images[0]));assert(!D.variantCurrent(p,videos[0],clips[0]),'Republishing new meaning cannot approve old video');
  assert(D.variantCurrent(p,frames[1],images[1]));assert(D.variantCurrent(p,videos[1],clips[1]),'Unrelated media stays reviewed after republishing the map');
  assert(D.variantCurrent(p,voice,audio));
  const fresh=approve(videos[0],{kind:'video',assetId:D.id(),text:'Проверенный новый вариант',duration:6,refs:[images[0].assetId]});
  assert(D.variantCurrent(p,videos[0],fresh));assert(videos[0].variants.includes(clips[0]));

  const current=basis(frames[0],images[0]);d.storyMeanings.reverse();assert.equal(basis(frames[0],images[0]),current,'Changing map display order does not alter meaning');
  const originalLinks=shots[0].meaningIds;shots[0].meaningIds=['reaction'];publish();
  assert.notEqual(basis(frames[0],images[0]),current,'Changing only a published meaning link changes dependencies');
  shots[0].meaningIds=originalLinks;publish();
  d.storyMeanings=d.storyMeanings.filter(m=>m.id!=='arrow');assert.notEqual(basis(frames[0],images[0]),current,'Deleted targets cannot leave a stale dependency current');

  const legacy=structuredClone(p),legacyScript=legacy.items.find(i=>i.id===script.id),latest=legacyScript.variants.find(v=>v.id===legacyScript.approvedId),exported=JSON.parse(latest.text);
  for(const shot of exported.shots)delete shot.meaningIds;latest.text=JSON.stringify(exported);
  const legacyFrame=legacy.items.find(i=>i.id===frames[0].id),legacyVideo=legacy.items.find(i=>i.id===videos[0].id);
  const legacyBases=[B.materialBasis(legacy,legacyFrame,images[0]),B.materialBasis(legacy,legacyVideo,clips[0]),B.materialBasis(legacy,legacyFrame)];
  delete legacy.directing.storyMeanings;delete legacy.directing.storyMeaningsApproved;
  assert.deepEqual([B.materialBasis(legacy,legacyFrame,images[0]),B.materialBasis(legacy,legacyVideo,clips[0]),B.materialBasis(legacy,legacyFrame)],legacyBases,'Unlinked and pre-v2 legacy dependencies never adopt live draft links');
  console.log('PASS story meaning basis: linked media/queued jobs/keyframes stale on meaning or link changes; unrelated media, speech and legacy stable; reapproval/publication cannot autoapprove old assets.');
}finally{globalThis.fetch=oldFetch;}
