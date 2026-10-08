import {montageProposalSchema,type MontageProposal} from './montage-schemas';
export {montageProposalSchema,type MontageProposal} from './montage-schemas';
import {isApproved,participates,type Project} from './domain';
import {mediaReviewCurrent,reviewBasis} from './media-review';
export function montageProposalIssue(p:Project,value:MontageProposal){
 const i=p.items.find(i=>i.id===value.itemId&&i.stage===7&&participates(p,i)),v=i?.variants.find(v=>v.id===value.variantId);
 if(!i||!v?.assetId||i.approvedId!==v.id||!isApproved(p,i))return 'Утверждённый видеоплан изменился.';
 const seconds=p.mediaDurations?.[v.assetId];if(!seconds)return 'Сначала измерьте исходные файлы в настройках финальной сборки.';
 if(value.trim+value.duration>seconds+.001)return 'Предложенный участок выходит за конец исходного видео.';
 const audio=p.items.filter(a=>a.stage===6&&participates(p,a)&&a.sourceShot?.title===i.sourceShot?.title).flatMap(a=>a.variants.filter(v=>v.id===a.approvedId&&v.kind==='audio'&&v.assetId));
 for(const a of audio){const n=p.mediaDurations?.[a.assetId!];if(!n)return 'Измерьте выбранную реплику перед применением монтажного решения.';if(n-a.trim>value.duration+.001)return 'Полная реплика длиннее предложенного участка. Выберите больше секунд или переозвучьте этот план.';}
 return '';
}
export function montageReviewCurrent(p:Project,r:NonNullable<Project['mediaReviews']>[number]){const item=p.items.find(i=>i.id===r.itemId),v=item?.variants.find(v=>v.id===r.variantId);return mediaReviewCurrent(p,r)||!!item&&!!v&&r.montageAppliedBasis===reviewBasis(p,item,v,r.filmStory!==undefined);}
export function applyMontageProposal(p:Project,reviewId:string,index:number){
 const r=p.mediaReviews?.find(r=>r.id===reviewId),proposal=r?.result?.montage?.[index];
 if(!r||!montageReviewCurrent(p,r)||!proposal)throw Error('Монтажное предложение устарело или не найдено. Повторите проверку.');
 if(r.appliedMontage?.includes(index))return;
 const value=montageProposalSchema.parse(proposal),issue=montageProposalIssue(p,value);if(issue)throw Error(issue);
 p.assemblyCuts=[...(p.assemblyCuts??[]).filter(c=>c.itemId!==value.itemId),{itemId:value.itemId,variantId:value.variantId,trim:value.trim,duration:value.duration}];
 r.appliedMontage=[...(r.appliedMontage??[]),index];const item=p.items.find(i=>i.id===r.itemId)!,v=item.variants.find(v=>v.id===r.variantId)!;r.montageAppliedBasis=reviewBasis(p,item,v,r.filmStory!==undefined);
}
