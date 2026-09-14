import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
  export {runtime} from './lib/storage';
  export default {async fetch(req) {
    const url=new URL(req.url), paths=url.pathname.split('/');
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
const {default:handler,runtime}=await import(pathToFileURL(harnessPath));
const db=runtime.DB,bucket=runtime.FILES;
const originalFetch=globalThis.fetch;
let losePart=true,loseComplete=true,partCalls=0,maxPart=0,completedId;
async function call(path,method='POST',body,user='owner',extra={}) {
 const headers={'test-user':user,origin:'http://site.test',...extra};
 const options={method,headers};
 if(body!==undefined){options.body=body; if(typeof body==='string')headers['content-type']='application/json';}
 return handler.fetch(new Request('http://site.test'+path,options));
}
try {
 const metadata=JSON.stringify({name:'large.mp4',mime:'video/mp4',size:100});
 assert.equal((await call('/api/assets/uploads','POST',metadata,'')).status,401);
 assert.equal((await call('/api/assets/uploads','POST',metadata,'owner',{origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify({name:'bad',mime:'text/html',size:100}))).status,400);
 assert.equal((await call('/api/assets/uploads','POST',JSON.stringify({name:'bad',mime:'video/mp4',size:1024**3+1}))).status,400);
 const session=await (await call('/api/assets/uploads','POST',metadata)).json(),url='/api/assets/uploads/'+session.id;
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
 const seed=new Uint8Array(1024*1024);for(let i=0;i<seed.length;i++)seed[i]=(i*13+7)%251;
 const file=new File([...Array(57).fill(seed),seed.slice(0,177)],'Монтаж.mp4',{type:'video/mp4'});
 const progress=[];const result=await uploadAsset(file,text=>progress.push(text));
 assert.equal(result.id,completedId);assert.equal(result.size,file.size);assert.equal(result.mime,'video/mp4');
 assert(file.size>50*1024*1024);assert(maxPart<=ASSET_PART_BYTES);assert.equal(partCalls,Math.ceil(file.size/ASSET_PART_BYTES)+1);
 const stored=await bucket.get(result.id);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(Buffer.from(await stored.arrayBuffer())),hash(Buffer.from(await file.arrayBuffer())),'Every uploaded byte is preserved');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM assets WHERE id=?').bind(result.id).first()).n,1);
 assert.equal(await db.prepare('SELECT id FROM asset_uploads WHERE id=?').bind(result.id).first(),null);
 assert.equal((await call('/api/assets/uploads/'+result.id,'DELETE')).status,204);
 assert(await bucket.head(result.id),'Abort after a lost response must never delete completed media');
 assert.equal((await call('/api/assets/uploads/'+result.id,'POST','{}','other')).status,404);
 assert(progress.some(s=>s.includes('без дополнительного сжатия')));
 // Recovery between atomic file publication and the metadata transaction.
 const retry=await (await call('/api/assets/uploads','POST',metadata)).json();
 const row=await db.prepare('SELECT * FROM asset_uploads WHERE id=?').bind(retry.id).first();
 const pending=bucket.resumeMultipartUpload(row.id,row.upload_id);
 const uploaded=await pending.uploadPart(1,new Uint8Array(100));await pending.complete([uploaded]);
 const recovered=await call('/api/assets/uploads/'+retry.id,'POST','{}');assert.equal(recovered.status,200);
 assert.equal((await recovered.json()).size,100);
 console.log('PASS real Node/SQLite/files: 57 MiB byte-identical upload, bounded parts, lost part/completion retries, ownership and origin checks, validation, abort safety and interrupted metadata recovery.');
} finally {globalThis.fetch=originalFetch;db.close();await rm(temporary,{recursive:true,force:true});}
