import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const entries=['lib/domain.ts','lib/storyboard.ts','lib/characters.ts','lib/prompt-compiler.ts','lib/storyboard-image-prompt.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-storyboard/route.ts'];
await build({entryPoints:entries,bundle:true,platform:'node',format:'esm',outdir:'work/tests/storyboard-image-prompt',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'memory',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,rev)=>{if(rev!==state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const getKey=async()=> 'unused-test';export const asset=async(_,id)=>({id,mime:'image/png',size:100});`}));}}]});
const root='../work/tests/storyboard-image-prompt/',D=await import(root+'lib/domain.mjs'),S=await import(root+'lib/storyboard.mjs'),C=await import(root+'lib/characters.mjs'),PC=await import(root+'lib/prompt-compiler.mjs'),P=await import(root+'lib/storyboard-image-prompt.mjs'),G=await import(root+'app/api/projects/[id]/generate/route.mjs'),B=await import(root+'app/api/projects/[id]/generate-storyboard/route.mjs');
const p=D.newProject('Компактная раскадровка'),durations=[6,4,4,5,4,5,6,4,4,4,4];
const shots=durations.map((duration,n)=>({title:`План ${n+1}`,cast:['Петя'],duration,description:`ДЕЙСТВИЕ_${n}: `+'Прогулка у моря. '.repeat(190),camera:'Крупный план, наезд',continuity:'Переход на стоящего справа героя',dialogue:n===0?'Привет!':'Закадровая речь',speechType:n===0?'character':'voiceover',speaker:n===0?'Петя':'Катя'}));
const hero={name:'Петя',appearance:'Рыжие волосы, зелёная рубашка',description:'Смелый и любопытный',instructions:'Сохрани веснушки',refs:[D.id()]};
for(const item of p.items.filter(i=>i.stage<=4).sort((a,b)=>D.stagePosition(a.stage)-D.stagePosition(b.stage))){
  const data=item.stage===0?{text:'ОБЩИЙ_СЦЕНАРИЙ '+'Длинный сюжет. '.repeat(5000)}:item.stage===1?{kind:'image',assetId:D.id(),text:'Образ',character:structuredClone(hero)}:item.stage===2?{text:'УТВЕРЖДЁННЫЙ_СТИЛЬ: тёплая гуашь, мягкий вечерний свет.'}:item.stage===3?{kind:'image',assetId:D.id(),text:'НЕВЫБРАННАЯ_ЛОКАЦИЯ'}:{text:JSON.stringify({shots})};
  D.addVariant(p,item.id,data);D.approve(p,item.id);
}
S.preparePlanCards(p);const frames=p.items.filter(i=>i.stage===5),frame=frames[0],style=p.items.find(i=>i.stage===2),location=p.items.find(i=>i.stage===3);
p.items.find(i=>i.stage===1).character={...hero,name:'НЕУТВЕРЖДЁННЫЙ',appearance:'Синие волосы'};
p.jobs.push({id:D.id(),itemId:frame.id,status:'done',actual:'987654321',prompt:'ПРЕЖНИЙ_ЗАПРОС '.repeat(10000)});
const refs=C.characterImageRefs(p,frame,[]),task=S.storyboardPrompt(p,frame),request=P.storyboardImageRequest(p,frame,task,refs);
assert(D.promptFor(p,frame,task,D.chosen(frame)).length>32000,'Reproduce previous hidden overflow');
assert(request.length<10000);assert(request.prompt.includes('УТВЕРЖДЁННЫЙ_СТИЛЬ'));assert(request.prompt.includes(hero.appearance));assert(request.prompt.includes(hero.description));assert(request.prompt.includes(hero.instructions));assert(request.prompt.includes('Изображение 1: Петя'));assert(request.prompt.includes('ДЕЙСТВИЕ_0'));assert(!request.prompt.includes('ДЕЙСТВИЕ_10'));
for(const absent of ['ОБЩИЙ_СЦЕНАРИЙ','НЕВЫБРАННАЯ_ЛОКАЦИЯ','ПРЕЖНИЙ_ЗАПРОС','НЕУТВЕРЖДЁННЫЙ',hero.refs[0],style.approvedId,'987654321','"deps"'])assert(!request.prompt.includes(absent),absent);
assert(P.storyboardImageRequest(p,frame,task,[D.chosen(location).assetId,...refs]).prompt.includes('Изображение 2: Петя'));
assert(P.storyboardImageRequest(p,frame,task,[D.chosen(location).assetId,...refs]).prompt.includes('НЕВЫБРАННАЯ_ЛОКАЦИЯ'));
const manual='Авторская правка: добавить красный мяч в руку.';
assert(P.storyboardImageRequest(p,frame,manual,refs).prompt.includes(D.chosen(frame).text));assert.equal(P.storyboardImageRequest(p,frame,manual,refs).prompt.split(manual).length-1,1);
const copied=structuredClone(p),copyFrame=copied.items.find(i=>i.id===frame.id);D.addVariant(copied,copyFrame.id,{...S.planFields(p,frame,D.chosen(frame)),kind:'image',assetId:D.id(),text:task});
assert.equal(S.storyboardPrompt(copied,copyFrame),task,'Editing/saving a generated task must not nest prompt wrappers');
assert.equal(P.storyboardImageRequest(copied,copyFrame,task,refs).length,request.length);
const editedImage=D.chosen(copyFrame);editedImage.camera='НОВАЯ_КАМЕРА';editedImage.continuity='НОВЫЙ_СТЫК';editedImage.duration=5.5;editedImage.text+='\nАвторское дополнение после задачи.';
const editedTask=S.storyboardPrompt(copied,copyFrame),editedRequest=P.storyboardImageRequest(copied,copyFrame,editedTask,refs);
assert(editedTask.includes('НОВАЯ_КАМЕРА'));assert(editedTask.includes('НОВЫЙ_СТЫК'));assert(!editedTask.includes(shots[0].camera));assert(!editedTask.includes(shots[0].continuity));assert(editedTask.includes('Авторское дополнение после задачи.'));assert(editedRequest.prompt.includes('5.5 сек'));
const ctx={params:Promise.resolve({id:p.id})},req=b=>new Request('http://localhost',{method:'POST',body:JSON.stringify(b)});
const single={revision:p.revision,batchId:D.id(),itemId:frame.id,models:['gpt-image-2.5-sunburst'],count:1,prompt:task,refs,dialogue:'',voiceId:'',estimates:{}};
const batch={revision:p.revision,batchId:D.id(),model:'gpt-image-2.5-sunburst',refs,estimate:null,plans:frames.map(i=>({itemId:i.id,prompt:S.storyboardPrompt(p,i)}))};
const assertCompiled=(job,action='ДЕЙСТВИЕ_0',camera=shots[0].camera)=>{
  assert(job.compilation,'New image requests carry the common compiler snapshot');
  assert.equal(job.compilation.budget.compiledCharacters,job.prompt.length);
  assert(job.prompt.length<=PC.promptModelCapability(job.model).promptLimit);
  assert(job.prompt.includes(action));assert(job.prompt.includes(camera));
  assert(job.prompt.includes(hero.appearance));assert(job.prompt.includes(hero.instructions));
  assert(job.prompt.includes('УТВЕРЖДЁННЫЙ_СТИЛЬ'));assert.match(job.prompt,/рты всех персонажей закрыты/);
  for(const absent of ['ОБЩИЙ_СЦЕНАРИЙ','ПРЕЖНИЙ_ЗАПРОС','НЕУТВЕРЖДЁННЫЙ','987654321','"deps"'])assert(!job.prompt.includes(absent),absent);
};
globalThis.state=structuredClone(p);const zenBatchResponse=await B.POST(req({...batch,model:'zencreator:image:SEEDREAM_5_PRO'}),ctx);
assert.equal(zenBatchResponse.status,200,await zenBatchResponse.clone().text());assert.equal(state.jobs.length,p.jobs.length+11);
assert(state.jobs.slice(p.jobs.length).every(j=>j.zenCreditsEstimate===3&&j.actual===null&&j.estimate===null));
assert.deepEqual(state.jobs[p.jobs.length].refs,refs);assertCompiled(state.jobs[p.jobs.length]);assert.deepEqual(state.items,p.items);
for(const route of [G,B]){
 globalThis.state=structuredClone(copied);const response=await route.POST(req(route===G?{...single,prompt:editedTask}:{...batch,plans:[{itemId:copyFrame.id,prompt:editedTask}]}),ctx);
 assert.equal(response.status,200,await response.clone().text());assertCompiled(state.jobs.at(-1),'ДЕЙСТВИЕ_0','НОВАЯ_КАМЕРА');
 assert(state.jobs.at(-1).prompt.includes('Авторское дополнение после задачи.'),'Appended manual notes must remain mandatory');
 assert(state.jobs.at(-1).prompt.includes('НОВЫЙ_СТЫК'));
}
globalThis.state=structuredClone(p);let response=await G.POST(req(single),ctx);assert.equal(response.status,200,await response.clone().text());assertCompiled(state.jobs.at(-1));
globalThis.state=structuredClone(p);response=await B.POST(req(batch),ctx);assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.length,p.jobs.length+11);
for(const [n,job] of state.jobs.slice(p.jobs.length).entries())assertCompiled(job,`ДЕЙСТВИЕ_${n}`);
assert.deepEqual(state.items,p.items,'Queued generation leaves all cards/approvals intact');
// A short legacy adapter cannot silently cut the approved action or identity.
for(const route of [G,B]){
 globalThis.state=structuredClone(p);const input=route===G?{...single,models:['image-01']}:{...batch,model:'image-01',estimate:'35000000'};
 response=await route.POST(req(input),ctx);assert.equal(response.status,400);assert.match((await response.json()).error,/Обязательная постановка/);assert.deepEqual(state,p);
}
// Optional style paragraphs are excluded whole with a report; mandatory descriptions block atomically.
const optional=structuredClone(p);D.chosen(optional.items.find(i=>i.id===style.id)).text='x'.repeat(33000);
globalThis.state=optional;response=await G.POST(req(single),ctx);assert.equal(response.status,200,await response.clone().text());
assert(state.jobs.at(-1).compilation.compression.omitted.some(x=>x.reason==='budget'&&x.key.startsWith('style.')));
assert(!state.jobs.at(-1).prompt.includes('xxxxx'),'No silent substring of the oversized optional paragraph');
const mandatory=structuredClone(p);D.chosen(mandatory.items.find(i=>i.stage===1)).character.appearance='НЕОБХОДИМАЯ ВНЕШНОСТЬ '.repeat(1800);
for(const route of [G,B]){globalThis.state=structuredClone(mandatory);response=await route.POST(req(route===G?single:{...batch,plans:[batch.plans[0]]}),ctx);assert.equal(response.status,400);assert.match((await response.json()).error,/Обязательная постановка/);assert.deepEqual(state,mandatory);}
globalThis.state=structuredClone(p);response=await B.POST(req({...batch,plans:[batch.plans[0],{itemId:frames[1].id,prompt:'x'.repeat(19999)}],model:'fal-qwen-image-edit-2511'}),ctx);
assert.equal(response.status,400);assert.deepEqual(state,p,'One oversized manual task must not partially enqueue earlier rows');
const falModel='fal-qwen-image-edit-2511';
globalThis.state=structuredClone(p);response=await G.POST(req({...single,models:[falModel],estimates:{[falModel]:'300000000'}}),ctx);
assert.equal(response.status,200,await response.clone().text());assertCompiled(state.jobs.at(-1));assert.deepEqual(state.jobs.at(-1).refs,refs);assert.equal(state.jobs.at(-1).estimate,'300000000');assert.equal(state.jobs.at(-1).actual,null);
globalThis.state=structuredClone(p);response=await B.POST(req({...batch,model:falModel,estimate:'300000000'}),ctx);assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.length,p.jobs.length+11);assertCompiled(state.jobs[p.jobs.length]);assert.deepEqual(state.items,p.items);
response=await B.POST(req({...batch,model:falModel,estimate:'300000000'}),ctx);assert.equal(response.status,200);assert.equal(state.jobs.length,p.jobs.length+11,'Same fal batch remains idempotent');
globalThis.state=structuredClone(p);state.limit='1';response=await B.POST(req({...batch,model:falModel,estimate:'300000000'}),ctx);assert.equal(response.status,400);assert.equal(state.jobs.length,p.jobs.length,'Fal series respects budget atomically');
console.log('PASS storyboard compiler APIs: current action, manual camera/notes, approved identity/style/mouth, per-model budgets/ref order, whole-paragraph optional omissions, mandatory overflow rejection, atomic single/bulk validation, immutable approvals, costs and idempotency. Legacy pure helper compatibility retained. No paid calls.');
