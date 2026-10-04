import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as S from './lib/storyboard';export * as P from './lib/storyboard-progress';export {StoryboardProgress} from './app/storyboard-progress';export {KeyframeBatchEditor} from './app/keyframe-batch-editor';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/storyboard-progress.mjs',external:['react','react-dom','@ffmpeg/ffmpeg']});
const {D,K,S,P,StoryboardProgress,KeyframeBatchEditor}=await import('../work/tests/storyboard-progress.mjs');
function fixture(mode='pair'){
  const p=D.newProject('Готовность кадров'),shot={id:D.id(),title:'План с движением',description:'Герой поднимает стрелу',duration:5,camera:'Наезд',continuity:'Прямая склейка',stateIn:'Стоит',stateOut:'Держит стрелу',continuityChanges:'Стрела в руке',speechType:'none',dialogue:'',speaker:''};
  for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Утверждённая основа'});D.approve(p,item.id);}
  const item=p.items.find(i=>i.stage===5);item.sourceShot={scriptId:p.items.find(i=>i.stage===4).id,title:shot.title,shotId:shot.id};K.setKeyframeMode(p,item.id,mode);
  const image=(role,choose=true)=>{
    const metadata=role==='start'?{keyframe:'start',pairId:D.id(),model:'grok-imagine-image-2.0'}:K.prepareKeyframeGeneration(p,item.id,role,{model:'grok-imagine-image-2.0'});
    const v=D.makeVariant(p,item,{...metadata,kind:'image',assetId:D.id(),jobId:D.id(),title:role});v.keyframeReviewBasis=K.keyframeFoundationBasis(p,item,role,v);item.variants.push(v);if(choose)K.chooseKeyframe(p,item.id,role,v.id);return v;
  };
  const job=(role,status,created='2026-10-04T10:00:00Z')=>{const j={id:D.id(),itemId:item.id,kind:'image',keyframe:role,status,created,error:'Do not render provider secrets'};p.jobs.push(j);return j;};
  return {p,item,image,job};
}
const row=p=>P.storyboardProgress(p)[0];
const html=p=>renderToStaticMarkup(createElement(StoryboardProgress,{p,busy:false,open:()=>{throw Error('Opening requires a click');},createEnds:()=>{throw Error('Generation requires a click');}}));
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Progress must not fetch or generate');};
try{
  const f=fixture();D.addVariant(f.p,f.item.id,{kind:'text',text:'Описание вместо картинки'});f.item.variants.push(D.makeVariant(f.p,f.item,{kind:'image',text:'Ответ без файла'}));
  let r=row(f.p);assert.equal(r.frames[0].imageCount,0);assert.equal(r.frames[0].status,'missing');assert.equal(r.missingImages,true);assert.equal(P.storyboardProgressSummary([r]).startImages,0);assert(!html(f.p).includes('Описание вместо картинки'));assert.match(html(f.p),/aria-pressed="true"[^>]*>Без начального кадра/);
  const start=f.image('start');r=row(f.p);assert.equal(r.frames[0].status,'ready');assert.equal(r.frames[1].status,'missing');assert.equal(P.storyboardProgressSummary([r]).startImages,1);assert.equal(P.storyboardProgressSummary([r]).completeImages,0);assert.equal(r.approved,false);
  const end=f.image('end',false);r=row(f.p);assert.equal(r.frames[1].status,'choose');assert.equal(r.frames[1].assetId,end.assetId);assert.equal(r.frames[1].selectedId,undefined);assert.equal(r.missingImages,false);assert.equal(r.selected,false);assert.equal(P.storyboardProgressSummary([r]).completeImages,1);
  K.chooseKeyframe(f.p,f.item.id,'end',end.id);r=row(f.p);assert.equal(r.selected,true);assert.equal(r.approved,false);
  const before=JSON.stringify(f.p),markup=html(f.p);assert(markup.includes('/api/assets/'+start.assetId));assert(markup.includes('/api/assets/'+end.assetId));assert(markup.includes('Открыть план: '+f.item.title));assert.equal(JSON.stringify(f.p),before);
  K.approveKeyframes(f.p,f.item.id);assert.equal(row(f.p).approved,true);assert.equal(row(f.p).attention,false);
  f.job('end','pending');r=row(f.p);assert.equal(r.frames[1].status,'ready');assert.match(r.frames[1].jobMessage,/Ещё один вариант/);assert.equal(r.missingImages,false);assert.equal(r.attention,true);

  const failed=fixture('triple');failed.job('start','failed');failed.job('end','unknown');failed.job('middle','saving');r=row(failed.p);assert.deepEqual(r.frames.map(frame=>frame.status),['failed','saving','unknown']);assert.match(r.frames[2].message,/Проверьте эту попытку/);assert(!html(failed.p).includes('provider secrets'));
  failed.job('start','queued','2026-10-04T11:00:00Z');assert.equal(row(failed.p).frames[0].status,'queued');failed.p.jobs=failed.p.jobs.filter(j=>j.keyframe!=='start');failed.job('start','done');assert.match(row(failed.p).frames[0].message,/сохранённого изображения нет/);
  const stale=fixture();const a=stale.image('start');a.keyframeReviewBasis='old-basis';assert.equal(row(stale.p).frames[0].status,'review');assert.equal(row(stale.p).missingImages,true); // Its end is still missing.
  const unchosen=fixture('single');const preview=unchosen.image('start',false);D.addVariant(unchosen.p,unchosen.item.id,{kind:'text',text:'Сейчас выбран текст'});assert.equal(row(unchosen.p).frames[0].status,'choose');assert.equal(row(unchosen.p).frames[0].assetId,preview.assetId);
  unchosen.item.keyframeSelection={startId:preview.id};preview.keyframe='end';assert.equal(row(unchosen.p).frames[0].selectedId,undefined);assert.equal(row(unchosen.p).frames[0].imageCount,0,'An end does not complete an initial image');assert.equal(S.storyboardBatchPlans(unchosen.p)[0].hasImage,false,'The initial-image batch includes plans that only have an end');
  const wrong=fixture();wrong.image('start');const ending=wrong.image('end');wrong.item.keyframeSelection.startId=ending.id;assert.equal(row(wrong.p).frames[0].status,'choose');
  const extra={...wrong.item,id:D.id(),stage:7};wrong.p.items.push(extra,{...wrong.item,id:D.id(),removedAt:D.now()},{...wrong.item,id:D.id(),planArchive:{reason:'removed'}});assert.equal(P.storyboardProgress(wrong.p).length,1);
  const legacy=fixture('single');const old=legacy.image('start');delete legacy.item.keyframeMode;delete legacy.item.keyframeSelection;delete old.keyframe;delete old.keyframeReviewBasis;assert.equal(row(legacy.p).frames.length,1);assert.equal(row(legacy.p).frames[0].imageCount,1);
  const legacyText=fixture('single');delete legacyText.item.keyframeMode;D.addVariant(legacyText.p,legacyText.item.id,{text:'Ранее утверждённое текстовое описание'});D.approve(legacyText.p,legacyText.item.id);assert.equal(D.isApproved(legacyText.p,legacyText.item),true);assert.equal(row(legacyText.p).approved,false,'Legacy approval of a description never counts as an approved image set');
  const batch=fixture();batch.image('start');const batchBefore=JSON.stringify(batch.p);const batchMarkup=renderToStaticMarkup(createElement(KeyframeBatchEditor,{p:batch.p,busy:false,initiallyOpen:true,submit:()=>{throw Error('No automatic request');}}));assert(batchMarkup.includes('Роль ключевого кадра серии'));assert(batchMarkup.includes('Создать ключевые кадры'));assert.equal(JSON.stringify(batch.p),batchBefore);
  console.log('PASS storyboard progress: real images by role, text/fileless output, initial/end completeness, choice vs approval, queued/saving/unknown, old failure with saved image, stale/wrong roles, removed/archived plans, initial batch, and read-only SSR/batch opening.');
}finally{globalThis.fetch=originalFetch;}
