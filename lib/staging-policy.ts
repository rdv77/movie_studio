import {z} from 'zod';

export const STAGING_MODES=['readable','balanced','expressive'] as const;
export const FRAME_POLICIES=['auto','single','pair'] as const;
export type StagingMode=typeof STAGING_MODES[number];
export type FramePolicy=typeof FRAME_POLICIES[number];
export const stagingModeSchema=z.enum(STAGING_MODES);
export const framePolicySchema=z.enum(FRAME_POLICIES);
export const STAGING_MODE_LABELS:Record<StagingMode,string>={readable:'Простые и ясно читаемые действия',balanced:'Сбалансированная постановка',expressive:'Сложная выразительная постановка'};
export const STAGING_MODE_HELP:Record<StagingMode,string>={
  readable:'Одно заметное действие и короткая реакция в плане. Причина и результат понятны без пояснений; меньше сложных контактов и мелких деталей.',
  balanced:'Действие и реакция могут сочетаться, если зритель успевает их прочитать. Сложные взаимодействия требуют проверки.',
  expressive:'Можно использовать более сложные действия и камеру. Для точной постановки может потребоваться больше проб.',
};
export const FRAME_POLICY_LABELS:Record<FramePolicy,string>={auto:'Автоматический выбор',single:'Только начальный кадр',pair:'Начальный и конечный кадры'};
export const FRAME_POLICY_HELP:Record<FramePolicy,string>={
  auto:'Один кадр для обычного действия; два, когда важно точно задать конечную композицию или положение предметов.',
  single:'Видео начинает движение из одного изображения. Конечное состояние сохраняется в текстовом задании.',
  pair:'Генерируются оба опорных изображения. Использование конечного кадра в видео зависит от модели.',
};
/** Missing fields keep legacy projects unchanged. */
export const effectiveStagingMode=(film?:StagingMode,shot?:StagingMode):StagingMode|undefined=>shot??film;

/** Compact media invariant. Still images must depict a moment, not an action sequence. */
export function stagingPrompt(mode:StagingMode,kind:'image'|'video'='video'):string{
  const modeText=mode==='readable'?'One clear main action, optionally a brief reaction; visible subject, object, cause and result. Avoid tiny contact chains or competing camera action.'
    :mode==='balanced'?'Keep actions and reactions readable, with visible causes and results; avoid overloaded simultaneous movement.'
      :'Use motivated expressive staging; keep actions, causes and results legible despite complexity.';
  return `Staging: ${modeText} Preserve approved events. ${kind==='image'?'Show only the requested instant; no montage or multiple action phases.':'Use natural continuing micro-motion, not a frozen final pose; pause only when explicitly directed. Do not add events.'}`;
}

export function stagingInstructions(brief:{stagingMode?:StagingMode;framePolicy?:FramePolicy}):string{
  if(!brief.stagingMode&&!brief.framePolicy)return '';
  const lines=['Постановочная политика режиссёра:'];
  if(brief.stagingMode){
    lines.push(STAGING_MODE_LABELS[brief.stagingMode]+'. '+STAGING_MODE_HELP[brief.stagingMode]);
    if(brief.stagingMode==='readable')lines.push('В каждом плане одно главное наблюдаемое действие и, при необходимости, короткая реакция. Назови действующего героя, предмет, видимую причину, действие и результат. Описывай наблюдаемые глаголы, а не только «осознаёт» или «чувствует». Смысловой предмет должен быть достаточно крупным и не перекрытым. Простое действие должно быть заметным, а не едва различимым. Не строй смысл на цепочке мелких контактов, точной физики или нескольких зависимых микрособытий. Сложное действие не совмещай со сложным движением камеры. Если утверждённое событие требует рискованного взаимодействия, сохрани его, отметь риск и предложи более читаемую постановку для выбора режиссёра.');
    lines.push('Сохраняй утверждённые события, характеры и замысел. Замена событий, объединение или удаление планов — только отдельное предложение, не скрытая правка. Закрытый рот не запрещает выражение лица. Не предписывай неподвижное удержание финальной позы до конца ролика: после действия допустимо естественное микродвижение; конечная пауза только осмысленная и явно заданная.');
  }
  if(brief.framePolicy)lines.push(`Опорные изображения: ${FRAME_POLICY_LABELS[brief.framePolicy]}. ${FRAME_POLICY_HELP[brief.framePolicy]} Один исходный кадр не означает статичную камеру или неподвижного героя. Конечное состояние описывай всегда, даже без отдельной конечной картинки.`);
  return lines.join('\n');
}
