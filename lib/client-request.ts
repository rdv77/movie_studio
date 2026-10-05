/** API failures must never expose an HTML page or turn an ambiguous write into a retry. */
export class ApiResponseError extends Error {
  constructor(message: string, public status: number, public endpoint: string,
    public retryable: boolean, public uncertain: boolean, public code?:string) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

function endpointFor(url: string) {
  try { return new URL(url, 'https://studio.invalid').pathname; }
  catch { return '/api'; }
}
function transportError(url: string, method: string, status: number, kind: 'html' | 'format' | 'network') {
  const endpoint = endpointFor(url);
  const uncertain = method !== 'GET' && (status === 0 || status >= 500 || status < 400);
  const reason = kind === 'network' ? 'Связь со студией прервалась.'
    : kind === 'html' ? 'Сервер вернул HTML-страницу вместо данных.'
    : 'Сервер вернул ответ в неверном формате.';
  const detail = `${status ? ' HTTP ' + status + '.' : ''} Запрос: ${endpoint}.`;
  const advice = status === 401 || status === 403 ? ' Проверьте вход в студию.'
    : uncertain ? ' Результат действия не подтверждён. Обновите данные и проверьте журнал перед повторным запуском. Автоматического повтора этого действия нет.'
    : ' Обновите данные. Это сообщение само по себе не означает отказ модели.';
  return new ApiResponseError(reason + detail + advice, status, endpoint,
    status === 0 || status === 408 || status === 429 || status >= 500 || status < 400, uncertain);
}

export async function apiResponse<T = any>(r: Response, url: string, method = 'GET'): Promise<T> {
  method = method.toUpperCase();
  const type = r.headers.get('content-type') ?? '';
  if (/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) {
    await r.body?.cancel().catch(() => {});
    throw transportError(url, method, r.status, 'html');
  }
  let data: any;
  try { data = await r.json(); }
  catch { throw transportError(url, method, r.status, 'format'); }
  if (!r.ok || data && typeof data === 'object' && !Array.isArray(data) && data.error) {
    const message = typeof data?.error === 'string' ? data.error
      : typeof data?.error?.message === 'string' ? data.error.message : 'Не удалось выполнить действие.';
    if (/Unexpected (?:token|end)[\s\S]*(?:JSON|json)/.test(message))
      throw transportError(url, method, r.status, 'format');
    throw new ApiResponseError(message, r.status, endpointFor(url), r.status === 408 || r.status === 429 || r.status >= 500, false,
      r.status===503&&data?.code==='MEDIA_WORKER_BUSY'?'MEDIA_WORKER_BUSY':undefined);
  }
  if (data === null || typeof data !== 'object') throw transportError(url, method, r.status, 'format');
  return data;
}

export async function request(url: string, method = 'GET', body?: unknown): Promise<any> {
  method = method.toUpperCase();
  for (let attempt = 0; ; attempt++) {
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: body instanceof FormData || body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
          body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { throw transportError(url, method, 0, 'network'); }
      return await apiResponse(response, url, method);
    } catch (error) {
      // Only reread data once. POST/PATCH/DELETE (including job advancement)
      // are never replayed by transport recovery, regardless of HTTP status.
      if (method !== 'GET' || attempt >= 1 || !(error instanceof ApiResponseError) || !error.retryable) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
