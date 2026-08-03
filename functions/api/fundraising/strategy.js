import { json, error, readJson } from '../../lib/response.js';
import { requireTenant, requireRole, canViewFinance } from '../../lib/permissions.js';
import {
  strategySnapshot,
  saveTermSheet,
  decideTermSheet,
  saveCapTableScenario,
  approveCapTableScenario,
  saveStrategicFunding,
  recognizeFundingAward,
  createFundingTask,
  STRATEGY_WRITE_ROLES,
  STRATEGY_APPROVAL_ROLES,
  TERM_STATUSES,
  CAP_TABLE_STATUSES,
  FUNDING_TYPES,
  FUNDING_STAGES,
  ANTI_DILUTION_TYPES,
  STAKEHOLDER_TYPES,
} from '../../lib/fundraising-strategy.js';

const TECHNICAL_DB_ERROR = /(no such table|no such column|D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY)/i;
const APPROVAL_ACTIONS = new Set(['decide-term-sheet','approve-cap-table','recognize-funding-award']);

function permissions(auth) {
  return {
    canWrite:STRATEGY_WRITE_ROLES.includes(auth?.role),
    canApprove:STRATEGY_APPROVAL_ROLES.includes(auth?.role),
    canFinance:canViewFinance(auth),
  };
}

export async function onRequestGet(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const snapshot = await strategySnapshot(context.env.DB,tenantId);
    return json({
      ...snapshot,
      permissions:permissions(auth),
      controls:{
        termStatuses:TERM_STATUSES,
        capTableStatuses:CAP_TABLE_STATUSES,
        fundingTypes:FUNDING_TYPES,
        fundingStages:FUNDING_STAGES,
        antiDilutionTypes:ANTI_DILUTION_TYPES,
        stakeholderTypes:STAKEHOLDER_TYPES,
      },
      ai:{ required:false,enabled:false,message:'AI is optional. Terms, ownership scenarios and strategic funding work fully in manual mode.' },
      disclaimers:{
        legal:'AKARI records and compares terms but does not provide legal advice.',
        capTable:'Ownership scenarios are planning models and not the legal cap table of record.',
      },
    });
  } catch (cause) {
    console.error('Fundraising strategy read failed',cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising strategy could not be loaded' : (message || 'Fundraising strategy could not be loaded'),Number(cause?.status || 500));
  }
}

export async function onRequestPost(context) {
  try {
    const auth = context.data.auth;
    const tenantId = requireTenant(auth);
    requireRole(auth,STRATEGY_WRITE_ROLES);
    if (!context.env.DB) return error('D1 binding DB is not configured',500);
    const body = await readJson(context.request);
    const action = String(body.action || '').trim().toLowerCase();
    if (APPROVAL_ACTIONS.has(action) && (!STRATEGY_APPROVAL_ROLES.includes(auth?.role) || !canViewFinance(auth))) {
      return error('Owner or Admin finance permission is required for this final fundraising decision',403);
    }
    if (action === 'save-term-sheet') return json(await saveTermSheet(context.env.DB,auth,tenantId,body));
    if (action === 'decide-term-sheet') return json(await decideTermSheet(context.env.DB,auth,tenantId,body));
    if (action === 'save-cap-table') return json(await saveCapTableScenario(context.env.DB,auth,tenantId,body));
    if (action === 'approve-cap-table') return json(await approveCapTableScenario(context.env.DB,auth,tenantId,body));
    if (action === 'save-strategic-funding') return json(await saveStrategicFunding(context.env.DB,auth,tenantId,body));
    if (action === 'recognize-funding-award') return json(await recognizeFundingAward(context.env.DB,auth,tenantId,body));
    if (action === 'create-funding-task') return json(await createFundingTask(context.env.DB,auth,tenantId,body));
    return error('Fundraising strategy action is not supported',404);
  } catch (cause) {
    console.error('Fundraising strategy write failed',cause);
    const message = String(cause?.message || '');
    return error(TECHNICAL_DB_ERROR.test(message) ? 'Fundraising strategy action failed' : (message || 'Fundraising strategy action failed'),Number(cause?.status || 500));
  }
}
