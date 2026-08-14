const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const databaseId=String(process.env.AKARI_D1_DATABASE_ID||'').trim();

for(const [name,value] of [['CLOUDFLARE_API_TOKEN',token],['CLOUDFLARE_ACCOUNT_ID',accountId],['AKARI_D1_DATABASE_ID',databaseId]]){
  if(!value)throw new Error(`${name} is required for the D1 authorization preflight`);
}

const endpoint=`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const response=await fetch(endpoint,{
  method:'POST',
  headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
  body:JSON.stringify({sql:'SELECT 1 AS akari_d1_authorized;'}),
});
let body=null;
try{body=await response.json();}catch{body={success:false,errors:[{message:'Cloudflare returned a non-JSON response'}]};}

const errors=Array.isArray(body?.errors)?body.errors:[];
const resultFailed=Array.isArray(body?.result)&&body.result.some(item=>item?.success===false);
if(!response.ok||body?.success!==true||errors.length||resultFailed){
  const compact={httpStatus:response.status,success:body?.success??false,errors,messages:body?.messages||[]};
  console.error('Cloudflare D1 authorization preflight failed.');
  console.error(JSON.stringify(compact,null,2));
  if(errors.some(error=>Number(error?.code)===7403)){
    console.error('Cloudflare error 7403: verify the API token belongs to the same account and has Account > D1 > Edit permission.');
  }
  process.exit(1);
}

console.log('Cloudflare D1 authorization preflight passed. Production D1 query access is authorized.');
