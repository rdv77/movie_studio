// Persisted stage IDs never change. Only creative workflow precedence changes.
export const CREATIVE_STAGE_ORDER=[0,2,3,1,4,5,6,7,8];
export const stagePosition=(stage:number)=>CREATIVE_STAGE_ORDER.indexOf(stage);
export const precedesStage=(before:number,after:number)=>stagePosition(before)>=0&&stagePosition(after)>=0&&stagePosition(before)<stagePosition(after);
