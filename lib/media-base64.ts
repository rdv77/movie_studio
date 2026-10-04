/** Decode binary media without Uint8Array.from(string), whose iterator builds
 * an intermediate array of boxed characters in Workers. Keep temporary binary
 * strings small even when several generation responses complete together. */
export function decodeMediaBase64(encoded:string):Uint8Array<ArrayBuffer> {
  // Preserve atob's support for unpadded API responses and ASCII whitespace.
  if(/[\t\n\f\r ]/.test(encoded))encoded=encoded.replace(/[\t\n\f\r ]/g,'');
  if(encoded.length%4===1||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||
    (encoded.includes('=')&&encoded.length%4))
    throw new Error('Invalid media base64.');
  const padding=encoded.endsWith('==')?2:encoded.endsWith('=')?1:0;
  const bytes=new Uint8Array(Math.floor(encoded.length/4*3)-padding);
  const chunkSize=32*1024; // Multiple of four; at most 24 KiB decoded per chunk.
  let offset=0;
  for(let n=0;n<encoded.length;n+=chunkSize){
    const binary=atob(encoded.slice(n,n+chunkSize));
    for(let i=0;i<binary.length;i++)bytes[offset++]=binary.charCodeAt(i);
  }
  return bytes;
}
