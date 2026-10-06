import {z} from 'zod';

export const FACIAL_EXPRESSION_MODES=['auto','restrained','natural','cartoon','exaggerated'] as const;
export type FacialExpressionMode=typeof FACIAL_EXPRESSION_MODES[number];
export const facialExpressionSchema=z.enum(FACIAL_EXPRESSION_MODES);
export const FACIAL_EXPRESSION_LABELS:Record<FacialExpressionMode,string>={
  auto:'По жанру и характеру',restrained:'Сдержанно',natural:'Естественно',cartoon:'Мультяшно',exaggerated:'Гипертрофированно',
};
export const FACIAL_EXPRESSION_HELP:Record<FacialExpressionMode,string>={
  auto:'Мимика следует жанру, характеру и ситуации; без преувеличения по умолчанию.',
  restrained:'Тонкие реакции: взгляд, брови и небольшие изменения выражения лица.',
  natural:'Живая, правдоподобная мимика без театральных преувеличений.',
  cartoon:'Выразительные анимационные реакции с сохранением узнаваемости героя.',
  exaggerated:'Подчёркнутые реакции в важных моментах, без постоянных гримас и изменения лица.',
};

/** Undefined shot setting inherits the film; explicit auto remains an override. */
export function effectiveFacialExpression(briefMode?:FacialExpressionMode,shotMode?:FacialExpressionMode):FacialExpressionMode{
  return shotMode??briefMode??'auto';
}

/** Kept compact because this is an invariant in constrained media prompts. */
export function facialExpressionPrompt(mode:FacialExpressionMode):string{
  const acting:Record<FacialExpressionMode,string>={
    auto:'Adapt facial expression to the genre, character and current emotion; use natural intensity unless the scene calls for stylization.',
    restrained:'Use restrained facial acting: subtle eyes, brows and small changes of expression; avoid broad reactions.',
    natural:'Use natural, believable facial acting with clear emotional changes; avoid theatrical grimaces or overacting.',
    cartoon:'Use expressive cartoon facial acting with clear, motivated reactions and readable emotional changes.',
    exaggerated:'Use emphatic, exaggerated facial reactions at motivated emotional peaks, with calmer transitions; avoid constant grimacing.',
  };
  return `Facial acting: ${acting[mode]} Override older generic intensity, not scripted emotions or actions. Preserve the approved facial identity and anatomy. Follow the separate speaker and closed-mouth rules.`;
}
