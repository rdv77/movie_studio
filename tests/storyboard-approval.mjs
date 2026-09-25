import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const mock={name:'server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`
export const api=f=>f;export const owner=async()=>{if(globalThis.denied)throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(_,p)=>{p.revision++;globalThis.state=p;return p};
export const asset=async()=>{if(globalThis.foreign)throw new Error('Foreign asset');return {mime:globalThis.badMime?'video/mp4':'image/png'}};`}));}};
await build({entryPoints:['lib/domain.ts','lib/storyboard-approval.ts','lib/approval-blockers.ts','app/api/projects/[id]/route.ts'],bundle:true,platform:'node',format:'esm',outbase:'.',outdir:'work/tests/storyboard-approval',outExtension:{'.js':'.mjs'},plugins:[mock]});
const base='../work/tests/storyboard-approval/',D=await import(base+'lib/domain.mjs'),S=await import(base+'lib/storyboard-approval.mjs'),B=await import(base+'lib/approval-blockers.mjs'),{PATCH}=await import(base+'app/api/projects/[id]/route.mjs');
const p=D.newProject('Storyboard');
const scriptText=JSON.stringify({shots:Array.from({length:10},(_,n)=>({title:'План '+(n+1),description:'Герой у окна',duration:5,camera:'Общий план',dialogue:'',continuity:'Прямая склейка',speechType:'none'}))});
for(const item of p.items.filter(i=>i.stage<=6).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))) {
 D.addVariant(p,item.id,{text:item.stage===4?scriptText:'Сохранённый текст',kind:item.stage===5?'image':item.stage===6?'audio':'text',assetId:item.stage>=5?D.id():undefined});
 D.approve(p,item.id);
}
const frame=p.items[5],script=p.items[4],source=structuredClone(D.chosen(frame));
frame.sourceShot={scriptId:script.id,title:'План 1'};
p.jobs.push({id:D.id(),status:'done',itemId:frame.id,model:'test',deps:source.deps,actual:'123',refs:[]});
D.addVariant(p,script.id,{text:scriptText});D.approve(p,script.id);
assert(D.stageReady(p,5));assert(!D.isApproved(p,frame));assert.throws(()=>D.approve(p,frame.id),/Основа изменилась/);
const before=structuredClone(p),downstream=structuredClone(p.items[6]);
S.reapproveStoryboard(p,frame.id,source.id);
assert.equal(frame.variants.length,1);assert.equal(frame.approvedId,source.id);assert.equal(frame.selectedId,source.id);
assert.deepEqual(D.chosen(frame),{...source,deps:D.dependencies(p,5)});
assert(D.isApproved(p,frame));assert(D.stageReady(p,6));assert(!D.isApproved(p,p.items[6]));
assert.deepEqual(p.items[6],downstream);assert.deepEqual(p.jobs,before.jobs);
assert(!B.approvalBlockers(p,6).some(b=>b.itemId===frame.id));
const draft=structuredClone(before);D.chosen(draft.items[5]).kind='text';delete D.chosen(draft.items[5]).assetId;S.reapproveStoryboard(draft,frame.id,source.id);assert(D.isApproved(draft,draft.items[5]));
for(const change of [x=>{x.items[4].approvedId=undefined},x=>{x.jobs.push({status:'saving'})},x=>{x.items[5].selectedId=undefined},x=>{x.items[5].planArchive=true},x=>{x.items[5].removedAt='now'},x=>{x.items[5].sourceShot.title='Удалённый план'},x=>{delete D.chosen(x.items[5]).assetId},x=>{D.chosen(x.items[5]).kind='video'}]) {
 const bad=structuredClone(before);change(bad);const snapshot=structuredClone(bad);assert.throws(()=>S.reapproveStoryboard(bad,frame.id,source.id));assert.deepEqual(bad,snapshot);
}
const payload={revision:before.revision,action:'reapproveStoryboard',itemId:frame.id,data:{variantId:source.id}};
const run=body=>PATCH(new Request('https://site.test/api',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
globalThis.state=structuredClone(before);
for(let n=0;n<2;n++)await run({revision:state.revision,action:'select',itemId:frame.id,data:{variantId:source.id}});
assert(!D.isApproved(state,state.items[5]));await run({...payload,revision:state.revision});assert(D.isApproved(state,state.items[5]));assert.equal(state.items[5].variants.length,1);
const saved=structuredClone(state);await assert.rejects(()=>run(payload),/Проект изменился/);assert.deepEqual(state,saved);
for(const flag of ['denied','foreign','badMime']) {globalThis.state=structuredClone(before);globalThis[flag]=true;await assert.rejects(()=>run(payload));assert.deepEqual(state,before);globalThis[flag]=false;}
globalThis.state=structuredClone(before);await assert.rejects(()=>run({...payload,data:{variantId:D.id()}}));assert.deepEqual(state,before);
console.log('PASS storyboard reapproval: stable card/file/text/metadata, image and draft, no duplicate or paid generation, stale downstream retained, removed plans refused, ownership/revision/media validation.');
