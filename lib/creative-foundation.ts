/** Production preferences do not rewrite the approved story, heroes or world.
 * Concrete shot direction remains an ordinary reviewed edit; camera preference
 * also has its own video-only basis. Omission preserves legacy signatures. */
export function creativeFoundationBrief<T extends object>(brief:T|undefined):Omit<T,'facialExpression'|'stagingMode'|'framePolicy'|'cameraPolicy'>|undefined {
  if(!brief)return undefined;
  const {facialExpression,stagingMode,framePolicy,cameraPolicy,...foundation}=brief as T&{facialExpression?:unknown;stagingMode?:unknown;framePolicy?:unknown;cameraPolicy?:unknown};
  return foundation;
}
