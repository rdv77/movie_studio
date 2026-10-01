import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
await build({entryPoints:['lib/batch-scope.ts','lib/storyboard.ts','lib/domain.ts','app/batch-scope-selector.tsx'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/batch-scope',outExtension:{'.js':'.mjs'},external:['react','react-dom','react/jsx-runtime']});
const D=await import('../work/tests/batch-scope/lib/domain.mjs'),S=await import('../work/tests/batch-scope/lib/batch-scope.mjs'),B=await import('../work/tests/batch-scope/lib/storyboard.mjs'),{BatchScopeSelector}=await import('../work/tests/batch-scope/app/batch-scope-selector.mjs');
const rows=[{id:'fresh',remaining:false,needsAttention:false},{id:'stale',remaining:false,needsAttention:true},{id:'missing',remaining:true,needsAttention:true},{id:'unknown',remaining:true,needsAttention:true,blocked:'Unknown request'}];
assert.deepEqual(S.batchScopeIds(rows,'all'),['fresh','stale','missing']);
assert.deepEqual(S.batchScopeIds(rows,'remaining'),['missing']);
assert.deepEqual(S.batchScopeIds(rows,'attention'),['stale','missing']);
assert.deepEqual(S.batchScopeIds(rows,'selected',['fresh','unknown','foreign','fresh']),['fresh'],'Manual choices stay unique, owned candidates only, blocked excluded');
const html=renderToStaticMarkup(React.createElement(BatchScopeSelector,{rows,selected:['stale'],onChange:()=>{throw Error('Viewing must not submit')}}));
for(const label of ['Весь этап','Выбранные','Оставшиеся','Требуют внимания','платный вариант'])assert(html.includes(label));
const p=D.newProject('Batch scopes'),script=p.items.find(i=>i.stage===4);for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{kind:'text',text:i.id===script.id?JSON.stringify({timingMode:'actual',shots:[{title:'One',description:'Лес',duration:5,camera:'Общий',dialogue:'',continuity:'Склейка',speechType:'none'}]}):'Foundation'});D.approve(p,i.id);}
const image=p.items.find(i=>i.stage===5);image.sourceShot={scriptId:script.id,title:'One'};D.addVariant(p,image.id,{kind:'image',assetId:D.id(),text:'Forest'});image.variants[0].deps='outdated';
assert.equal(S.mediaBatchCandidate(p,image,'image').needsAttention,true);
assert.equal(B.storyboardBatchPlans(p).find(r=>r.item.id===image.id).blocked,'','A stale image can be regenerated from current scenario without fake manual edits');
p.jobs.push({id:D.id(),itemId:image.id,status:'unknown',created:D.now()});assert(S.mediaBatchCandidate(p,image,'image').blocked);assert(B.storyboardBatchPlans(p).find(r=>r.item.id===image.id).blocked);
console.log('PASS batch scopes: full/manual/remaining/problematic, no unknown repeat, stale regeneration allowed, SSR only displays cost consent. No provider calls.');
