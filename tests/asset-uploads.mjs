import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from '../scripts/migrate.mjs';

const temporary=await mkdtemp(join(tmpdir(),'movie-studio-route-'));
process.env.DATA_DIR=join(temporary,'data');
process.env.VAULT_KEY=Buffer.alloc(32).toString('base64');
migrate(process.env.DATA_DIR);
const bundled = await build({stdin:{resolveDir:process.cwd(),contents:`
  import * as start from './app/api/assets/uploads/route';
  import * as part from './app/api/assets/uploads/[id]/route';
  import * as small from './app/api/assets/route';
  import * as projects from './app/api/projects/route';
  import * as project from './app/api/projects/[id]/route';
  export {runtime} from './lib/storage';
  export {makeVariant} from './lib/domain';
  export default {async fetch(req) {
    const url=new URL(req.url), paths=url.pathname.split('/');
    if(paths[2]==='projects')return (paths[3]?project:projects)[req.method](req,{params:Promise.resolve({id:paths[3]})});
    const route=paths[3]==='uploads'?(paths[4]?part:start):small;
    return route[req.method](req,{params:Promise.resolve({id:paths[4]})});
  }};
`},bundle:true,write:false,format:'esm',platform:'node',target:'node24',packages:'external',plugins:[{name:'auth',setup(b){
  b.onResolve({filter:/[\/]auth$/},()=>({path:'auth',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export class AuthRequestError extends Error {constructor(message,status){super(message);this.status=status;}}
export const authenticateRequest=req=>req.headers.get('test-user')||null;
export function assertRequestOrigin(req){if(req.headers.get('origin')!=='http://site.test')throw new AuthRequestError('Invalid origin',403);}`}));
}}]});
await build({entryPoints:['lib/asset-upload.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/tests/asset-upload.mjs'});
const {uploadAsset,ASSET_PART_BYTES}=await import('../work/tests/asset-upload.mjs');
await mkdir('work/tests',{recursive:true});
const harnessPath=resolve('work/tests/asset-uploads-routes.mjs');
await writeFile(harnessPath,bundled.outputFiles[0].text);
const {default:handler,runtime,makeVariant}=await import(pathToFileURL(harnessPath));
const db=runtime.DB,bucket=runtime.FILES;
const originalFetch=globalThis.fetch;
let losePart=true,loseComplete=true,partCalls=0,maxPart=0,completedId;
async function call(path,method='POST',body,user='owner',extra={}) {
 const headers={'test-user':user,origin:'http://site.test',...extra};
 const options={method,headers};
 if(body!==undefined){options.body=body; if(typeof body==='string')headers['content-type']='application/json';}
 return handler.fetch(new Request('http://site.test'+path,options));
}
async function okJson(response, status=200) {
 const value=await response;
 assert.equal(value.status,status,await value.clone().text());
 return value.json();
}
const listing=(projectId,user='owner')=>okJson(call('/api/assets?projectId='+projectId,'GET',undefined,user));
const listIds=async(projectId,user='owner')=>(await listing(projectId,user)).map(asset=>asset.id).sort();
const form=(projectId)=>{const body=new FormData();body.set('file',new File(['fixture'],'photo.png',{type:'image/png'}));if(projectId!==undefined)body.set('projectId',projectId);return body;};
try {
 const projectA=await okJson(call('/api/projects','POST',JSON.stringify({title:'Фильм A'})),201);
 const projectB=await okJson(call('/api/projects','POST',JSON.stringify({title:'Фильм B'})),201);
 const foreign=await okJson(call('/api/projects','POST',JSON.stringify({title:'Чужой фильм'}),'other'),201);
 assert.deepEqual(await listing(projectA.id),[]);
 assert.deepEqual(await listing(projectB.id),[],'A newly created film has an empty asset library');
 assert.deepEqual(await listing(foreign.id,'other'),[]);
 assert.equal((await call('/api/assets','GET')).status,400,'A project must be explicit when listing files');
 assert.equal((await call('/api/assets?projectId='+foreign.id,'GET')).status,404);
 assert.equal((await call('/api/assets?projectId='+projectA.id,'GET',undefined,'')).status,401);
 assert.equal((await call('/api/assets','POST',form())).status,400,'Small uploads require a project');
 assert.equal((await call('/api/assets','POST',form(foreign.id))).status,404,'An owner cannot upload into a foreign project');
 const meta={name:'large.mp4',mime:'video/mp4',size:100};
 const metadata=JSON.stringify({...meta,projectId:projectA.id});
 assert.equal((await call('/api/assets/uploads','POST',metadata,'')).status,401);
 assert.equal((await call('/api/assets/uploads','POST',metadata,'owner',{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify(meta))).status,400,'Multipart uploads require a project');
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify({...meta,projectId:foreign.id}))).status,404);
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify({projectId:projectA.id,name:'bad',mime:'text/html',size:100}))).status,400);
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify({projectId:projectA.id,name:'bad',mime:'video/mp4',size:1024**3+1}))).status,400);
 const session=await (await call('/api/assets/uploads','POST',metadata)).json(),url='/api/assets/uploads/'+session.id;
 assert.equal((await db.prepare('SELECT project_id FROM asset_uploads WHERE id=?').bind(session.id).first()).project_id,projectA.id);
 assert.equal((await call(url+'?part=1','PUT',new Uint8Array(100),'other')).status,404);
 assert.equal((await call(url,'POST',JSON.stringify({parts:[]}),'other')).status,404);
 assert.equal((await call(url,'DELETE',undefined,'other')).status,404);
 assert.equal((await call(url+'?part=0','PUT',new Uint8Array(100))).status,400);
 assert.equal((await call(url+'?part=1','PUT',new Uint8Array(101))).status,413);
 assert.equal((await call(url+'?part=1','PUT',new Uint8Array(99))).status,400);
 assert.equal((await call(url,'POST',JSON.stringify({parts:[]}))).status,400);
 assert.equal((await call(url,'DELETE')).status,204);
 assert.equal(await db.prepare('SELECT id FROM asset_uploads WHERE id=?').bind(session.id).first(),null);

 globalThis.fetch=async(path,opts={})=>{
   if(opts.method==='PUT') {partCalls++;maxPart=Math.max(maxPart,opts.body.size);}
   const r=await call(path,opts.method,opts.body,'owner',opts.headers);
   if(opts.method==='PUT'&&losePart){losePart=false;await r.arrayBuffer();throw new Error('Lost part response');}
   if(opts.method==='POST'&&/uploads\//.test(path)&&loseComplete){loseComplete=false;completedId=path.split('/').pop();await r.arrayBuffer();throw new Error('Lost completion response');}
   return r;
 };
 // Five separate uploads in each film exercise the real small-file client and
 // server binding without mutating project revisions as files are added.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yUt8AAAAASUVORK5CYII=','base64');
 const photosA=[],photosB=[];
 for(let index=0;index<5;index++) {
   photosA.push(await uploadAsset(new File([png],`A-${index+1}.png`,{type:'image/png'}),projectA.id));
   photosB.push(await uploadAsset(new File([png],`B-${index+1}.png`,{type:'image/png'}),projectB.id));
 }
 assert.deepEqual(await listIds(projectA.id),photosA.map(a=>a.id).sort());
 assert.deepEqual(await listIds(projectB.id),photosB.map(a=>a.id).sort());
 assert.equal(new Set([...photosA,...photosB].map(a=>a.id)).size,10);
 assert.equal((await db.prepare('SELECT revision FROM projects WHERE id=?').bind(projectA.id).first()).revision,projectA.revision,'Adding an upload must not stale the following project mutation');
 for(const [project,photos] of [[projectA,photosA],[projectB,photosB]]) for(const photo of photos) {
   assert.equal((await db.prepare('SELECT project_id FROM assets WHERE id=?').bind(photo.id).first()).project_id,project.id);
 }

 // A pre-migration file referenced by a saved legacy snapshot stays available
 // only there. Unattributed old files are preserved, never guessed into a film.
 const legacyId=randomUUID(),unattributedId=randomUUID();
 for(const [assetId,name] of [[legacyId,'legacy.png'],[unattributedId,'unattributed.png']]) {
   await bucket.put(assetId,png,{httpMetadata:{contentType:'image/png'}});
   await db.prepare('INSERT INTO assets (id,owner,name,mime,size,created) VALUES (?,?,?,?,?,?)').bind(assetId,'owner',name,'image/png',png.length,new Date().toISOString()).run();
 }
 const legacyProject=await okJson(call('/api/projects/'+projectA.id,'GET'));
 legacyProject.items[3].variants.push(makeVariant(legacyProject,legacyProject.items[3],{kind:'image',assetId:legacyId,title:'Старая локация'}));
 await db.prepare('UPDATE projects SET state=? WHERE id=?').bind(JSON.stringify(legacyProject),projectA.id).run();
 assert.deepEqual(await listIds(projectA.id),[...photosA.map(a=>a.id),legacyId].sort());
 assert.deepEqual(await listIds(projectB.id),photosB.map(a=>a.id).sort());
 assert(await bucket.head(unattributedId),'Unattributed legacy bytes must not be deleted');
 assert.equal((await db.prepare('SELECT project_id FROM assets WHERE id=?').bind(legacyId).first()).project_id,null);

 const patch=async(projectId,action,data,itemId)=>{
   const current=await okJson(call('/api/projects/'+projectId,'GET'));
   return call('/api/projects/'+projectId,'PATCH',JSON.stringify({revision:current.revision,action,itemId,data}));
 };
 const itemB=projectB.items[1].id;
 for(const [action,data] of [
   ['addVariant',{title:'Чужой готовый образ',text:'',kind:'image',assetId:photosA[0].id,refs:[]}],
   ['addVariant',{title:'Чужой референс',text:'',kind:'image',assetId:photosB[0].id,refs:[photosA[2].id]}],
   ['addVariant',{title:'Чужой образ героя',text:'',kind:'image',assetId:photosB[0].id,refs:[],characterRefs:[photosA[3].id]}],
   ['saveCharacter',{profile:{name:'Герой',description:'Не должен забирать файлы другого фильма',refs:[photosA[1].id]}}],
   ['addVariant',{title:'Чужое legacy',text:'',kind:'image',assetId:legacyId,refs:[]}],
 ]) {
   const response=await patch(projectB.id,action,data,itemB);
   assert.equal(response.status,404,await response.clone().text());
 }
 assert.equal((await okJson(call('/api/projects/'+projectB.id,'GET'))).items[1].variants.length,0,'Rejected attachments do not mutate the destination project');

 // Cross-film transfer remains available only through the explicit source
 // project import, which brings the approved variant and its exact references.
 await okJson(await patch(projectA.id,'addVariant',{title:'Основа',text:'Утверждённый сценарий',kind:'text',refs:[]},projectA.items[0].id));
 await okJson(await patch(projectA.id,'approve',undefined,projectA.items[0].id));
 for(const stage of [2,3]){await okJson(await patch(projectA.id,'addVariant',{title:'Основа',text:'Утверждённый стиль и локации',kind:'text',refs:[]},projectA.items[stage].id));await okJson(await patch(projectA.id,'approve',undefined,projectA.items[stage].id));}
 await okJson(await patch(projectA.id,'saveCharacter',{profile:{name:'Герой A',description:'Утверждённый персонаж',refs:[photosA[1].id]},imageId:photosA[0].id},projectA.items[1].id));
 await okJson(await patch(projectA.id,'approve',undefined,projectA.items[1].id));
 await okJson(await patch(projectB.id,'importLibrary',{projectId:projectA.id,itemId:projectA.items[1].id}));
 assert.deepEqual(await listIds(projectB.id),[...photosB.map(a=>a.id),photosA[0].id,photosA[1].id].sort(),'Explicit import grants only the approved material and its sources');
 assert.equal((await patch(projectB.id,'addVariant',{title:'Другой файл A',text:'',kind:'image',assetId:photosA[2].id,refs:[]},itemB)).status,404,'Importing one material does not grant the whole source library');
 assert.deepEqual(await listing(foreign.id,'other'),[]);

 const seed=new Uint8Array(1024*1024);for(let i=0;i<seed.length;i++)seed[i]=(i*13+7)%251;
 const file=new File([...Array(57).fill(seed),seed.slice(0,177)],'Монтаж.mp4',{type:'video/mp4'});
 const progress=[];const result=await uploadAsset(file,projectA.id,text=>progress.push(text));
 assert.equal(result.id,completedId);assert.equal(result.size,file.size);assert.equal(result.mime,'video/mp4');
 assert(file.size>50*1024*1024);assert(maxPart<=ASSET_PART_BYTES);assert.equal(partCalls,Math.ceil(file.size/ASSET_PART_BYTES)+1);
 const stored=await bucket.get(result.id);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(Buffer.from(await stored.arrayBuffer())),hash(Buffer.from(await file.arrayBuffer())),'Every uploaded byte is preserved');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM assets WHERE id=?').bind(result.id).first()).n,1);
 assert.equal((await db.prepare('SELECT project_id FROM assets WHERE id=?').bind(result.id).first()).project_id,projectA.id);
 assert((await listIds(projectA.id)).includes(result.id));
 assert(!(await listIds(projectB.id)).includes(result.id),'Multipart output stays with its originating film');
 assert.equal(await db.prepare('SELECT id FROM asset_uploads WHERE id=?').bind(result.id).first(),null);
 assert.equal((await call('/api/assets/uploads/'+result.id,'DELETE')).status,204);
 assert(await bucket.head(result.id),'Abort after a lost response must never delete completed media');
 assert.equal((await call('/api/assets/uploads/'+result.id,'POST','{}','other')).status,404);
 assert(progress.some(s=>s.includes('без дополнительного сжатия')));
 // Recovery between atomic file publication and the metadata transaction.
 const retry=await (await call('/api/assets/uploads','POST',metadata)).json();
 const row=await db.prepare('SELECT * FROM asset_uploads WHERE id=?').bind(retry.id).first();
 assert.equal(row.project_id,projectA.id);
 const pending=bucket.resumeMultipartUpload(row.id,row.upload_id);
 const uploaded=await pending.uploadPart(1,new Uint8Array(100));await pending.complete([uploaded]);
 const recovered=await call('/api/assets/uploads/'+retry.id,'POST',JSON.stringify({projectId:projectB.id}));assert.equal(recovered.status,200);
 assert.equal((await recovered.json()).size,100);
 assert.equal((await db.prepare('SELECT project_id FROM assets WHERE id=?').bind(retry.id).first()).project_id,projectA.id,'Metadata recovery uses the stored upload binding, not a later client project');
 assert((await listIds(projectA.id)).includes(retry.id));
 assert(!(await listIds(projectB.id)).includes(retry.id));
 assert(!(await listIds(projectA.id)).includes(unattributedId));

 // Animatic previews use the same variant shape as manual attachments. Check
 // every nested reference before the basis/save step can grant membership.
 // A already has a video/mp4 from the multipart test; B gets its own upload.
 const videoB=await uploadAsset(new File([Buffer.from('000000186674797069736f6d0000000069736f6d6d703432','hex')],'B-preview.mp4',{type:'video/mp4'}),projectB.id);
 const beforeAnimatic=await okJson(call('/api/projects/'+projectB.id,'GET'));
 const beforeAnimaticFiles=await listIds(projectB.id);
 assert(!beforeAnimaticFiles.includes(result.id));
 for(const [label,fields] of [
   ['main asset',{assetId:result.id}],
   ['refs',{refs:[photosA[2].id]}],
   ['characterRefs',{characterRefs:[photosA[3].id]}],
   ['character.refs',{character:{name:'Чужой герой',description:'Не добавлять в этот фильм',refs:[photosA[4].id]}}],
 ]) {
   const response=await patch(projectB.id,'saveAnimaticPreview',{
     title:'Проверка изоляции аниматика',text:'',kind:'video',assetId:videoB.id,
     refs:[],basis:'intentionally-invalid-basis',...fields,
   });
   assert.equal(response.status,404,`${label}: ${await response.clone().text()}`);
   assert.match((await response.json()).error,/Файл не принадлежит этому проекту/,`${label} must fail project membership before basis validation`);
   assert.deepEqual(await okJson(call('/api/projects/'+projectB.id,'GET')),beforeAnimatic,`${label} must not modify the project or its revision`);
   assert.deepEqual(await listIds(projectB.id),beforeAnimaticFiles,`${label} must not grant new library membership`);
 }
 console.log('PASS real Node/SQLite/files: isolated film libraries, 5+5 photos, mandatory owned project, safe legacy recovery, cross-film attach/animatic-reference rejection and explicit import, 57 MiB byte-identical multipart/retries/abort/metadata recovery.');
} finally {globalThis.fetch=originalFetch;db.close();await rm(temporary,{recursive:true,force:true});}
