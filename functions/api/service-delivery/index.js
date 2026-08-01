import { json, error } from '../../lib/response.js';
import { all } from '../../lib/db.js';
import { requireTenant, canViewFinance } from '../../lib/permissions.js';
import { parseDeliveryRoot, deliverySummary } from '../../lib/service-delivery.js';
import { parseEngagement } from '../../lib/revenue-lifecycle.js';

function publicItem(row, financeVisible) {
  const engagement = parseEngagement(row);
  const { delivery } = parseDeliveryRoot(row.notes);
  const summary = deliverySummary(delivery);
  const item = {
    id:row.id,
    projectId:row.project_id,
    projectName:row.project_name,
    opportunityId:row.opportunity_id,
    opportunityName:row.opportunity_name,
    name:row.name,
    status:row.status,
    serviceType:delivery.serviceType || engagement.serviceType,
    ownerId:delivery.deliveryOwnerId || row.campaign_owner_id,
    ownerName:row.delivery_owner_name || row.campaign_owner_name,
    startDate:row.start_date,
    endDate:row.end_date,
    reportingDueDate:row.reporting_due_date,
    nextAction:row.next_action,
    templateId:delivery.templateId,
    templateName:delivery.templateName,
    progress:summary.progress,
    overdue:summary.overdue,
    blocked:summary.blocked,
    milestones:summary.milestoneTotal,
    completedMilestones:summary.milestoneDone,
    deliverables:summary.deliverableTotal,
    completedDeliverables:summary.deliverableDone,
    creators:summary.creators,
    activeCreators:summary.activeCreators,
    reach:summary.reach,
    engagements:summary.engagements,
    updatedAt:row.updated_at,
  };
  if (financeVisible) {
    Object.assign(item, {
      grossRevenue:engagement.grossRevenue,
      directCosts:engagement.directCosts,
      akariNetRevenue:engagement.akariNetRevenue,
      amountInvoiced:engagement.amountInvoiced,
      amountReceived:engagement.amountReceived,
      outstandingAmount:engagement.outstandingAmount,
      referralReward:engagement.referralReward,
      currency:engagement.currency,
    });
  }
  return item;
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return json({ metrics:{}, items:[], total:0, financeVisible:canViewFinance(auth), demo:true });
    const rows = await all(context.env.DB, `
      SELECT c.*, p.name AS project_name, o.name AS opportunity_name,
        cu.full_name AS campaign_owner_name,
        du.full_name AS delivery_owner_name
      FROM campaigns c
      JOIN projects p ON p.id = c.project_id AND p.tenant_id = c.tenant_id
      LEFT JOIN opportunities o ON o.id = c.opportunity_id AND o.tenant_id = c.tenant_id
      LEFT JOIN users cu ON cu.id = c.campaign_owner_id
      LEFT JOIN users du ON du.id = json_extract(c.notes, '$.serviceDelivery.deliveryOwnerId')
      WHERE c.tenant_id = ?
      ORDER BY CASE c.status
        WHEN 'LIVE' THEN 1 WHEN 'ONBOARDING' THEN 2 WHEN 'PLANNING' THEN 3
        WHEN 'CREATOR_SELECTION' THEN 4 WHEN 'REPORTING' THEN 5 ELSE 6 END,
        c.updated_at DESC
      LIMIT 500
    `, [tenantId]);
    const financeVisible = canViewFinance(auth);
    const items = rows.map((row) => publicItem(row, financeVisible));
    const active = items.filter((item) => !['COMPLETED','CANCELLED'].includes(item.status));
    const metrics = {
      active:active.length,
      onboarding:items.filter((item) => item.status === 'ONBOARDING').length,
      live:items.filter((item) => item.status === 'LIVE').length,
      reporting:items.filter((item) => item.status === 'REPORTING').length,
      overdue:active.reduce((sum, item) => sum + Number(item.overdue || 0), 0),
      blocked:active.reduce((sum, item) => sum + Number(item.blocked || 0), 0),
      averageProgress:active.length ? Math.round(active.reduce((sum, item) => sum + Number(item.progress || 0), 0) / active.length) : 0,
      completed:items.filter((item) => item.status === 'COMPLETED').length,
      outstanding:financeVisible ? items.reduce((sum, item) => sum + Number(item.outstandingAmount || 0), 0) : null,
      netRevenue:financeVisible ? items.reduce((sum, item) => sum + Number(item.akariNetRevenue || 0), 0) : null,
    };
    return json({ metrics, items, total:items.length, financeVisible });
  } catch (cause) {
    console.error('Service delivery overview error', cause);
    return error(cause.message || 'Service delivery overview could not be loaded', Number(cause.status || 500));
  }
}
