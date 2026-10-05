import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
let hostedServer=path.resolve('../studio/lib/server.ts');
try{await access(hostedServer);}catch{hostedServer=path.resolve('platform/hosted/server.ts.template');}
const server=await readFile(hostedServer,'utf8'),kick=await readFile('platform/hosted/background-kick.ts.template','utf8');
assert.match(server,/captureQueueHook\(req\)/,'The actual hosted API wrapper must contain the hook; documentation alone is insufficient');
await build({stdin:{contents:`export {api,owner,HttpError} from 'actual-hosted-server';export {queueHookProject,captureQueueHook} from './lib/api-queue-hook';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'work/tests/hosted-enqueue-hook.mjs',plugins:[{name:'actual-api-platform-mocks',setup(b){
 b.onResolve({filter:/^\.\/media-work-slot$/},a=>a.namespace==='platform'?{path:'slot',namespace:'hosted-slot'}:undefined);
 b.onLoad({filter:/.*/,namespace:'hosted-slot'},async()=>({contents:await readFile('platform/hosted/media-work-slot.ts.template','utf8'),loader:'ts'}));
 b.onResolve({filter:/^actual-hosted-server$/},()=>({path:'server',namespace:'platform'}));
 b.onResolve({filter:/^\.\/background-kick$/},a=>a.namespace==='platform'?{path:'kick',namespace:'platform'}:undefined);
 b.onResolve({filter:/^\.\/api-queue-hook$/},a=>a.namespace==='platform'?{path:path.resolve('lib/api-queue-hook.ts')}:undefined);
 b.onResolve({filter:/^\.\/(domain|project-state|project-assets)$/},a=>a.namespace==='platform'?{path:a.path,namespace:'mock'}:undefined);
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));
 b.onResolve({filter:/^@\/app\/chatgpt-auth$/},()=>({path:'auth',namespace:'mock'}));
 b.onResolve({filter:/^vinext\/shims\/request-context$/},()=>({path:'context',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/project-worker$/},()=>({path:'worker',namespace:'mock'}));
 b.onResolve({filter:/^@\/lib\/background-work$/},()=>({path:path.resolve('lib/background-work.ts')}));
 b.onLoad({filter:/.*/,namespace:'platform'},a=>({contents:a.path==='server'?server:kick,loader:'ts',resolveDir:path.dirname(hostedServer)}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='env'?`export const env={DB:{prepare(sql){globalThis.events.push('query');return{bind(id,user){return{async first(){globalThis.events.push('owned:'+user);if(globalThis.failOwnership)throw Error('DB unavailable');return globalThis.owned[id]===user?{id}:null;}};}};}}};`:a.path==='auth'?`export const getChatGPTUser=async()=>{globalThis.events.push('auth');const user=globalThis.authSequence.length?globalThis.authSequence.shift():globalThis.user;return user?{userId:user}:null;};`:a.path==='context'?`export const getRequestExecutionContext=()=>globalThis.context;`:a.path==='worker'?`export const projectWorkerTickFor=async(user,id)=>{globalThis.events.push('worker');globalThis.ticks.push({user,id});if(globalThis.failWorker)throw Error('network');};`:a.path==='./domain'?`export const now=()=>'';export const repairLegacyTransportFailures=()=>false;`:a.path==='./project-state'?`export class ProjectStorageError extends Error{};export const encodeProjectState=()=>{};export const decodeProjectState=()=>{};export const storedProjectAssetIds=()=>undefined;`:`export const projectAssetIds=()=>[];`}));
}}]});
const {api,owner,HttpError,queueHookProject,captureQueueHook}=await import('../work/tests/hosted-enqueue-hook.mjs');
const project='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002',job='00000000-0000-4000-8000-000000000003';
const waited=[];
function reset(){globalThis.events=[];globalThis.ticks=[];globalThis.user='owner';globalThis.authSequence=[];globalThis.owned={[project]:'owner',[foreign]:'someone-else'};globalThis.context={waitUntil:p=>waited.push(p)};globalThis.failOwnership=false;globalThis.failWorker=false;waited.length=0;}
function request(route,body={},method='POST',headers={}){return new Request('https://hosted.test/api/projects/'+project+'/'+route,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(body)})});}
const save=api(async(req)=>{await owner(req,true);if(req.method==='POST')await req.json();events.push('saved');return Response.json({saved:true});});
const cases=[...['generate','generate-storyboard','generate-speech','generate-remaining','generate-lipsync','generate-voice-tests','media-review','queue'].map(route=>[route,{}]),...['run','scriptRun','retry','advance'].map(action=>['directing',{action}]),['world',{action:'generateActor'}],...['ideas','generate'].map(action=>['music',{action}]),...['design','proposeDelivery','saveVoice','advance'].map(action=>['voice-design',{action}]),...['generate','advance'].map(action=>['soundscape',{action}]),...['mode','select','review','approve'].map(action=>['keyframes',{action}]),];
for(const [route,body] of cases){reset();const response=await save(request(route,{...body,owner:'forged',projectId:foreign}),{});assert.equal(response.status,200,route);assert.equal(waited.length,1,route+' schedules after a successful saved mutation');await Promise.all(waited);assert.deepEqual(ticks,[{user:'owner',id:project}],route);assert.ok(events.indexOf('worker')>events.indexOf('saved'));assert.ok(events.lastIndexOf('auth')>events.indexOf('saved'));assert.ok(events.indexOf('owned:owner')>events.indexOf('saved'));}
const excluded=[['jobs/'+job,{}],['jobs/'+job,{action:'resume-wait'}],['jobs/'+job,{action:'recover-result'}],['jobs/'+job,{action:'recover-voice-file'}],['jobs/'+job,{action:'check-wait'}],['jobs/'+job,{action:'stop'}],['directing',{action:'stop'}],['directing',{action:'saveShot'}],['directing',{action:'approveShots'}],['voice-design',{action:'stop'}],['voice-design',{action:'saveProfile'}],['soundscape',{action:'stop'}],['music',{action:'settings'}],['world',{action:'removeLocation'}],['unknown',{}],['generate/extra',{}],['queue',{},'GET']];
for(const [route,body,method] of excluded){reset();assert.equal((await save(request(route,body,method),{})).status,200);assert.equal(waited.length,0,route+' '+JSON.stringify(body));assert.equal(ticks.length,0);assert.equal(events.filter(x=>x==='auth').length,1,'No post-save authorization or hook on an excluded request');}
reset();const consumed=request('directing',{action:'run'});assert.equal(await captureQueueHook(consumed),project);assert.deepEqual(await consumed.json(),{action:'run'},'Capture reads a clone and preserves the route input');
assert.equal(queueHookProject('POST','/api/projects/'+project+'/jobs/'+job,{action:'check-wait'}),undefined);
assert.equal(queueHookProject('PATCH','/api/projects/'+project+'/generate'),undefined);
reset();user=null;assert.equal((await save(request('generate',{},'POST',{'x-owner':'owner'}),{})).status,401);assert.equal(waited.length,0);assert.ok(!events.includes('saved'));
reset();assert.equal((await save(request('generate',{},'POST',{origin:'https://evil.test'}),{})).status,403);assert.equal(waited.length,0);
reset();const failed=api(async(req)=>{await owner(req,true);throw new HttpError('CAS save conflict',409);});assert.equal((await failed(request('generate'),{})).status,409);assert.equal(waited.length,0);assert.ok(!events.includes('query'));
reset();const refused=api(async()=>Response.json({error:'invalid'}, {status:400}));assert.equal((await refused(request('generate'),{})).status,400);assert.equal(waited.length,0);
reset();owned[project]='someone-else';assert.equal((await save(request('generate'),{})).status,200);assert.equal(waited.length,0,'The hook independently rejects a project not owned by the current authenticated account');
reset();authSequence=['owner',null];assert.equal((await save(request('generate'),{})).status,200);assert.equal(waited.length,0,'Loss of auth after save cannot undo the saved response or launch background work');
reset();failOwnership=true;assert.equal((await save(request('generate'),{})).status,200);assert.equal(waited.length,0);
reset();context=null;assert.equal((await save(request('generate'),{})).status,200);await Promise.resolve();assert.equal(waited.length,0);assert.equal(ticks.length,0,'No request context means no detached promise');
reset();failWorker=true;assert.equal((await save(request('generate'),{})).status,200);await Promise.all(waited);assert.equal(ticks.length,1,'After-response executor errors are caught without replacing the committed response');
console.log('PASS actual hosted api after-save enqueue hooks: '+cases.length+' authorized paths/actions; owner/origin/database checks; consumed body; CAS/validation failure; GET/stop/edit/watchdog exclusions; waitUntil only and saved response preservation. No paid calls. Source: '+hostedServer);
