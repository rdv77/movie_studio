/** Recover only a duplicated opening quote on an ASCII object-property name.
 * Strings, values and array members are never rewritten. The repaired candidate
 * must still pass JSON.parse and the caller's ordinary semantic schema. */
export function parseDirectorJSON(value:string):unknown{
  const source=value.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  try{return JSON.parse(source);}catch(original){
    if(source.length>200_000)throw original;
    const stack:string[]=[],remove:number[]=[];
    let quoted=false,escaped=false,previous='';
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(quoted){
        if(escaped)escaped=false;
        else if(c==='\\')escaped=true;
        else if(c==='"'){quoted=false;previous='"';}
        continue;
      }
      if(/\s/.test(c))continue;
      if(c==='"'){
        if(stack.at(-1)==='{'&&(previous==='{'||previous===',')&&/^""[A-Za-z_][A-Za-z0-9_]{0,99}"\s*:/.test(source.slice(i,i+110))){
          remove.push(i);
          if(remove.length>4)throw original;
          i++; // The second quote becomes the original property's opener.
        }
        quoted=true;previous='"';continue;
      }
      if(c==='{'||c==='[')stack.push(c);
      else if(c==='}'||c===']')stack.pop();
      previous=c;
    }
    if(!remove.length)throw original;
    // Scanner and slice use the same UTF-16 offsets, preserving surrogate pairs.
    const candidate=remove.reduceRight((text,index)=>text.slice(0,index)+text.slice(index+1),source);
    try{return JSON.parse(candidate);}catch{throw original;}
  }
}
