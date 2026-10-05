import type { Project } from './domain';
import type { ObjectStore } from './storage-types';
import {projectAssetIds} from './project-assets';

// D1 limits a string/table row to 2,000,000 bytes. Keep ample headroom and
// store growing project snapshots as private blobs in the existing R2 binding.
export const PROJECT_STATE_INLINE_BYTES=512_000;
const tag='$kadrProjectState';
const encoder=new TextEncoder();
export class ProjectStorageError extends Error {}
async function hash(bytes:Uint8Array<ArrayBuffer>){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
async function prefix(user:string,id:string){return `project-state/${await hash(encoder.encode(JSON.stringify([user,id])))}/`;}

export async function encodeProjectState(files:ObjectStore,user:string,p:Project) {
  const text=JSON.stringify(p),bytes=encoder.encode(text);
  if(bytes.byteLength<=PROJECT_STATE_INLINE_BYTES)return {state:text};
  const key=`${await prefix(user,p.id)}${p.revision}/${crypto.randomUUID()}.json`;
  try {
    const saved=await files.put(key,bytes,{httpMetadata:{contentType:'application/json'}});
    if(!saved)throw new Error('Empty storage response');
  }catch {throw new ProjectStorageError('Не удалось сохранить данные проекта. Предыдущая сохранённая версия остаётся доступной. Повторите действие позже.');}
  // File-list refreshes need membership, not another 18+ MB film snapshot.
  // This index is written with the same immutable snapshot and D1 revision.
  return {state:JSON.stringify({[tag]:'r2-v1',key,size:bytes.byteLength,sha256:await hash(bytes),revision:p.revision,assetIds:[...projectAssetIds(p)]})};
}

/** Only call with a row already authorized by owner/id. Old pointers fall back
 * to the full snapshot once; their next normal save writes the small index. */
export async function storedProjectAssetIds(user:string,id:string,state:string,revision:number):Promise<Set<string>|undefined>{
  let data:any;try{data=JSON.parse(state);}catch{return;}
  if(!data||typeof data!=='object')return;
  if(!Object.hasOwn(data,tag))return data.id===id&&Array.isArray(data.items)&&Array.isArray(data.jobs)?projectAssetIds(data):undefined;
  const scope=await prefix(user,id),start=scope+revision+'/';
  if(data[tag]!=='r2-v1'||data.revision!==revision||typeof data.key!=='string'||!data.key.startsWith(start)||
    !/^[0-9a-f-]{36}\.json$/.test(data.key.slice(start.length))||!Array.isArray(data.assetIds)||
    !data.assetIds.every((value:unknown)=>typeof value==='string'&&value.length>0))return;
  return new Set<string>(data.assetIds);
}

export async function decodeProjectState(files:ObjectStore,user:string,id:string,state:string,revision:number):Promise<Project> {
  const fail=()=>new ProjectStorageError('Не удалось прочитать сохранённые данные проекта. Не создавайте его заново: повторите загрузку позже.');
  let data:any;
  try{data=JSON.parse(state);}catch{throw fail();}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail();
  if(Object.hasOwn(data,tag)){
    const scope=await prefix(user,id);
    if(data[tag]!=='r2-v1'||typeof data.key!=='string'||!data.key.startsWith(scope+revision+'/')||
      !/^[0-9a-f-]{36}\.json$/.test(data.key.slice((scope+revision+'/').length))||
      data.revision!==revision||!Number.isSafeInteger(data.size)||data.size<1||!/^[a-f0-9]{64}$/.test(data.sha256??''))throw fail();
    const pointer=data;
    try{
      const object=await files.get(pointer.key);
      if(!object||object.size!==pointer.size)throw fail();
      const bytes=new Uint8Array(await object.arrayBuffer());
      if(bytes.byteLength!==pointer.size||await hash(bytes)!==pointer.sha256)throw fail();
      data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(data.revision!==revision)throw fail();
    }catch{throw fail();}
  }
  if(!data||data.id!==id||!Array.isArray(data.items)||!Array.isArray(data.jobs))throw fail();
  return {...data,revision} as Project;
}
