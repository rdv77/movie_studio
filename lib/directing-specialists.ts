import {z} from 'zod';
import type {DirectingShot,Scene} from './directing';
import {normalizedName} from './creative-versions';
import {shotDirectionSchema,validateShotDirection,type ShotDirection} from './shot-direction';

export const SCENE_SPECIALIST_ROLES=['camera','art','dialogue','performance'] as const;
export type SceneSpecialistRole=typeof SCENE_SPECIALIST_ROLES[number];
type StructuredShot=DirectingShot&{direction?:ShotDirection};
type StructuredScene=Omit<Scene,'shots'>&{shots:StructuredShot[]};
const text=z.string().max(6000);
const dialogue=z.object({speechType:z.enum(['voiceover','character','none']),speaker:z.string().max(100),text:z.string().max(4000),delivery:z.string().max(1500)});
// A concurrent camera answer cannot overwrite the actor specialist's work.
export const cameraDirectionSchema=shotDirectionSchema.omit({performance:true,facialExpression:true}).strip();
const performanceSchema=shotDirectionSchema.shape.performance.unwrap();
export const SCENE_SPECIALIST_INSTRUCTIONS:Record<SceneSpecialistRole,string>={
  camera:'Продумай мотивированную камеру и монтаж только текущей сцены, учитывая соседние планы. Укажи начальную и конечную крупность отдельно: extreme-wide, wide, medium, close-up, extreme-close-up, detail. Не делай все планы одинаковыми: крупный план реакции или деталь полезны для поворота, но не обязательны в каждом кадре. Наезд раскрывает новое знание или эмоцию; статичная камера допустима. Для каждого плана опиши начальное и конечное изображения, ракурс, композицию, перевод внимания, движение камеры, расположение героев, действия по времени и склейку. Время относительно начала плана и не выходит за duration. Речь не сокращай, сюжет, costume и реквизит не меняй. Верни {"shots":[{"id":"существующий ID","cinematography":"описание операторского решения","direction":{"framingStart":"wide","framingEnd":"close-up","angle":{"type":"eye-level","description":"..."},"composition":"...","attention":{"start":"...","end":"..."},"cameraMovement":{"type":"push-in","description":"...","from":"...","to":"..."},"actionBeats":[{"start":0,"end":2,"action":"...","emotionalChange":"..."}],"timing":{"openingHold":0,"endingHold":0.5,"revealAt":2},"positions":[{"subject":"имя или предмет","start":"...","end":"...","screenDirection":"static"}],"transition":{"type":"cut","description":"..."},"sound":{"ambience":"...","effects":[{"at":2,"description":"..."}],"music":"..."},"startFrame":"первое состояние","endFrame":"последнее состояние"}}]}. direction не содержит performance. Тип камеры: static, pan, tilt, push-in, pull-out, dolly, tracking, orbit, handheld, crane, zoom, custom. Ракурс: eye-level, low, high, overhead, dutch, point-of-view, custom. Переход: cut, match-cut, dissolve, fade, black, custom. Не возвращай историю, художника или реплики: они принадлежат другим специалистам.',
  art:'Найди выразительное художественное решение только текущей сцены. Сохрани постоянные внешность, географию, одежду и реквизит. Учти время, свет, погоду и разрешённые изменения места. Верни {"shots":[{"id":"существующий ID","productionDesign":"цвет, свет, тени, фактуры, декорации, костюм и предметы"}]}. Не меняй операторские поля, историю, реплики или актёрские задачи.',
  dialogue:'Проработай речь только текущей сцены. Сохрани смысл сюжета, сократи банальные пояснения, используй характерный подтекст, если он уместен. speechType voiceover — голос за кадром, character — один присутствующий говорящий герой, none — без речи. Для none speaker/text/delivery пусты. Текст содержит только произносимые слова. Верни {"shots":[{"id":"существующий ID","dialogue":{"speechType":"voiceover|character|none","speaker":"имя","text":"...","delivery":"манера исполнения"}}]}. Не меняй остальные поля.',
  performance:'Ты режиссёр по работе с актёрами анимационного фильма. Для каждого участвующего героя опиши цель, подтекст, наблюдаемое действие и изменение эмоции. Показывай чувство через взгляд, жест, позу и паузу; вместо общей фразы «удивляется» дай видимое поведение. В visibleAction свяжи причину реакции с конкретным изменением лица: куда переводится взгляд, как меняются брови и выражение губ при сомкнутом рте, как начинается и завершается реакция. Учитывай анатомию героя; не добавляй ему новых черт. Например: заметив находку, переводит взгляд на неё, слегка приподнимает брови, затем смягчает взгляд и сдержанно улыбается с закрытым ртом. Выраженность реакции определяется facialActing; пример не навязывает каждому герою одну эмоцию. Учитывай роль, мотивацию, противоречие и манеру героя, genre/style и состояние соседних планов. Не меняй внешность, костюм, реквизит, сюжет, реплики, движения камеры или duration. В visibleAction прямо укажи: у каждого неговорящего героя рот закрыт; при voiceover/none рты закрыты у всех; речевая артикуляция только у указанного говорящего, остальные могут менять выражение сомкнутых губ без имитации речи. Верни {"shots":[{"id":"существующий ID","performance":[{"character":"имя из cast","objective":"чего добивается","subtext":"что думает, но не произносит","visibleAction":"причина, переход выражения лица, наблюдаемая игра и правило рта","emotionStart":"...","emotionEnd":"..."}]}]}. Это дополнение к постановке, не пятый блок утверждения.',
};

/** Preflight every row before returning immutable, owned-field updates. */
export function specialistUpdates(scene:StructuredScene,role:SceneSpecialistRole,result:unknown,shotId?:string|string[]):StructuredShot[]{
  const row=role==='camera'?z.object({id:z.string(),cinematography:text,direction:cameraDirectionSchema.optional()}):
    role==='art'?z.object({id:z.string(),productionDesign:text}):
      role==='dialogue'?z.object({id:z.string(),dialogue}):z.object({id:z.string(),performance:performanceSchema});
  const data=z.object({shots:z.array(row).min(1).max(40)}).parse(result);
  const expected=shotId?scene.shots.filter(s=>Array.isArray(shotId)?shotId.includes(s.id):s.id===shotId):scene.shots;
  if(!expected.length||data.shots.length!==expected.length||new Set(data.shots.map(s=>s.id)).size!==expected.length||expected.some(s=>!data.shots.some(v=>v.id===s.id)))
    throw Error('Специалист должен вернуть все запрошенные планы с прежними ID.');
  return data.shots.map(value=>{
    const current=scene.shots.find(s=>s.id===value.id)!;
    const next:StructuredShot=structuredClone(current);
    if(role==='camera'){
      const v=value as z.infer<typeof row>&{cinematography:string;direction?:z.infer<typeof cameraDirectionSchema>};next.cinematography=v.cinematography;
      if(v.direction!==undefined)next.direction={...next.direction,...v.direction};
    }else if(role==='art')next.productionDesign=(value as {productionDesign:string}).productionDesign;
    else if(role==='dialogue')next.dialogue=(value as {dialogue:z.infer<typeof dialogue>}).dialogue;
    else{
      const performance=(value as {performance:z.infer<typeof performanceSchema>}).performance;
      const names=new Set<string>(),ids=new Set<string>();for(const actor of performance){const name=normalizedName(actor.character);if(names.has(name)||actor.characterId&&ids.has(actor.characterId))throw Error('Для одного героя предложены повторные актёрские задачи.');names.add(name);if(actor.characterId)ids.add(actor.characterId);}
      for(const actor of performance)if(!current.cast.includes(actor.character)&&!current.characterIds?.includes(actor.characterId??''))throw Error('Актёрская задача относится к герою, которого нет в этом плане.');
      next.direction={...next.direction,performance};
    }
    if(next.dialogue.speechType==='none'&&next.dialogue.text.trim())throw Error('У плана без речи заполнена реплика.');
    if(next.dialogue.speechType==='character'&&(!next.dialogue.speaker||!next.cast.includes(next.dialogue.speaker)))throw Error('Говорящий герой должен присутствовать в составе плана.');
    const conflict=validateShotDirection(next).find(i=>i.severity==='conflict');if(conflict)throw Error(conflict.message);
    next.approved=undefined;return next;
  });
}
