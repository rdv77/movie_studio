import './storyboard-approval.mjs';
import {strict as assert} from 'node:assert';
const base='../work/tests/storyboard-approval/',D=await import(base+'lib/domain.mjs'),S=await import(base+'lib/storyboard-approval.mjs'),{PATCH}=await import(base+'app/api/projects/[id]/route.mjs');
const p=D.newProject('Unchanged plans');
const shots=Array.from({length:10},(_,n)=>({title:'План '+(n+1),description:'Сцена '+n,duration:5,camera:'Общий план',dialogue:'',continuity:'Прямая склейка',speechType:'none'}));
const script=p.items.find(i=>i.stage===4);
for(const i of p.items.filter(i=>i.stage<5).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
const oldId=script.approvedId;
const frames=[];
for(const [n,shot] of shots.entries()){
 const i=n===0?p.items.find(i=>i.stage===5):{id:D.id(),stage:5,title:shot.title,variants:[]};
 if(n)p.items.push(i);i.title=shot.title;i.sourceShot={scriptId:script.id,title:shot.title,scriptVersion:oldId};
 D.addVariant(p,i.id,{kind:'image',assetId:D.id(),text:shot.description,shotSource:oldId});D.approve(p,i.id);frames.push(i);
}
const voice=p.items.find(i=>i.stage===6);D.addVariant(p,voice.id,{kind:'audio',assetId:D.id()});D.approve(p,voice.id);
const ready=x=>S.unchangedStoryboardBatch(x).filter(r=>!r.reason).map(({itemId,variantId})=>({itemId,variantId}));
// Editing a single storyboard card does not invalidate siblings.
const frameEdit=structuredClone(p);D.addVariant(frameEdit,frames[0].id,{kind:'image',assetId:D.id()});D.approve(frameEdit,frames[0].id);
assert(frameEdit.items.filter(i=>i.stage===5).every(i=>D.isApproved(frameEdit,i)));
assert.equal(ready(frameEdit).length,0);
// Reconcile has already moved sourceShot to the new script version. Use the
// approval dependencies, not this mutable link, when comparing the old scene.
const updated=structuredClone(shots);updated[4].description='Другое действие';updated[9].camera='Крупный план';
D.addVariant(p,script.id,{text:JSON.stringify({shots:updated},null,2)});D.approve(p,script.id);
for(const i of frames)i.sourceShot.scriptVersion=script.approvedId;
assert.equal(ready(p).length,8);
assert.deepEqual(S.unchangedStoryboardBatch(p).filter(r=>r.reason).map(r=>r.title),['План 5','План 10']);
const before=structuredClone(p),downstream=structuredClone(voice),jobs=structuredClone(p.jobs);
S.reapproveUnchangedStoryboard(p,ready(p));
assert.equal(frames.filter(i=>D.isApproved(p,i)).length,8);assert.deepEqual(voice,downstream);assert.deepEqual(p.jobs,jobs);
assert(frames.every(i=>i.variants.length===1));assert.equal(ready(p).length,0);
// A later script edit is compared with the last approval, not generation time.
const next=structuredClone(updated);next[0].dialogue='Рассказ';next[0].speechType='voiceover';
D.addVariant(p,script.id,{text:JSON.stringify({shots:next})});D.approve(p,script.id);
assert.equal(ready(p).length,7);
// Every meaningful shot field, global instructions, other dependencies, and
// ambiguous/deleted/unknown provenance must stay out of the batch.
for(const patch of [s=>s.description='Новое',s=>s.camera='Новая',s=>s.dialogue='Речь',s=>s.speaker='Катя',s=>s.speechType='voiceover',s=>s.continuity='Наплыв',s=>s.duration=6]){
 const x=structuredClone(before),source=D.getItem(x,script.id),data=JSON.parse(D.chosen(source).text);patch(data.shots[0]);
 if(data.shots[0].duration===6)data.shots[1].duration=4;
 // dialogue alone requires a compatible type to remain a valid scenario.
 if(data.shots[0].dialogue)data.shots[0].speechType='voiceover';
 D.chosen(source).text=JSON.stringify(data);
 assert(!ready(x).some(s=>s.itemId===frames[0].id));
}
for(const change of [x=>x.configVersion++,x=>{D.getItem(x,p.items[1].id).approvedId=D.id()},x=>{D.getItem(x,frames[0].id).approvedId=undefined},x=>{D.getItem(x,frames[0].id).selectedId=undefined},x=>{D.getItem(x,frames[0].id).planArchive={reason:'removed'}},x=>{D.getItem(x,frames[0].id).removedAt='now'},x=>{D.chosen(D.getItem(x,frames[0].id)).deps='invalid'},x=>{x.jobs.push({status:'pending'})},x=>{D.getItem(x,script.id).variants=D.getItem(x,script.id).variants.filter(v=>v.id!==oldId)},x=>{const v=D.chosen(D.getItem(x,script.id));v.text=JSON.stringify({...JSON.parse(v.text),direction:'Новая атмосфера'})}]){
 const x=structuredClone(before);change(x);assert(!ready(x).some(s=>s.itemId===frames[0].id));
}
const deleted=structuredClone(before),deletedScript=D.getItem(deleted,script.id),old=deletedScript.variants.find(v=>v.id===oldId);
deletedScript.variants=deletedScript.variants.filter(v=>v.id!==oldId);deleted.removedVariants=[{itemId:script.id,variant:old,removedAt:'now'}];assert.equal(ready(deleted).length,8);
const all=ready(before),bad={itemId:frames[4].id,variantId:frames[4].selectedId};
for(const selection of [[],[all[0],all[0]],[...all,bad],[{...all[0],variantId:D.id()}]]){
 const x=structuredClone(before);assert.throws(()=>S.reapproveUnchangedStoryboard(x,selection));assert.deepEqual(x,before);
}
const payload={revision:before.revision,action:'reapproveUnchangedStoryboard',data:{selections:all}};
const run=body=>PATCH(new Request('https://site.test/api',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:p.id})});
globalThis.state=structuredClone(before);await run(payload);assert.equal(state.items.filter(i=>i.stage===5&&D.isApproved(state,i)).length,8);
const saved=structuredClone(state);await assert.rejects(()=>run(payload),/Проект изменился/);assert.deepEqual(state,saved);
for(const flag of ['denied','foreign','badMime']){globalThis.state=structuredClone(before);globalThis[flag]=true;await assert.rejects(()=>run(payload));assert.deepEqual(state,before);globalThis[flag]=false;}
globalThis.state=structuredClone(before);await assert.rejects(()=>run({...payload,data:{selections:[...all,bad]}}));assert.deepEqual(state,before);
console.log('PASS unchanged storyboard batch: content comparison across approvals, changed scenes excluded, same files/cards, atomic server validation, permissions and revision checks.');
