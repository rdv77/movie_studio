import { chosen, isApproved, type Project, type Item } from './domain';
import { approvedCharacters } from './characters';
import { planFields, storyboardPrompt } from './storyboard';
import { videoShot } from './video';

export const MINIMAX_IMAGE_PROMPT_LIMIT = 1500;
export const MINIMAX_IMAGE_ESTIMATE = '35000000'; // $0.0035; estimate, not a billing receipt.
export const isMiniMaxImage = (id: string) => id === 'image-01';
export function miniMaxImageRefIssue(refs: { mime: string; size: number }[]) {
  if (refs.length > 8) return 'MiniMax image-01: в студии можно передать до 8 референсов.';
  if (refs.some(r => !['image/png','image/jpeg'].includes(r.mime) || r.size >= 10*1024*1024))
    return 'MiniMax image-01: референсы должны быть PNG или JPEG меньше 10 МБ. Замените WebP на PNG/JPEG либо выберите другую модель.';
  if (refs.reduce((sum,r) => sum+r.size,0) > 20*1024*1024)
    return 'MiniMax image-01: суммарный размер референсов в студии — до 20 МБ.';
  return '';
}
const clean = (s: string) => s.replace(/\s+/g,' ').trim();
const shorten = (s: string, n: number) => {
  if (s.length <= n) return s;
  const cut=s.slice(0,Math.max(0,n-1));
  const space=cut.lastIndexOf(' ');
  return (space>n*0.7?cut.slice(0,space):cut).trimEnd()+'…';
};

// Separate quotas keep both style and locations present even with many cards.
// Only approved descriptions are included; never embed serialized variants.
export function characterVisualContext(p:Project) {
  const summary=(stage:number)=>{
    const cards=p.items.filter(i=>i.stage===stage&&isApproved(p,i));
    const perCard=Math.max(1,Math.floor(900/Math.max(1,cards.length))-3);
    return shorten(cards.map(card=>{
      const v=card.variants.find(v=>v.id===card.approvedId)!;
      const brief=v.kind==='text'?v.text:p.jobs.find(j=>j.id===v.jobId)?.brief||v.text;
      return shorten(clean(`${card.title}: ${brief||'визуальный образ по утверждённому референсу'}`),perCard);
    }).join('; '),900);
  };
  return {style:summary(2),locations:summary(3)};
}
export function characterImageRequest(p:Project,item:Item,instruction:string,refs:string[],index=1,count=1,modelId='') {
  const limit=isMiniMaxImage(modelId)?MINIMAX_IMAGE_PROMPT_LIMIT:4000;
  return {...compactImageRequest(p,item,instruction,refs,index,count,limit),limit};
}

// A separate, visible compact prompt. Never trim a serialized screenplay or
// mutate the director's source cards. Preview and queued jobs use this function.
export function miniMaxImageRequest(p:Project,item:Item,instruction:string,refs:string[],index=1,count=1) {
  return compactImageRequest(p,item,instruction,refs,index,count,MINIMAX_IMAGE_PROMPT_LIMIT);
}
export function compactImageRequest(p:Project,item:Item,instruction:string,refs:string[],index=1,count=1,limit=MINIMAX_IMAGE_PROMPT_LIMIT) {
  const fields=planFields(p,item,chosen(item)),shot=videoShot(p,item);
  const speech=fields.speechType==='character'
    ? `Говорит ${fields.speaker}; лицо видно; у всех остальных рты закрыты весь план, без артикуляции.`
    : 'У всех героев закрыты рты; речь только за кадром или отсутствует.';
  const character=item.stage===1?(item.character??chosen(item)?.character):undefined;
  const fixed=character
    ? `Образ одного героя анимационного фильма, ${p.format}. Покажи только этого героя в полный рост, с хорошо различимым лицом, на простом фоне. Без текста, коллажа и других персонажей. Прикреплённые изображения — прообразы; сохрани узнаваемые черты, меняй только указанное в задаче. Вариант ${index}/${count}.`
    : `Анимация, ${p.format}. Одно цельное изображение, без текста, коллажа и пузырей речи. Сохрани лица, одежду и стиль референсов. Только участники описанного действия. ${speech} Вариант ${index}/${count}.`;
  const sections:{label:string;text:string;weight:number}[]=[];
  const add=(label:string,text:string,weight:number)=>{if(clean(text))sections.push({label,text:clean(text),weight});};
  const defaultTask=item.stage===5?storyboardPrompt(p,item).trim():'';
  const task=instruction.trim();
  const visual=chosen(item);
  const action=visual?.text&&(visual.kind==='text'||!visual.jobId)?visual.text:shot?.description??'';
  if(item.stage===5) {
    const actionAt=defaultTask.indexOf('\n\nДействие: '),cameraAt=defaultTask.lastIndexOf('\nКамера (покажи начальный ракурс): ');
    const description=actionAt>=0&&cameraAt>actionAt?defaultTask.slice(actionAt+11,cameraAt):action;
    add('План',`${shot?.title??item.title}. ${description}`,4);
    // Keep notes appended after our generated speech footer when a saved brief is edited.
    for(const ending of ['Не добавляй голос или субтитры.','не добавляй свою речь, пение или субтитры.']) {
      const at=defaultTask.lastIndexOf(ending);
      if(at>=0)add('Дополнение режиссёра',defaultTask.slice(at+ending.length),3);
    }
    add('Камера',fields.camera,1);
    add('Стыковка',fields.continuity,3);
    if(shot?.productionDesign)add('Художественное решение',shot.productionDesign,3);
  }
  if(task!==defaultTask) add('Задача режиссёра',task,5);
  if(character) {
    add('Герой',`${character.name}: ${character.appearance}`,5);
    add('Характер',character.description,2);
    add('Работа с исходными изображениями',character.instructions,5);
  }
  for(const c of item.stage<4?[]:approvedCharacters(p))
    add(`Герой ${c.profile.name}`,`${refs.includes(c.assetId)?`Референс ${refs.indexOf(c.assetId)+1}. `:''}${c.profile.appearance||c.profile.description}`,2);
  if(item.stage===1){
    const context=characterVisualContext(p);
    add('Стиль',context.style,3);
    add('Локации и мир',context.locations,3);
    add('Единство образа','Согласуй рисунок, фактуры, палитру, свет и костюм героя с утверждённым стилем и миром. Локации задают окружение истории, а портрет остаётся на простом фоне.',2);
  }
  for(const card of p.items.filter(i=>item.stage!==1&&[2,3].includes(i.stage)&&i.stage<item.stage&&isApproved(p,i))) {
    const v=card.variants.find(v=>v.id===card.approvedId)!;
    if(card.stage===3&&v.kind!=='text'&&!refs.includes(v.assetId??''))continue;
    add(card.stage===2?'Стиль':'Локация',v.text,2);
  }
  const render=(texts:string[])=>[fixed,...sections.map((s,i)=>`${s.label}: ${texts[i]}`)].join('\n');
  const original=render(sections.map(s=>s.text));
  let prompt=original;
  if(prompt.length>limit) {
    // Labels also consume the cap; unusually many/long names require explicit editing.
    const budget=limit-render(sections.map(()=>'' )).length;
    if(budget<sections.length*12) return {prompt:original,length:original.length,shortened:false,sections:sections.map(s=>({label:s.label,length:s.text.length}))};
    const lengths=sections.map(()=>0);let remaining=budget;
    while(remaining>0) {
      let assigned=0;
      for(let i=0;i<sections.length&&remaining>0;i++) {
        const n=Math.min(sections[i].weight,sections[i].text.length-lengths[i],remaining);
        lengths[i]+=n;remaining-=n;assigned+=n;
      }
      if(!assigned)break;
    }
    prompt=render(sections.map((s,i)=>shorten(s.text,lengths[i])));
  }
  return {prompt,length:prompt.length,shortened:original.length>prompt.length,sections:sections.map(s=>({label:s.label,length:s.text.length}))};
}
