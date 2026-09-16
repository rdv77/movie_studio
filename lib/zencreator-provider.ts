import type { Job } from './domain';
import type { Result } from './providers';
import { call, json, ProviderError } from './provider-http';
import { ZEN_MODELS, zenProfile, zenTool, prepareZenJobs, generationSeconds } from './zencreator-models';

const BASE='https://api.zencreator.pro/api/public/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function auth(key:string) { return {Authorization:`Bearer ${key}`}; }
function clean(message:unknown,key:string) {
  return typeof message==='string'?message.split(key).join('[скрыто]').replace(/https?:\/\/\S+|data:\S+/g,'[адрес]').slice(0,400):'';
}
async function catalog(key:string) {
  const data=await json(await call(`${BASE}/tools`,auth(key)));
  if(!Array.isArray(data.tools))throw new ProviderError('ZenCreator: каталог моделей не получен.');
  return data.tools;
}
function schemaNode(root:any,node:any,depth=0):any {
  if(depth>8||!node||typeof node!=='object')return {};
  if(typeof node.$ref==='string'&&node.$ref.startsWith('#/')) {
    const target=node.$ref.slice(2).split('/').reduce((v:any,k:string)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],root);
    return {...schemaNode(root,target,depth+1),...Object.fromEntries(Object.entries(node).filter(([k])=>k!=='$ref'))};
  }
  return node;
}
function enumValues(root:any,node:any,depth=0):unknown[] {
  if(depth>8)return [];
  node=schemaNode(root,node);
  return [...(Array.isArray(node.enum)?node.enum:[]),...(node.const!==undefined?[node.const]:[]),
    ...[...(node.anyOf??[]),...(node.oneOf??[]),...(node.allOf??[])].flatMap(n=>enumValues(root,n,depth+1))];
}
function available(tools:any[],id:string,refs:number) {
  const tool=tools.find(t=>t.name===zenTool(id,refs));
  const root=tool?.input_schema;
  const values=enumValues(root,schemaNode(root,root)?.properties?.model);
  return !!tool&&values.includes(zenProfile(id)?.native);
}
export async function checkZenConnection(key:string) {
  const tools=await catalog(key);
  const balance=await json(await call(`${BASE}/balance`,auth(key)));
  if(!Number.isFinite(balance.credits))throw new ProviderError('ZenCreator: баланс не получен.');
  return {credits:balance.credits,checkedAt:new Date().toISOString(),models:ZEN_MODELS.map(m=>({id:m.id,name:m.name,kind:m.kind,
    available:available(tools,m.id,m.kind==='video'?1:0),references:m.kind==='image'?available(tools,m.id,1):undefined}))};
}
export async function generateZen(j:Job,key:string,refs:string[],format:string):Promise<Result> {
  const p=zenProfile(j.model);
  if(!p)throw new ProviderError('ZenCreator: неизвестная модель.',true,true);
  let files:{mime:string;data:string;size:number}[],tool:any;
  try {
    if(refs.length!==j.refs.length)throw new Error('ZenCreator: не все выбранные референсы загружены.');
    files=refs.map(ref=>{
      const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(ref);
      if(!match||match[2].length%4)throw new Error('ZenCreator: нужен референс PNG/JPEG/WebP.');
      return {mime:match[1],data:match[2],size:match[2].length*3/4-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0)};
    });
    prepareZenJobs([j],files);
    if(!['16:9','9:16'].includes(format))throw new Error('ZenCreator: неподдерживаемый формат фильма.');
    if(!UUID.test(j.id))throw new Error('ZenCreator: отсутствует идентификатор попытки.');
    const tools=await catalog(key);
    if(!available(tools,j.model,refs.length))throw new Error('ZenCreator: модель недоступна для этого ключа или типа задачи. Проверьте доступ в кабинете.');
    tool=tools.find((t:any)=>t.name===zenTool(j.model,refs.length));
    const schema=tool.input_schema,props=schemaNode(schema,schema)?.properties??{};
    const cap=schemaNode(schema,props.prompt).maxLength??schemaNode(schema,props.positive_prompt).maxLength;
    if(typeof cap==='number'&&j.prompt.length>cap)throw new Error(`ZenCreator: промпт длиннее ${cap} символов, разрешённых текущим API.`);
    const maxRefs=schemaNode(schema,props.image_assets).maxItems;
    if(typeof maxRefs==='number'&&refs.length>maxRefs)throw new Error(`ZenCreator: API разрешает не более ${maxRefs} референсов.`);
  } catch(e) { throw new ProviderError(`${e instanceof Error?e.message:'ZenCreator: ошибка проверки.'} Генерация не отправлена.`,true,true); }
  const assets:string[]=[];
  // Private references are uploaded directly, in order; no publicly shared URLs.
  try {
    for(const file of files) {
      const form=new FormData();
      form.append('file',new Blob([Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))],{type:file.mime}),`reference.${file.mime.split('/')[1]}`);
      form.append('media_type',file.mime);
      const out=await json(await call(`${BASE}/assets`,auth(key),form));
      if(!UUID.test(out.asset_id??''))throw new Error('ZenCreator: не получен идентификатор загруженного референса.');
      assets.push(out.asset_id);
    }
  } catch(e) { throw new ProviderError(`${e instanceof Error?e.message:'Ошибка загрузки референсов.'} Платная генерация не отправлена.`,true,true); }
  const prompt=p.kind==='video'?j.prompt.replace(/до конца 6-секундного клипа/g,`до конца ${generationSeconds(j.model)}-секундного клипа`):j.prompt;
  const input=p.kind==='text'?{model:p.native,prompt,max_tokens:4096,system_prompt:''}
    :p.kind==='video'?{model:p.native,prompt,ref_asset:assets[0],duration:p.seconds,resolution:'720p',ratio:format,generate_audio:false,prompt_extend:false}
    :assets.length?{model:p.native,prompt,image_assets:assets,ratio:format,tier:'2K',batch_mode:false,number_of_images:1,sequential_generation:false,rewrite_prompt:false}
    :{model:p.native,positive_prompt:prompt,ratio:format,tier:'2K',mode:'fast',batch_size:1,rewrite_prompt:false};
  const out=await json(await call(`${BASE}/generations`,{...auth(key),'content-type':'application/json','Idempotency-Key':j.id},{tool:tool.name,input}));
  // From here, missing receipts and transport failures are ambiguous, never free.
  if(!UUID.test(out.id??''))throw new ProviderError('ZenCreator: идентификатор задачи не получен. Проверьте запрос в кабинете; повтор не отправляется.');
  return {pending:true,requestId:out.id,actual:null,usage:{provider:'zencreator',credits_estimate:j.zenCreditsEstimate}};
}
export async function pollZen(j:Job,key:string):Promise<Result> {
  if(!UUID.test(j.requestId??''))throw new ProviderError('ZenCreator: неверный идентификатор задачи.',true);
  const url=`${BASE}/generations/${j.requestId}`;
  const status=await json(await call(url,auth(key)));
  if(status.id!==j.requestId)throw new ProviderError('ZenCreator: получен статус другой задачи.');
  const usage={provider:'zencreator',credits_estimate:j.zenCreditsEstimate,progress:status.progress};
  if(['queued','processing'].includes(status.status))return {pending:true,requestId:j.requestId,actual:null,usage};
  if(status.status==='failed')return {error:`ZenCreator: ${clean(status.error,key)||'генерация завершилась ошибкой. Проверьте возврат кредитов в кабинете.'}`,actual:null,usage};
  if(!['succeeded','partial'].includes(status.status))throw new ProviderError('ZenCreator: неизвестный статус задачи.');
  const out=await json(await call(`${url}/result`,auth(key)));
  if(out.id!==j.requestId)throw new ProviderError('ZenCreator: получен результат другой задачи.');
  if(j.kind==='text'&&typeof out.text==='string'&&out.text.trim())return {text:out.text,actual:null,usage};
  const download=out.outputs?.[0]?.download_url;
  if(j.kind!=='text'&&typeof download==='string'&&download.startsWith('https://'))return {url:download,actual:null,usage};
  // Retry this read (including a refreshed signed URL), never the generation.
  throw new ProviderError('ZenCreator: оригинал результата пока недоступен. Повторяется только проверка готового запроса.');
}
