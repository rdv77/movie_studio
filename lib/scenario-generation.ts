import type {Project} from './domain';
import {STAGING_MODE_LABELS} from './staging-policy';

/** Stage one adapts the story; specialist passes are a separate workflow. */
export function scenarioGenerationInstruction(p:Project){
  return `Создай один цельный вариант общего сценария анимационного фильма на основе исходного текста и сохранённого творческого задания. Жанр, режиссёрский подход, воздействие на аудиторию и интенсивности должны проявляться в событиях, точке зрения, раскрытии информации, реакциях и финале, а не только в названии. Соблюдай обязательные условия и выбранную свободу изменения сюжета. ${p.directing?.durationMode==='strict'?'Уложись в заданный предел длительности.':'Длительность — ориентир; не обрезай историю ради точного числа секунд.'} Верни только полный сценарий, без рецензии, отчёта специалистов и технических промптов. Можно разделить текст на смысловые эпизоды; подробная разработка планов будет отдельным этапом. ${p.directing?.brief.stagingMode?'Постановка: '+STAGING_MODE_LABELS[p.directing.brief.stagingMode]+'. Подробные правила постановки из творческого задания обязательны.':''}`;
}

export function scenarioVariantInstruction(prompt:string,index:number,count:number){
  return `${prompt}\nПредложи вариант ${index} из ${count}. Найди самостоятельное творческое решение в рамках того же задания.`;
}
