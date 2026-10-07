/** Recover a duplicated opening property quote or one extra mismatched closing
 * delimiter in an otherwise closed JSON tail. Strings/values are never rewritten
 * and missing closers are not invented. JSON.parse and semantic schemas still run. */
export function parseDirectorJSON(value:string):unknown{
  const source=value.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  try{return JSON.parse(source);}catch(original){
    if(source.length>200_000)throw original;
    const stack:string[]=[],remove:number[]=[];
    let quoted=false,escaped=false,previous='',tailDelimiterRemoved=false;
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
      else if(c==='}'||c===']'){
        const expected=stack.at(-1)==='{'?'}':stack.at(-1)==='['?']':undefined;
        if(c!==expected){
          // Only a redundant closer immediately before the expected closer at
          // the very end. No recovery across another value, key or array item.
          if(expected&&!tailDelimiterRemoved&&/^[\s\]}]+$/.test(source.slice(i))&&source.slice(i+1).trimStart().startsWith(expected)){
            remove.push(i);tailDelimiterRemoved=true;continue;
          }
          throw original;
        }
        stack.pop();
      }
      previous=c;
    }
    if(!remove.length)throw original;
    // Scanner and slice use the same UTF-16 offsets, preserving surrogate pairs.
    const candidate=remove.reduceRight((text,index)=>text.slice(0,index)+text.slice(index+1),source);
    try{return JSON.parse(candidate);}catch{throw original;}
  }
}
