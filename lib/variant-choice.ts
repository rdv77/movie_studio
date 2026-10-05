import {chosen,isApproved,type Project,type Item,type Variant} from './domain';
import {hasKeyframeConfig,keyframesApproved,planKeyframeMode,requiredKeyframeRoles,selectedKeyframe} from './keyframes';

/** Storyboard choices belong to a moment; selectedId stays pinned to the start. */
export function variantChoice(p:Project,item:Item,v:Variant){
  if(item.stage===5&&v.kind==='image'&&hasKeyframeConfig(p,item)){
    const role=v.keyframe??'start';
    const selected=requiredKeyframeRoles(planKeyframeMode(p,item)).includes(role)&&selectedKeyframe(item,role)?.id===v.id;
    return {role,selected,approved:selected&&keyframesApproved(p,item)};
  }
  return {role:undefined,selected:chosen(item)?.id===v.id,approved:item.approvedId===v.id&&isApproved(p,item)};
}
