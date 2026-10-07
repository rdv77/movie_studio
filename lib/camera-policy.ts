import {z} from 'zod';

export const CAMERA_POLICIES=['static','cinematic','dynamic'] as const;
export type CameraPolicy=typeof CAMERA_POLICIES[number];
export const cameraPolicySchema=z.enum(CAMERA_POLICIES);
export const CAMERA_POLICY_LABELS:Record<CameraPolicy,string>={
  static:'Преимущественно статичная',
  cinematic:'Сдержанная кинематографическая',
  dynamic:'Динамичная',
};
export const CAMERA_POLICY_HELP:Record<CameraPolicy,string>={
  static:'Устойчивая композиция в большинстве планов. Простое движение допустимо, если оно помогает показать действие или раскрыть важную деталь.',
  cinematic:'Плавные наезды, отъезды, панорамы или сопровождение там, где они раскрывают эмоцию, пространство или действие. Движение не обязательно в каждом плане.',
  dynamic:'Более энергичные мотивированные движения и изменения крупности с сохранением понятного действия и удобных монтажных стыков. Камера не движется непрерывно без причины.',
};

/** No implicit policy for existing projects. This guides new/revised direction,
 * never rewrites a shot which the director has already approved. */
export function cameraPolicyInstructions(mode?:CameraPolicy):string {
  if(mode===undefined)return '';
  return `Работа камеры — ${CAMERA_POLICY_LABELS[mode]}. ${CAMERA_POLICY_HELP[mode]}
Оператор выбирает камеру по задаче конкретного плана: показать переживание, открыть новую информацию, сопровождать действие или удержать внимание. Не добавляй движение ради движения и не заполняй все планы шаблоном «статичная камера». Если текущий проход разрабатывает или дорабатывает операторское решение, проверь, соответствует ли прежняя общая статика выбранной политике; предложи уместное изменение, сохраняя события, реплики, актёрскую игру и длительность. Осмысленно статичный план допустим при любой политике; квоты движущихся планов нет.
В direction укажи framingStart/framingEnd, cameraMovement.type/description/from/to, purpose (зачем камера движется или остаётся неподвижной), speed (наблюдаемая скорость), start/end (секунды от начала плана), keepInFrame (кого или что удерживать в кадре). Для заданных времён соблюдай 0 <= start < end <= duration; не навязывай шаблонное время всем планам. endFrame описывает конечную композицию, transition — монтажный стык. Сохрани направление взгляда и движения, ось и пространственную ясность между соседними планами.
При readable допустимо одно простое движение камеры вместе с одним простым действием героя, если они не конкурируют за внимание; сложное взаимодействие рук и предметов показывай устойчиво. Единственный начальный референс не запрещает движение камеры. Само движение или изменение крупности не требует отдельного конечного изображения.
При подготовке и сокращении видеопромпта точно сохраняй утверждённое движение конкретного плана, начальную/конечную крупность, направление, скорость, время, удерживаемый объект и конечную композицию. Утверждённое операторское решение плана имеет приоритет над общей политикой; не заменяй его случайным наездом, облётом или статикой. Общая политика не отменяет актёрскую игру.`;
}

/** Compact provider invariant. Exact approved shot direction always wins. */
export function cameraPolicyPrompt(mode:CameraPolicy):string {
  const policy=mode==='static'?'Mostly stable framing; use only motivated simple moves.'
    :mode==='cinematic'?'Restrained cinematic camera; use purposeful simple moves, not movement in every shot.'
      :'Dynamic but purposeful, readable camera; no perpetual movement or competing action.';
  return `Camera policy: ${policy} Exact approved shot camera, framing, timing and end composition take priority. Do not invent or replace camera moves. A single start image does not require a static camera. Preserve acting and screen direction.`;
}
