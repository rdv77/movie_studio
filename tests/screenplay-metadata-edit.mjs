import {build} from 'esbuild';
import assert from 'node:assert/strict';
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as R from './lib/directing';export * as M from './lib/story-meaning';export {PATCH} from './app/api/projects/[id]/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/screenplay-metadata-edit.mjs',plugins:[{name:'test-store',setup(b){
  b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'test-store'}));
  b.onLoad({filter:/.*/,namespace:'test-store'},()=>({contents:`export const api=fn=>fn;export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.metadataTestProject);export const asset=async()=>{throw Error('Unexpected asset access');};export const saveProject=async(user,p,revision)=>{if(revision!==globalThis.metadataTestProject.revision)throw Error('revision');p.revision++;globalThis.metadataTestProject=p;return p;};`}));
}}]});
const {D,R,M,PATCH}=await import('../work/tests/screenplay-metadata-edit.mjs');
const meaning={id:'turn',title:'A changed destination',kind:'turn',priority:'required',viewerBefore:'The arrow will land in the village',viewerAfter:'The arrow is heading into the forest',event:'The arrow crosses the last roof',stakes:'The hero must enter an unknown place',evidence:['The arrow is beyond the final roof with forest ahead']};
const arc={character:'Hero',want:'Find a welcoming destination',expectation:'The arrow lands in a courtyard',stakes:'An unfamiliar future',emotionStart:'Hope',emotionEnd:'Anxiety',beats:[{trigger:'The arrow passes the final roof',meaning:'The expected destination is lost',emotionStart:'Hope',emotionEnd:'Anxiety',decision:'Follow the arrow',visibleEvidence:'His smile fades and his gaze follows the distant arrow'}]};
function fixture(){
  const p=D.newProject('Manual screenplay edits'),item=p.items.find(i=>i.stage===0);
  const parent=D.addVariant(p,item.id,{title:'Original',text:'The arrow crosses the village.',kind:'text'});
  parent.versionInfo.settings={emotionalArcs:[arc],storyMeanings:[meaning],workflowReceipt:'must not survive',model:'old-model'};
  D.approve(p,item.id);R.ensureDirecting(p);M.saveStoryMeanings(p,[meaning]);M.approveStoryMeanings(p);
  globalThis.metadataTestProject=p;
  return {p,item,parent};
}
const invoke=(itemId,data,action='addVariant')=>PATCH(new Request('http://local.test',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({revision:globalThis.metadataTestProject.revision,action,itemId,data})}),{params:Promise.resolve({id:globalThis.metadataTestProject.id})});
const edit=(itemId,data={})=>invoke(itemId,{title:'Edited',text:'The arrow crosses the last roof toward the forest.',kind:'text',...data});
const current=()=>globalThis.metadataTestProject;
const selected=itemId=>D.chosen(D.getItem(current(),itemId));

// Ordinary UI edits inherit only validated screenplay fields from the selected parent.
let {p,item,parent}=fixture();const parentBefore=structuredClone(parent),mapBefore=structuredClone(p.directing);
await edit(item.id);let v=selected(item.id);
assert.deepEqual(v.versionInfo.settings.emotionalArcs,[arc]);assert.deepEqual(v.versionInfo.settings.storyMeanings,[meaning]);
assert.deepEqual(v.versionInfo.settings.screenplayMetadataReview,{sourceVariantId:parent.id,fields:['emotionalArcs','storyMeanings'],required:true});
assert.equal(v.versionInfo.settings.workflowReceipt,undefined);assert.equal(v.versionInfo.settings.model,undefined);
assert.equal(D.getItem(current(),item.id).approvedId,parent.id,'A manual correction is not automatically approved');
assert.deepEqual(D.getItem(current(),item.id).variants[0],parentBefore);assert.deepEqual(current().directing,mapBefore,'The live map and approval are never rewritten by a candidate edit');
assert(M.storyMeaningsApproved(current()));
await invoke(item.id,undefined,'approve');assert(!M.storyMeaningsApproved(current()),'Approving a changed screenplay makes the old live map stale');
const pendingId=v.id;await edit(item.id,{text:v.text});v=selected(item.id);
assert.equal(v.versionInfo.settings.screenplayMetadataReview.required,true,'Copying the same text cannot clear an inherited advisory');
assert.equal(v.versionInfo.settings.screenplayMetadataReview.sourceVariantId,pendingId);

// Explicit parent wins over whichever variant happens to be selected in the UI.
({p,item,parent}=fixture());const other=D.addVariant(p,item.id,{title:'Other',kind:'text',text:'Other story'});
other.versionInfo.settings={emotionalArcs:[{...arc,character:'Other'}],storyMeanings:[{...meaning,id:'other'}]};
await edit(item.id,{parentVariantId:parent.id});v=selected(item.id);
assert.deepEqual(v.versionInfo.settings.storyMeanings,[meaning]);assert.equal(v.versionInfo.parentVariantId,parent.id);

// Native callers may explicitly replace both structured fields; they remain candidates.
const correctedArc={...arc,emotionEnd:'Determination'},correctedMeaning={...meaning,stakes:'He chooses to enter the forest'};
await edit(item.id,{screenplayMetadata:{emotionalArcs:[correctedArc],storyMeanings:[correctedMeaning]}});v=selected(item.id);
assert.deepEqual(v.versionInfo.settings,{emotionalArcs:[correctedArc],storyMeanings:[correctedMeaning]});assert.equal(v.screenplayMetadata,undefined);
assert.deepEqual(current().directing.storyMeanings,[meaning]);assert.equal(D.getItem(current(),item.id).approvedId,parent.id);
await edit(item.id,{text:'A revised third draft.',screenplayMetadata:{emotionalArcs:[]}});v=selected(item.id);
assert.deepEqual(v.versionInfo.settings.emotionalArcs,[]);assert.deepEqual(v.versionInfo.settings.storyMeanings,[correctedMeaning]);
assert.deepEqual(v.versionInfo.settings.screenplayMetadataReview.fields,['storyMeanings']);
await edit(item.id,{screenplayMetadata:{emotionalArcs:[],storyMeanings:[]}});assert.deepEqual(selected(item.id).versionInfo.settings,{emotionalArcs:[],storyMeanings:[]});

// Invalid explicit metadata and cross-stage usage fail before storing any change.
for(const screenplayMetadata of [{storyMeanings:[meaning,meaning]},{emotionalArcs:[{...arc,beats:[]}]},{emotionalArcs:null},{approved:true},{storyMeanings:[{...meaning,event:''}]}]){
  const before=structuredClone(current());await assert.rejects(()=>edit(item.id,{screenplayMetadata}));assert.deepEqual(current(),before);
}
const beforeInvalidStage=structuredClone(current());await assert.rejects(()=>edit(p.items.find(i=>i.stage===1).id,{screenplayMetadata:{storyMeanings:[]}}),/общего сценария/);assert.deepEqual(current(),beforeInvalidStage);
await assert.rejects(()=>edit(item.id,{kind:'image',screenplayMetadata:{storyMeanings:[]}}),/общего сценария/);assert.deepEqual(current(),beforeInvalidStage);
await assert.rejects(()=>edit(item.id,{parentVariantId:D.id()}),/Исходная версия/);assert.deepEqual(current(),beforeInvalidStage);

// Existing corrupt metadata is omitted; legacy text does not acquire invented structure.
({p,item,parent}=fixture());parent.versionInfo.settings={emotionalArcs:[{character:'broken'}],storyMeanings:[{...meaning,event:''}],workflowReceipt:'old'};
await edit(item.id);assert.equal(selected(item.id).versionInfo.settings,undefined);
({p,item,parent}=fixture());delete parent.versionInfo.settings;
await edit(item.id);assert.equal(selected(item.id).versionInfo.settings,undefined);
({p,item,parent}=fixture());await edit(item.id,{text:parent.text});assert.equal(selected(item.id).versionInfo.settings.screenplayMetadataReview,undefined,'An unchanged copy does not create a new advisory');
const sibling=D.addVariant(current(),item.id,{title:'Merge source',kind:'text',text:parent.text});
await edit(item.id,{text:parent.text,parentVariantId:parent.id,mergedFromIds:[parent.id,sibling.id]});assert.equal(selected(item.id).versionInfo.settings.screenplayMetadataReview.required,true,'Merging text requires checking inherited context');
console.log('PASS screenplay metadata API: exact-parent inheritance, validated explicit corrections and clearing, advisory provenance, stale-map protection, atomic rejection, and legacy compatibility. Mock store only.');
