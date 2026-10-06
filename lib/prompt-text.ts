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

/** Extract visual rules from a mixed film-style document without rewriting facts.
 * Unknown/free-form sections stay intact. Only explicit narrative/production
 * sections and paragraphs naming a different known location are excluded. */
export function frameStyleText(text: string, currentLocations: readonly string[], otherLocations: readonly string[]): string {
  const normalize = (s: string) => s.toLocaleLowerCase('ru').normalize('NFKC').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Exact word boundaries also support real short location names: «Лес», «Двор».
  const names = (values: readonly string[]) => values.map(normalize).filter(s => s.length >= 3);
  const current = names(currentLocations), other = names(otherLocations).filter(s => !current.includes(s));
  const narrative = /^(?:сценарий|сюжет|события|персонажи|герои|реквизит|предметы|(?:\S+\s+)?постановочные при[её]мы|режисс[её]рские при[её]мы|финальный (?:образ|кадр)|монтаж|композиция и движение|хронометраж|речь|озвучка)(?:\s|[:—-]|$)/iu;
  let excludedAt: number | undefined;
  const visual = text.replace(/\r\n?/g, '\n').split('\n').filter(line => {
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (excludedAt !== undefined && level <= excludedAt) excludedAt = undefined;
      if (narrative.test(heading[2])) excludedAt = Math.min(excludedAt ?? level, level);
    }
    if (excludedAt !== undefined) return false;
    return !/^\s*\*\*(?:формат|речь|озвучка|хронометраж|длительность)\s*:?[\s*]/iu.test(line);
  }).join('\n');
  return visual.split(/\n[\t ]*\n+/).filter(paragraph => {
    const value = ` ${normalize(paragraph)} `;
    return !other.some(name => value.includes(` ${name} `)) || current.some(name => value.includes(` ${name} `));
  }).map(s => s.trim()).filter(Boolean).join('\n\n');
}
