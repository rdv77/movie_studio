import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const server=`
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};
export const owner=async req=>{if(req.headers.get('test-owner')!=='owner')throw new Error('Unauthorized');return 'owner'};
export const loadProject=async()=>structuredClone(globalThis.state);
export const saveProject=async(user,p,revision)=>{if(revision!==globalThis.state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};
export const mutate=async(user,id,fn)=>{const p=structuredClone(globalThis.state);fn(p);return saveProject(user,p,p.revision)};
export const getKey=async()=> 'test-key';
export const asset=async(user,id)=>{const a=globalThis.assets.get(id);if(!a)throw new Error('Foreign asset');return a};
export const imageData=async(user,id)=>{await asset(user,id);return 'data:image/png;base64,'+id};
export const storeAsset=async(user,id,name,mime,bytes)=>{globalThis.assets.set(id,{id,name,mime,size:bytes.length});return id};
export const runtime={FILES:{get:async()=>new Blob(['media'])}};
`;
const entries=['lib/domain.ts','lib/characters.ts','lib/providers.ts','app/api/projects/[id]/route.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-storyboard/route.ts','app/api/projects/[id]/generate-remaining/route.ts','app/api/projects/[id]/jobs/[jobId]/route.ts'];
await build({entryPoints:entries,bundle:true,platform:'node',format:'esm',outdir:'work/tests/characters',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'server',setup(b){
 b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));
}}]});
const D=await import('../work/tests/characters/lib/domain.mjs'),C=await import('../work/tests/characters/lib/characters.mjs');
const {PATCH:patch}=await import('../work/tests/characters/app/api/projects/[id]/route.mjs');
const {POST:generate}=await import('../work/tests/characters/app/api/projects/[id]/generate/route.mjs');
const {POST:storyboard}=await import('../work/tests/characters/app/api/projects/[id]/generate-storyboard/route.mjs');
const {POST:remaining}=await import('../work/tests/characters/app/api/projects/[id]/generate-remaining/route.mjs');
const {POST:tick}=await import('../work/tests/characters/app/api/projects/[id]/jobs/[jobId]/route.mjs');
const P=await import('../work/tests/characters/lib/providers.mjs');
const req=(data,user='owner')=>new Request('https://site.test/api',{method:'POST',headers:{'content-type':'application/json','test-owner':user},body:JSON.stringify(data)});
globalThis.assets=new Map();
function image(){const id=D.id();assets.set(id,{id,mime:'image/png',size:100});return id;}
const photo=image(),approvedImage=image(),extra=image(),firstFrame=image();
const profile={name:'Катя',appearance:'Рыжие косы, веснушки, красный галстук',description:'Смелая и внимательная, ведёт друзей в поход.',instructions:'Сохрани лицо, нарисуй в стиле гуашевой анимации.',refs:[photo]};
globalThis.state=D.newProject('Герои');const ctx={params:Promise.resolve({id:state.id})};
const save={revision:0,action:'saveCharacter',data:{profile}};
assert.equal((await patch(req(save,'other'),ctx)).status,400);
assert.equal((await patch(req({...save,data:{profile:{...profile,refs:[D.id()]}}}),ctx)).status,400);
assert.equal((await patch(req(save),ctx)).status,200);
assert.equal(state.items.length,9,'Empty character placeholder is reused');assert.deepEqual(state.items[1].character,profile);
assert.equal(state.items[1].approvedId,undefined);assert.equal(state.items[1].variants.length,0,'Draft can be saved before screenplay approval');
const shots=Array.from({length:10},(_,n)=>({title:'План '+(n+1),description:'Катя помогает другу.',duration:5,camera:'Средний план',continuity:'Прямая склейка',dialogue:'Привет'}));
for(const item of state.items.filter(i=>i.stage<7)) {
 if(item.stage>=5)item.sourceShot={scriptId:state.items[4].id,title:'План 1'};
 D.addVariant(state,item.id,{kind:[1,3,5].includes(item.stage)?'image':item.stage===6?'audio':'text',assetId:item.stage===1?approvedImage:item.stage>=3&&item.stage!==4?firstFrame:undefined,
  text:item.stage===4?JSON.stringify({shots}):'Утверждённая основа',character:item.stage===1?structuredClone(profile):undefined,duration:5});
 D.approve(state,item.id);
}
state.items[7].sourceShot={scriptId:state.items[4].id,title:'План 1'};
const baseline=structuredClone(state),hero=state.items[1],frame=state.items[5],video=state.items[7];
assert.deepEqual(C.characterImageRefs(state,frame,[approvedImage,extra]),[approvedImage,extra]);
assert.deepEqual(C.characterImageRefs(state,hero,[]),[photo]);
assert.match(C.characterReferenceNote(state,[extra,approvedImage]),/Изображение 2: Катя/);
const oldIdentity=C.withCharacterIdentity(state,'План');state.items[1].character.appearance='Синие волосы';
assert.equal(C.withCharacterIdentity(state,'План'),oldIdentity,'Unapproved draft edits never replace approved identity');
assert.equal(D.stageReady(state,7),true);
state.items[1].title='Анна';state.items[1].character.name='Анна';
assert.doesNotMatch(D.promptFor(state,state.items[4],'Напиши сценарий'),/"material":"Анна"/,'Draft names must not leak into the approved context');
const described=structuredClone(baseline);D.chosen(described.items[1]).character.appearance='';
assert.match(C.withCharacterIdentity(described,'План'),/Смелая и внимательная/,'Text-only brief remains in video identity when the short appearance is omitted');
const nextHero=D.addVariant(state,hero.id,{kind:'image',assetId:extra,text:'Новый образ',character:structuredClone(state.items[1].character)});
assert.equal(C.withCharacterIdentity(state,'План'),oldIdentity,'Selecting a new image does not approve it');
D.approve(state,hero.id);assert.equal(D.stageReady(state,7),false,'Approving new identity invalidates downstream materials');
assert.match(C.withCharacterIdentity(state,'План'),/Синие волосы/);
state=structuredClone(baseline);D.addVariant(state,hero.id,{kind:'text',text:'Только описание',character:profile});assert.throws(()=>D.approve(state,hero.id),/изображение/);
const input=(itemId,model,refs=[])=>({revision:state.revision,batchId:D.id(),itemId,models:[model],count:1,prompt:'Создай вариант',refs,dialogue:'',voiceId:'',estimates:{[model]:'900000000'}});
state=structuredClone(baseline);let data=input(hero.id,'grok-imagine-image-2.0');assert.equal((await generate(req(data),ctx)).status,200);
let job=state.jobs[0];assert.deepEqual(job.refs,[photo]);assert.deepEqual(job.character,profile);assert.match(job.prompt,/Сохрани лицо/);
let sent=[];globalThis.fetch=async(url,options)=>{sent.push({url,body:options?.body?JSON.parse(options.body):null});return url.startsWith('https://api.x.ai')?Response.json({data:[{url:'https://assets.example/result.png'}]}):new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})};
await tick(req({}),{params:Promise.resolve({id:state.id,jobId:job.id})});assert.equal(state.jobs[0].status,'done');
assert.deepEqual(sent[0].body.image,{url:'data:image/png;base64,'+photo,type:'image_url'});
assert.deepEqual(state.items[1].variants.at(-1).character,profile);assert.equal(state.items[1].approvedId,baseline.items[1].approvedId,'New generated portrait requires director approval');
state=structuredClone(baseline);assert.equal((await generate(req(input(frame.id,'grok-imagine-image-2.0',[extra])),ctx)).status,200);
assert.deepEqual(state.jobs[0].refs,[approvedImage,extra]);assert.match(state.jobs[0].prompt,/Изображение 1: Катя/);assert.match(state.jobs[0].prompt,/Смелая и внимательная/);
const batch={revision:baseline.revision,batchId:D.id(),model:'grok-imagine-image-2.0',refs:[extra],estimate:'600000000',plans:[{itemId:frame.id,prompt:'Сцена у моря'}]};
state=structuredClone(baseline);assert.equal((await storyboard(req(batch),ctx)).status,200);assert.deepEqual(state.jobs[0].refs,[approvedImage,extra]);
assert.match(state.jobs[0].prompt,/Катя/);
const crowded=structuredClone(baseline);for(let n=0;n<5;n++){const item={id:D.id(),stage:1,title:'Герой '+n,character:{...profile,name:'Герой '+n},variants:[]};crowded.items.push(item);D.addVariant(crowded,item.id,{kind:'image',assetId:image(),text:'Образ',character:item.character});D.approve(crowded,item.id);}
for(const i of crowded.items.filter(i=>i.stage>1&&i.stage<7)){D.chosen(i).deps=D.dependencies(crowded,i.stage);}
state=structuredClone(crowded);const denied=await generate(req(input(frame.id,'grok-imagine-image-2.0')),ctx);assert.equal(denied.status,400);assert.match((await denied.json()).error,/6 референсов/);assert.equal(state.jobs.length,0);
state=structuredClone(baseline);assert.equal((await generate(req(input(video.id,'grok-imagine-video-1.5',[firstFrame])),ctx)).status,200);
job=state.jobs[0];assert.deepEqual(job.refs,[firstFrame]);assert.deepEqual(job.characterRefs,[approvedImage]);assert.match(job.prompt,/Рыжие косы/);
sent=[];globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({request_id:'video-receipt',task_id:'minimax-receipt'})};
await P.generate(job,'key',['data:first'],'16:9',['data:hero']);assert.deepEqual(sent[0].image,{url:'data:first'});assert.deepEqual(sent[0].reference_images,[{url:'data:hero'}]);
await P.generate({...job,model:'MiniMax-Hailuo-2.3'},'key',['data:first'],'16:9',[]);assert.equal(sent[1].first_frame_image,'data:first');assert.equal(sent[1].reference_images,undefined);
state=structuredClone(baseline);const long=await generate(req({...input(video.id,'MiniMax-Hailuo-2.3',[firstFrame]),prompt:'a'.repeat(1990)}),ctx);assert.equal(long.status,400);assert.equal(state.jobs.length,0,'Combined mandatory identity counts against provider limit before charging');
state=structuredClone(baseline);D.addVariant(state,video.id,{kind:'video',assetId:firstFrame,text:'Ролик',model:'grok-imagine-video-1.5'});D.approve(state,video.id);
const remainingItem={id:D.id(),stage:7,title:'План 2',sourceShot:{scriptId:state.items[4].id,title:'План 2'},variants:[]};state.items.push(remainingItem);
assert.equal((await remaining(req({revision:state.revision,batchId:D.id(),sourceItemId:video.id,sourceVariantId:D.chosen(state.items[7]).id,estimate:'8600000000',plans:[{itemId:remainingItem.id,ref:firstFrame,prompt:'Катя идёт к морю.'}]}),ctx)).status,200);
assert.deepEqual(state.jobs[0].characterRefs,[approvedImage]);assert.match(state.jobs[0].prompt,/Рыжие косы/);
console.log('PASS character workflow: owned photo/text drafts, immutable approved profiles, portrait generation snapshots, automatic single/batch references, Grok video reference_images, MiniMax first frame, reference/prompt limits before billing, and downstream reapproval. Zero paid calls.');

// Explicit empty selection is different from legacy requests with no selection.
const remainingBase=structuredClone(state);remainingBase.jobs=[];
const remainingInput=()=>({revision:state.revision,batchId:D.id(),sourceItemId:video.id,sourceVariantId:D.chosen(state.items.find(i=>i.id===video.id)).id,estimate:'8500000000',plans:[{itemId:remainingItem.id,ref:firstFrame,prompt:'Пейзаж у моря.'}]});
for(const ids of [[],[hero.id]]){
 state=structuredClone(remainingBase);const res=await remaining(req({...remainingInput(),characterIds:ids}),ctx);assert.equal(res.status,200,await res.clone().text());
 const j=state.jobs[0];assert.deepEqual(j.characterIds,ids);assert.deepEqual(j.characterRefs??[],ids.length?[approvedImage]:[]);
 assert.equal(j.prompt.includes('Рыжие косы'),!!ids.length);assert.deepEqual(j.refs,[firstFrame]);
}
const allHeroes=C.approvedCharacters(crowded),picked=allHeroes[1];
for(const model of ['grok-imagine-video-1.5','MiniMax-Hailuo-2.3'])for(const ids of [[],[picked.itemId]]){
 state=structuredClone(crowded);const initial=structuredClone(state.items);
 const res=await generate(req({...input(video.id,model,[firstFrame]),characterIds:ids}),ctx);assert.equal(res.status,200,await res.clone().text());
 const j=state.jobs[0];assert.deepEqual(j.characterIds,ids);assert.deepEqual(j.refs,[firstFrame]);assert.deepEqual(state.items,initial,'Exclusion never removes a hero or changes approvals');
 assert.equal(j.prompt.includes('Постоянные герои:'),!!ids.length);
 assert(!j.prompt.includes('Катя:'),'Unselected identity excluded from automatic prompt');
 assert.equal(j.prompt.includes(picked.profile.name+':'),!!ids.length);
 assert.deepEqual(j.characterRefs??[],model.startsWith('grok')&&ids.length?[picked.assetId]:[]);
}
for(const ids of [[D.id()],[hero.id,hero.id],[frame.id]]){
 state=structuredClone(baseline);const res=await generate(req({...input(video.id,'grok-imagine-video-1.5',[firstFrame]),characterIds:ids}),ctx);assert.equal(res.status,400);assert.equal(state.jobs.length,0);
 state=structuredClone(remainingBase);const batchRes=await remaining(req({...remainingInput(),characterIds:ids}),ctx);assert.equal(batchRes.status,400);assert.equal(state.jobs.length,0);
}
state=structuredClone(baseline);const explicit={...input(video.id,'grok-imagine-video-1.5',[firstFrame]),characterIds:[]};
assert.equal((await generate(req({...explicit,revision:-1}),ctx)).status,400);assert.equal(state.jobs.length,0);
assert.equal((await generate(req(explicit,'other'),ctx)).status,400);assert.equal(state.jobs.length,0);
assert.equal((await generate(req(explicit),ctx)).status,200);const selectedJob=state.jobs[0];
assert.equal((await generate(req(explicit),ctx)).status,200);assert.equal(state.jobs.length,1,'Retry does not create a second series');
selectedJob.status='saving';selectedJob.output={url:'https://assets.example/result.mp4',mime:'video/mp4'};
globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
await tick(req({}),{params:Promise.resolve({id:state.id,jobId:selectedJob.id})});
assert.equal(state.jobs[0].status,'done',state.jobs[0].error);
assert.deepEqual(state.items.find(i=>i.id===video.id).variants.at(-1).characterIds,[],'Saved result preserves explicit empty selection');
console.log('PASS video hero selection: one/none/legacy, prompt and provider refs agree, first frame and approvals preserved, remaining batch, persistence, stale/foreign/duplicate selection validation and idempotency.');
