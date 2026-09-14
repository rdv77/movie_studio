import {runtime} from '@/lib/storage';
export const dynamic='force-dynamic';
export async function GET(){
  try{await runtime.DB.prepare('SELECT revision FROM projects LIMIT 1').first();return Response.json({status:'ok'},{headers:{'cache-control':'no-store'}});}
  catch{return Response.json({status:'unavailable'},{status:503});}
}
