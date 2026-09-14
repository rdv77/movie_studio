import {build} from 'esbuild';
import {strict as assert} from 'node:assert';
import {mkdtemp,writeFile,mkdir,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {migrate} from '../scripts/migrate.mjs';

// Real Node routes, SQLite, and private files; only login identity is replaced.
const temporary=await mkdtemp(join(tmpdir(),'movie-studio-route-'));
process.env.DATA_DIR=join(temporary,'data');
process.env.VAULT_KEY=Buffer.alloc(32).toString('base64');
migrate(process.env.DATA_DIR);
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:`
  import * as project from './app/api/projects/[id]/route';
  import * as batch from './app/api/projects/[id]/generate-storyboard/route';
  import * as media from './app/api/assets/[id]/route';
  import {runtime,setKey,api,mutate} from './lib/server';
  import {newProject,addVariant,approve,id,now} from './lib/domain';
  import {preparePlanCards,storyboardPrompt} from './lib/storyboard';
  export {runtime} from './lib/storage';
  export default {async fetch(req){
    const url=new URL(req.url),paths=url.pathname.split('/');
    if(url.pathname==='/fixture'){
      const p=newProject('Большой проект'),shots=Array.from({length:11},(_,n)=>({title:'План '+(n+1),duration:n===0?5:4.5,
        description:'Герои идут вдоль моря. '.repeat(60),camera:'Общий план, медленный наезд',
        continuity:'Переход по движению',dialogue:'Мы встретились у моря.',speechType:'voiceover',speaker:'Катя'}));
      for(const item of p.items.filter(i=>i.stage<=4)){
        addVariant(p,item.id,{text:item.stage===4?JSON.stringify({shots}):'Утверждённая основа: тёплая рисованная анимация. '.repeat(10)});
        approve(p,item.id);
      }
      preparePlanCards(p);
      const history={id:id(),itemId:p.items[0].id,model:'test-history',kind:'text',status:'done',transportVersion:2,
        prompt:'',actual:'123456789',actualSource:'Сверка расходов',created:now()};
      p.jobs.push(history);
      const size=()=>new TextEncoder().encode(JSON.stringify(p)).byteLength;
      history.prompt='Я'.repeat(Math.floor((1_990_000-size())/2));
      await runtime.DB.prepare('INSERT INTO projects (id,owner,title,state,revision,updated) VALUES (?,?,?,?,?,?)')
        .bind(p.id,'owner',p.title,JSON.stringify(p),0,now()).run();
      await setKey('owner','openai','fake-test-key');
      return Response.json({id:p.id,initialBytes:size(),historyId:history.id,itemId:p.items[0].id,
        batch:{revision:0,batchId:id(),model:'gpt-image-2.5-sunburst',refs:[],estimate:null,
          plans:p.items.filter(i=>i.stage===5&&!i.planArchive).map(i=>({itemId:i.id,prompt:storyboardPrompt(p,i)}))}});
    }
    if(url.pathname==='/reserve')return api(async()=>{
      const p=await mutate('owner',url.searchParams.get('project'),p=>{
        const j=p.jobs.find(j=>j.id===url.searchParams.get('job'));
        if(j.status!=='queued')throw new Error('Already reserved');
        j.status='dispatching';
      });return Response.json({revision:p.revision});
    })(req,{});
    const route=paths[2]==='assets'?media:paths[4]==='generate-storyboard'?batch:project;
    return route[req.method](req,{params:Promise.resolve({id:decodeURIComponent(paths[3])})});
  }};
`},bundle:true,write:false,format:'esm',platform:'node',target:'node24',packages:'external',plugins:[{name:'auth',setup(b){
  b.onResolve({filter:/[\/]auth$/},()=>({path:'auth',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export class AuthRequestError extends Error {constructor(message,status){super(message);this.status=status;}}
export const authenticateRequest=req=>req.headers.get('test-user')||null;
export function assertRequestOrigin(req){if(req.headers.get('origin')!=='http://site.test')throw new AuthRequestError('Invalid origin',403);}`}));
}}]});
await mkdir('work/tests',{recursive:true});
const harnessPath=resolve('work/tests/project-state-routes.mjs');
await writeFile(harnessPath,bundled.outputFiles[0].text);
const {default:handler,runtime}=await import(pathToFileURL(harnessPath));
const db=runtime.DB,bucket=runtime.FILES;
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('No provider calls allowed');};
const objectDirectory=key=>join(process.env.DATA_DIR,'private-files','objects',createHash('sha256').update(key).digest('hex'));
const objectCount=async()=>(await readdir(join(process.env.DATA_DIR,'private-files','objects'))).length;
async function call(path,method='GET',body,user='owner'){
  return handler.fetch(new Request('http://site.test'+path,{method,headers:{'test-user':user,origin:'http://site.test','content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}));
}
try{
  const fixture=await (await call('/fixture')).json(),path='/api/projects/'+fixture.id;
  assert(fixture.initialBytes>=1_989_998&&fixture.initialBytes<=1_990_000);
  assert.equal(fixture.batch.plans.length,11);
  let response=await call(path+'/generate-storyboard','POST',fixture.batch);
  assert.equal(response.status,200,await response.clone().text());
  let p=await response.json();
  assert(Buffer.byteLength(JSON.stringify(p))>2_000_000,'The real queue crosses the D1 row limit');
  assert.equal(p.jobs.length,12);assert.equal(p.jobs[0].id,fixture.historyId);assert.equal(p.jobs[0].actual,'123456789');
  assert.equal(p.jobs.filter(j=>j.status==='queued').length,11);assert.equal(p.revision,1);
  const row=await db.prepare('SELECT state,revision FROM projects WHERE id=?').bind(p.id).first(),pointer=JSON.parse(row.state);
  assert.equal(pointer.$kadrProjectState,'r2-v1');assert(row.state.length<1000);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await (await bucket.get(pointer.key)).arrayBuffer())),p);
  assert.deepEqual(await (await call(path)).json(),p,'Normal project GET returns the full snapshot');
  assert.equal((await call(path,'GET',undefined,'other')).status,404);
  assert.equal((await call(path,'GET',undefined,'')).status,401);
  assert.equal((await call('/api/assets/'+encodeURIComponent(pointer.key))).status,404,'Snapshots cannot be served as media');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,0);
  const objectsBefore=await objectCount();
  response=await call(path+'/generate-storyboard','POST',fixture.batch);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),p,'Retrying the same batch does not queue twice');
  assert.equal(await objectCount(),objectsBefore,'Deduplication creates no extra snapshot');
  response=await call(path,'PATCH',{revision:p.revision,action:'renameItem',itemId:fixture.itemId,data:{title:'Исправленный заголовок'}});
  assert.equal(response.status,200,await response.clone().text());p=await response.json();
  assert.equal(p.items.find(i=>i.id===fixture.itemId).title,'Исправленный заголовок');assert.equal(p.revision,2);
  assert(await bucket.head(pointer.key),'Older snapshot remains available to existing readers');
  const stale=await call(path,'PATCH',{revision:1,action:'renameItem',itemId:fixture.itemId,data:{title:'Устаревшее изменение'}});
  assert.equal(stale.status,400);assert.match((await stale.json()).error,/изменился/);
  assert.deepEqual(await (await call(path)).json(),p);
  const job=p.jobs.find(j=>j.status==='queued'),reserve='/reserve?project='+p.id+'&job='+job.id;
  const reserved=await Promise.all([call(reserve,'POST'),call(reserve,'POST')]);
  assert.deepEqual(reserved.map(r=>r.status).sort(),[200,400],'Only one concurrent caller reserves a queued generation');
  p=await (await call(path)).json();assert.equal(p.jobs.filter(j=>j.status==='dispatching').length,1);assert.equal(p.revision,3);
  // Missing object must not be mistaken for a blank project or start a new batch.
  const last=JSON.parse((await db.prepare('SELECT state FROM projects WHERE id=?').bind(p.id).first()).state);
  await rm(join(objectDirectory(last.key),'object.json'));
  response=await call(path);assert.equal(response.status,503);assert.match((await response.json()).error,/сохранённые данные/);
  assert.equal((await db.prepare('SELECT revision FROM projects WHERE id=?').bind(p.id).first()).revision,3);
  console.log('PASS real Node/SQLite/files: legacy 1.99 MB project, 11-frame batch beyond 2 MB, full history and costs, transparent reads/edits, batch retry deduplication, private snapshots, owner isolation, concurrent dispatch reservation and missing-file failure. No paid calls.');
}finally{globalThis.fetch=originalFetch;db.close();await rm(temporary,{recursive:true,force:true});}
