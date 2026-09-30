import {build} from 'esbuild';
import {strict as A} from 'node:assert';
await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/creative-brief';export * as R from './lib/directing';export * as D from './lib/domain';export * as V from './lib/creative-versions';`},bundle:true,platform:'node',format:'esm',outfile:'work/tests/creative-brief.mjs'});
const C=await import('../work/tests/creative-brief.mjs');
const legacy={genre:'Сказка',effect:'Удивить и вызвать сопереживание',audience:'Дети 7–10 лет',director:'Спилберг',techniques:'Реакция героя и раскрытие чуда',locked:'Лягушка остаётся в короне. История заканчивается находкой.',factual:false,targetSeconds:120};
const before=structuredClone(legacy),effective=C.effectiveCreativeBrief(legacy);
A.deepEqual(effective,legacy);A.notEqual(effective,legacy);A.equal(Object.hasOwn(effective,'strengths'),false);A.equal(C.renderCreativeInstructions(legacy),'');A.equal(C.renderCreativeInstructions(legacy,{}),'');A.equal(C.renderCreativeInstructions(legacy,{strengths:{}}),'');A.deepEqual(legacy,before);
A.deepEqual(C.creativeStrengthsSchema.parse({}),{});
for(const key of C.CREATIVE_STRENGTH_KEYS){
  A.equal(C.creativeStrengthsSchema.parse({[key]:0})[key],0);A.equal(C.creativeStrengthsSchema.parse({[key]:10})[key],10);
  for(const value of [-1,11,3.5,NaN,Infinity,'7',null])A.equal(C.creativeStrengthsSchema.safeParse({[key]:value}).success,false);
  A(C.CREATIVE_STRENGTH_LABELS[key]);A(C.CREATIVE_STRENGTH_HELP[key]);
}
A.equal(C.creativeStrengthsSchema.safeParse({invented:7}).success,false);
const film={...legacy,strengths:{style:8,genre:7,surprise:6,conflict:5,drama:4,pace:8,plotFreedom:0}};
const overrides={genre:'Хоррор + Приключение',effect:'Создать тревожное ожидание',strengths:{style:0,genre:10,surprise:undefined,pace:0}};
const bothBefore=structuredClone({film,overrides});const local=C.effectiveCreativeBrief(film,overrides);
A.equal(local.strengths.style,0);A.equal(local.strengths.pace,0);A.equal(local.strengths.genre,10);A.equal(local.strengths.surprise,6);A.equal(local.strengths.plotFreedom,0);A.equal(local.genre,'Хоррор + Приключение');A.equal(local.director,'Спилберг');A.equal(local.techniques,film.techniques);A.equal(local.audience,film.audience);A.equal(local.locked,film.locked);A.equal(local.factual,film.factual);A.equal(local.targetSeconds,film.targetSeconds);A.deepEqual({film,overrides},bothBefore);
const shallowLocal=C.effectiveCreativeBrief(legacy,{strengths:{conflict:0}});A.deepEqual(shallowLocal.strengths,{conflict:0});A.equal(shallowLocal.strengths.style,undefined,'No unselected axis receives a default');
for(const field of ['audience','factual','locked','targetSeconds','approved'])A.equal(C.creativeOverridesSchema.safeParse({[field]:field==='factual'?false:'override'}).success,false,'A scene cannot relax film constraints');
A.throws(()=>C.effectiveCreativeBrief(film,{audience:'Adults',strengths:{genre:10}}));
const text=C.renderCreativeInstructions(film,overrides,'scene');
A.match(text,/Режиссёрский подход — 0\/10/);A.match(text,/Темп — 0\/10: Медленный созерцательный/);A.match(text,/Жанровая выраженность — 10\/10/);A.match(text,/Хоррор: конкретный источник угрозы/);A.match(text,/Дети 7–10 лет/);A.match(text,/Лягушка остаётся в короне/);A.match(text,/приоритет|Приоритет/);A.match(text,/Утверждённый сюжет не заменяется автоматически/);A.match(text,/Выбор и утверждение остаются за режиссёром/);A.match(text,/состояния на входе и выходе, одежду, реквизит/);A.match(text,/не ускоряй и не обрезай речь/i);
const noGenre=C.renderCreativeInstructions({...film,strengths:{genre:0}});A.doesNotMatch(noGenre,/Сказка: узнаваемое правило/,'Genre intensity0 disables added genre devices');
const documentary=C.renderCreativeInstructions({...legacy,genre:'Неигровое кино',factual:true,strengths:{plotFreedom:10,surprise:10,genre:10}},undefined,'scenario');A.match(documentary,/не выдумывай события, цитаты, мотивы или биографические факты/);A.match(documentary,/отдельный кандидат/);A.match(documentary,/только режиссёр/);A.match(documentary,/не разрешение|не даёт права|не.*системные правила/);
A.match(C.renderCreativeInstructions({...legacy,strengths:{style:4}},undefined,'scenario'),/два-три уместных приёма/);A.match(C.renderCreativeInstructions({...legacy,strengths:{style:9}},undefined,'scenario'),/три-четыре работающих приёма/);
A.match(C.renderCreativeInstructions({...legacy,strengths:{pace:10}}),/Быстрый ритм/);A.match(C.renderCreativeInstructions({...legacy,strengths:{pace:5}}),/Сбалансированный ритм/);
for(const genre of ['Сказка','Блокбастер','Хоррор','Комедия','Драма','Триллер','Детектив','Фэнтези','Неигровое кино'])A(C.GENRE_OPTIONS.includes(genre));
const custom=C.effectiveCreativeBrief(legacy,{genre:'Поэтическая сказочная трагикомедия',director:'Собственный подход',techniques:'Тёплые детали, предметы как мотивы'});A.equal(custom.genre,'Поэтическая сказочная трагикомедия');A.equal(custom.director,'Собственный подход');A.match(C.renderCreativeInstructions(legacy,{genre:'Блокбастер'}),/один выразительный зрелищный эпизод/);
for(const n of [0,1,3,4,6,7,10])for(const key of C.CREATIVE_STRENGTH_KEYS){const line=C.renderCreativeInstructions({...legacy,strengths:{[key]:n}});A(line.includes(`${C.CREATIVE_STRENGTH_LABELS[key]} — ${n}/10`));}
A.equal(Object.hasOwn(legacy,'strengths'),false,'Render does not mutate legacy settings');
const p=C.D.newProject('Проверка задания'),d=C.R.ensureDirecting(p);d.brief=C.R.creativeBriefSchema.parse({...film,promptNotes:'Раскрывай чудо через реакцию героя.'});
const scene={id:C.D.id(),title:'Находка',purpose:'Раскрыть чудо',location:'Болото',conflict:'Неизвестность',turn:'Обнаружение',stateIn:'Поиск',stateOut:'Находка',continuity:[],shots:[],creativeOverrides:overrides};d.scenes=[scene];
const run={id:'preview',created:'',basis:'',model:'test',mode:'role',sceneIds:[scene.id],tasks:[]},task={id:'preview',role:'camera',sceneId:scene.id,requires:[]};
const prompt=C.R.directorPrompt(p,run,task);A.match(prompt,/Темп — 0\/10/);A.match(prompt,/Жанровая выраженность — 10\/10/);A.match(prompt,/Раскрывай чудо через реакцию героя/);A.match(prompt,/Дети 7–10 лет/);
A.match(C.D.promptFor(p,p.items.find(i=>i.stage===0),'Создай версию'),/Режиссёрский подход — 8\/10/,'Ordinary generation uses the same creative directions');
const image=p.items.find(i=>i.stage===5);image.sourceShot={scriptId:C.D.id(),title:'Находка',sceneId:scene.id};const j={id:C.D.id(),itemId:image.id,model:'mock',kind:'image',refs:[],status:'queued'};C.V.stampGenerationVersions(p,[j]);A.equal(j.versionInfo.settings.brief.strengths.pace,0);A.equal(j.versionInfo.settings.brief.genre,'Хоррор + Приключение');
console.log('PASS creative strengths0–10, undefined inheritance and explicit0, film constraint priority, legacy preservation, custom/mixed genres, measurable scenario/scene instructions, explicit director choice. No paid requests.');
