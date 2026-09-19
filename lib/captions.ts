import type { Item, Project } from './domain';

export const CAPTION_FONTS = { Arial: 'Arial, sans-serif', 'Times New Roman': '"Times New Roman", serif', 'Courier New': '"Courier New", monospace' };
export type PlanCaption = { planId: string; text: string; enabled: boolean; font: keyof typeof CAPTION_FONTS; size: number; x: number; y: number; color: 'white'|'black'; background: boolean };
export function defaultCaption(planId:string):PlanCaption {
  return {planId,text:'',enabled:true,font:'Arial',size:56,x:50,y:90,color:'white',background:true};
}
export function sameCaptionPlan(a:Item,b:Item) {
  if(a.id===b.id)return true;
  if(!a.sourceShot||!b.sourceShot)return false;
  if(a.sourceShot.scriptId!==b.sourceShot.scriptId)return false;
  return a.sourceShot.key&&b.sourceShot.key ? a.sourceShot.key===b.sourceShot.key : a.sourceShot.title===b.sourceShot.title;
}
export function captionForPlan(p:Project,item:Item) {
  const frame=p.items.find(i=>i.stage===5&&!i.removedAt&&!i.planArchive&&sameCaptionPlan(i,item));
  return frame ? p.captions?.find(c=>c.planId===frame.id&&c.enabled&&c.text.trim()) : undefined;
}
// Canvas is used both for the editor preview and the actual transparent PNG.
// Text is never interpreted as HTML or as an FFmpeg filter expression.
export function drawCaption(canvas:HTMLCanvasElement,c:PlanCaption,width:number,height:number) {
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось подготовить титр.');
  ctx.clearRect(0,0,width,height);if(!c.enabled||!c.text.trim())return;
  ctx.font=`${c.size}px ${CAPTION_FONTS[c.font]}`;
  const pad=Math.ceil(c.size*.3), margin=16, maxWidth=width-2*(pad+margin), lines:string[]=[];
  for(const paragraph of c.text.split('\n')){
    let line='';
    for(const word of paragraph.split(/\s+/)){
      const candidate=line?`${line} ${word}`:word;
      if(ctx.measureText(candidate).width<=maxWidth){line=candidate;continue;}
      if(line)lines.push(line);line='';
      for(const char of word){if(line&&ctx.measureText(line+char).width>maxWidth){lines.push(line);line='';}line+=char;}
    }
    lines.push(line);
  }
  const lineHeight=c.size*1.25, boxHeight=lines.length*lineHeight+pad*2;
  if(boxHeight>height-margin*2)throw new Error('Титр не помещается по высоте. Уменьшите шрифт или сократите текст.');
  const boxWidth=Math.max(...lines.map(l=>ctx.measureText(l).width),0)+pad*2;
  const left=Math.max(margin,Math.min(width-boxWidth-margin,width*c.x/100-boxWidth/2));
  const top=Math.max(margin,Math.min(height-boxHeight-margin,height*c.y/100-boxHeight/2));
  if(c.background){ctx.fillStyle=c.color==='white'?'rgba(0,0,0,0.65)':'rgba(255,255,255,0.8)';ctx.fillRect(left,top,boxWidth,boxHeight);}
  ctx.fillStyle=c.color;ctx.textAlign='center';ctx.textBaseline='middle';
  lines.forEach((line,n)=>ctx.fillText(line,left+boxWidth/2,top+pad+lineHeight*(n+.5)));
}
export async function captionPng(c:PlanCaption,width:number,height:number) {
  await document.fonts.ready;
  const canvas=document.createElement('canvas');drawCaption(canvas,c,width,height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось сохранить титр.')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
