import {build} from 'esbuild';
import A from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as K from './lib/keyframes';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/keyframe-removal.mjs'});
const {D,K}=await import('../work/tests/keyframe-removal.mjs');
for(const role of ['start','middle','end']){
 const p=D.newProject('Удаление кадра'),item=p.items.find(i=>i.stage===5);
 const frames=Object.fromEntries(['start','middle','end'].map(r=>{const v=D.makeVariant(p,item,{kind:'image',assetId:r+'-file',keyframe:r});item.variants.push(v);return [r,v];}));
 item.keyframeMode='triple';item.keyframeSelection={startId:frames.start.id,middleId:frames.middle.id,endId:frames.end.id};item.approvedKeyframes={...item.keyframeSelection,basis:'Approved frozen files'};item.selectedId=frames.start.id;item.approvedId=frames.start.id;
 const selection=structuredClone(item.keyframeSelection),ids=item.variants.map(v=>v.id);D.deleteVariant(p,item.id,frames[role].id);A.equal(item.approvedKeyframes,undefined);A.deepEqual(item.keyframeSelection,selection);A(K.keyframeIssues(p,item).some(i=>i.code==='missing_'+role));
 D.restoreVariant(p,item.id,frames[role].id);A.equal(item.approvedKeyframes,undefined,'Restoring a file never restores approval');A.deepEqual(item.keyframeSelection,selection);A.deepEqual(item.variants.map(v=>v.id).sort(),ids.sort());A.equal(K.keyframesApproved(p,item),false);
 if(role==='start'){A.equal(item.selectedId,undefined);A.equal(item.approvedId,undefined);}
}
// An old approval may refer to a different set than today's selection. Both must invalidate the approval.
for(const ref of ['approval','selection']){
 const p=D.newProject('Старая пара'),item=p.items.find(i=>i.stage===5),v=D.makeVariant(p,item,{kind:'image',assetId:'file'});item.variants.push(v);
 item.keyframeSelection={startId:ref==='selection'?v.id:'other'};item.approvedKeyframes={basis:'Old approval',startId:ref==='approval'?v.id:'other'};D.deleteVariant(p,item.id,v.id);A.equal(item.approvedKeyframes,undefined);
}
console.log('PASS keyframe deletion/restore: every referenced role invalidates approval, selection IDs retained, restored files never auto-approved.');
