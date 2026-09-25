import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
await build({entryPoints:['lib/domain.ts','lib/approval-blockers.ts'],bundle:true,platform:'node',format:'esm',outdir:'work/tests/approval-blockers',outExtension:{'.js':'.mjs'}});
const D=await import('../work/tests/approval-blockers/domain.mjs');
const {approvalBlockers}=await import('../work/tests/approval-blockers/approval-blockers.mjs');
const p=D.newProject('Film');p.speechMode='plans';
for (const i of p.items.filter(i=>i.stage<8).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
  if(i.stage===6)i.sourceShot={scriptId:p.items[4].id,title:'Plan 1'};
  D.addVariant(p,i.id,{text:'Basis',kind:i.stage===6?'audio':i.stage===7?'video':'text',assetId:D.id()});D.approve(p,i.id);
}
const unchanged=JSON.stringify(p);
assert.deepEqual(approvalBlockers(p,8),[]);
assert.equal(JSON.stringify(p),unchanged,'Diagnostics never alter approvals');
const video=p.items[7],voice=p.items[6];
D.addVariant(p,video.id,{text:'Synced',kind:'video',assetId:D.id(),lipsync:{videoVariantId:video.approvedId,audioVariantId:voice.approvedId,audioItemId:voice.id}});
D.approve(p,video.id);
assert.deepEqual(approvalBlockers(p,8),[],'Approving a sync variant alone does not block final assembly');
const snapshots=[structuredClone(p)];
const selectedOnly=structuredClone(p);delete selectedOnly.items[7].approvedId;
assert.match(approvalBlockers(selectedOnly,8)[0].reason,/выбран, но не утверждён/);snapshots.push(selectedOnly);
const extra=structuredClone(p);extra.items.push({id:D.id(),stage:7,title:'Extra old card',variants:[]});
assert.equal(approvalBlockers(extra,8)[0].title,'Extra old card');snapshots.push(extra);
const missing=structuredClone(p);missing.items=missing.items.filter(i=>i.stage!==6);
assert(approvalBlockers(missing,8).some(b=>!b.itemId&&b.stage===6));snapshots.push(missing);
const changed=structuredClone(p);D.addVariant(changed,voice.id,{kind:'audio',assetId:D.id(),text:'New voice'});D.approve(changed,voice.id);
const rows=approvalBlockers(changed,8);
assert.equal(rows.length,1);assert.equal(rows[0].itemId,video.id);
assert(rows[0].reason.includes(voice.title));assert.match(rows[0].reason,/повторите синхронизацию/);snapshots.push(changed);
const config=structuredClone(p);config.configVersion++;
assert(approvalBlockers(config,8).every(b=>b.reason.includes('настройки фильма')));snapshots.push(config);
const malformed=structuredClone(p);malformed.items[7].variants.find(v=>v.id===video.approvedId).deps='invalid';
assert.match(approvalBlockers(malformed,8)[0].reason,/Основа/);snapshots.push(malformed);
const readyNew=structuredClone(p);readyNew.items[7].variants.find(v=>v.id===video.approvedId).deps='invalid';
D.addVariant(readyNew,video.id,{text:'New current',kind:'video',assetId:D.id()});
assert.match(approvalBlockers(readyNew,8)[0].reason,/Новый актуальный вариант/);snapshots.push(readyNew);
for(const snapshot of snapshots)for(let stage=0;stage<=8;stage++)
  assert.equal(approvalBlockers(snapshot,stage).length===0,D.stageReady(snapshot,stage),'Diagnostics match the actual gate');
console.log('PASS approval diagnostics: sync approvals, selected versus approved, extra cards, missing speech, named changed dependencies, malformed snapshots and exact agreement with stage gate. No data mutations.');
