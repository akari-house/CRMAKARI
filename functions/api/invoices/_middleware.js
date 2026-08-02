import { first } from '../../lib/db.js';
import { error } from '../../lib/response.js';
import { requireTenant } from '../../lib/permissions.js';
import { parseJson, text } from '../../lib/revenue-lifecycle.js';

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const isCreateInvoice = context.request.method === 'POST' && /^\/api\/invoices\/?$/.test(url.pathname);
    if (!isCreateInvoice || !context.env.DB) return context.next();

    const body = await context.request.clone().json().catch(() => ({}));
    const campaignId = text(body.campaignId, 120);
    if (!campaignId) return context.next();

    const tenantId = requireTenant(context.data.auth);
    const campaign = await first(context.env.DB, `
      SELECT id, notes
      FROM campaigns
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `, [tenantId, campaignId]);
    if (!campaign) return context.next();

    const metadata = parseJson(campaign.notes, {});
    const nonBillable = metadata.invoiceEligible === false
      || metadata.dealModel === 'PARTNERSHIP'
      || metadata.commercialModel === 'NON_BILLABLE';
    if (nonBillable) {
      return error('This partnership is non-billable and does not require an invoice', 422);
    }
    return context.next();
  } catch (cause) {
    return error(cause.message || 'Invoice eligibility could not be checked', Number(cause.status || 500));
  }
}
