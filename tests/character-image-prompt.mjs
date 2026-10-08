import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
const server=`export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}};
export const api=fn=>async(req,ctx)=>{try{return await fn(req,ctx)}catch(e){return Response.json({error:e.message},{status:400})}};export const owner=async()=> 'owner';export const loadProject=async()=>structuredClone(globalThis.state);export const saveProject=async(_,p,revision)=>{assertRevision(revision);p.revision++;globalThis.state=structuredClone(p);return p};function assertRevision(rev){if(rev!==state.revision)throw Error('revision')};export const getKey=async()=> 'fake';export const asset=async(_,id)=>({id,mime:'image/png',size:100});`;
await build({entryPoints:['lib/domain.ts','lib/models.ts','lib/prompt-compiler.ts','lib/prompt-jobs.ts','lib/zencreator-models.ts','lib/providers.ts','lib/character-portrait.ts','lib/minimax-image.ts','app/api/projects/[id]/generate/route.ts'],outdir:'work/tests/character-image-prompt',outbase:'.',outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'node',plugins:[{name:'memory',setup(b){b.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:server}));}}]});
const base='../work/tests/character-image-prompt/',D=await import(base+'lib/domain.mjs'),C=await import(base+'lib/prompt-compiler.mjs'),J=await import(base+'lib/prompt-jobs.mjs'),M=await import(base+'lib/models.mjs'),Z=await import(base+'lib/zencreator-models.mjs'),G=await import(base+'app/api/projects/[id]/generate/route.mjs');
const p=D.newProject('Проверка портрета'),hero=p.items.find(i=>i.stage===1),script=p.items.find(i=>i.stage===0),style=p.items.find(i=>i.stage===2);
D.addVariant(p,script.id,{text:'СЦЕНАРИЙ_НЕ_ОТПРАВЛЯТЬ '+('Сюжет большого фильма. '.repeat(5000))});D.approve(p,script.id);
D.addVariant(p,style.id,{text:'УТВЕРЖДЁННЫЙ_СТИЛЬ: гуашь, тёплая палитра.\n\n## Сюжет\nСТИЛЬ_СЮЖЕТ: Лена на болоте встречает лягушку.\n\n## Цвет\nПастельные цвета, мягкий свет.'});D.approve(p,style.id);
D.addVariant(p,p.items[3].id,{kind:'image',assetId:D.id(),text:'ЛОКАЦИЯ: болото, лягушка у кувшинок.'});D.approve(p,p.items[3].id);
hero.character={name:'Лена',appearance:'Рыжие волосы, зелёные глаза, синяя куртка.',description:'БИОГРАФИЯ: идёт на болото и находит лягушку.',locked:'Не меняй форму носа.',instructions:'Сохрани лицо первого прообраза, причёску второго.',refs:[D.id(),D.id()],actorProfile:{identity:'Веснушки на носу.',role:'РОЛЬ: ищет лягушку.',motivation:'МОТИВ: спасти лягушку.',contradiction:'ПРОТИВОРЕЧИЕ: боится болота.',mannerisms:'ПОВЕДЕНИЕ: гладит лягушку.',traits:[{name:'Харизма',intensity:7,instruction:'ИНСТРУКЦИЯ_ПОВЕДЕНИЯ: поднимает лягушку из воды.'}]}};
D.addVariant(p,hero.id,{kind:'image',assetId:D.id(),text:'СЛУЖЕБНАЯ_ИСТОРИЯ',character:structuredClone(hero.character)});D.approve(p,hero.id);

const other={...hero,id:D.id(),title:'ЧУЖОЙ_ГЕРОЙ',character:{...hero.character,name:'ЧУЖОЙ_ГЕРОЙ'},variants:[],approvedId:undefined,selectedId:undefined};p.items.push(other);
D.addVariant(p,other.id,{kind:'image',assetId:D.id(),text:'ЧУЖОЙ_ГЕРОЙ',character:other.character});D.approve(p,other.id);
const task='Создай один образ героя на простом фоне.',refs=hero.character.refs;
const models=M.MODELS.filter(m=>Z.isZenCreatorImage(m.id)).map(m=>m.id);assert(models.length>4);
const preview=C.compilePrompt(p,hero,models[0],{kind:'image',prompt:J.mediaVariantPrompt(task,1,2),references:refs,allowLegacyModel:true});
assert(preview.prompt.length<5000);assert(!preview.compression.shortened);
for(const text of ['Лена','Рыжие волосы','Веснушки','Не меняй форму носа','Харизма — 7/10','Сохрани лицо первого','УТВЕРЖДЁННЫЙ_СТИЛЬ',task,'рты всех персонажей закрыты'])assert(preview.prompt.includes(text),text);
const irrelevant=['СЦЕНАРИЙ_НЕ_ОТПРАВЛЯТЬ','СЛУЖЕБНАЯ_ИСТОРИЯ','ЧУЖОЙ_ГЕРОЙ','ЛОКАЦИЯ','БИОГРАФИЯ','РОЛЬ:','МОТИВ:','ПРОТИВОРЕЧИЕ','ПОВЕДЕНИЕ','СТИЛЬ_СЮЖЕТ','болото','лягушк'];
for(const absent of [...irrelevant,hero.approvedId,...refs,'"deps"'])assert(!preview.prompt.includes(absent),absent);
assert(preview.compression.omitted.some(x=>x.key.startsWith('portrait-world.')&&x.reason==='irrelevant'));
const original=structuredClone(p),long=structuredClone(p);long.items.find(i=>i.id===hero.id).character.appearance+=Array.from({length:3000},(_,n)=>` Деталь одежды ${n}.`).join('');
const oversized=C.compilePrompt(long,long.items.find(i=>i.id===hero.id),models[0],{kind:'image',prompt:task,references:refs});
assert(oversized.budget.needsOptimization);assert(oversized.criticalText.includes('Деталь одежды 2999'),'Identity remains mandatory for the optimizer; never silently clipped');
assert.deepEqual(p,original,'Prompt construction never changes descriptions, refs or approvals');
const payload={revision:p.revision,batchId:D.id(),itemId:hero.id,models:[...models,models[0]],count:2,prompt:task,refs:[],dialogue:'',voiceId:'',estimates:{}};
const ctx={params:Promise.resolve({id:p.id})},req=b=>new Request('http://test/',{method:'POST',body:JSON.stringify(b)});
globalThis.state=structuredClone(p);let response=await G.POST(req(payload),ctx);assert.equal(response.status,200,await response.clone().text());
assert.equal(state.jobs.length,models.length*2);assert.deepEqual(state.items,p.items);assert.equal(state.jobs[0].prompt,preview.prompt);
for(const j of state.jobs){assert(j.prompt.length<=5000);assert.deepEqual(j.refs,refs);assert.deepEqual(j.character,hero.character);assert.equal(j.actual,null);assert(j.zenCreditsEstimate>0);}
response=await G.POST(req(payload),ctx);assert.equal(response.status,200);assert.equal(state.jobs.length,models.length*2,'Repeated batch does not add more paid jobs');
globalThis.state=structuredClone(long);response=await G.POST(req({...payload,batchId:D.id()}),ctx);assert.equal(response.status,200);assert(state.jobs.every(j=>j.compilation.budget.needsOptimization));assert.deepEqual(state.items,long.items);
globalThis.state=structuredClone(p);state.limit='1';response=await G.POST(req({...payload,estimates:Object.fromEntries(models.map(m=>[m,'2']))}),ctx);assert.equal(response.status,400);assert.equal(state.jobs.length,0,'Large selections still respect the budget atomically');
for(const m of M.MODELS.filter(m=>m.kind==='image')){
 globalThis.state=structuredClone(p);
 const request={...payload,batchId:D.id(),models:[m.id],count:1};
 const response=await G.POST(req(request),ctx);assert.equal(response.status,200,m.id+': '+await response.clone().text());
 const actual=state.jobs[0],expected=C.compilePrompt(p,hero,m.id,{kind:'image',prompt:task,references:refs,allowLegacyModel:true});
 assert.equal(actual.prompt,expected.prompt,m.id+' preview and queued prompt differ');
 assert(actual.prompt.length<=expected.budget.limit||actual.compilation.budget.needsOptimization,m.id);
 assert(actual.compilation && actual.prompt.includes('Рыжие волосы'));assert(actual.prompt.includes('УТВЕРЖДЁННЫЙ_СТИЛЬ'));assert.deepEqual(state.items,p.items);
 for(const absent of irrelevant)assert(!actual.prompt.includes(absent),m.id+': '+absent);
}
// Selected old portraits are valid regeneration references; locations and other heroes are not.
const oldAsset=D.id();hero.variants.push({...hero.variants[0],id:D.id(),assetId:oldAsset});
const unrelated=[other.variants[0].assetId,p.items[3].variants[0].assetId];
const scoped=C.compilePrompt(p,hero,'grok-imagine-image-2.0',{kind:'image',prompt:task,references:[oldAsset,...refs,...unrelated],allowLegacyModel:true});
assert.deepEqual(new Set(scoped.references.map(r=>r.assetId)),new Set([oldAsset,...refs]));
const ownFrog=structuredClone(p),frog=ownFrog.items.find(i=>i.id===hero.id);
frog.character={name:'Лягушка',appearance:'Зелёная лягушка с золотой короной.',locked:'Сохрани корону.',instructions:'Нарисуй на фоне болота.',refs:[]};
const frogPrompt=C.compilePrompt(ownFrog,frog,'grok-imagine-image-2.0',{kind:'image',prompt:'Добавь кувшинку справа.',references:[],allowLegacyModel:true}).prompt;
for(const text of ['Зелёная лягушка','золотой короной','на фоне болота','Добавь кувшинку'])assert(frogPrompt.includes(text),'Explicit director content must survive: '+text);

// Inspect exact wire bodies rather than trusting a UI preview.
const P=await import(base+'lib/providers.mjs');const wire=[];
globalThis.fetch=async(url,options)=>{const body=options.body instanceof FormData?Object.fromEntries(options.body):JSON.parse(options.body);wire.push({url:String(url),body});return Response.json({data:[{url:'https://assets.example/portrait.png'}],request_id:D.id(),status:'IN_QUEUE'});};
for(const model of ['grok-imagine-image-2.0','gpt-image-2.5-sunburst','fal-qwen-image-edit-2511']){
 const result=C.compilePrompt(p,hero,model,{kind:'image',prompt:task,references:refs,allowLegacyModel:true});
 await P.generate({id:D.id(),model,kind:'image',prompt:result.prompt,refs,duration:5},'mock-key',['data:image/png;base64,AA=='],'16:9');
 const body=wire.at(-1).body;assert.equal(body.prompt,result.prompt);for(const absent of irrelevant)assert(!body.prompt.includes(absent),model+' wire: '+absent);
}
const Portrait=await import(base+'lib/character-portrait.mjs'),Legacy=await import(base+'lib/minimax-image.mjs');
const named=structuredClone(p);named.items.find(i=>i.stage===3).title='Болото';
const mixed=Portrait.portraitStyleText(named,hero.character,'Гуашь с реалистичными пропорциями. Болото освещено луной. Светлая трава у деревянного забора. Палитра: приглушённая охра.');
assert.match(mixed,/Гуашь/);assert.match(mixed,/Палитра/);assert.doesNotMatch(mixed,/Болото|трава|забор/);
for(const m of M.MODELS.filter(m=>m.kind==='image')){
 const legacy=Legacy.characterImageRequest(p,hero,task,refs,1,1,m.id);
 assert(legacy.length<=legacy.limit);for(const absent of irrelevant)assert(!legacy.prompt.includes(absent),m.id+' legacy: '+absent);
 assert.match(legacy.prompt,/Рыжие/);assert.match(legacy.prompt,/Сохрани лицо/);
}
console.log('PASS portrait isolation: all model jobs omit story/locations/other heroes and actor plot, preserve identity/locks/visual style, exact Grok/OpenAI/fal wire payloads, selected portrait references, explicit frog/background requests, immutable cards, optimizer handoff, idempotency and budget protection. Zero paid calls.');
