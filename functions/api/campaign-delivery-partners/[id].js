import { json,error } from '../../lib/response.js';
import { first,all } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
import { buildDeliveryPartnerPerformance } from '../../lib/campaign-delivery-partner-performance.js';

export async function onRequestGet(context){
  try{
    const tenantId=requireTenant(context.data.auth);
    if(!context.env.DB)return error('D1 binding DB is not configured',500);
    const row=await first(context.env.DB,`SELECT c.id,c.name,c.status,c.start_date,c.end_date,c.notes,p.name AS project_name FROM campaigns c JOIN projects p ON p.id=c.project_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.id=? LIMIT 1`,[tenantId,context.params.id]);
    if(!row)return error('Campaign engagement not found',404);
    const partners=await all(context.env.DB,`SELECT id,name,partner_type,status,website,x_url,contact_name FROM partners WHERE tenant_id=? AND status IN ('ACTIVE','DORMANT') ORDER BY name COLLATE NOCASE`,[tenantId]);
    return json({item:{id:row.id,name:row.name,projectName:row.project_name,status:row.status,startDate:row.start_date,targetCompletionDate:row.end_date,performance:buildDeliveryPartnerPerformance(row.notes,partners)}});
  }catch(cause){return error(cause.message||'Delivery partner performance could not be loaded',Number(cause.status||500));}
}
