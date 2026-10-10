import {z} from 'zod';
import type {Project} from './domain';
import {directorApprovalBasis,directorRunActive,editorBasis,ensureDirecting,scenesBasis,shotApproved,shotPromptBasis} from './directing';
import {recordCreativeVersion,versionSignature} from './creative-versions';
import {freezeExistingKeyframeModes} from './keyframes';
import {setProductionOrder} from './production-order';
import {runtimeMode} from './runtime-policy';
import {framePolicySchema} from './staging-policy';
import {planSetApproved,planSetBasis} from './shot-planning';
import {animaticBasis} from './animatic';
import {validateAnimaticManifest} from './animatic-manifest';
import {editPlan} from './render';
import {videoPreparationIssue} from './video-from-animatic';
import {videoPreparationCurrent} from './video-preparation-basis';
import {MODELS} from './models';

export const filmSettingsSchema=z.object({
  title:z.string().trim().min(1).max(100),format:z.enum(['16:9','9:16']),
  seconds:z.number().finite().min(1).max(3600),limit:z.string().regex(/^\d+$/).nullable(),
  durationMode:z.enum(['free','strict']).optional(),
  productionOrder:z.enum(['voice-first','video-first']).optional(),
  framePolicy:z.union([framePolicySchema,z.literal('')]).optional(),
  screenplayModel:z.string().refine(id=>MODELS.some(m=>m.id===id&&m.kind==='text'&&['openai','xai','minimax'].includes(m.provider)),'Выберите доступную текстовую модель.').optional(),
}).superRefine((v,ctx)=>{
  if(v.seconds<10&&(v.durationMode!==undefined||v.productionOrder!==undefined||v.framePolicy!==undefined))
    ctx.addIssue({code:'custom',path:['seconds'],message:'Ориентир длительности — от 10 до 3600 секунд.'});
});
export type FilmSettings=z.infer<typeof filmSettingsSchema>;

/** A free target cannot change an existing movie's actual edit. Refresh only
 * proven-current provenance, keeping stale previews and paid requests intact. */
function preserveUnchangedAnimatics(before:Project,after:Project){
  if(!before.animatic?.variants.length)return;
  let oldBasis:string,newBasis:string;
  try{
    if(JSON.stringify(editPlan(before,true))!==JSON.stringify(editPlan(after,true)))return;
    oldBasis=animaticBasis(before);newBasis=animaticBasis(after);
  }catch{return;}
  if(oldBasis===newBasis)return;
  const manifests=new Map<string,{before:string;after:string}>();
  for(const saved of before.animatic.variants){
    if(saved.animaticBasis!==oldBasis||saved.kind!=='video'||!saved.assetId)continue;
    const updated=after.animatic?.variants.find(v=>v.id===saved.id);if(!updated)continue;
    if(saved.animaticManifest){
      try{
        validateAnimaticManifest(before,saved.animaticManifest,oldBasis);
        const manifest={...saved.animaticManifest,basis:newBasis};
        validateAnimaticManifest(after,manifest,newBasis);
        manifests.set(saved.id,{before:versionSignature(saved.animaticManifest),after:versionSignature(manifest)});
        updated.animaticManifest=manifest;
      }catch{continue;}
    }
    updated.animaticBasis=newBasis;
  }
  for(const item of before.items){
    const prep=item.videoPreparation,hashes=prep&&manifests.get(prep.animaticVariantId);
    if(!prep||!hashes||prep.manifestBasis!==hashes.before||videoPreparationIssue(before,item))continue;
    const updated=after.items.find(v=>v.id===item.id)?.videoPreparation;if(!updated)continue;
    const aliases=[...item.variants,...before.jobs.filter(j=>j.itemId===item.id)].flatMap(record=>
      record.videoPreparationBasis&&!record.videoPreparationBasis.startsWith('vp2:')&&videoPreparationCurrent(before,item,record)?[record.videoPreparationBasis]:[]);
    updated.manifestBasis=hashes.after;
    if(aliases.length)updated.legacyBases=[...new Set([...(updated.legacyBases??[]),...aliases])];
  }
}

/** Validate and apply to a private copy: a rejected workflow change cannot save
 * only some settings. Optional fields omitted by older clients remain intact. */
export function applyFilmSettings(p:Project,input:unknown):void{
  const s=filmSettingsSchema.parse(input),next=structuredClone(p);
  const target=Math.max(10,s.seconds),oldTarget=p.directing?.brief.targetSeconds??Math.max(10,p.seconds);
  const mode=s.durationMode??runtimeMode(p),modeChanged=mode!==runtimeMode(p);
  const frameChanged=s.framePolicy!==undefined&&(s.framePolicy||undefined)!==p.directing?.brief.framePolicy;
  const orderChanged=s.productionOrder!==undefined&&s.productionOrder!==(p.productionOrder??'voice-first');
  const targetChanged=target!==oldTarget,technicalChanged=targetChanged||modeChanged||frameChanged||orderChanged;
  if(technicalChanged&&p.directing?.runs.some(directorRunActive))
    throw Error('Дождитесь проработки или остановите её перед изменением параметров фильма.');

  // Free timing is a planning preference. Preserve only signatures which were
  // current before this edit; never bless already stale scenes or shots.
  const preserveTiming=(targetChanged||p.seconds!==s.seconds)&&mode==='free'&&!modeChanged&&!frameChanged&&!orderChanged&&s.format===p.format;
  const sceneApproval=preserveTiming&&p.directing?.scenesApproved===scenesBasis(p);
  const oldFoundation=preserveTiming?directorApprovalBasis(p):undefined;
  const approvedShots=new Set(preserveTiming?p.directing?.scenes.flatMap(scene=>scene.shots.filter(shot=>shotApproved(scene,shot,p)).map(shot=>shot.id))??[]:[]);
  const preparedShots=new Set(preserveTiming?p.directing?.scenes.flatMap(scene=>scene.shots.filter(shot=>shot.promptBasis===shotPromptBasis(p,scene,shot)).map(shot=>shot.id))??[]:[]);
  const planSets=new Set(preserveTiming?p.directing?.scenes.filter(scene=>planSetApproved(p,scene)).map(scene=>scene.id)??[]:[]);
  const priorEditorBasis=preserveTiming&&!modeChanged?editorBasis(p):undefined;

  if(technicalChanged)recordCreativeVersion(next,'До изменения параметров фильма');
  if(orderChanged)setProductionOrder(next,s.productionOrder!);
  if(frameChanged)freezeExistingKeyframeModes(next);
  const needsDirecting=!!next.directing||technicalChanged;
  if(needsDirecting){
    const d=ensureDirecting(next);
    d.brief={...d.brief,targetSeconds:target};
    if(s.framePolicy!==undefined){if(s.framePolicy)d.brief.framePolicy=s.framePolicy;else delete d.brief.framePolicy;}
    if(modeChanged){
      d.durationMode=mode;d.editorBasis=undefined;d.acceptedRuntime=undefined;
      for(const issue of d.issues){
        if(issue.category==='runtime_metadata'||issue.category==='runtime_target'&&mode==='free')issue.severity='note';
        if(issue.category==='runtime_target'&&mode==='strict'){issue.severity='conflict';issue.resolved=false;}
      }
    }
    if(targetChanged)d.acceptedRuntime=undefined;
  }
  if(p.format!==s.format)next.configVersion++;
  Object.assign(next,{title:s.title,format:s.format,seconds:s.seconds,limit:s.limit});
  if(s.screenplayModel!==undefined){next.screenplayModel=s.screenplayModel;if(next.generalScenario?.config)next.generalScenario.config.model=s.screenplayModel;}
  if(preserveTiming&&next.directing){
    const d=next.directing;
    if(sceneApproval)d.scenesApproved=scenesBasis(next);
    for(const scene of d.scenes){
      for(const shot of scene.shots){
        if(approvedShots.has(shot.id)&&shot.approvalVersion!==2)shot.approvedFoundation=directorApprovalBasis(next);
        if(preparedShots.has(shot.id))shot.promptBasis=shotPromptBasis(next,scene,shot);
      }
      if(planSets.has(scene.id)){const row=d.shotPlanning?.scenes.find(row=>row.sceneId===scene.id);if(row)row.approved=planSetBasis(next,scene);}
    }
    for(const review of d.sceneReviews??[])if(review.foundation===oldFoundation)review.foundation=directorApprovalBasis(next);
    if(priorEditorBasis&&p.directing?.editorBasis===priorEditorBasis)d.editorBasis=editorBasis(next);
    if(priorEditorBasis&&p.directing?.patchesBasis===priorEditorBasis)d.patchesBasis=editorBasis(next);
  }
  if(preserveTiming)preserveUnchangedAnimatics(p,next);
  Object.assign(p,next);
}
