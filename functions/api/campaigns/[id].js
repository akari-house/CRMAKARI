import { json, error, readJson } from '../../lib/response.js';
import { first, run, makeId, nowIso } from '../../lib/db.js';
import { requireTenant } from '../../lib/permissions.js';
const WRITE_ROLES=new Set(['OWNER','ADMIN','BD_MANAGER','BD_MEMBER']);
const STATUSES=new Set(['CONFIRMED','ONBOARDING','PLANNING','CREATOR_SELECTION','LIVE','REPORTING','COMPLETED','PAUSED','CANCELLED']);
export async function onRequestPatch(context){
  try{
    const auth=context.data.auth;if(!WRITE_ROLES.has(auth?.role))return error('Campaign write permission is required',403);
    const tenantId=requireTenant(auth);const id=context.params.id;const body=await readJson(context.request);if(!context.env.DB)return json({id,updated:true,demo:true});
    const existing=await first(context.env.DB,'SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?',[tenantId,id]);if(!existing)return error('Campaign not found',404);
    const status=body.status?String(body.status).toUpperCase():existing.status;if(!STATUSES.has(status))return error('Invalid campaign status',422);const now=nowIso();
    await run(context.env.DB,`UPDATE campaigns SET status=?, gross_revenue=COALESCE(?,gross_revenue), gross_revenue_base_currency=COALESCE(?,gross_revenue_base_currency), campaign_cost=COALESCE(?,campaign_cost), creator_cost=COALESCE(?,creator_cost), other_cost=COALESCE(?,other_cost), referral_percentage=COALESCE(?,referral_percentage), amount_invoiced=COALESCE(?,amount_invoiced), amount_received=COALESCE(?,amount_received), next_action=COALESCE(?,next_action), notes=COALESCE(?,notes), updated_at=?, updated_by=? WHERE tenant_id=? AND id=?`,[
      status,body.grossRevenue===undefined?null:Number(body.grossRevenue),body.grossRevenue===undefined?null:Number(body.grossRevenue),body.campaignCost===undefined?null:Number(body.campaignCost),body.creatorCost===undefined?null:Number(body.creatorCost),body.otherCost===undefined?null:Number(body.otherCost),body.referralPercentage===undefined?null:Number(body.referralPercentage),body.amountInvoiced===undefined?null:Number(body.amountInvoiced),body.amountReceived===undefined?null:Number(body.amountReceived),body.nextAction||null,body.notes||null,now,auth.userId,tenantId,id
    ]);
    await run(context.env.DB,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,'CAMPAIGN_UPDATED','CAMPAIGN',?,?,?,?)`,[makeId('aud'),tenantId,auth.userId,id,JSON.stringify({status:existing.status}),JSON.stringify({status}),now]);
    return json({id,updated:true,status});
  }catch(cause){console.error('Campaign PATCH error',cause);return error(cause.message||'Campaign could not be updated',Number(cause.status||500));}
}
