import type { Job } from './domain';

export const GOOGLE_OMNI = 'gemini-omni-1.1-flash';
export const GOOGLE_MODELS = [
  {id:GOOGLE_OMNI,name:'Google · Gemini Omni Flash',provider:'google',kind:'video' as const,estimate:'10500000000',
    note:'720p · просим 10 сек, фактические 3–10 сек зависят от модели · ориентир $1.05 с запасом на вход; оплата по токенам'},
  {id:'veo-3.1-generate-preview',name:'Google · Veo 3.1',provider:'google',kind:'video' as const,estimate:'32000000000',
    note:'Preview · первый кадр · 720p · 8 сек со звуком · ориентир $3.20'},
  {id:'veo-3.1-fast-generate-preview',name:'Google · Veo 3.1 Fast',provider:'google',kind:'video' as const,estimate:'8000000000',
    note:'Preview · первый кадр · 720p · 8 сек со звуком · ориентир $0.80'},
];
export const isGoogleVideo = (id:string) => GOOGLE_MODELS.some(m=>m.id===id);
export const googleSeconds = (id:string) => isGoogleVideo(id) ? id===GOOGLE_OMNI?10:8 : undefined;
export function googleEstimate(id:string,estimate:string|null) {
  const minimum=GOOGLE_MODELS.find(m=>m.id===id)?.estimate;
  return minimum&&(estimate===null||BigInt(estimate)<BigInt(minimum))?minimum:estimate;
}
export function prepareGoogleJobs(jobs:Job[],assets:{mime:string;size:number}[]=[]) {
  for(const j of jobs) {
    if(!isGoogleVideo(j.model))continue;
    if(j.kind!=='video'||j.refs.length!==1||!Number.isFinite(j.duration)||j.duration<=0||j.duration>googleSeconds(j.model)!)
      throw new Error(`Google: выберите один первый кадр и план до ${googleSeconds(j.model)} сек. Запрос не отправлен.`);
    if(!j.prompt.trim()||j.prompt.length>2000)throw new Error('Google: видеопромпт должен содержать от 1 до 2000 символов. Запрос не отправлен.');
    if(assets.some(a=>!['image/png','image/jpeg','image/webp'].includes(a.mime)||a.size>10*1024*1024))
      throw new Error('Google: первый кадр PNG, JPEG или WebP до 10 МБ. Запрос не отправлен.');
    // A client may raise the estimate, but cannot bypass the known reservation.
    j.estimate=googleEstimate(j.model,j.estimate??null);
  }
}
