import {build} from 'esbuild';import {strict as assert} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as W from './lib/workflow';export * as I from './lib/minimax-image';export * as C from './lib/characters';export * as B from './lib/approval-blockers';export * as M from './lib/models';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/creative-order.mjs',external:['@ffmpeg/ffmpeg']});
const {D,W,I,C,B,M}=await import('../work/tests/creative-order.mjs');
const p=D.newProject('Мир фильма'),card=s=>p.items.find(i=>i.stage===s),approve=(s,text)=>{D.addVariant(p,card(s).id,{text});D.approve(p,card(s).id);};
assert.deepEqual(W.WORKFLOW.slice(0,7).map(x=>x.id),[0,2,3,1,4,5,6]);assert.equal(W.nextStage(3),1);assert.equal(W.nextStage(1),4);
approve(0,'СЦЕНАРИЙ_НЕ_КОПИРОВАТЬ '.repeat(5000));assert(D.stageReady(p,2));assert(!D.stageReady(p,1));
approve(2,'АКВАРЕЛЬ, приглушённая охра, мягкий свет. '.repeat(2000));assert(D.stageReady(p,3));assert(!D.stageReady(p,1));
// An image location with no photo selected must still contribute its text.
D.addVariant(p,card(3).id,{kind:'image',assetId:D.id(),text:'ЛЕСНАЯ_ДЕРЕВНЯ: деревянные дома и зелёные холмы. '.repeat(2000)});D.approve(p,card(3).id);
assert(D.stageReady(p,1));assert.deepEqual(B.approvalBlockers(p,1),[]);
card(1).character={name:'Лена',appearance:'Рыжие волосы, зелёные глаза.',description:'Смелая девочка. '.repeat(1000),instructions:'Сохрани лицо. '.repeat(1000),refs:[D.id()]};
const before=structuredClone(p),instruction='Синий плащ. '.repeat(1500);
for(const model of M.MODELS.filter(m=>m.kind==='image')){
 const r=I.characterImageRequest(p,card(1),instruction,card(1).character.refs,1,4,model.id);
 assert(r.length<=r.limit,model.id);assert(r.limit<=4000);if(model.id==='image-01')assert.equal(r.limit,1500);
 for(const s of ['АКВАРЕЛЬ','ЛЕСНАЯ_ДЕРЕВНЯ','Рыжие','Сохрани лицо'])assert(r.prompt.includes(s),model.id+': '+s);
 assert(!r.prompt.includes('СЦЕНАРИЙ_НЕ_КОПИРОВАТЬ'));assert(!r.prompt.includes('"deps"'));
}
assert.deepEqual(p,before);
assert.deepEqual(C.characterImageRefs(p,card(2),[]),[]);assert.deepEqual(C.characterImageRefs(p,card(3),[]),[]);
// Old projects retain IDs, files and approvals: production dependencies contain the same ordered set.
for(const item of p.items){const v=D.makeVariant(p,item,{text:'Legacy',assetId:D.id(),kind:item.stage===6?'audio':'image',character:item.character});v.deps=JSON.stringify([p.configVersion,...p.items.filter(i=>i.stage<item.stage).map(i=>[i.id,i.approvedId??null])]);item.variants=[v];item.selectedId=v.id;item.approvedId=v.id;}
const legacy=structuredClone(p);for(const s of [1,2,3])assert(D.isApproved(p,card(s)));for(const s of [4,5,6,7,8])assert.equal(D.dependencies(p,s),D.chosen(card(s)).deps);assert.deepEqual(p,legacy);
const heroDeps=D.dependencies(p,1);approve(2,'Новый стиль');assert.notEqual(D.dependencies(p,1),heroDeps);assert(D.isApproved(p,card(1)));assert(!D.isApproved(p,card(4)));
assert(!D.dependencies(p,2).includes(card(1).id));assert(!D.dependencies(p,3).includes(card(1).id));
console.log('PASS creative order: gates/navigation, image-location text without reference selection, bounded prompts for all image models, immutable source cards, legacy IDs/approvals/production basis, and upstream style changes.');
