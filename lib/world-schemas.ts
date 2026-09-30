import {z} from 'zod';

const short=z.string().trim().max(2000);
const refs=z.array(z.string().uuid()).max(8).refine(ids=>new Set(ids).size===ids.length,'Референс указан дважды.');
export const locationAngleSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),description:short,refs});
export const locationProfileSchema=z.object({
  name:z.string().trim().min(1).max(100),identity:short,geography:short,permanentProps:short,
  refs,approvedAngles:z.array(locationAngleSchema).max(24),
}).refine(p=>new Set(p.approvedAngles.map(a=>a.id)).size===p.approvedAngles.length,'Ракурс указан дважды.');
export type LocationProfile=z.infer<typeof locationProfileSchema>;
export const locationStateSchema=z.object({
  time:z.string().trim().max(300),light:short,weather:z.string().trim().max(1000),layout:short,
  allowedChanges:short,artDirection:short,angleIds:z.array(z.string().uuid()).max(24).optional(),
});
export type LocationState=z.infer<typeof locationStateSchema>;
export const actorTraitSchema=z.object({name:z.string().trim().min(1).max(100),intensity:z.number().int().min(0).max(10),instruction:z.string().trim().max(1000)});
export const actorProfileSchema=z.object({
  motivation:short,contradiction:short,role:short,mannerisms:short,identity:short,
  traits:z.array(actorTraitSchema).max(20),
}).refine(p=>new Set(p.traits.map(t=>t.name.toLocaleLowerCase('ru'))).size===p.traits.length,'Особенность героя указана дважды.');
export type ActorTrait=z.infer<typeof actorTraitSchema>;
export type ActorProfile=z.infer<typeof actorProfileSchema>;
export const actorDraftResultSchema=z.object({
  appearance:z.string().trim().max(160),description:z.string().trim().min(1).max(4000),
  actorProfile:actorProfileSchema,notes:z.array(z.string().trim().max(1000)).max(20),
});
export type ActorDraftResult=z.infer<typeof actorDraftResultSchema>;
