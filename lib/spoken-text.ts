const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

// Deliberately recognize a bounded set of screenplay cues. Ordinary parenthetical
// speech, internal quotes, colons and provider sound tags must remain intact.
function isDirection(value: string): boolean {
  return value.split(/[,;]/).every((part) =>
    /^(?:за кадром|з\s*\/?\s*к\.?|закадровый голос|голос за кадром|внутренний монолог|про себя|мысленно|ш[её]потом|тихо|громко|спокойно|с улыбкой|со смехом|сме[её]тся|вздыхает|плачет|пауза(?:\s+\d+(?:[.,]\d+)?\s*(?:с|сек|секунд[ыа]?)\.?)?|без речи|без реплик|тишина|v\.?o\.?|o\.?s\.?)$/iu.test(normalized(part)),
  );
}

function removeDirections(value: string) {
  return value.replace(/\(([^()\n]*)\)|\[([^\[\]\n]*)\]/g,
    (whole, round, square) => isDirection(round ?? square) ? ' ' : whole);
}

function unquote(value: string) {
  const pairs: Record<string, string> = { '«': '»', '“': '”', '"': '"' };
  const text = value.trim();
  const close = pairs[text[0]];
  if (text.length < 2 || !close || close !== text.at(-1)) return text;
  if (text[0] === close) return text.indexOf(close, 1) === text.length - 1 ? text.slice(1, -1).trim() : text;
  let depth = 1;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === text[0]) depth++;
    if (text[i] === close && --depth === 0) return i === text.length - 1 ? text.slice(1, -1).trim() : text;
  }
  return text;
}

function isSpeakerLabel(value: string, speakers: Set<string>) {
  const label = value.trim().replace(/^\*\*(.*?)\*\*$/u, '$1');
  const bare = removeDirections(label).trim();
  if (speakers.has(normalized(bare))) return true;
  if (/^(?:рассказчи[кц]а?|диктор|закадровый голос|голос за кадром|внутренний монолог)$/iu.test(bare)) return true;
  if (isDirection(bare)) return true;
  // Explicit cues identify the prefix as metadata even if the character was
  // described in prose and has no separate, named character card.
  const parts = bare.split(',');
  if (parts.length > 1 && parts.slice(1).every(isDirection) && /^[\p{L}\s.'’\-]{1,60}$/u.test(parts[0])) return true;
  if (bare !== label && /^[\p{L}\s.'’\-]{1,60}$/u.test(bare)) return true;
  return /^[\p{L}\s.'’\-]{1,60}\s+(?:за кадром|про себя|ш[её]потом)$/iu.test(bare);
}

export function spokenText(text: string, characterNames: string[] = []): string {
  const speakers = new Set(characterNames.map(normalized));
  return unquote(text).split(/\r?\n/).map((raw) => {
    let line = unquote(raw);
    const prefix = line.match(/^(?:[—–-]\s*)?(.{1,100}?)(?::\s*|\s+[—–]\s+)(.*)$/u);
    if (prefix && isSpeakerLabel(prefix[1], speakers)) line = prefix[2];
    else if (isDirection(line)) return '';
    line = removeDirections(line).trim();
    return unquote(line).replace(/[ \t]{2,}/g, ' ').trim();
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
