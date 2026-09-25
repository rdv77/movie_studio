// Provider limits and conservative application budgets are distinct. Unknown
// provider limits are not advertised as unlimited. Keep historical model IDs.
export function promptCapacity(modelId:string,kind:'image'|'video'){
  if(modelId==='image-01')return {limit:1500,source:'API',short:true};
  if(modelId==='MiniMax-Hailuo-2.3')return {limit:2000,source:'API',short:true};
  if(modelId==='MiniMax-H3')return {limit:7000,source:'API',short:false};
  if(kind==='image'&&modelId.startsWith('gpt-image-'))return {limit:32000,source:'API',short:false};
  return {limit:5000,source:'бюджет студии; провайдер может иметь дополнительные ограничения',short:false};
}
export const videoPromptLimit=(modelId:string)=>promptCapacity(modelId,'video').limit;
export const selectedVideoPromptLimit=(ids:string[])=>ids.length?Math.min(...ids.map(videoPromptLimit)):5000;
export const availableForDirecting=(id:string)=>!['image-01','MiniMax-Hailuo-2.3'].includes(id);
