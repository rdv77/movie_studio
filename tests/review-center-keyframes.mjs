import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';export * as C from './lib/review-center';export {ensureDirecting} from './lib/directing';export {ReviewCenter} from './app/review-center';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/review-center-keyframes.mjs',external:['react','react-dom','@ffmpeg/ffmpeg']});
const {D,K,C,ensureDirecting,ReviewCenter}=await import('../work/tests/review-center-keyframes.mjs');
const fixture=(mode='pair')=>{
 const p=D.newProject('Пересмотр кадров');ensureDirecting(p);
 const shot={id:D.id(),title:'План с движением',description:'Герой поднимает стрелу',duration:5,camera:'Наезд',continuity:'Прямая склейка',stateIn:'Стоит',stateOut:'Держит стрелу',continuityChanges:'Стрела в руке',speechType:'none',dialogue:'',speaker:''};
 for(const stage of [0,2,3,1,4]){const item=p.items.find(i=>i.stage===stage);D.addVariant(p,item.id,{text:stage===4?JSON.stringify({timingMode:'actual',shots:[shot]}):'Утверждённая основа'});D.approve(p,item.id);}
 const script=p.items.find(i=>i.stage===4),item=p.items.find(i=>i.stage===5);item.sourceShot={scriptId:script.id,title:shot.title,shotId:shot.id};K.setKeyframeMode(p,item.id,mode);
 const first=D.makeVariant(p,item,{kind:'image',assetId:D.id(),title:'Начало',keyframe:'start',pairId:D.id(),model:'grok-imagine-image-2.0',jobId:D.id(),imageSettings:{quality:'medium',resolution:'2k'}});
 item.variants.push(first);K.chooseKeyframe(p,item.id,'start',first.id);first.keyframeReviewBasis=K.keyframeFoundationBasis(p,item,'start',first);
 const endpoint=role=>{const settings=K.prepareKeyframeGeneration(p,item.id,role,{model:first.model,refs:[first.assetId],imageSettings:first.imageSettings}),v=D.makeVariant(p,item,{...settings,kind:'image',assetId:D.id(),jobId:D.id(),title:role});item.variants.push(v);K.chooseKeyframe(p,item.id,role,v.id);return v;};
 const end=mode==='single'?undefined:endpoint('end'),middle=mode==='triple'?endpoint('middle'):undefined;
 return {p,item,first,end,middle,endpoint};
};
const row=(p,item)=>C.reviewRows(p).find(r=>r.itemId===item.id);
const html=p=>renderToStaticMarkup(createElement(ReviewCenter,{p,stage:5,busy:false,submit:()=>{throw Error('Viewing must not mutate');},open:()=>{throw Error('SSR must not navigate');}}));
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Viewing must not fetch or call a provider');};
try{
 const {p,item,first,end}=fixture(),before=JSON.stringify(p);
 let previews=C.reviewKeyframePreviews(p,item.id);
 assert.deepEqual(previews.map(v=>[v.role,v.variantId,v.assetId,v.status]),[['start',first.id,first.assetId,'current'],['end',end.id,end.assetId,'current']]);
 const rendered=html(p);assert(rendered.includes('/api/assets/'+first.assetId));assert(rendered.includes('/api/assets/'+end.assetId));assert(rendered.includes('data-keyframe-role="end"'));assert(rendered.includes('Одно утверждение относится ко всем показанным кадрам'));assert.equal(JSON.stringify(p),before);
 end.keyframeReviewBasis='previous-end-foundation';previews=C.reviewKeyframePreviews(p,item.id);
 assert.equal(previews[0].status,'current');assert.equal(previews[1].status,'review');assert.match(previews[1].reason,/Основа/);
 const changed=html(p);assert(changed.includes('Последний кадр</strong> · Нужен пересмотр'));assert(changed.includes('<details open=""'));assert(changed.includes('/api/assets/'+end.assetId));
 const approval=C.reviewApprovalSelection(row(p,item));assert.equal(approval.reviewed,true);assert.deepEqual(approval.keyframes,{startId:first.id,endId:end.id});
 const oldEndId=end.id,newEnd=fixture().end; // Unrelated historical image cannot replace the selected endpoint.
 assert(!previews.some(v=>v.assetId===newEnd.assetId));
 const replacement={...end,id:D.id(),assetId:D.id(),keyframeReviewBasis:K.keyframeFoundationBasis(p,item,'end',end)};item.variants.push(replacement);K.chooseKeyframe(p,item.id,'end',replacement.id);
 const changedSet=structuredClone(p);assert.throws(()=>C.approveReview(p,[approval]),/Выбор ключевых кадров изменился/);assert.deepEqual(p,changedSet,'An old preview cannot approve a newly selected endpoint');
 previews=C.reviewKeyframePreviews(p,item.id);assert.equal(previews[1].variantId,replacement.id);assert.equal(previews[1].assetId,replacement.assetId);assert(!previews.some(v=>v.variantId===oldEndId));
 const current=C.reviewApprovalSelection(row(p,item)),ids=item.variants.map(v=>v.id),jobs=structuredClone(p.jobs);C.approveReview(p,[current]);assert(K.keyframesApproved(p,p.items.find(i=>i.id===item.id)));assert.deepEqual(p.items.find(i=>i.id===item.id).variants.map(v=>v.id),ids);assert.deepEqual(p.jobs,jobs);

 const triple=fixture('triple');triple.middle.keyframeReviewBasis='old-middle';triple.end.keyframeReviewBasis='old-end';
 assert.deepEqual(C.reviewKeyframePreviews(triple.p,triple.item.id).map(v=>[v.role,v.status]),[['start','current'],['middle','review'],['end','review']]);
 const tripleHtml=html(triple.p);for(const frame of [triple.first,triple.middle,triple.end])assert(tripleHtml.includes('/api/assets/'+frame.assetId));
 assert(tripleHtml.includes('Промежуточный кадр</strong> · Нужен пересмотр'));assert(tripleHtml.includes('Последний кадр</strong> · Нужен пересмотр'));
 const submitted=C.reviewApprovalSelection(row(triple.p,triple.item));assert.equal(submitted.keyframes.middleId,triple.middle.id);assert.equal(submitted.keyframes.endId,triple.end.id);C.approveReview(triple.p,[submitted]);assert(K.keyframesApproved(triple.p,triple.p.items.find(i=>i.id===triple.item.id)));

 const missing=fixture();missing.item.variants=missing.item.variants.filter(v=>v.id!==missing.end.id);const missingPreview=C.reviewKeyframePreviews(missing.p,missing.item.id);assert.equal(missingPreview[1].status,'missing');assert(!missingPreview[1].assetId);assert(html(missing.p).includes('Нет изображения'));assert.throws(()=>C.reviewApprovalSelection(row(missing.p,missing.item)),/готовый материал/);
 const selectionCases=['ready','review','approved','missing','conflict'].map(status=>({itemId:status,variantId:`variant-${status}`,stage:5,title:status,status,reason:status}));
 selectionCases.push({itemId:'no-variant',stage:5,title:'No selection',status:'ready',reason:'No selected variant'});
 const selectionSnapshot=structuredClone(selectionCases),allSelectable=C.selectableReviewRows(selectionCases);
 assert.deepEqual(allSelectable.map(r=>r.itemId),['ready','review'],'Select all includes unchanged and reviewed images, but never approved, incomplete or conflicting materials');
 assert.deepEqual(allSelectable.map(C.reviewApprovalSelection).map(s=>[s.itemId,s.reviewed]),[['ready',false],['review',true]],'A bulk selection preserves the explicit confirmation required by changed foundations');
 assert.deepEqual(selectionCases,selectionSnapshot,'Selecting materials does not approve or mutate them');
 assert.deepEqual(C.selectableReviewRows([]),[]);

 const scoped=fixture('single');scoped.p.speechMode='plans';scoped.item.title='КАДР_ДЛЯ_АНИМАТИКА';
 const scopedVoice={id:D.id(),stage:6,title:'ГОЛОС_ДЛЯ_АНИМАТИКА',sourceShot:{...scoped.item.sourceShot},variants:[]};
 const scopedVideo={id:D.id(),stage:7,title:'ВИДЕО_ТОЛЬКО_ДЛЯ_ФИЛЬМА',sourceShot:{...scoped.item.sourceShot},variants:[]};
 for(const [target,kind] of [[scopedVoice,'audio'],[scopedVideo,'video']]){const variant=D.makeVariant(scoped.p,target,{kind,assetId:D.id(),duration:5});target.variants.push(variant);target.selectedId=variant.id;}
 scoped.p.items.push(scopedVoice,scopedVideo);scoped.p.animaticSettings={sound:'silent',music:false,motion:false};
 const scopeHtml=props=>renderToStaticMarkup(createElement(ReviewCenter,{p:scoped.p,busy:false,submit:()=>{throw Error('Viewing cannot approve');},open:()=>{throw Error('Viewing cannot navigate');},...props}));
 const scopedSnapshot=JSON.stringify(scoped.p),silentHtml=scopeHtml({scope:'animatic'});
 assert(silentHtml.includes(scoped.item.title),'Silent animatics still expose pending storyboard images');
 assert(!silentHtml.includes(scopedVideo.title),'Video plans do not participate in animatic review');
 assert(!silentHtml.includes(scopedVoice.title),'Silent animatics do not ask for voice approvals');
 assert(silentHtml.includes('Выбрать все доступные материалы'),'The bulk checkbox is visible before reviewing each individual plan');
 assert(silentHtml.indexOf('Выбрать все доступные материалы')<silentHtml.indexOf(scoped.item.title),'Bulk selection sits above the plan list');
 assert.equal(JSON.stringify(scoped.p),scopedSnapshot,'Opening animatic review changes no project data');
 scoped.p.animaticSettings.sound='voices';const voicedHtml=scopeHtml({scope:'animatic'});
 assert(voicedHtml.includes(scopedVoice.title),'An animatic with speech exposes the voice materials it needs');
 assert(!voicedHtml.includes(scopedVideo.title),'Adding voices never adds video plan approval requirements');
 const generalHtml=scopeHtml({});assert(generalHtml.includes(scopedVideo.title),'The general review centre retains video plan diagnostics');
 const onlyFramesHtml=scopeHtml({scope:'animatic',stage:5});assert(onlyFramesHtml.includes(scoped.item.title));assert(!onlyFramesHtml.includes(scopedVoice.title),'An explicit stage filter is retained within the animatic scope');
 scoped.p.mediaDurations={[scopedVoice.variants[0].assetId]:6,[scopedVideo.variants[0].assetId]:3};
 assert.equal(C.reviewRows(scoped.p).find(r=>r.itemId===scopedVoice.id).status,'conflict','A voice longer than its video still blocks general film review');
 assert.equal(C.reviewRows(scoped.p).find(r=>r.itemId===scopedVideo.id).status,'conflict');
 assert(!C.reviewRows(scoped.p,'animatic').some(r=>r.itemId===scopedVideo.id),'The backend animatic scope also excludes future video plans');
 const beforeOutsideScope=structuredClone(scoped.p);
 assert.throws(()=>C.approveReview(scoped.p,[{itemId:scopedVideo.id,variantId:scopedVideo.selectedId,reviewed:true}],'animatic'),'An animatic request cannot approve a hidden video card');
 assert.deepEqual(scoped.p,beforeOutsideScope,'An out-of-scope approval is rejected without partial changes');
 C.approveReview(scoped.p,[C.reviewApprovalSelection(C.reviewRows(scoped.p,'animatic').find(r=>r.itemId===scoped.item.id))],'animatic');
 const animaticVoice=C.reviewRows(scoped.p,'animatic').find(r=>r.itemId===scopedVoice.id);
 assert(['ready','review'].includes(animaticVoice.status),'Future video length does not block a still-image animatic voice');
 C.approveReview(scoped.p,[C.reviewApprovalSelection(animaticVoice)],'animatic');
 assert.equal(scoped.p.items.find(i=>i.id===scopedVoice.id).approvedId,scopedVoice.selectedId,'Animatic approval can accept speech longer than a future video clip');
 assert.equal(C.reviewRows(scoped.p).find(r=>r.itemId===scopedVideo.id).status,'conflict','Approving the animatic does not waive the film timing conflict');
 const legacy=fixture('single');delete legacy.item.keyframeMode;delete legacy.item.keyframeSelection;delete legacy.first.keyframe;delete legacy.first.keyframeReviewBasis;assert.equal(C.reviewKeyframePreviews(legacy.p,legacy.item.id).length,1);assert(!C.reviewApprovalSelection(row(legacy.p,legacy.item)).keyframes);
 legacy.item.removedAt=D.now();assert.deepEqual(C.reviewKeyframePreviews(legacy.p,legacy.item.id),[]);assert.deepEqual(C.reviewKeyframePreviews(legacy.p,D.id()),[]);
 const casting=fixture('single');casting.p.speechMode='plans';
 const video={id:D.id(),stage:7,title:'Одинаковое название',sourceShot:{...casting.item.sourceShot},variants:[]};
 const voice={id:D.id(),stage:6,title:'Одинаковое название',sourceShot:{...video.sourceShot},variants:[]};
 const history={...voice,id:D.id(),planArchive:'previous-script'},removed={...voice,id:D.id(),removedAt:D.now()},other={...voice,id:D.id(),sourceShot:{...voice.sourceShot,shotId:D.id()}},foreignScript={...voice,id:D.id(),sourceShot:{...voice.sourceShot,scriptId:D.id(),shotId:D.id()}};
 casting.p.items.unshift(history,removed,other,foreignScript,voice,video);
 const audio=D.makeVariant(casting.p,voice,{kind:'audio',assetId:D.id(),duration:6}),clip=D.makeVariant(casting.p,video,{kind:'video',assetId:D.id(),duration:5});voice.variants.push(audio);voice.selectedId=audio.id;video.variants.push(clip);video.selectedId=clip.id;casting.p.mediaDurations={[audio.assetId]:6,[clip.assetId]:5};
 const castingHtml=()=>renderToStaticMarkup(createElement(ReviewCenter,{p:casting.p,stage:7,busy:false,submit:()=>{throw Error('SSR cannot save');},open:()=>{throw Error('SSR cannot navigate');}}));assert(castingHtml().includes('Переозвучить план'),'The actual UI offers revoice for a uniquely matched active voice');
 assert.equal(C.reviewVoiceItem(casting.p,video.id)?.id,voice.id,'Revoice targets the active stable shot ID, not an earlier equal title or history');
 voice.title='Переименованный голос';voice.sourceShot.title='Новое название';assert.equal(C.reviewVoiceItem(casting.p,video.id)?.id,voice.id,'Labels do not replace identity');
 voice.removedAt=D.now();assert.equal(C.reviewVoiceItem(casting.p,video.id),undefined,'Missing current voice never opens a random duplicate');
 assert(!castingHtml().includes('Переозвучить план'),'The actual UI cannot revoice an archived or duplicate-title fallback');
 delete voice.removedAt;video.removedAt=D.now();assert.equal(C.reviewVoiceItem(casting.p,video.id),undefined);delete video.removedAt;
 delete video.sourceShot.shotId;delete voice.sourceShot.shotId;voice.sourceShot.title=video.sourceShot.title;
 const oldForeign={...voice,id:D.id(),sourceShot:{scriptId:D.id(),title:video.sourceShot.title}};casting.p.items.unshift(oldForeign);assert.equal(C.reviewVoiceItem(casting.p,video.id)?.id,voice.id,'Legacy matching stays scoped to its script and active plan');
 const ambiguous={...voice,id:D.id(),sourceShot:{...voice.sourceShot}};casting.p.items.unshift(ambiguous);assert.equal(C.reviewVoiceItem(casting.p,video.id),undefined,'Two active legacy matches do not identify a specific voice card');
 console.log('PASS review centre: pair/triple current/stale frame previews and atomic approval; animatic scope excludes video and silent voices; bulk selection includes ready/review, skips approved/missing/conflict; missing/removed/legacy cases; stable revoice identity. SSR performs no fetch, payment or mutation.');
}finally{globalThis.fetch=originalFetch;}
