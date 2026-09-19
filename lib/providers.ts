import { generateFal, pollFal } from './fal-provider';
import { generateGoogle, pollGoogle } from './google-provider';
import { call, json, ProviderError } from './provider-http';
export { ProviderError } from './provider-http';
import { generateZen, pollZen } from './zencreator-provider';
import type { Job } from './domain';
import { model } from './models';
import { VIDEO_PROMPT_LIMIT } from './video';
import { isMiniMaxImage, miniMaxImageRefIssue, MINIMAX_IMAGE_PROMPT_LIMIT } from './minimax-image';
import { isOpenAIImage, openAIImageSize, OPENAI_IMAGE_PROMPT_LIMIT, OPENAI_IMAGE_REFS_BYTES } from './openai-image';
export type Result = {
  error?: string;
  pending?: boolean;
  requestId?: string;
  pollingUrl?: string;
  text?: string;
  url?: string;
  bytes?: Uint8Array;
  mime?: string;
  actual?: string | null;
  usage?: unknown;
};
function headers(provider: string, key: string) {
  return {
    'content-type': 'application/json',
    ...(provider === 'bfl'
      ? { 'x-key': key }
      : provider === 'elevenlabs'
        ? { 'xi-api-key': key }
        : { Authorization: `Bearer ${key}` }),
  };
}
function receipt(d: any): Pick<Result, 'actual' | 'usage'> {
  const t = d.usage?.cost_in_usd_ticks;
  return {
    actual: t != null && /^\d+$/.test(String(t)) ? String(t) : null,
    usage: d.usage ?? d.extra_info,
  };
}
export async function generate(
  j: Job,
  key: string,
  refs: string[],
  format: string,
  characterRefs: string[] = [],
): Promise<Result> {
  if (j.kind === 'video' && j.prompt.length > VIDEO_PROMPT_LIMIT)
    throw new ProviderError(`Видеопромпт длиннее ${VIDEO_PROMPT_LIMIT} символов. Сократите его и запустите новую серию. Запрос не отправлен.`, true, true);
  const m = model(j.model),
    h = headers(m.provider, key);
  if (m.provider === 'sync') throw new ProviderError('Используйте отдельное окно синхронизации губ.', true, true);
  if(m.provider==='fal')return generateFal(j,key,refs,format);
  if(m.provider==='google')return generateGoogle(j,key,refs,format);
  if(m.provider==='zencreator')return generateZen(j,key,refs,format);
  let d: any;
  if (j.kind === 'image' && isMiniMaxImage(j.model)) {
    if (!j.prompt.trim() || j.prompt.length > MINIMAX_IMAGE_PROMPT_LIMIT)
      throw new ProviderError('MiniMax image-01: промпт должен содержать от 1 до 1500 символов. Запрос не отправлен.',true,true);
    const inputs=refs.map(ref=>{
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(ref);
      if(!match||match[2].length%4)throw new ProviderError('MiniMax image-01: нужен референс PNG/JPEG в формате Data URL. Запрос не отправлен.',true,true);
      return {mime:match[1],size:match[2].length*3/4-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0)};
    });
    const issue=miniMaxImageRefIssue(inputs);if(issue)throw new ProviderError(issue,true,true);
    if(!['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'].includes(format))
      throw new ProviderError('MiniMax image-01: неподдерживаемый формат кадра.',true,true);
    d=await json(await call('https://api.minimax.io/v1/image_generation',h,{
      model:'image-01',prompt:j.prompt,aspect_ratio:format,n:1,response_format:'url',prompt_optimizer:false,
      ...(refs.length?{subject_reference:refs.map(image_file=>({type:'character',image_file}))}:{}),
    }));
    const url=d.data?.image_urls?.[0];
    return {requestId:d.id,actual:null,usage:d.metadata,
      ...(typeof url==='string'&&url?{url}:{error:'MiniMax не вернул картинку. Проверьте расход в кабинете; повтор запускается вручную.'})};
  }
  if(j.kind==='image'&&isOpenAIImage(j.model)) {
    if(j.prompt.length>OPENAI_IMAGE_PROMPT_LIMIT||refs.length>8)throw new ProviderError('GPT Image: до 32 000 символов полного промпта и до 8 референсов в студии. Запрос не отправлен.',true,true);
    const settings={model:j.model,prompt:j.prompt,n:1,size:openAIImageSize(format),quality:'high',output_format:'png'};
    let body:unknown=settings,requestHeaders=h;
    if(refs.length) {
      const form=new FormData();for(const [key,value] of Object.entries(settings))form.set(key,String(value));
      let total=0;
      for(const [index,ref] of refs.entries()) {
        const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(ref);
        if(!match)throw new ProviderError('GPT Image: нужен референс PNG, JPEG или WebP.',true,true);
        const size=Math.floor(match[2].length*3/4)-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
        if(size>10*1024*1024)throw new ProviderError('GPT Image: каждый референс в студии должен быть до 10 МБ.',true,true);
        total+=size;
        if(total>OPENAI_IMAGE_REFS_BYTES)throw new ProviderError('GPT Image: суммарный размер референсов в студии — до 20 МБ.',true,true);
        let bytes:Uint8Array<ArrayBuffer>;
        try {bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}
        catch {throw new ProviderError('Не удалось прочитать референс GPT Image. Запрос не отправлен.',true,true);}
        form.append('image[]',new Blob([bytes],{type:match[1]}),`reference-${index+1}.${match[1].split('/')[1]}`);
      }
      body=form;requestHeaders={Authorization:`Bearer ${key}`} as typeof h;
    }
    const response=await call('https://api.openai.com/v1/images/'+(refs.length?'edits':'generations'),requestHeaders,body);
    d=await json(response);
    const usage=d.usage,requestId=response.headers.get('x-request-id')??undefined;
    const encoded=d.data?.[0]?.b64_json;
    if(typeof encoded!=='string'||!encoded)return {requestId,usage,actual:null,error:'OpenAI не вернул изображение. Проверьте расход; повтор запускается вручную.'};
    try {return {bytes:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),mime:'image/png',requestId,usage,actual:null};}
    catch {return {requestId,usage,actual:null,error:'Не удалось прочитать изображение OpenAI. Проверьте расход; повтор не отправлен.'};}
  }
  if (j.kind === 'text' && m.provider === 'openai') {
    d = await json(
      await call('https://api.openai.com/v1/responses', h, {
        model: j.model,
        instructions:
          'Ты сценарист и режиссер короткого анимационного фильма. Отвечай по-русски. Учитывай утвержденную основу. Выполни задачу режиссера и верни один готовый вариант текущего материала. Не включай внутренние рассуждения.',
        input: j.prompt,
        reasoning: { effort: 'medium' },
        max_output_tokens: 12000,
        service_tier: 'default',
        store: false,
      }),
    );
    const text = (Array.isArray(d.output) ? d.output : [])
      .filter((item: any) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
      .filter((part: any) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n')
      .trim();
    // Keep usage and request ID even when a paid response is incomplete/refused.
    // Token counts are not a billing receipt: reconcile actual cost separately.
    return {
      requestId: d.id,
      usage: d.usage,
      actual: null,
      ...(d.status !== 'completed'
        ? { error: 'OpenAI не завершил ответ. Проверьте расход в бюджете; повторная генерация запускается вручную.' }
        : !text
          ? { error: 'OpenAI не вернул текст сценария. Проверьте задачу и расход в бюджете.' }
          : { text }),
    };
  }
  if (j.kind === 'text') {
    d = await json(
      await call(
        `https://${m.provider === 'xai' ? 'api.x.ai' : 'api.minimax.io'}/v1/chat/completions`,
        h,
        {
          model: j.model,
          messages: [
            {
              role: 'system',
              content:
                'Ты сценарист и режиссер короткого анимационного фильма. Отвечай по-русски. Учитывай утвержденную основу. Не включай внутренние рассуждения.',
            },
            { role: 'user', content: j.prompt },
          ],
          stream: false,
          max_tokens: 7000,
        },
      ),
    );
    const text = d.choices?.[0]?.message?.content
      ?.replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    if (!text) throw new ProviderError('Провайдер не вернул текст.');
    return { text, requestId: d.id, ...receipt(d) };
  }
  if (j.kind === 'image' && m.provider === 'xai') {
    const body: any = {
      model: j.model,
      prompt: j.prompt,
      n: 1,
      resolution: '1k',
      quality: 'low',
      aspect_ratio: format,
    };
    if (refs.length === 1) body.image = { url: refs[0], type: 'image_url' };
    if (refs.length > 1)
      body.images = refs.map((url) => ({ url, type: 'image_url' }));
    d = await json(
      await call(
        `https://api.x.ai/v1/images/${refs.length ? 'edits' : 'generations'}`,
        h,
        body,
      ),
    );
    return { url: d.data?.[0]?.url, requestId: d.id, ...receipt(d) };
  }
  if (j.kind === 'image' && m.provider === 'bfl') {
    const body: any = {
      prompt: j.prompt,
      width: format === '16:9' ? 1024 : 576,
      height: format === '16:9' ? 576 : 1024,
      output_format: 'png',
    };
    refs.forEach(
      (r, i) => (body[i ? 'input_image_' + (i + 1) : 'input_image'] = r),
    );
    d = await json(await call('https://api.bfl.ai/v1/flux-2-pro', h, body));
    return {
      pending: true,
      requestId: d.id,
      pollingUrl: d.polling_url,
      ...receipt(d),
    };
  }
  if (j.kind === 'video') {
    if (j.model === 'MiniMax-H3') {
      const frame=/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(refs[0]??'');
      if(refs.length!==1||!frame||frame[1].length%4||frame[1].length>Math.ceil(10*1024*1024/3)*4||characterRefs.length)
        throw new ProviderError('MiniMax H3: выберите один первый кадр PNG/JPEG/WebP до 10 МБ. Отдельные референсы нельзя смешивать с первым кадром. Запрос не отправлен.',true,true);
      if(!j.prompt.trim())throw new ProviderError('MiniMax H3: добавьте описание действия. Запрос не отправлен.',true,true);
      d=await json(await call('https://api.minimax.io/v2/video_generation',h,{
        model:'MiniMax-H3',content:[{type:'text',text:j.prompt},{type:'image_url',image_url:{url:refs[0]},role:'first_frame'}],
        resolution:'768P',duration:6,ratio:'adaptive',
      }));
      if(typeof d.task_id!=='string'||!d.task_id)
        throw new ProviderError('MiniMax H3 не вернул номер задачи. Проверьте исход запроса в кабинете; автоматического повтора не будет.');
      return {pending:true,requestId:d.task_id,actual:null};
    }
    if (m.provider === 'xai') {
      d = await json(
        await call('https://api.x.ai/v1/videos/generations', h, {
          model: j.model,
          prompt: j.prompt,
          image: { url: refs[0] },
          ...(characterRefs.length ? {reference_images:characterRefs.map(url=>({url}))} : {}),
          duration: 6,
          resolution: '720p',
          aspect_ratio: format,
        }),
      );
      return { pending: true, requestId: d.request_id, ...receipt(d) };
    }
    d = await json(
      await call('https://api.minimax.io/v1/video_generation', h, {
        model: j.model,
        prompt: j.prompt,
        first_frame_image: refs[0],
        duration: 6,
        resolution: '768P',
        prompt_optimizer: false,
      }),
    );
    return { pending: true, requestId: d.task_id, ...receipt(d) };
  }
  if (j.kind === 'audio' && m.provider === 'elevenlabs') {
    const r = await call(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(j.voiceId)}?output_format=mp3_44100_128`,
      h,
      { model_id: j.model, text: j.dialogue },
    );
    return {
      bytes: new Uint8Array(await r.arrayBuffer()),
      mime: 'audio/mpeg',
      requestId: r.headers.get('request-id') ?? undefined,
      usage: { characters: j.dialogue.length },
      actual: null,
    };
  }
  if (j.kind === 'audio' && m.provider === 'minimax') {
    d = await json(
      await call('https://api.minimax.io/v1/t2a_v2', h, {
        model: j.model,
        text: j.dialogue,
        stream: false,
        output_format: 'hex',
        language_boost: 'Russian',
        voice_setting: { voice_id: j.voiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      }),
    );
    if (!/^(?:[a-f0-9]{2})+$/i.test(d.data?.audio ?? ''))
      throw new ProviderError('MiniMax не вернул аудио.');
    return {
      bytes: Uint8Array.from(d.data.audio.match(/.{2}/g), (x: any) =>
        parseInt(x, 16),
      ),
      mime: 'audio/mpeg',
      requestId: d.trace_id,
      ...receipt(d),
    };
  }
  throw new Error('Неизвестный тип генерации.');
}
export async function poll(j: Job, key: string): Promise<Result> {
  if(model(j.model).provider==='google')return pollGoogle(j,key);
  if(model(j.model).provider==='fal')return pollFal(j,key);
  if(model(j.model).provider==='zencreator')return pollZen(j,key);
  const m = model(j.model),
    h = headers(m.provider, key);
  let d: any;
  if(j.model==='MiniMax-H3') {
    if(!j.requestId)throw new ProviderError('MiniMax H3: нет номера ранее отправленной задачи.',true,true);
    d=await json(await call('https://api.minimax.io/v2/query/video_generation/'+encodeURIComponent(j.requestId),h));
    const task=d.task;
    if(!task||task.id!==j.requestId)throw new ProviderError('MiniMax H3 вернул ответ для неизвестной задачи. Новая генерация не запускается.');
    if(['queued','running'].includes(task.status))return {pending:true,actual:null};
    const receipt={requestId:task.id,usage:task.usage,actual:null};
    if(['failed','cancelled'].includes(task.status))return {...receipt,error:`MiniMax H3: ${task.status==='cancelled'?'задача отменена':'генерация не выполнена'}. Проверьте задачу ${task.id} в кабинете провайдера.`};
    if(task.status!=='succeeded')throw new ProviderError('MiniMax H3 вернул неизвестный статус. Проверьте задачу в кабинете; новая генерация не запускается.');
    const url=task.content?.url;
    return {...receipt,...(typeof url==='string'&&url?{url,mime:'video/mp4'}:{error:'MiniMax H3 завершил задачу без ссылки на видео. Проверьте результат в кабинете.'})};
  }
  if (m.provider === 'xai') {
    d = await json(
      await call(
        'https://api.x.ai/v1/videos/' + encodeURIComponent(j.requestId!),
        h,
      ),
    );
    if (['failed', 'expired'].includes(d.status))
      throw new ProviderError(
        'Генерация завершилась ошибкой или срок результата истек.',
        true,
      );
    return { pending: d.status !== 'done', url: d.video?.url, ...receipt(d) };
  }
  if (m.provider === 'bfl') {
    const url = new URL(j.pollingUrl!);
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'api.bfl.ai' || url.hostname.endsWith('.bfl.ai'))
    )
      throw new Error('Недопустимый адрес проверки FLUX.');
    d = await json(await call(url.href, h));
    if (
      ['Error', 'Failed', 'Request Moderated', 'Content Moderated'].includes(
        d.status,
      )
    )
      throw new ProviderError('FLUX не завершил генерацию: ' + d.status, true);
    return {
      pending: d.status !== 'Ready',
      url: d.result?.sample,
      ...receipt(d),
    };
  }
  d = await json(
    await call(
      'https://api.minimax.io/v1/query/video_generation?task_id=' +
        encodeURIComponent(j.requestId!),
      h,
    ),
  );
  if (d.status === 'Fail')
    throw new ProviderError('MiniMax сообщил об ошибке генерации.', true);
  if (d.status !== 'Success') return { pending: true, ...receipt(d) };
  const file = await json(
    await call(
      'https://api.minimax.io/v1/files/retrieve?file_id=' +
        encodeURIComponent(d.file_id),
      h,
    ),
  );
  return { url: file.file?.download_url, ...receipt(d) };
}
function resultUrl(url: string) {
  const u = new URL(url);
  const host = u.hostname.replace(/\.$/, '');
  if (
    u.protocol !== 'https:' ||
    /^(localhost|\d|\[)/.test(host) ||
    !host.includes('.') ||
    /\.(localhost|local|internal|lan|home)$/.test(host) ||
    (u.port && u.port !== '443') ||
    u.username ||
    u.password
  )
    throw new Error('Недопустимый адрес результата.');
  u.hash = '';
  return u;
}
export async function retrieve(url: string) {
  let u = resultUrl(url);
  const signal = AbortSignal.timeout(60000);
  const seen = new Set<string>();
  let r: Response;
  for (let redirects = 0; ; redirects++) {
    if (seen.has(u.href)) throw new Error('Ссылка результата зациклена. Файл не загружен; новая генерация не запускается.');
    seen.add(u.href);
    // Follow media redirects only, validating every destination. Never attach API credentials.
    r = await fetch(u.href, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(r.status)) break;
    const location = r.headers.get('location');
    await r.body?.cancel();
    if (!location) throw new Error('Провайдер не указал адрес перенаправления результата.');
    if (redirects >= 5) throw new Error('Слишком много перенаправлений результата. Файл не загружен; новая генерация не запускается.');
    u = resultUrl(new URL(location, u).href);
  }
  if (!r.ok) throw new Error('Не удалось сохранить результат провайдера.');
  if (Number(r.headers.get('content-length') ?? 0) > 50 * 1024 * 1024)
    throw new Error('Результат больше 50 МБ.');
  const reader = r.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 50 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Результат больше 50 МБ.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return { bytes, mime: (r.headers.get('content-type') ?? '').split(';')[0] };
}
