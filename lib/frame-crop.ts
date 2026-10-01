import {z} from 'zod';

export const FRAME_CROP_FORMATS=['16:9','9:16'] as const;
export type FrameCropFormat=typeof FRAME_CROP_FORMATS[number];
export type CropRect={x:number;y:number;width:number;height:number};
export const frameCropTransformSchema=z.object({
  sourceAssetId:z.string().uuid(),sourceWidth:z.number().int().min(16).max(32768),sourceHeight:z.number().int().min(16).max(32768),
  rect:z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}),
  format:z.enum(FRAME_CROP_FORMATS),outputWidth:z.number().int().positive().max(2048),outputHeight:z.number().int().positive().max(2048),
}).superRefine((v,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.rect.x+v.rect.width>v.sourceWidth||v.rect.y+v.rect.height>v.sourceHeight)fail('Область кадра выходит за исходное изображение.');
  const [rw,rh]=v.format==='16:9'?[16,9]:[9,16];
  if(v.rect.width*rh!==v.rect.height*rw)fail('Область должна соответствовать выбранному формату без растягивания.');
  if(v.outputWidth*rh!==v.outputHeight*rw)fail('Размер PNG должен соответствовать выбранному формату.');
  if(v.outputWidth>v.rect.width||v.outputHeight>v.rect.height)fail('Подготовка кадра не увеличивает исходные пиксели.');
});
export type FrameCropTransform=z.infer<typeof frameCropTransformSchema>;

function dimensions(width:number,height:number){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>32768||height>32768)throw Error('Изображение должно быть от 16 до 32 768 пикселей по каждой стороне.');
}
function ratio(format:FrameCropFormat){if(!FRAME_CROP_FORMATS.includes(format))throw Error('Выберите формат 16:9 или 9:16.');return format==='16:9'?[16,9] as const:[9,16] as const;}
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
/** Coordinates are source pixels. Position 0/100 reaches either edge of the available travel. */
export function fitFrameCrop(width:number,height:number,format:FrameCropFormat,scale=1,positionX=50,positionY=50):CropRect{
  dimensions(width,height);const [rw,rh]=ratio(format);
  if(![scale,positionX,positionY].every(Number.isFinite)||scale<=0||scale>1||positionX<0||positionX>100||positionY<0||positionY>100)throw Error('Укажите размер области 1–100% и положение 0–100%.');
  const units=Math.max(1,Math.floor(Math.min(width/rw,height/rh)*scale)),cropWidth=units*rw,cropHeight=units*rh;
  return {x:Math.round((width-cropWidth)*positionX/100),y:Math.round((height-cropHeight)*positionY/100),width:cropWidth,height:cropHeight};
}
/** Changing one size preserves aspect ratio and keeps the complete rectangle inside its original file. */
export function resizeFrameCrop(width:number,height:number,format:FrameCropFormat,rect:CropRect,key:keyof CropRect,value:number):CropRect{
  dimensions(width,height);if(!Number.isFinite(value))throw Error('Введите число пикселей.');const [rw,rh]=ratio(format);
  const maxUnits=Math.floor(Math.min(width/rw,height/rh));
  const units=key==='width'?clamp(Math.floor(value/rw),1,maxUnits):key==='height'?clamp(Math.floor(value/rh),1,maxUnits):Math.floor(rect.width/rw);
  const next={...rect,width:units*rw,height:units*rh};if(key==='x'||key==='y')next[key]=Math.round(value);
  next.x=clamp(next.x,0,width-next.width);next.y=clamp(next.y,0,height-next.height);return next;
}
export function frameCropTransform(sourceAssetId:string,width:number,height:number,format:FrameCropFormat,rect:CropRect):FrameCropTransform{
  const [rw,rh]=ratio(format),units=Math.floor(Math.min(rect.width/rw,rect.height/rh,2048/rw,2048/rh));
  if(units<1)throw Error('Выбранная область слишком мала для подготовки кадра.');
  return frameCropTransformSchema.parse({sourceAssetId,sourceWidth:width,sourceHeight:height,rect,format,outputWidth:units*rw,outputHeight:units*rh});
}
/** Same operation draws the visible preview and exported PNG: no screenshot, CSS crop or prompt instruction. */
export function drawFrameCrop(canvas:HTMLCanvasElement,image:HTMLImageElement|ImageBitmap,value:FrameCropTransform){
  const v=frameCropTransformSchema.parse(value),width='naturalWidth' in image?image.naturalWidth:image.width,height='naturalHeight' in image?image.naturalHeight:image.height;
  if(width!==v.sourceWidth||height!==v.sourceHeight)throw Error('Размер исходного файла изменился. Откройте подготовку кадра заново.');
  canvas.width=v.outputWidth;canvas.height=v.outputHeight;const context=canvas.getContext('2d');if(!context)throw Error('Браузер не поддерживает подготовку изображений.');
  context.clearRect(0,0,canvas.width,canvas.height);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  context.drawImage(image,v.rect.x,v.rect.y,v.rect.width,v.rect.height,0,0,v.outputWidth,v.outputHeight);
}
export async function frameCropPng(canvas:HTMLCanvasElement,image:HTMLImageElement|ImageBitmap,value:FrameCropTransform):Promise<Blob>{
  drawFrameCrop(canvas,image,value);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Не удалось сохранить PNG.')),'image/png'));
  if(blob.type!=='image/png'||blob.size<=0||blob.size>10*1024*1024)throw Error('Подготовленный PNG должен быть не больше 10 МБ. Выберите меньшую область.');return blob;
}
