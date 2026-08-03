import { json, error, readJson } from '../../lib/response.js';
import { requireTenant, requireRole, canViewFinance } from '../../lib/permissions.js';
import {
  closingSnapshot,
  executeClosingAction,
  CLOSING_WRITE_ROLES,
  CLOSING_APPROVAL_ROLES,
  COMMITMENT_STATUSES,
  UPDATE_STATUSES,
  PAYMENT_RAILS,
} from '../../lib/fundraising-closing.js';

const TECHNICAL_DB_ERROR = /(no such table|no such column|D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY)/i;

function permissions(auth) {
  return {
    canWrite: CLOSING_WRITE_ROLES.includes(auth?.role),
    canApprove: CLOSING_APPROVAL_ROLES.includes(auth?.role),
    canFinance: canViewFinance(auth),
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const snapshot = await closingSnapshot(context.env.DB, tenantId);
    return json({
      ...snapshot,
      permissions: permissions(auth),
      controls: {
        commitmentStatuses: COMMITMENT_STATUSES,
        updateStatuses: UPDATE_STATUSES,
        paymentRails: PAYMENT_RAILS,
      },
      ai: {
        required: false,
        enabled: false,
        message: 'AI is optional. Commitments, closing and investor updates work fully in manual mode.',
      },
    });
  } catch (cause) {
    console.error('Fundraising closing read failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising closing could not be loaded' : (message || 'Fundraising closing could not be loaded'), Number(cause?.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    requireRole(auth, CLOSING_WRITE_ROLES);
    if (!context.env.DB) return error('D1 binding DB is not configured', 500);
    const body = await readJson(context.request);
    return json(await executeClosingAction(context.env.DB, auth, tenantId, body));
  } catch (cause) {
    console.error('Fundraising closing write failed', cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising closing action failed' : (message || 'Fundraising closing action failed'), Number(cause?.status || 500));
  }
}
