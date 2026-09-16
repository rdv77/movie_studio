import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const entries=['lib/domain.ts','lib/storyboard.ts','lib/characters.ts','lib/storyboard-image-prompt.ts','app/api/projects/[id]/generate/route.ts','app/api/projects/[id]/generate-storyboard/route.ts'];
await build({entryPoints:entries,bundle:true,platform:'node',format:'esm',outdir:'work/tests/storyboard-image-prompt',outbase:'.',outExtension:{'.js':'.mjs'},plugins:[{name:'memory',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,rev)=>{if(rev!==state.revision)throw new Error('revision');p.revision++;globalThis.state=structuredClone(p);return p};export const getKey=async()=> 'unused-test';export const asset=async(_,id)=>({id,mime:'image/png',size:100});`}));}}]});
const root='../work/tests/storyboard-image-prompt/',D=await import(root+'lib/domain.mjs'),S=await import(root+'lib/storyboard.mjs'),C=await import(root+'lib/characters.mjs'),P=await import(root+'lib/storyboard-image-prompt.mjs'),G=await import(root+'app/api/projects/[id]/generate/route.mjs'),B=await import(root+'app/api/projects/[id]/generate-storyboard/route.mjs');
const p=D.newProject('Компактная раскадровка'),durations=[6,4,4,5,4,5,6,4,4,4,4];
const shots=durations.map((duration,n)=>({title:`План ${n+1}`,duration,description:`ДЕЙСТВИЕ_${n}: `+'Прогулка у моря. '.repeat(190),camera:'Крупный план, наезд',continuity:'Переход на стоящего справа героя',dialogue:n===0?'Привет!':'Закадровая речь',speechType:n===0?'character':'voiceover',speaker:n===0?'Петя':'Катя'}));
const hero={name:'Петя',appearance:'Рыжие волосы, зелёная рубашка',description:'Смелый и любопытный',instructions:'Сохрани веснушки',refs:[D.id()]};
for(const item of p.items.filter(i=>i.stage<=4)){
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
globalThis.state=structuredClone(copied);let editedResponse=await G.POST(req({...single,prompt:editedTask}),ctx);assert.equal(editedResponse.status,200);assert.equal(state.jobs.at(-1).prompt,editedRequest.prompt);
globalThis.state=structuredClone(copied);editedResponse=await B.POST(req({...batch,plans:[{itemId:copyFrame.id,prompt:editedTask}]}),ctx);assert.equal(editedResponse.status,200);assert.equal(state.jobs.at(-1).prompt,editedRequest.prompt);
globalThis.state=structuredClone(p);let response=await G.POST(req(single),ctx);assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.at(-1).prompt,request.prompt);
globalThis.state=structuredClone(p);response=await B.POST(req(batch),ctx);assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.length,p.jobs.length+11);assert.equal(state.jobs[p.jobs.length].prompt,request.prompt);assert(state.jobs.slice(p.jobs.length).every(j=>j.prompt.length<10000));assert.deepEqual(state.items,p.items,'Queued generation leaves all cards/approvals intact');
// MiniMax has its own compact, visible request; other model prompts remain intact.
const mini=P.storyboardImageRequest(p,frame,task,refs,1,1,'image-01');
assert(mini.length<=1500);assert(mini.prompt.includes('ДЕЙСТВИЕ_0'));assert(mini.prompt.includes('Крупный план'));assert(mini.prompt.includes('УТВЕРЖДЁННЫЙ_СТИЛЬ'));assert(mini.prompt.includes('Референс 1'));assert(mini.prompt.includes('Говорит Петя'));assert(!mini.prompt.includes('ДЕЙСТВИЕ_10'));
assert.equal(P.storyboardImagePromptIssue(mini,'image-01',frame.title),'');
globalThis.state=structuredClone(p);response=await G.POST(req({...single,models:['image-01','gpt-image-2.5-sunburst']}),ctx);
assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.at(-2).prompt,mini.prompt);assert.equal(state.jobs.at(-1).prompt,request.prompt);
assert.deepEqual(state.jobs.at(-2).refs,refs);assert.deepEqual(state.items,p.items);
globalThis.state=structuredClone(p);response=await B.POST(req({...batch,model:'image-01',estimate:'35000000'}),ctx);
assert.equal(response.status,200,await response.clone().text());assert.equal(state.jobs.length,p.jobs.length+11);assert.equal(state.jobs[p.jobs.length].prompt,mini.prompt);
assert(state.jobs.slice(p.jobs.length).every(j=>j.prompt.length<=1500&&j.estimate==='35000000'&&j.actual===null));
assert(state.jobs[p.jobs.length+1].prompt.includes('закрыты рты'));
// Exact final limits, after adding all context, reference notes and speech rules.
const boundary=structuredClone(p),boundaryStyle=D.chosen(boundary.items.find(i=>i.id===style.id));boundaryStyle.text='';
const base=P.storyboardImageRequest(boundary,boundary.items.find(i=>i.id===frame.id),task,refs).length;
// Empty sections are omitted; seed one character before measuring overhead.
boundaryStyle.text='x';const seeded=P.storyboardImageRequest(boundary,boundary.items.find(i=>i.id===frame.id),task,refs).length;
boundaryStyle.text='x'.repeat(32000-seeded+1);let exact=P.storyboardImageRequest(boundary,boundary.items.find(i=>i.id===frame.id),task,refs);
assert.equal(exact.length,32000);assert.equal(P.storyboardImagePromptIssue(exact,single.models[0],frame.title),'');
globalThis.state=structuredClone(boundary);response=await G.POST(req(single),ctx);assert.equal(response.status,200,await response.clone().text());
globalThis.state=structuredClone(boundary);response=await B.POST(req({...batch,plans:[batch.plans[0]]}),ctx);assert.equal(response.status,200,await response.clone().text());
boundaryStyle.text+='x';exact=P.storyboardImageRequest(boundary,boundary.items.find(i=>i.id===frame.id),task,refs);assert.equal(exact.length,32001);assert.match(P.storyboardImagePromptIssue(exact,single.models[0],frame.title),/Визуальный стиль/);
for(const run of [()=>G.POST(req(single),ctx),()=>B.POST(req({...batch,plans:[batch.plans[0]]}),ctx)]){globalThis.state=structuredClone(boundary);response=await run();assert.equal(response.status,400);assert.match((await response.json()).error,/32001/);assert.deepEqual(state,boundary);}
boundaryStyle.text=boundaryStyle.text.slice(0,-1);globalThis.state=structuredClone(boundary);
response=await B.POST(req({...batch,plans:[batch.plans[0],{itemId:frames[1].id,prompt:'x'.repeat(19999)}]}),ctx);assert.equal(response.status,400);assert.deepEqual(state,boundary,'One oversized later row must not partially enqueue the first row');
console.log(`PASS compact storyboard prompts: old ${D.promptFor(p,frame,task,D.chosen(frame)).length} chars -> ${request.length}; 11 queued frames, approved profiles/style/ref order, identical preview/single/batch, stable saved tasks, 32000/32001 boundaries and atomic rejection. No paid calls.`);
