export class ProviderError extends Error {
  constructor(
    message: string,
    public definite = false,
    public notSent = false,
    public retryable = false,
    public httpStatus?: number,
  ) {
    super(message);
  }
}
export function providerDetail(value:unknown,key=''):string{
  if(typeof value!=='string')return '';
  return (key?value.split(key).join('[скрыто]'):value)
    .replace(/Bearer\s+\S+|(?:api[_-]?key|authorization)\s*[:=]\s*\S+/gi,'[скрыто]')
    .replace(/data:\S+|https?:\/\/\S+/gi,'[адрес]').replace(/[\r\n\t]+/g,' ').slice(0,500);
}
export async function call(url: string, h: Record<string, string>, body?: unknown, timeoutMs=body?180000:30000) {
  let options: RequestInit;
  try {
    options = {
      method: body ? 'POST' : 'GET',
      headers: h,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    };
    // Validate locally before distinguishing a transport failure from a sent request.
    // Validating multipart with a throwaway Request serializes every image a
    // second time. Validate its headers/method without duplicating the body.
    new Request(url, body instanceof FormData?{...options,body:undefined}:options);
  } catch {
    throw new ProviderError('Запрос не отправлен: ошибка подготовки обращения к модели.', true, true);
  }
  let r: Response|undefined;
  // Only idempotent reads may retry. A paid POST is never repeated here,
  // including when its response is lost or the provider returns HTTP 5xx.
  for(let attempt=0;attempt<(body?1:3);attempt++){
    try{r=await fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});}
    catch(e){
      if(!body&&attempt<2){await new Promise(resolve=>setTimeout(resolve,250*2**attempt));continue;}
      throw new ProviderError((e instanceof Error&&/Timeout|Abort/.test(e.name)?`Провайдер не ответил за ${timeoutMs/1000} сек. `:'Связь с провайдером прервалась. ')+
        (body?'Исход запроса неизвестен; этот запрос автоматически не повторяется.':'Не удалось прочитать состояние прежнего запроса. Новая генерация не отправлялась.'));
    }
    if(!body&&attempt<2&&(r.status===429||r.status>=500)){
      const retryAfter=Number(r.headers.get('retry-after'))*1000;
      // Long provider pauses belong to the persisted polling backoff. Do not
      // occupy an HTTP worker just to sleep for a minute.
      if(Number.isFinite(retryAfter)&&retryAfter>2000)break;
      await r.body?.cancel();await new Promise(resolve=>setTimeout(resolve,Math.max(250*2**attempt,Number.isFinite(retryAfter)?retryAfter:0)));continue;
    }
    break;
  }
  if(!r)throw new ProviderError('Не удалось прочитать ответ провайдера.');
  if (r.status >= 300 && r.status < 400)
    throw new ProviderError('Провайдер перенаправил запрос. Переход не выполнен; проверьте обращение и списание в кабинете.', true);
  if (!r.ok) {
    let detail = '';
    try {
      // Read a bounded error body; never persist a complete provider response.
      const reader = r.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (size < 8192) {
          const next = await reader.read();
          if (next.done) break;
          const chunk=next.value.subarray(0,8192-size);
          chunks.push(chunk);size+=chunk.length;
        }
        await reader.cancel();
        const prefix=await new Blob(chunks as BlobPart[]).text();
        let data:any;
        try{data=JSON.parse(prefix);}catch{
          // A validation error may echo megabytes of input after loc/msg.
          // Recover only complete JSON string messages from the bounded prefix.
          const messages=[...prefix.matchAll(/"msg"\s*:\s*("(?:[^"\\]|\\.)*")/g)].slice(0,5).map(m=>JSON.parse(m[1]));
          const location=/"loc"\s*:\s*(\[[^\]]{0,500}\])/.exec(prefix);
          data={detail:messages.map(msg=>({msg,loc:location?JSON.parse(location[1]):[]}))};
        }
        const issues=Array.isArray(data.detail)?data.detail:Array.isArray(data.error?.details)?data.error.details:[];
        // FastAPI/fal validation bodies contain loc/msg/type plus a potentially
        // enormous private input. Retain only the field and bounded message.
        const fields=issues.slice(0,5).map((v:any)=>{
          const loc=Array.isArray(v?.loc)?v.loc.filter((x:any)=>typeof x==='string'||typeof x==='number').join('.'):'';
          return typeof v?.msg==='string'?`${loc?loc+': ':''}${v.msg.slice(0,250)}`:'';
        }).filter(Boolean).join('; ');
        const message = [data.error?.message,data.error,data.message,fields||undefined,data.detail].find(value=>typeof value==='string');
        if (typeof message === 'string') detail = message;
      }
      for (const value of Object.values(h)) {
        const key = value.replace(/^(?:Bearer|Key) /i, '');
        if (key.length >= 8) detail = detail.split(key).join('[скрыто]');
      }
      detail = detail.replace(/Bearer\s+\S+/gi, 'Bearer [скрыто]')
        .replace(/data:[^\s]+/gi, '[изображение]').replace(/https?:\/\/[^\s]+/gi,'[адрес]').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
    } catch { /* A malformed error must not obscure the HTTP status. */ }
    if (![400,403,422].includes(r.status)) detail = '';
    const xai=new URL(url).hostname==='api.x.ai';
    const advice = r.status === 400 || r.status === 422 ? 'Проверьте параметры запроса.'
      : r.status === 403 ? detail ? 'Провайдер запретил запрос; ориентируйтесь на его пояснение выше.'
        : xai ? 'xAI запретил запрос без пояснения. Проверьте права API-ключа на изображения и выбранную модель в console.x.ai. Причину отказа по содержимому этот ответ не подтверждает.'
        : 'Доступ запрещён провайдером без пояснения. Проверьте разрешения ключа и модели в его кабинете.'
      : r.status === 401 ? 'Проверьте API-ключ и доступ к модели.'
      : r.status === 402 ? 'Проверьте баланс провайдера.'
      : r.status === 429 ? 'Достигнут лимит провайдера. Повтор возможен после паузы.'
      : 'Проверьте запрос в кабинете провайдера.';
    throw new ProviderError(
      `Провайдер вернул HTTP ${r.status}. ${detail ? detail + ' ' : ''}${advice}`,
      r.status < 500,
      false, r.status===429, r.status,
    );
  }
  return r;
}
export async function json(r: Response) {
  let d: any;
  try { d = await r.json(); }
  catch {
    // An accepted HTTP response without a usable receipt is ambiguous. Never
    // classify it as a rejected/not-sent request or repeat a paid generation.
    throw new ProviderError(`Провайдер вернул ответ в неверном формате (HTTP ${r.status}), возможно HTML-страницу вместо JSON. Исход запроса неизвестен; автоматического повтора не будет. Проверьте результат и расход в кабинете провайдера.`);
  }
  if (!d || typeof d !== 'object' || Array.isArray(d))
    throw new ProviderError(`Провайдер вернул некорректные данные (HTTP ${r.status}). Исход запроса неизвестен; автоматического повтора не будет.`);
  if (d.base_resp?.status_code)
    throw new ProviderError(
      `MiniMax: ${providerDetail(d.base_resp.status_msg) || d.base_resp.status_code}`,
      true,
    );
  return d;
}
