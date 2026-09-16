export class ProviderError extends Error {
  constructor(
    message: string,
    public definite = false,
    public notSent = false,
  ) {
    super(message);
  }
}
export async function call(url: string, h: Record<string, string>, body?: unknown) {
  let options: RequestInit;
  try {
    options = {
      method: body ? 'POST' : 'GET',
      headers: h,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180000),
      redirect: 'manual',
    };
    // Validate locally before distinguishing a transport failure from a sent request.
    new Request(url, options);
  } catch {
    throw new ProviderError('Запрос не отправлен: ошибка подготовки обращения к модели.', true, true);
  }
  let r: Response;
  try {
    r = await fetch(url, options);
  } catch {
    throw new ProviderError(
      'Связь с провайдером прервалась. Исход запроса неизвестен; автоматического повтора не будет.',
    );
  }
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
          size += next.value.length;
          if (size > 8192) break;
          chunks.push(next.value);
        }
        await reader.cancel();
        const data = JSON.parse(await new Blob(chunks as BlobPart[]).text());
        const message = data.error?.message ?? data.error ?? data.message ?? data.detail;
        if (typeof message === 'string') detail = message;
      }
      for (const value of Object.values(h)) {
        const key = value.replace(/^Bearer /i, '');
        if (key.length >= 8) detail = detail.split(key).join('[скрыто]');
      }
      detail = detail.replace(/Bearer\s+\S+/gi, 'Bearer [скрыто]')
        .replace(/data:[^\s]+/gi, '[изображение]').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
    } catch { /* A malformed error must not obscure the HTTP status. */ }
    if (r.status !== 400 && r.status !== 422) detail = '';
    const advice = r.status === 400 || r.status === 422 ? 'Проверьте параметры запроса.'
      : r.status === 401 || r.status === 403 ? 'Проверьте API-ключ и доступ к модели.'
      : r.status === 402 ? 'Проверьте баланс провайдера.'
      : r.status === 429 ? 'Достигнут лимит провайдера. Повторите позднее вручную.'
      : 'Проверьте запрос в кабинете провайдера.';
    throw new ProviderError(
      `Провайдер вернул HTTP ${r.status}. ${detail ? detail + ' ' : ''}${advice}`,
      r.status < 500,
    );
  }
  return r;
}
export async function json(r: Response) {
  const d: any = await r.json();
  if (d.base_resp?.status_code)
    throw new ProviderError(
      `MiniMax: ${d.base_resp.status_msg || d.base_resp.status_code}`,
      true,
    );
  return d;
}
