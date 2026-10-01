import type {Project,Item,Variant} from './domain';
import {frameSchedule,animaticMotionFilter} from './animatic-manifest';
import {versionShot} from './creative-versions';
type Engine={writeFile:(name:string,data:Uint8Array)=>Promise<unknown>;deleteFile:(name:string)=>Promise<unknown>;exec:(args:string[])=>Promise<number>};
export async function renderKeyframeClip(p:Project,item:Item,clip:Variant,index:number,width:number,height:number,ff:Engine,input:(name:string,v:Variant)=>Promise<void>,args:(v:Variant,index:number,width:number,height:number,animatic:boolean,caption?:string)=>string[],captionFile?:string){
  const frames=frameSchedule(p,item,clip.duration),motion=(p as Project&{animaticSettings?:{motion?:boolean}}).animaticSettings?.motion;
  const direction=versionShot(p,item)?.direction,files:string[]=[];
  for(const [n,frame] of frames.entries()){
    const source=item.variants.find(v=>v.id===frame.variantId);if(!source)throw Error('Источник ключевого кадра изменился.');
    const inputName=`kf-${index}-${n}`,outputName=`kf-${index}-${n}.mp4`;await input(inputName,source);
    const options=args({...clip,duration:frame.duration},index,width,height,true,captionFile).map(value=>value===`in${index}`?inputName:value===`clip${index}.mp4`?outputName:value);
    const filter=motion?animaticMotionFilter(direction,width,height,frame.duration):'';
    if(filter){for(const key of ['-vf','-filter_complex']){const at=options.indexOf(key);if(at>=0)options[at+1]=options[at+1].replace('fps=24','fps=24'+filter);}}
    if(await ff.exec(options)!==0)throw Error(`Не удалось подготовить ключевой кадр «${item.title}».`);
    await ff.deleteFile(inputName);files.push(outputName);
  }
  const list=`kf-list-${index}.txt`;await ff.writeFile(list,new TextEncoder().encode(files.map(name=>`file '${name}'`).join('\n')));
  if(await ff.exec(['-y','-f','concat','-safe','0','-i',list,'-c','copy',`clip${index}.mp4`])!==0)throw Error(`Не удалось соединить ключевые кадры «${item.title}».`);
  await ff.deleteFile(list);for(const file of files)await ff.deleteFile(file);
}
