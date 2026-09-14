import { approve, chosen, dependencies, getItem, participates, stageReady, type Project } from './domain';
import { assertSpeech, speechInfo } from './speech-mode';
import { spokenText } from './spoken-text';

export function speechReapprovalReason(p:Project,itemId:string,variantId:string) {
  const item=getItem(p,itemId),audio=chosen(item);
  if(item.stage!==6||!participates(p,item))return 'Откройте активную карточку озвучки в выбранном режиме: «По планам» или «Общая дорожка».';
  if(audio?.id!==variantId||audio.kind!=='audio'||!audio.assetId)return 'Выберите готовую аудиозапись в этой карточке.';
  if(!stageReady(p,6))return 'Сначала утвердите материалы предыдущих этапов. Причины блокировки перечислены выше.';
  if(p.jobs.some(j=>['queued','dispatching','pending','saving'].includes(j.status)))return 'Дождитесь завершения текущих задач, затем подтвердите запись.';
  if(audio.speechType){
    try {assertSpeech(speechInfo(audio),audio.dialogue);}catch(e){return (e as Error).message+' Исправьте описание речи через «Правки».';}
    if(audio.speechType==='character'&&!item.sourceShot)return 'Для реплики героя нужна отдельная карточка плана. Используйте «Подготовить озвучку по планам».';
    if(audio.speechType==='character'&&!spokenText(audio.dialogue,[audio.speaker??'']))return 'В реплике героя нет произносимого текста. Проверьте запись и заполните реплику через «Правки».';
  }
  if(audio.deps===dependencies(p,6))return 'Запись уже относится к текущей версии. Используйте обычное утверждение.';
  return '';
}

export function reapproveSpeech(p:Project,itemId:string,variantId:string) {
  const reason=speechReapprovalReason(p,itemId,variantId);if(reason)throw new Error(reason);
  const copy=structuredClone(p),item=getItem(copy,itemId);
  // The director reviews the existing recording. Do not rewrite its words,
  // speaker, timings, file or generation receipt to match a newer script.
  chosen(item)!.deps=dependencies(copy,6);
  approve(copy,itemId);
  Object.assign(getItem(p,itemId),item);
}
