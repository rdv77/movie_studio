export const OPENAI_IMAGE_PROMPT_LIMIT=32000;
export const OPENAI_IMAGE_REFS_BYTES=20*1024*1024;
export function isOpenAIImage(model:string){return ['gpt-image-2.5-sunburst','gpt-image-2.5-flare'].includes(model);}
export function openAIImageSize(format:string){return format==='9:16'?'864x1536':format==='1:1'?'1024x1024':'1536x864';}
// A tariff calculation, not a billing receipt. Published image usage does not
// reliably identify cached text/image tokens, so actual cost stays unconfirmed.
export function openAIImageTariff(usage:any):string|null {
  const t=usage?.input_tokens_details?.text_tokens,i=usage?.input_tokens_details?.image_tokens,o=usage?.output_tokens;
  if(![t,i,o,usage?.input_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)||t+i!==usage.input_tokens)return null;
  if(usage.output_tokens_details && (usage.output_tokens_details.text_tokens>0||usage.output_tokens_details.image_tokens!==o))return null;
  return (BigInt(t)*50000n+BigInt(i)*80000n+BigInt(o)*300000n).toString();
}
