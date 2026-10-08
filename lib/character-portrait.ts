import type { CharacterBrief, Project } from './domain';
import { frameStyleText } from './prompt-text';

/** A casting image is not a scene. Actor biography and scene-specific trait
 * instructions can contain partners, props and locations, so do not replay
 * them as image content. Identity and explicit director instructions are
 * compiled separately and are never filtered here. */
export function portraitTraits(character: CharacterBrief): string {
  const traits = character.actorProfile?.traits ?? [];
  return traits.length ? 'Передай особенности только выражением лица и спокойной позой этого героя, без сюжетных действий, предметов или партнёров: ' +
    traits.map(trait => `${trait.name} — ${trait.intensity}/10${trait.intensity === 0 ? ' (не усиливать)' : ''}`).join('; ') + '.' : '';
}

export const PORTRAIT_DIRECTION = 'Образ только одного героя: полный рост и хорошо различимое лицо. По умолчанию простой нейтральный фон; другой фон, поза или реквизит — только если явно запрошены в описании внешности, ограничениях или задаче режиссёра. Не иллюстрируй биографию, события фильма или отношения с другими героями. Не переноси фон и посторонние объекты из фотографий-прообразов.';

/** Extract visual language, not the story that may share its style document.
 * Fail closed for narrative-only paragraphs instead of feeding an entire
 * screenplay back into a portrait. This is not a filter of the hero's own
 * appearance: e.g. a frog character and its explicitly requested crown stay. */
export function portraitStyleText(p: Project, character: CharacterBrief | undefined, text: string): string {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const ownName = normalize(character?.name ?? '');
  const foreignNames = p.items.filter(item => !item.removedAt && !item.planArchive && (item.stage === 3 || item.stage === 1 && normalize(item.character?.name ?? '') !== ownName))
    .flatMap(item => item.stage === 3 ? [item.title, item.location?.name ?? ''] : [item.character?.name ?? ''])
    .map(normalize).filter(name => name.length >= 3);
  const visual = /(?:стил|анимац|иллюстрац|рисунк|акварел|гуаш|живопис|палитр|цвет|освещен|свет(?:ом|а|отен|ов|\s|[,.!?;:—-]|$)|текстур|фактур|контур|пропорц|реализм|рендер|шейдинг|(?:^|\W)[23]d(?:\W|$)|style|animation|illustration|palette|colou?r|lighting|texture|watercolou?r|gouache|render|shading)/iu;
  const narrative = /^(?:сюжет|сценарий|действие|событи[ея]|локаци[яи]|место действия|сцена|план\s*\d|герои|персонажи|реквизит|предметы|монтаж|камера|финал|хронометраж|звук|музыка|речь|озвучка)(?:\s|[:—-]|$)/iu;
  // Filter narrative headings first, then sentences: a single mixed paragraph
  // must not discard its valid medium/palette because it also names a location.
  return frameStyleText(text, [], []).split(/\n[\t ]*\n+/).flatMap(paragraph => paragraph.split(/\n|(?<=[.!?])\s+(?=[А-ЯA-Z«“])/u))
    .map(line => line.trim()).filter(line => {
      const plain = line.replace(/^[#*\s\d.)-]+/u, ''), normalized = ` ${normalize(plain)} `;
      return visual.test(plain) && !narrative.test(plain) && !foreignNames.some(name => normalized.includes(` ${name} `));
    }).join('\n');
}
