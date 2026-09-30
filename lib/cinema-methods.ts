export const CINEMA_METHODS = [
  {id:'character_drive',title:'Цель, препятствие и перемена героя',roles:['script-critic','script-dramaturg','script-control'],
    sourceTitle:'NFTS · Intensive Short Film Workshop',sourceUrl:'https://nfts.co.uk/intensive-short-film-workshop',
    checks:['Чего герой добивается именно сейчас?','Какая сила ему мешает?','Как выбор проявляется действием?','Что изменилось в герое или почему он остался прежним?']},
  {id:'scene_economy',title:'Необходимость и экономия сцены',roles:['script-critic','script-dramaturg','script-producer','script-control'],
    sourceTitle:'John August · How to write a scene',sourceUrl:'https://johnaugust.com/2007/write-scene',
    checks:['Что необходимое происходит в сцене?','Что потеряется при её удалении?','Нужны ли все участники?','Можно ли начать позже и убрать повторную подготовку?']},
  {id:'cause_effect',title:'Причины, решения и последствия',roles:['script-adaptation','script-critic','script-dramaturg','script-control'],
    sourceTitle:'Pixar / Khan Academy · Story spine',sourceUrl:'https://www.khanacademy.org/humanities/hass-storytelling/storytelling-pixar-in-a-box/ah-piab-story-structure/v/video1a-fine?t=140',
    checks:['Как прежний выбор вызвал эту ситуацию?','Как действие героя создаёт следующее событие?','Не заменено ли решение случайностью?']},
  {id:'visual_storytelling',title:'История через видимое действие',roles:['script-adaptation','script-critic','script-dramaturg','script-producer','script-control'],
    sourceTitle:'AFI · What is Screenwriting?',sourceUrl:'https://www.afi.com/news/what-is-screenwriting-and-what-does-a-screenwriter-do/',
    checks:['Каким наблюдаемым действием раскрывается характер?','Как внутреннее состояние проявляется на экране?','Дублирует ли речь уже видимое?']},
  {id:'setup_payoff',title:'Подготовка и развитие обещанных деталей',roles:['script-critic','script-dramaturg','script-control'],
    sourceTitle:'Steven Pressfield · Setups and Payoffs',sourceUrl:'https://stevenpressfield.com/2012/10/setups-and-payoffs/',
    checks:['Какие детали получают дальнейшее развитие?','Какие развязки предварительно подготовлены?','Поворот неожиданен, но объясним задним числом?']},
  {id:'audience_promise',title:'Обещание замысла зрителю',roles:['script-adaptation','script-critic','script-producer','script-control'],
    sourceTitle:'Save the Cat! · The Promise of the Premise',sourceUrl:'https://savethecat.com/tips-and-tactics/the-promise-of-the-premise-fun-and-games',
    checks:['Какое переживание обещают жанр и идея?','Какие конкретные сцены дают это переживание?','Не заменено ли действие бесконечной подготовкой?']},
  {id:'story_clarity',title:'Ясность целой истории',roles:['script-adaptation','script-critic','script-dramaturg','script-producer','script-control'],
    sourceTitle:'Screen Australia / Michael Brindley · Synopsis, Outline, Treatment',sourceUrl:'https://www.screenaustralia.gov.au/wp-content/uploads/2025/08/What-is-a-synopsis-1.pdf?v=1775615756',
    checks:['Понятны герой, проблема, действия и исход?','Ясны ставки и ключевые повороты?','Можно ли назвать событие сцены и его значение?','Есть ли повторения или сюжетные тупики?']},
] as const;
export type CinemaMethodId=typeof CINEMA_METHODS[number]['id'];
export const CINEMA_METHOD_IDS=CINEMA_METHODS.map(m=>m.id) as CinemaMethodId[];
export const CINEMA_METHODS_NOTE='Критерии адаптированы для приложения по первоисточникам. Это не официальная оценочная шкала киношкол и не гарантия качества. Не навязывай короткому фильму полнометражную формулу или развязку каждой декоративной детали.';
