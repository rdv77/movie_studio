import {z} from 'zod';
export const montageProposalSchema=z.object({itemId:z.string().uuid(),variantId:z.string().uuid(),trim:z.number().finite().min(0).max(600),duration:z.number().finite().min(.2).max(3600),reason:z.string().max(2000)});
export type MontageProposal=z.infer<typeof montageProposalSchema>;
