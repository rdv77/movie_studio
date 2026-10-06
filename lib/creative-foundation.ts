/** Global facial acting is a preference for future generations, not an edit to
 * already reviewed story/material. Keep all other brief fields in approvals.
 * Omitting this optional key also preserves legacy signatures byte for byte. */
export function creativeFoundationBrief<T extends object>(brief:T|undefined):Omit<T,'facialExpression'>|undefined {
  if(!brief)return undefined;
  const {facialExpression,...foundation}=brief as T&{facialExpression?:unknown};
  return foundation;
}
