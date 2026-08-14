import { error,json,readJson } from '../../../lib/response.js';
import { requireRole,requireTenant } from '../../../lib/permissions.js';
import { commitCsvImport,CSV_ENTITIES,CSV_IMPORT_ENTITIES,exportEntityCsv,previewCsvImport } from '../../../lib/csv-portability.js';

const EXPORT_ROLES=['OWNER','ADMIN','BD_MANAGER','BD_MEMBER','FINANCE','VIEWER'];
const IMPORT_ROLES=['OWNER','ADMIN'];

export async function onRequestGet(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,EXPORT_ROLES);
    const url=new URL(context.request.url),entity=String(url.searchParams.get('entity')||'projects').toLowerCase();
    const result=await exportEntityCsv(context.env.DB,tenantId,entity);
    return new Response(result.csv,{status:200,headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="akari-${result.entity}-${new Date().toISOString().slice(0,10)}.csv"`,'cache-control':'private, no-store','x-akari-row-count':String(result.rowCount)}});
  }catch(cause){console.error('R76 CSV export failed',cause);return error(cause.message||'CSV export failed',Number(cause.status||500));}
}

export async function onRequestPost(context){
  try{
    const auth=context.data?.auth||{},tenantId=requireTenant(auth);requireRole(auth,IMPORT_ROLES);
    const body=await readJson(context.request),entity=String(body.entity||'').toLowerCase(),csv=String(body.csv||'');
    if(!csv)return error('CSV content is required',422);
    if(body.commit===true){const result=await commitCsvImport(context.env.DB,tenantId,auth.userId,entity,csv);return json({committed:true,result});}
    const preview=await previewCsvImport(context.env.DB,tenantId,entity,csv);return json({committed:false,preview});
  }catch(cause){console.error('R76 CSV import failed',cause);return error(cause.message||'CSV import failed',Number(cause.status||500),cause.details?{details:cause.details}:{});}
}

export async function onRequestOptions(){return json({exportEntities:CSV_ENTITIES,importEntities:CSV_IMPORT_ENTITIES});}
