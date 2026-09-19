import type { Job, Kind } from './domain';
import { googleSeconds } from './google-models';

// Public REST catalog, checked 2026-09-16. Prices are estimates in credits,
// never USD receipts. Account access is checked against /tools before sending.
type Profile = { native: string; kind: Kind; title: string; credits: number; editCredits?: number; seconds?: number; note?: string };
const profiles: Profile[] = [
  {native:'grok',kind:'text',title:'Grok',credits:1},
  {native:'hermes-3-405b',kind:'text',title:'Hermes 3 405B',credits:1},
  {native:'euryale-70b',kind:'text',title:'Euryale 70B',credits:1},
  {native:'NANO_BANANA',kind:'image',title:'Nano Banana',credits:2,editCredits:4},
  {native:'QWEN_IMAGE',kind:'image',title:'Qwen Image',credits:1},
  {native:'QWEN_IMAGE_PRO',kind:'image',title:'Qwen Image Pro',credits:2},
  {native:'SEEDREAM_5',kind:'image',title:'Seedream 5',credits:1},
  {native:'SEEDREAM_5_PRO',kind:'image',title:'Seedream 5 Pro',credits:3},
  {native:'WAN_2_7_IMAGE',kind:'image',title:'Wan 2.7 Image',credits:1},
  {native:'WAN_2_7_IMAGE_PRO',kind:'image',title:'Wan 2.7 Image Pro',credits:2},
  {native:'FLUX_KLEIN_NSFW',kind:'image',title:'FLUX Klein',credits:2,editCredits:1,note:'Требуется доступ Trusted'},
  {native:'grok@4.1',kind:'video',title:'Grok 4.1 Video',credits:18,seconds:6,note:'Встроенный звук создаётся всегда'},
  {native:'kling@2.6',kind:'video',title:'Kling 2.6',credits:10,seconds:10},
  {native:'minimax@3.0',kind:'video',title:'MiniMax 3.0',credits:12,seconds:6,note:'Встроенный звук создаётся всегда'},
  {native:'minimax@3.0-turbo',kind:'video',title:'MiniMax 3.0 Turbo',credits:6,seconds:6,note:'Встроенный звук создаётся всегда'},
  {native:'seedance_v1_5_pro',kind:'video',title:'Seedance 1.5 Pro',credits:4,seconds:6},
  {native:'seedance_2_0',kind:'video',title:'Seedance 2.0',credits:19,seconds:6},
  {native:'seedance_2_0_fast',kind:'video',title:'Seedance 2.0 Fast',credits:15,seconds:6},
  {native:'seedance_2_0_mini',kind:'video',title:'Seedance 2.0 Mini',credits:15,seconds:6},
  {native:'wan@2.6-flash',kind:'video',title:'Wan 2.6 Flash',credits:3,seconds:6},
  {native:'wan@2.7',kind:'video',title:'Wan 2.7',credits:20,seconds:10},
  {native:'wan@3.0',kind:'video',title:'Wan 3.0',credits:29,seconds:6,note:'Очередь может занимать 15–55 минут'},
];
export const ZEN_MODELS = profiles.map(p=>({
  id:`zencreator:${p.kind}:${p.native}`, name:`ZenCreator · ${p.title}`,provider:'zencreator',kind:p.kind,estimate:null,
  note:[p.kind==='text'?'Сценарии и правки; ответ до 4096 токенов':p.kind==='image'?'Одна картинка; поддерживает референсы; 2K, если доступно':`720p, ${p.seconds} сек; выбранный первый кадр`,
    `Ориентир ${p.credits}${p.editCredits!==undefined&&p.editCredits!==p.credits?` / ${p.editCredits} с референсами`:''} кредитов`,p.note].filter(Boolean).join(' · '),
}));
export function zenProfile(id: string) { return profiles.find(p=>`zencreator:${p.kind}:${p.native}`===id); }
// Several image backends reject >5000 even when /tools omits maxLength.
export const ZEN_IMAGE_PROMPT_LIMIT=5000;
export function isZenCreatorImage(id:string) { return zenProfile(id)?.kind==='image'; }
export function zenCredits(id: string, refs = 0) { const p=zenProfile(id); return p ? (refs ? p.editCredits??p.credits : p.credits) : undefined; }
export function generationSeconds(id: string) { return googleSeconds(id)??zenProfile(id)?.seconds??6; }
export function zenTool(id: string, refs = 0) { const p=zenProfile(id); return p?.kind==='text'?'run_any_llm':p?.kind==='video'?'videogen':refs?'image_editor':'by_prompt'; }
export function prepareZenJobs(jobs: Job[], assets: {mime:string;size:number}[] = []) {
  for(const j of jobs) {
    const p=zenProfile(j.model); if(!p)continue;
    if(j.kind!==p.kind)throw new Error('ZenCreator: тип модели не совпадает с задачей.');
    if(!j.prompt.trim()||(p.kind==='text'&&j.prompt.length>32000))throw new Error('ZenCreator: текстовый промпт должен содержать от 1 до 32 000 символов. Запрос не отправлен.');
    if(p.kind==='image'&&j.prompt.length>ZEN_IMAGE_PROMPT_LIMIT)throw new Error('ZenCreator: полный промпт изображения длиннее 5000 символов. Откройте новое окно генерации для подготовки компактного запроса. Запрос не отправлен.');
    if(p.kind==='text'&&j.refs.length)throw new Error('ZenCreator: текстовые модели в студии принимают только текст; уберите референсы.');
    if(p.kind==='video'&&(j.refs.length!==1||!Number.isFinite(j.duration)||j.duration<=0||j.duration>generationSeconds(j.model)))throw new Error(`ZenCreator: выберите один первый кадр и план до ${generationSeconds(j.model)} секунд.`);
    if(j.refs.length>8||assets.some(a=>!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024)||assets.reduce((s,a)=>s+a.size,0)>20*1024*1024)
      throw new Error('ZenCreator: до 8 референсов PNG/JPEG/WebP, до 10 МБ каждый и до 20 МБ суммарно. Запрос не отправлен.');
    j.zenCreditsEstimate??=zenCredits(j.model,j.refs.length);
  }
}
