import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock={name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p)=>{p.revision++;globalThis.state=p;return p};
export const asset=async()=>{throw new Error('No media needed')};`}));}};
await build({entryPoints:['lib/domain.ts','lib/script-approval.ts','lib/approval-blockers.ts','app/api/projects/[id]/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/script-approval',outExtension:{'.js':'.mjs'},plugins:[mock]});
const base='../work/tests/script-approval/',D=await import(base+'lib/domain.mjs'),S=await import(base+'lib/script-approval.mjs'),B=await import(base+'lib/approval-blockers.mjs'),{PATCH}=await import(base+'app/api/projects/[id]/route.mjs');
const p=D.newProject('Reviewed script');
for(const item of p.items.filter(i=>i.stage<=5)){D.addVariant(p,item.id,{text:'Сохранённый текст'});D.approve(p,item.id);}
const script=p.items[4],source=structuredClone(D.chosen(script)),board=structuredClone(p.items[5]);
p.jobs.push({id:D.id(),status:'done',itemId:script.id,model:'test',deps:source.deps,actual:'123',refs:[]});
D.addVariant(p,p.items[0].id,{text:'Изменённая основа'});D.approve(p,p.items[0].id);
assert(D.stageReady(p,4));assert(!D.isApproved(p,script));assert(!D.stageReady(p,5));
assert.throws(()=>D.approve(p,script.id),/Основа изменилась/);
const before=structuredClone(p);
assert.equal(S.scriptReapprovalReason(p,script.id,source.id),'');
S.reapproveScript(p,script.id,source.id);
assert.equal(script.variants.length,1);assert.equal(script.selectedId,source.id);assert.equal(script.approvedId,source.id);
assert.deepEqual(D.chosen(script),{...source,deps:D.dependencies(p,4)});
assert(D.isApproved(p,script));assert(D.stageReady(p,5));assert(!D.isApproved(p,p.items[5]));
assert.deepEqual(p.items[5],board,'Do not change downstream cards or approve stale frames');assert.deepEqual(p.jobs,before.jobs);
assert(!B.approvalBlockers(p,5).some(b=>b.itemId===script.id));
assert.throws(()=>S.reapproveScript(p,script.id,source.id),/обычное/);
for(const change of [
 x=>{x.items[0].approvedId=undefined},x=>{x.jobs.push({status:'pending'})},
 x=>{x.items[4].selectedId=undefined},x=>{x.items[4].planArchive=true},
 x=>{x.items[4].removedAt=new Date().toISOString()},x=>{D.chosen(x.items[4]).text='  '},
 x=>{D.chosen(x.items[4]).kind='video'},
]) {const bad=structuredClone(before);change(bad);const snapshot=structuredClone(bad);assert.throws(()=>S.reapproveScript(bad,script.id,source.id));assert.deepEqual(bad,snapshot);}
assert.throws(()=>S.reapproveScript(structuredClone(before),p.items[5].id,board.selectedId),/сценарий/);
const payload={revision:before.revision,action:'reapproveScript',itemId:script.id,data:{variantId:source.id}};
const run=body=>PATCH(new Request('https://site.test/api',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
globalThis.state=structuredClone(before);
// Repeated selection is not approval and never updates the variant's basis.
for(let n=0;n<2;n++)await run({revision:state.revision,action:'select',itemId:script.id,data:{variantId:source.id}});
assert(!D.isApproved(state,state.items[4]));assert.equal(D.chosen(state.items[4]).deps,source.deps);
await run({...payload,revision:state.revision});assert(D.isApproved(state,state.items[4]));assert.equal(state.items[4].variants.length,1);
const saved=structuredClone(state);await assert.rejects(()=>run(payload),/Проект изменился/);assert.deepEqual(state,saved);
globalThis.state=structuredClone(before);globalThis.denied=true;await assert.rejects(()=>run(payload),/Unauthorized/);assert.deepEqual(state,before);globalThis.denied=false;
globalThis.state=structuredClone(before);await assert.rejects(()=>run({...payload,data:{variantId:D.id()}}),/Выберите/);assert.deepEqual(state,before);
console.log('PASS script reapproval: single stale variant, repeated selection, in-place explicit approval, downstream remains stale, unchanged costs/history, blocked and concurrent actions are atomic.');
