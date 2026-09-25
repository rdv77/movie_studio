import { isApproved, participates, type Project, type Item, type Variant } from './domain';
import { parseShots } from './shots';
import { speechInfo, type SpeechInfo } from './speech-mode';

export function planSpeech(p: Project, item: Item, value?: Partial<Variant>): SpeechInfo {
  const script = p.items.find(i=>i.stage===4&&isApproved(p,i));
  const scriptVariant = script?.variants.find(v=>v.id===script.approvedId);
  const title = item.sourceShot?.title ?? item.title;
  let result = speechInfo(value);
  if (scriptVariant && (!item.sourceShot || item.sourceShot.scriptId===script!.id)) {
    try { result = speechInfo(parseShots(scriptVariant.text,p.seconds).find(s=>s.title===title) ?? value); } catch { /* Manual or legacy script. */ }
  }
  const matches = (i:Item) => (i.sourceShot?.title ?? i.title)===title &&
    (i.sourceShot ? i.sourceShot.scriptId===(item.sourceShot?.scriptId ?? script?.id) : true);
  const frame = p.items.find(i=>i.stage===5&&matches(i)&&isApproved(p,i));
  const image = frame?.variants.find(v=>v.id===frame.approvedId);
  if (image?.speechType&&(!p.directing||image.shotSource===scriptVariant?.id)) result=speechInfo(image);
  if (item.stage===7) {
    const activeAudio=p.items.filter(i=>i.stage===6&&participates(p,i)&&isApproved(p,i));
    if (p.speechMode!=='plans' && activeAudio.some(i=>i.variants.some(v=>v.id===i.approvedId&&v.kind==='audio'&&v.assetId)))
      return {speechType:'voiceover',speaker:''};
    const audioItem = activeAudio.find(i=>matches(i));
    const audio = audioItem?.variants.find(v=>v.id===audioItem.approvedId&&v.kind==='audio');
    // The approved audio describes what will actually be heard. Old audio stays
    // off-screen until its purpose is explicitly reviewed and approved.
    if (audio) return speechInfo({...audio,dialogue:audio.dialogue||audio.text});
  }
  if (value?.speechType && !(item.stage===5&&value.kind==='image'&&(p.directing||value.jobId)&&scriptVariant&&value.shotSource!==scriptVariant.id)) return speechInfo(value);
  if (item.stage===6 && value?.kind==='audio') return speechInfo({...value,dialogue:value.dialogue||value.text});
  return result;
}
