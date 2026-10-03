/** Remove only identical sentences/paragraphs. No clipping, synonym rewriting,
 * or removal of a different state, negation, number, owner or camera action. */
export function compactPromptText(text: string): string {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/);
  const seen = new Set<string>();
  return paragraphs.map(paragraph => paragraph.trim().split(/(?<=[.!?])\s+(?=[А-ЯA-Z«“])/u).filter(sentence => {
    const key = sentence.trim().replace(/[\t ]+/g, ' ');
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(sentence => sentence.trim().replace(/[\t ]+/g, ' ')).join(' ')).filter(Boolean).join('\n\n');
}

export function uniquePromptFacts(texts: readonly string[]): string {
  return compactPromptText(texts.filter(text => text.trim()).join('\n\n'));
}

/** Only call for an exact, approved, automatically prepared source prompt.
 * The compiler renders this suffix from structured locks/world/state instead. */
export function preparedPromptBody(text: string, format: string): string {
  const marker='\nАнимация '+format+'. Только эти герои: ';
  const at=text.lastIndexOf(marker),suffix=at<0?'':text.slice(at);
  return at>=0&&suffix.includes('Постоянная внешность:')&&suffix.includes('Правило речи для этого плана:')?text.slice(0,at).trim():text;
}
