import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/bulk-approval.ts','lib/render.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/bulk-approval',outExtension:{'.js':'.mjs'},external:['@ffmpeg/ffmpeg']});
const D=await import('../work/tests/bulk-approval/domain.mjs'), B=await import('../work/tests/bulk-approval/bulk-approval.mjs'), R=await import('../work/tests/bulk-approval/render.mjs');
const p=D.newProject('Batch');
for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:'Основа'});D.approve(p,i.id);}
const first=p.items.find(i=>i.stage===5);
D.addVariant(p,first.id,{kind:'image',assetId:D.id(),duration:25});D.approve(p,first.id);
const approvedId=first.approvedId;
D.addVariant(p,first.id,{kind:'image',assetId:D.id(),duration:25});
const second={id:D.id(),stage:5,title:'Второй',variants:[]};p.items.push(second);
D.addVariant(p,second.id,{kind:'image',assetId:D.id(),duration:25});
const selections=(project,stage)=>B.approvalBatch(project,stage).filter(r=>!r.reason).map(({itemId,variantId})=>({itemId,variantId}));
const pending=structuredClone(p);
assert.equal(selections(p,5).length,1);
B.approveBatch(p,5,selections(p,5));assert.equal(first.approvedId,approvedId);assert.equal(second.approvedId,second.selectedId);
assert.equal(B.approvalBatch(p,5).length,0);
const voices=p.items.find(i=>i.stage===6);D.addVariant(p,voices.id,{kind:'audio',assetId:D.id(),duration:50});
B.approveBatch(p,6,selections(p,6));assert.equal(R.editPlan(p,true).audio.length,1);
const video=p.items.find(i=>i.stage===7);D.addVariant(p,video.id,{kind:'video',assetId:D.id(),duration:50});B.approveBatch(p,7,selections(p,7));assert(D.isApproved(p,video));
const stale=structuredClone(p);stale.configVersion++;assert(B.approvalBatch(stale,5).every(r=>r.reason));
for(const invalid of [[],[...selections(pending,5),...selections(pending,5)],[{itemId:second.id,variantId:D.id()}],[...selections(pending,5),{itemId:voices.id,variantId:voices.selectedId}]]){
 const snapshot=structuredClone(pending);assert.throws(()=>B.approveBatch(pending,5,invalid));assert.deepEqual(pending,snapshot);
}
const noAsset=structuredClone(pending);delete D.chosen(noAsset.items.find(i=>i.id===second.id)).assetId;assert.equal(selections(noAsset,5).length,0);
const old=structuredClone(pending);D.chosen(old.items.find(i=>i.id===second.id)).deps='old';assert.match(B.approvalBatch(old,5)[0].reason,/Основа изменилась/);
const active=structuredClone(pending);active.jobs.push({itemId:second.id,status:'pending'});assert.equal(selections(active,5).length,0);
const plans=structuredClone(p);plans.speechMode='plans';assert.equal(B.approvalBatch(plans,6).length,0); // Old narration excluded.
const linked={id:D.id(),stage:6,title:'Реплика',sourceShot:{scriptId:p.items[4].id,title:'План'},variants:[]};plans.items.push(linked);
D.addVariant(plans,linked.id,{kind:'video',assetId:D.id()});assert.equal(selections(plans,6).length,0);
D.addVariant(plans,linked.id,{kind:'audio',assetId:D.id()});assert.equal(selections(plans,6).length,1);
assert.throws(()=>B.approvalBatch(p,4));
const plugin={name:'server-mock',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw new Error('Unauthorized');return 'owner'};export const loadProject=async()=>structuredClone(globalThis.current);export const saveProject=async(_,p)=>{p.revision++;globalThis.current=p;return p};export const asset=async()=>({});`}));}};
await build({entryPoints:['app/api/projects/[id]/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/bulk-approval/route.mjs',plugins:[plugin]});
const Q=await import('../work/tests/bulk-approval/route.mjs');
const payload={revision:pending.revision,action:'approveBatch',data:{stage:5,selections:selections(pending,5)}};
const run=body=>Q.PATCH(new Request('http://localhost',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:pending.id})});
globalThis.current=structuredClone(pending);await run(payload);assert.equal(globalThis.current.revision,pending.revision+1);assert.equal(globalThis.current.items.find(i=>i.id===second.id).approvedId,second.selectedId);
const saved=structuredClone(globalThis.current);await assert.rejects(()=>run(payload),/Проект изменился/);assert.deepEqual(globalThis.current,saved);
globalThis.current=structuredClone(pending);globalThis.denied=true;await assert.rejects(()=>run(payload),/Unauthorized/);assert.deepEqual(globalThis.current,pending);globalThis.denied=false;
console.log('PASS bulk approvals: selected variants, preserved approvals, all-or-nothing validation, stage/media/dependency guards, inactive narration, animatic readiness, owner auth and stale revision rejection.');
