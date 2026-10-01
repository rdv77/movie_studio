import {build} from 'esbuild';
import A from 'node:assert/strict';
const mock=`
export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:e.status??400})}};
export const owner=async req=>{if(req.headers.get('test-user')!=='owner')throw new HttpError('Unauthorized',401);return 'owner'};
export const loadProject=async(user,id)=>{if(user!=='owner'||id!==globalThis.voiceApiState.id)throw new HttpError('Not found',404);return structuredClone(globalThis.voiceApiState)};
export const saveProject=async(user,p,revision)=>{if(globalThis.voiceApiConflict){globalThis.voiceApiConflict=false;throw new HttpError('Revision',409)}if(revision!==voiceApiState.revision)throw new HttpError('Revision',409);p.revision++;globalThis.voiceApiState=structuredClone(p);return p};
export const getKey=async()=>{globalThis.voiceApiKeyReads++;return 'mock-secret'};
export const asset=async(user,id,p)=>{if(!p.items.some(i=>i.variants.some(v=>v.assetId===id)))throw new HttpError('Foreign asset',404);return {id,mime:'image/png',size:100}};
`;
await build({stdin:{resolveDir:process.cwd(),contents:`export * as D from './lib/domain';export * as V from './lib/voice-direction';export * as W from './lib/voice-design';export * as S from './lib/speech';export * as B from './lib/storyboard';export {projectAssetIds} from './lib/project-assets';export {POST as single} from './app/api/projects/[id]/generate/route';export {POST as batch} from './app/api/projects/[id]/generate-speech/route';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/voice-direction-api.mjs',plugins:[{name:'mock-server',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:mock}));}}]});
const {D,V,W,S,B,projectAssetIds,single,batch}=await import('../work/tests/voice-direction-api.mjs');
let groups=0;async function test(name,fn){await fn();groups++;console.log('PASS voice API:',name);}
const narration='Я заметил корону. Теперь помогу тебе.';
function fixture(withSpeechCards=false){
 const p=D.newProject('Голоса по планам');p.speechMode='plans';const shots=Array.from({length:10},(_,n)=>({title:`План ${n+1}`,description:'Герой у воды.',duration:5,camera:'Средний',continuity:'Прямая склейка',speechType:n===1?'character':'voiceover',speaker:n===1?'Петя':'Катя',dialogue:n===1?'Я увидел корону. Теперь помогу тебе.':narration}));
 for(const i of p.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){D.addVariant(p,i.id,{kind:'text',text:i.stage===4?JSON.stringify({shots}):'Основа'});D.approve(p,i.id);}
 B.preparePlanCards(p);for(const i of p.items.filter(i=>i.stage===5)){D.addVariant(p,i.id,{...D.chosen(i),id:undefined,kind:'image',assetId:D.id()});D.approve(p,i.id);}
 if(withSpeechCards)for(const row of S.speechPlans(p))p.items.push({id:D.id(),stage:6,title:row.title,sourceShot:{scriptId:row.scriptId,title:row.title,scriptVersion:row.scriptVersion,shotId:row.shotId,sceneId:row.sceneId},variants:[]});
 globalThis.voiceApiState=p;globalThis.voiceApiConflict=false;globalThis.voiceApiKeyReads=0;return p;
}
const request=(handler,body,user='owner',id=voiceApiState.id)=>handler(new Request('http://localhost',{method:'POST',headers:{'test-user':user},body:JSON.stringify(body)}),{params:Promise.resolve({id})});
function singleBody(p,row,extra={}){return {revision:p.revision,batchId:D.id(),itemId:row.item.id,models:['speech-2.8-hd'],count:1,prompt:'Озвучить реплику',refs:[],dialogue:`КАТЯ, ЗА КАДРОМ: ${narration}`,voiceId:'legacy-voice',speechType:'voiceover',speaker:'Катя',estimates:{'speech-2.8-hd':'10'},...extra};}
const batchBody=(p,rows,extra={})=>({revision:p.revision,batchId:D.id(),model:'speech-2.8-hd',voiceId:'legacy-voice',estimate:'10',plans:rows.map(r=>({frameId:r.frameId,dialogue:r.dialogue,speechType:r.speechType,speaker:r.speaker})),...extra});
globalThis.fetch=async()=>{throw Error('API queue tests never contact a provider');};
await test('single audio route freezes selected profile and delivery after removing technical speech labels',async()=>{
 const p=fixture(true),row=S.speechPlans(p)[0],profile=W.saveVoiceProfile(p,{name:'Рассказчик',description:'',provider:'minimax',voiceId:'designed-narrator',delivery:{speed:.9}}),before=p.items.map(i=>[i.id,i.selectedId,i.approvedId]);
 const response=await request(single,singleBody(p,row,{voiceId:'',profileId:profile.id,voiceDelivery:{emotion:'happy',speed:1.1,intention:'Добрая тайна',targetSeconds:5,pauses:[{after:'корону.',seconds:.4}]}}));A.equal(response.status,200,await response.clone().text());
 const j=voiceApiState.jobs[0];A.equal(j.voiceId,'designed-narrator');A.equal(j.voiceProfileId,profile.id);A.equal(j.dialogue,narration);A.equal(j.voiceDelivery.emotion,'happy');A(j.ttsRequestText.includes('<#0.40#>'));A(!j.ttsRequestText.includes('КАТЯ'));A(!j.prompt.includes('Добрая тайна'));A.deepEqual(voiceApiState.items.map(i=>[i.id,i.selectedId,i.approvedId]),before);
});
await test('batch route supports per-plan casting and delivery with atomic frozen overrides',async()=>{
 const p=fixture(),rows=S.speechPlans(p).slice(0,2),narrator=W.saveVoiceProfile(p,{name:'Рассказчик',description:'',provider:'minimax',voiceId:'narrator',delivery:{speed:1}}),actor=W.saveVoiceProfile(p,{name:'Петя',description:'',provider:'minimax',voiceId:'actor',characterId:p.items.find(i=>i.stage===1).id,delivery:{emotion:'surprised',speed:1.1}});
 const body=batchBody(p,rows,{voiceId:'',profileId:narrator.id,voiceDelivery:{speed:.9}});body.plans[1].profileId=actor.id;body.plans[1].voiceDelivery={emotion:'fearful',speed:1.05};const before=p.items.map(i=>[i.id,i.selectedId,i.approvedId]);
 const response=await request(batch,body);A.equal(response.status,200,await response.clone().text());const [a,b]=voiceApiState.jobs;A.equal(a.voiceId,'narrator');A.equal(b.voiceId,'actor');A.equal(a.voiceDelivery.speed,.9);A.equal(b.voiceDelivery.emotion,'fearful');A.equal(a.speechType,'voiceover');A.equal(b.speechType,'character');A.equal(b.speaker,'Петя');A(voiceApiState.items.filter(i=>i.stage===6).every(i=>!i.approvedId));A.deepEqual(voiceApiState.items.filter(i=>before.some(r=>r[0]===i.id)).map(i=>[i.id,i.selectedId,i.approvedId]),before);
 actor.voiceId='later';V.saveVoiceDelivery(voiceApiState,b.itemId,{speed:1.2});A.equal(b.voiceId,'actor');A.equal(b.voiceDelivery.speed,1.05);A.equal((await request(batch,body)).status,200,'Known batch returns existing state without re-queue');A.equal(voiceApiState.jobs.length,2);
});
await test('ownership, foreign profile, provider mismatch, bad pauses and revision reject the entire batch before dispatch',async()=>{
 for(const kind of ['foreign','provider','pause','missing','revision','owner','project','cas']){
  const p=fixture(),rows=S.speechPlans(p).slice(0,2),before=structuredClone(p);let extra={},user='owner',id=p.id;
  if(kind==='foreign')extra={profileId:D.id()};if(kind==='provider'){const profile=W.saveVoiceProfile(p,{name:'El',description:'',provider:'elevenlabs',voiceId:'v',delivery:{}});extra={profileId:profile.id};}
  if(kind==='pause')extra={voiceDelivery:{pauses:[{after:'несуществующие слова',seconds:.5}]}};if(kind==='missing')extra={voiceId:''};if(kind==='revision')extra={revision:-1};if(kind==='owner')user='other';if(kind==='project')id=D.id();if(kind==='cas')voiceApiConflict=true;
  const saved=structuredClone(p),response=await request(batch,batchBody(p,rows,extra),user,id);A.notEqual(response.status,200,kind);A.deepEqual(voiceApiState,saved,kind+' must not admit partial jobs');A.equal(voiceApiState.jobs.length,0);A.equal(before.jobs.length,0);
 }
});
await test('single multi-provider comparison with one incompatible profile has no partial queue',async()=>{
 const p=fixture(true),row=S.speechPlans(p)[0],profile=W.saveVoiceProfile(p,{name:'MM',description:'',provider:'minimax',voiceId:'mm',delivery:{}}),before=structuredClone(p);
 const response=await request(single,singleBody(p,row,{models:['speech-2.8-hd','eleven_v3'],profileId:profile.id,estimates:{'speech-2.8-hd':'10',eleven_v3:'10'}}));A.equal(response.status,400);A.deepEqual(voiceApiState,before);
});
await test('legacy route bodies remain unmarked and retain prior Voice ID',async()=>{
 let p=fixture(),rows=S.speechPlans(p).slice(0,1);let response=await request(batch,batchBody(p,rows));A.equal(response.status,200);A.equal(voiceApiState.jobs[0].voiceDelivery,undefined);A.equal(voiceApiState.jobs[0].ttsRequestText,undefined);A.equal(voiceApiState.jobs[0].voiceId,'legacy-voice');A.equal(voiceApiState.jobs[0].prompt,narration);
 p=fixture(true);response=await request(single,singleBody(p,S.speechPlans(p)[0]));A.equal(response.status,200);A.equal(voiceApiState.jobs[0].voiceDelivery,undefined);A.equal(voiceApiState.jobs[0].voiceId,'legacy-voice');
});
await test('saved plan casting wins batch default; explicit row profile wins casting; chosen profile updates legacy dialog defaults',async()=>{
 const p=fixture(true),rows=S.speechPlans(p).slice(0,2),profiles=['Общий','Герой','Явный вариант'].map((name,n)=>W.saveVoiceProfile(p,{name,description:'',provider:'minimax',voiceId:'voice-'+n,delivery:{speed:1+n*.05}}));
 W.chooseVoiceProfile(p,profiles[0].id);A.deepEqual(p.preferredVoice,{model:'speech-2.8-hd',voiceId:'voice-0',name:'Общий'});for(const row of rows)W.assignVoiceProfile(p,row.item.id,profiles[1].id);
 const body=batchBody(p,rows,{profileId:profiles[0].id});body.plans[1].profileId=profiles[2].id;const response=await request(batch,body);A.equal(response.status,200,await response.clone().text());A.equal(voiceApiState.jobs[0].voiceId,'voice-1');A.equal(voiceApiState.jobs[0].voiceDelivery.speed,1.05);A.equal(voiceApiState.jobs[1].voiceId,'voice-2');A.equal(voiceApiState.jobs[1].voiceDelivery.speed,1.1);A(voiceApiState.items.filter(i=>i.stage===6).every(i=>!i.approvedId));
});
await test('asset membership preserves current, removed and late previews, never uses external voice identifiers',async()=>{
 const p=fixture(),s=V.voiceStudio(p);s.designs.push({id:D.id(),provider:'minimax',name:'Series',description:'',previewText:'Text',model:'minimax-voice-design',created:D.now(),jobIds:[],previews:[{id:D.id(),assetId:'design-preview',generatedVoiceId:'external-voice',mime:'audio/mpeg'}],removedAt:D.now()});
 s.profiles.push({id:D.id(),provider:'minimax',name:'Profile',description:'',voiceId:'external-saved-voice',created:D.now(),delivery:{},previewAssetId:'profile-preview',removedAt:D.now()});W.queueVoiceDesign(p,D.id(),{provider:'minimax',name:'Late',description:'Тёплый голос',previewText:'Проба'});const j=voiceApiState.jobs[0];j.voiceWorkflow.previews=[{id:D.id(),assetId:'late-preview',generatedVoiceId:'external-late-voice',mime:'audio/mpeg'}];j.voiceWorkflow.late=true;
 const ids=projectAssetIds(p);for(const file of ['design-preview','profile-preview','late-preview'])A(ids.has(file));for(const voice of ['external-voice','external-saved-voice','external-late-voice'])A(!ids.has(voice));const other=D.newProject('Другой фильм');for(const file of ['design-preview','profile-preview','late-preview'])A(!projectAssetIds(other).has(file));
});
console.log(`PASS ${groups} real voice queue route/asset-membership mock groups. No paid requests.`);
