const ALWAYS_PRIVATE=new Set([
  'internal_notes','internalNotes','owner_user_id','created_by','updated_by','access_id','metadata_json',
]);
const DATA_ROOM_PRIVATE=new Set(['notes','change_note','checksum','investor_pipeline_id']);

function sanitize(value,{dataRoom=false}={}){
  if(Array.isArray(value))return value.map(item=>sanitize(item,{dataRoom}));
  if(!value||typeof value!=='object')return value;
  const clean={};
  for(const [key,item] of Object.entries(value)){
    if(ALWAYS_PRIVATE.has(key))continue;
    if(dataRoom&&DATA_ROOM_PRIVATE.has(key))continue;
    clean[key]=sanitize(item,{dataRoom});
  }
  return clean;
}

export async function onRequest(context){
  const response=await context.next();
  const type=String(response.headers.get('content-type')||'');
  if(!type.includes('application/json'))return response;
  const dataRoom=new URL(context.request.url).pathname.endsWith('/data-room');
  let payload;
  try{payload=await response.clone().json();}catch{return response;}
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-akari-portal-privacy','founder-safe');
  return new Response(JSON.stringify(sanitize(payload,{dataRoom})),{status:response.status,statusText:response.statusText,headers});
}

export const __portalPrivacyForTest={sanitize};
