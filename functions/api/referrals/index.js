import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';

function requireFinance(auth) {
  if (!canViewFinance(auth)) {
    const permissionError = new Error('Finance permission is required');
    permissionError.status = 403;
    throw permissionError;
  }
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    requireFinance(auth);
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ items: [], total: 0, demo: true });
    const items = await all(context.env.DB, `
      SELECT r.*, p.name AS partner_name, pr.name AS project_name,
             o.name AS opportunity_name, c.name AS engagement_name
      FROM referrals r
      JOIN partners p ON p.id = r.partner_id AND p.tenant_id = r.tenant_id
      LEFT JOIN projects pr ON pr.id = r.project_id AND pr.tenant_id = r.tenant_id
      LEFT JOIN opportunities o ON o.id = r.opportunity_id AND o.tenant_id = r.tenant_id
      LEFT JOIN campaigns c ON c.id = r.campaign_id AND c.tenant_id = r.tenant_id
      WHERE r.tenant_id = ?
      ORDER BY CASE r.payment_status WHEN 'DUE' THEN 1 WHEN 'CONFIRMED' THEN 2 WHEN 'ESTIMATED' THEN 3 ELSE 4 END,
               COALESCE(r.due_date, '9999-12-31') ASC, r.updated_at DESC
    `, [tenantId]);
    return json({
      items: items.map((row) => ({
        id: row.id,
        partnerId: row.partner_id,
        partnerName: row.partner_name,
        projectId: row.project_id,
        projectName: row.project_name,
        opportunityId: row.opportunity_id,
        opportunityName: row.opportunity_name,
        engagementId: row.campaign_id,
        engagementName: row.engagement_name,
        revenueBasis: Number(row.revenue_basis || 0),
        percentage: Number(row.referral_percentage || 0),
        amount: Number(row.referral_amount || 0),
        currency: row.currency || 'USD',
        status: row.payment_status,
        dueDate: row.due_date,
        paidDate: row.paid_date,
        transactionReference: row.transaction_reference,
        notes: row.notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: items.length,
    });
  } catch (cause) {
    return error(cause.message || 'Referral rewards could not be loaded', Number(cause.status || 500));
  }
}
