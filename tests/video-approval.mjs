import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/video-approval.ts','lib/approval-blockers.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/video-approval',outExtension:{'.js':'.mjs'}});
const D=await import('../work/tests/video-approval/domain.mjs');
const V=await import('../work/tests/video-approval/video-approval.mjs');
const B=await import('../work/tests/video-approval/approval-blockers.mjs');
const p=D.newProject('Film');
for(const item of p.items.filter(i=>i.stage<8).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
  D.addVariant(p,item.id,{text:'Reviewed',kind:item.stage===6?'audio':item.stage===7?'video':'text',assetId:D.id(),trim:.2});D.approve(p,item.id);
}
const video=p.items[7],audio=p.items[6],source=structuredClone(D.chosen(video));
D.addVariant(p,audio.id,{text:'New voice',kind:'audio',assetId:D.id()});D.approve(p,audio.id);
assert(!D.stageReady(p,8));assert.equal(V.videoReapprovalReason(p,video.id,source.id),'');
const before=structuredClone(p);
V.reapproveVideo(p,video.id,source.id);
assert(D.stageReady(p,8));assert.deepEqual(B.approvalBlockers(p,8),[]);
assert.equal(video.variants.length,before.items[7].variants.length,'Approval does not duplicate the card');
const approved=D.chosen(video);
assert.equal(approved.id,source.id);assert.equal(video.approvedId,approved.id);
assert.deepEqual(approved,{...source,deps:D.dependencies(p,7)},'Only the approval basis changes; identity, title, file and all media fields stay intact');
assert.deepEqual(p.jobs,before.jobs,'No generation or cost record created');
assert.throws(()=>V.reapproveVideo(p,video.id,D.id()),/Выберите/);
assert.throws(()=>V.reapproveVideo(p,video.id,approved.id),/обычное/);
for(const adjust of [
  x=>{x.items[6].approvedId=undefined},
  x=>{x.jobs.push({status:'pending'})},
  x=>{D.chosen(x.items[7]).lipsync={audioItemId:audio.id,audioVariantId:'old',videoVariantId:source.id};D.chosen(x.items[7]).trim=0},
]) {
  const blocked=structuredClone(before);adjust(blocked);const unchanged=structuredClone(blocked);
  assert.throws(()=>V.reapproveVideo(blocked,video.id,source.id));assert.deepEqual(blocked,unchanged,'Blocked review is atomic');
}
const sync=structuredClone(before);const syncVideo=D.chosen(sync.items[7]);
syncVideo.trim=0;syncVideo.lipsync={audioItemId:audio.id,audioVariantId:sync.items[6].approvedId,videoVariantId:source.id};
V.reapproveVideo(sync,video.id,source.id);assert.deepEqual(D.chosen(sync.items[7]).lipsync,syncVideo.lipsync);
const mock={name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p)=>{p.revision++;globalThis.state=p;return p};
export const asset=async()=>{if(globalThis.foreign)throw new Error('Foreign asset');return {mime:'video/mp4'}};`}));}};
await build({entryPoints:['app/api/projects/[id]/route.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/video-approval/route.mjs',plugins:[mock]});
const {PATCH}=await import('../work/tests/video-approval/route.mjs');
const payload={revision:before.revision,action:'reapproveVideo',itemId:video.id,data:{variantId:source.id}};
const run=body=>PATCH(new Request('https://site.test/api',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
globalThis.state=structuredClone(before);await run(payload);assert(D.stageReady(state,8));
assert.equal(state.items[7].variants.length,before.items[7].variants.length);assert.equal(state.items[7].approvedId,source.id);
const saved=structuredClone(state);await assert.rejects(()=>run(payload),/Проект изменился/);assert.deepEqual(state,saved);
for(const flag of ['denied','foreign']){state=structuredClone(before);globalThis[flag]=true;await assert.rejects(()=>run(payload));assert.deepEqual(state,before);globalThis[flag]=false;}
console.log('PASS reviewed video approval in place: current final gate, stable card ID/count/title/file, no new media/jobs/costs, speech provenance, busy/upstream checks, atomic errors, owner and revision protection.');
