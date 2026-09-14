export type VoiceOption = { id: string; name: string; description: string; category: string; russian: boolean };
const clean = (v: unknown, max = 240) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
export function isRussianVoice(voice: any, provider: 'minimax' | 'elevenlabs') {
  const russian = (value: unknown) => /^(ru(?:[-_]ru)?|rus|russian|русский(?: язык)?)$/i.test(clean(value));
  if (provider === 'minimax' && /^Russian_/i.test(clean(voice.voice_id,150))) return true;
  return [voice.language, voice.labels?.language, ...(Array.isArray(voice.verified_languages) ? voice.verified_languages.map((v: any) => v?.language) : [])].some(russian);
}
export async function voiceCatalog(provider: 'minimax' | 'elevenlabs', key: string, cursor = '', scope: 'russian' | 'all' = 'russian') {
  const url = provider === 'minimax' ? 'https://api.minimax.io/v1/get_voice'
    : 'https://api.elevenlabs.io/v2/voices?page_size=100' + (cursor ? '&next_page_token=' + encodeURIComponent(cursor) : '');
  let response: Response;
  try {
    response = await fetch(url, { method: provider === 'minimax' ? 'POST' : 'GET', redirect: 'manual',
      headers: provider === 'minimax' ? {Authorization:`Bearer ${key}`,'Content-Type':'application/json'} : {'xi-api-key':key},
      body: provider === 'minimax' ? JSON.stringify({voice_type:'all'}) : undefined, signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('Не удалось загрузить голоса. Повторите загрузку списка.'); }
  if (!response.ok) throw new Error(`Список голосов недоступен (HTTP ${response.status}). Проверьте подключение и право API-ключа на чтение голосов.`);
  const data = await response.json() as any;
  const voices: VoiceOption[] = [];
  if (provider === 'minimax') {
    if (data.base_resp?.status_code !== 0) throw new Error('MiniMax не вернул каталог голосов. Проверьте ключ в «Подключениях».');
    for (const [field, category] of [['system_voice','Стандартный'],['voice_cloning','Клонированный'],['voice_generation','Созданный вами']]) {
      for (const voice of Array.isArray(data[field]) ? data[field] : []) {
        const russian = isRussianVoice(voice, provider);
        if (scope === 'russian' && !russian) continue;
        const id = clean(voice.voice_id, 150); if (!id) continue;
        voices.push({id,name:clean(voice.voice_name,120) || id,description:clean(Array.isArray(voice.description) ? voice.description.join(' ') : voice.description) || 'Провайдер не добавил описание.',category,russian});
      }
    }
  } else {
    if (!Array.isArray(data.voices)) throw new Error('Провайдер вернул некорректный список голосов.');
    for (const voice of data.voices) {
      const russian = isRussianVoice(voice, provider);
      if (scope === 'russian' && !russian) continue;
      const id=clean(voice.voice_id,150); if(!id) continue;
      const labels=voice.labels ?? {};
      voices.push({id,name:clean(voice.name,120)||id,description:clean(voice.description) || clean(['gender','age','accent','description','use_case'].map(k=>clean(labels[k],60)).filter(Boolean).join(' · ')) || 'Провайдер не добавил описание.',category:clean(voice.category,60),russian});
    }
  }
  const unique=[...new Map(voices.map(v=>[v.id,v])).values()];
  unique.sort((a,b)=>a.name.localeCompare(b.name));
  const nextCursor=provider==='elevenlabs' && data.has_more ? clean(data.next_page_token,2000) : '';
  if(provider==='elevenlabs' && data.has_more && (!nextCursor || nextCursor===cursor)) throw new Error('Не удалось загрузить следующую страницу голосов. Обновите список.');
  return {voices:unique,nextCursor};
}
