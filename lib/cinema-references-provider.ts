import {call,json,ProviderError} from './provider-http';
import {cinemaSourceUrl,CINEMA_RESEARCH_MODELS,type CinemaReferenceRun} from './cinema-references';
export type CinemaResearchReceipt={text:string;sources:{url:string;title?:string}[];searchPerformed:boolean;requestId?:string;usage?:unknown;actual:string|null;error?:string};
/** Sources come only from structured tool metadata, never from links authored in output text. */
export function cinemaProviderSources(response:any){
  const found:{url:string;title?:string}[]=[];
  const add=(entry:any)=>{const url=cinemaSourceUrl(typeof entry==='string'?entry:entry?.url);if(url&&!found.some(s=>s.url===url)&&found.length<80)found.push({url,...(typeof entry?.title==='string'?{title:entry.title.slice(0,1200)}:{})});};
  for(const item of Array.isArray(response.output)?response.output:[]){
    if(item?.type==='web_search_call')for(const source of Array.isArray(item.action?.sources)?item.action.sources:[])add(source);
    if(item?.type==='message')for(const part of Array.isArray(item.content)?item.content:[])for(const a of Array.isArray(part?.annotations)?part.annotations:[]){if(a?.type==='url_citation'){add(a);if(a.url_citation)add(a.url_citation);}}
  }
  for(const citation of Array.isArray(response.citations)?response.citations:[])add(citation);
  return found;
}
/** Verified 2026-10-08:
 * https://developers.openai.com/api/docs/guides/tools-web-search
 * https://docs.x.ai/developers/tools/web-search
 * https://docs.x.ai/developers/tools/citations
 * https://docs.x.ai/developers/tools/tool-usage-details */
export async function generateCinemaResearch(run:CinemaReferenceRun,prompt:string,key:string):Promise<CinemaResearchReceipt>{
  const m=CINEMA_RESEARCH_MODELS.find(m=>m.id===run.model);if(!m)throw new ProviderError('Модель киноисследования не поддерживается.',true,true);
  const search=!run.reusedFrom,openai=m.provider==='openai';
  const body={model:run.model,input:[{role:'user',content:prompt}],store:false,max_output_tokens:14000,
    ...(openai?{reasoning:{effort:'medium'},service_tier:'default'}:{}),
    ...(search?{tools:[{type:'web_search'}],...(openai?{include:['web_search_call.action.sources'],max_tool_calls:5}:{max_turns:3,include:['no_inline_citations']})}:{}),
  };
  const r=await call(openai?'https://api.openai.com/v1/responses':'https://api.x.ai/v1/responses',{'content-type':'application/json',Authorization:`Bearer ${key}`},body,240000),d=await json(r);
  const text=(Array.isArray(d.output)?d.output:[]).filter((v:any)=>v.type==='message'&&v.role==='assistant').flatMap((v:any)=>Array.isArray(v.content)?v.content:[]).filter((v:any)=>v.type==='output_text'&&typeof v.text==='string').map((v:any)=>v.text).join('\n').trim();
  const sources=cinemaProviderSources(d),searchPerformed=(d.output??[]).some((v:any)=>v.type==='web_search_call'&&v.status!=='failed');
  const ticks=d.usage?.cost_in_usd_ticks;
  const actual=!openai&&ticks!=null&&/^\d+$/.test(String(ticks))?String(ticks):null;
  return {text:text.slice(0,150000),sources,searchPerformed,requestId:d.id??r.headers.get('x-request-id')??undefined,usage:d.usage,actual,
    ...(d.status&&d.status!=='completed'?{error:'Киноисследователь не завершил ответ. Полученные данные и расход сохранены; повтор только вручную.'}:
      !text?{error:'Киноисследователь не вернул текст. Расход сохранён; повтор только вручную.'}:
      text.length>150000?{error:'Ответ киноисследователя слишком велик. Расход сохранён; повтор только вручную.'}:
      search&&!searchPerformed?{error:'Модель не выполнила поиск в интернете. Ответ не считается исследованием; сохранён для проверки, автоматического повтора нет.'}:{}),
  };
}
