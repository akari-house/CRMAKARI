import { all, first, run, makeId, nowIso } from './db.js';
import { canViewFinance } from './permissions.js';
import { closingSnapshot } from './fundraising-closing.js';

export const STRATEGY_WRITE_ROLES = ['OWNER','ADMIN','BD_MANAGER'];
export const STRATEGY_APPROVAL_ROLES = ['OWNER','ADMIN'];
export const TERM_STATUSES = ['DRAFT','RECEIVED','REVIEWING','APPROVED','REJECTED','SIGNED','ARCHIVED'];
export const CAP_TABLE_STATUSES = ['DRAFT','REVIEWING','APPROVED','ARCHIVED'];
export const FUNDING_TYPES = ['GRANT','PUBLIC_FUNDING','ACCELERATOR','ECOSYSTEM','STRATEGIC_CAPITAL','NON_DILUTIVE','OTHER'];
export const FUNDING_STAGES = ['RESEARCHING','ELIGIBLE','APPLYING','SUBMITTED','DILIGENCE','AWARDED','REJECTED','DECLINED','CLOSED'];
export const ANTI_DILUTION_TYPES = ['NONE','WEIGHTED_AVERAGE','BROAD_BASED_WEIGHTED_AVERAGE','NARROW_BASED_WEIGHTED_AVERAGE','FULL_RATCHET','OTHER'];
export const STAKEHOLDER_TYPES = ['FOUNDER','EMPLOYEE','ADVISOR','INVESTOR','OPTION_POOL','TREASURY','OTHER'];

const TERM_TYPE = 'FUNDRAISING_TERM_SHEET';
const CAP_TYPE = 'FUNDRAISING_CAP_TABLE_SCENARIO';
const FUNDING_TYPE = 'FUNDRAISING_STRATEGIC_FUNDING';
const TECHNICAL_DB_ERROR = /(no such table|no such column|D1_ERROR|SQLITE_ERROR|database is locked|SQLITE_BUSY)/i;

const text = (value,max=6000) => String(value ?? '').trim().slice(0,max);
const issue = (message,status=422) => Object.assign(new Error(message),{status});
const parse = value => { try { return typeof value === 'object' && value ? value : JSON.parse(value || '{}'); } catch { return {}; } };
const bool = value => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
const number = (value,label='Number',min=0,max=Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw issue(`${label} is invalid`);
  return Math.round(parsed * 10000) / 10000;
};
const money = (value,label='Amount') => Math.round(number(value,label,0) * 100) / 100;
const enumValue = (value,allowed,fallback,label) => {
  const normalized = text(value || fallback,100).toUpperCase();
  if (!allowed.includes(normalized)) throw issue(`${label} is invalid`);
  return normalized;
};
const dateValue = (value,label,required=false) => {
  const cleaned = text(value,100);
  if (!cleaned && !required) return '';
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) throw issue(`${label} must be a valid date`);
  return new Date(cleaned).toISOString();
};
const httpsValue = (value,label) => {
  const cleaned = text(value,2000);
  if (cleaned && !/^https:\/\//i.test(cleaned)) throw issue(`${label} must use HTTPS`);
  return cleaned;
};
const round4 = value => Math.round(Number(value || 0) * 10000) / 10000;

async function audit(db,auth,action,entityType,entityId,before,after) {
  await run(db,`INSERT INTO audit_logs (id,tenant_id,user_id,action,entity_type,entity_id,before_data,after_data,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[
    makeId('aud'),auth.tenantId,auth.userId,action,entityType,entityId,JSON.stringify(before || {}),JSON.stringify(after || {}),nowIso(),
  ]);
}

function decodeActivity(row) {
  const data = parse(row?.description);
  return {
    ...data,
    id:row.id,
    projectId:row.project_id || data.projectId || '',
    status:row.outcome || data.status || '',
    occurredAt:row.occurred_at,
    createdAt:data.createdAt || row.created_at,
  };
}

async function strategyRows(db,tenantId) {
  return all(db,`SELECT a.*,p.name project_name,u.full_name actor_name FROM activities a LEFT JOIN projects p ON p.id=a.project_id AND p.tenant_id=a.tenant_id LEFT JOIN users u ON u.id=a.user_id WHERE a.tenant_id=? AND a.activity_type IN (?,?,?) ORDER BY a.occurred_at DESC,a.created_at DESC LIMIT 3000`,[
    tenantId,TERM_TYPE,CAP_TYPE,FUNDING_TYPE,
  ]);
}

async function members(db,tenantId) {
  return all(db,`SELECT u.id,u.full_name,tm.role FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' ORDER BY u.full_name`,[tenantId]);
}

async function activeMember(db,tenantId,userId) {
  return first(db,`SELECT u.id,u.full_name,tm.role FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id WHERE tm.tenant_id=? AND tm.user_id=? AND tm.status='ACTIVE' AND u.status='ACTIVE' LIMIT 1`,[tenantId,userId]);
}

async function roundContext(db,tenantId,roundId) {
  const snapshot = await closingSnapshot(db,tenantId);
  const round = (snapshot.items || []).find(item => item.id === roundId);
  if (!round) throw issue('Fundraising round was not found in this workspace',404);
  return { snapshot,round };
}

async function targetContext(db,tenantId,round,targetId,investorName='') {
  const id = text(targetId,120);
  if (!id) {
    const name = text(investorName,500);
    if (!name) throw issue('Investor name or investor target is required');
    return { id:'',investorName:name,personName:'' };
  }
  if (round.sourceModel === 'LEGACY_COMPATIBILITY') {
    const target = (round.investorPipeline || []).find(item => item.id === id);
    if (!target) throw issue('Investor target was not found in this Capital Room',404);
    return { id,targetId:id,investorName:target.investorName || 'Investor',personName:target.decisionMaker || '' };
  }
  try {
    const target = await first(db,`SELECT t.id,o.name investor_name,ip.full_name person_name FROM fundraising_targets t JOIN investor_organisations o ON o.id=t.organisation_id AND o.tenant_id=t.tenant_id LEFT JOIN investor_people ip ON ip.id=t.primary_person_id AND ip.tenant_id=t.tenant_id WHERE t.tenant_id=? AND t.round_id=? AND t.id=? LIMIT 1`,[tenantId,round.id,id]);
    if (!target) throw issue('Investor target was not found in this fundraising round',404);
    return { id:target.id,targetId:target.id,investorName:target.investor_name || 'Investor',personName:target.person_name || '' };
  } catch (cause) {
    if (TECHNICAL_DB_ERROR.test(String(cause?.message || '')) && round.sourceModel === 'LEGACY_COMPATIBILITY') return targetContext(db,tenantId,round,id,investorName);
    throw cause;
  }
}

async function existingActivity(db,tenantId,id,type) {
  const row = await first(db,'SELECT * FROM activities WHERE tenant_id=? AND id=? AND activity_type=? LIMIT 1',[tenantId,id,type]);
  return row ? { row,item:decodeActivity(row) } : { row:null,item:null };
}

async function persistActivity(db,auth,{ id,type,projectId,subject,status,occurredAt,createdAt,data,existing }) {
  const now = nowIso();
  const encoded = JSON.stringify({ ...data,id,projectId,status,updatedAt:now,createdAt:createdAt || data.createdAt || now });
  if (existing) {
    await run(db,'UPDATE activities SET project_id=?,user_id=?,subject=?,description=?,outcome=?,occurred_at=? WHERE tenant_id=? AND id=? AND activity_type=?',[
      projectId,auth.userId,subject,encoded,status,occurredAt || now,auth.tenantId,id,type,
    ]);
  } else {
    await run(db,'INSERT INTO activities (id,tenant_id,project_id,user_id,activity_type,subject,description,outcome,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[
      id,auth.tenantId,projectId,auth.userId,type,subject,encoded,status,occurredAt || now,createdAt || now,
    ]);
  }
  return { ...data,id,projectId,status,updatedAt:now,createdAt:createdAt || data.createdAt || now };
}

function termRiskFlags(item) {
  const flags = [];
  if (Number(item.liquidationPreference || 0) > 1) flags.push('Liquidation preference exceeds 1x');
  if (item.participatingPreference) flags.push('Participating liquidation preference');
  if (item.antiDilution === 'FULL_RATCHET') flags.push('Full-ratchet anti-dilution');
  if (item.boardSeat) flags.push('Investor board seat requested');
  if (item.exclusivityDays > 30) flags.push('Exclusivity exceeds 30 days');
  if (item.discountPercentage > 25) flags.push('Discount exceeds 25%');
  if (item.interestRate > 10) flags.push('Interest rate exceeds 10%');
  if (item.maturityMonths > 0 && item.maturityMonths < 12) flags.push('Maturity is under 12 months');
  if (!item.informationRights) flags.push('Information rights are not defined');
  return flags;
}

function sanitizeTerm(body,existing,round,target) {
  const status = enumValue(body.status ?? existing?.status,TERM_STATUSES,'DRAFT','Term-sheet status');
  if (['APPROVED','REJECTED','SIGNED'].includes(status)) throw issue('Use the controlled term-sheet decision action for a final status',409);
  const next = {
    roundId:round.id,
    projectId:round.projectId,
    projectName:round.projectName,
    roundName:round.roundName,
    targetId:target.id || '',
    investorName:target.investorName,
    personName:target.personName || '',
    status,
    instrument:text(body.instrument ?? existing?.instrument ?? round.instrument,200),
    proposedInvestment:money(body.proposedInvestment ?? existing?.proposedInvestment,'Proposed investment'),
    valuation:money(body.valuation ?? existing?.valuation,'Valuation'),
    valuationCap:money(body.valuationCap ?? existing?.valuationCap,'Valuation cap'),
    discountPercentage:number(body.discountPercentage ?? existing?.discountPercentage,'Discount percentage',0,100),
    interestRate:number(body.interestRate ?? existing?.interestRate,'Interest rate',0,100),
    maturityMonths:number(body.maturityMonths ?? existing?.maturityMonths,'Maturity months',0,240),
    proRataRights:bool(body.proRataRights ?? existing?.proRataRights),
    informationRights:bool(body.informationRights ?? existing?.informationRights),
    boardSeat:bool(body.boardSeat ?? existing?.boardSeat),
    observerRights:bool(body.observerRights ?? existing?.observerRights),
    liquidationPreference:number(body.liquidationPreference ?? existing?.liquidationPreference ?? 1,'Liquidation preference',0,20),
    participatingPreference:bool(body.participatingPreference ?? existing?.participatingPreference),
    antiDilution:enumValue(body.antiDilution ?? existing?.antiDilution,ANTI_DILUTION_TYPES,'NONE','Anti-dilution provision'),
    exclusivityDays:number(body.exclusivityDays ?? existing?.exclusivityDays,'Exclusivity days',0,365),
    documentUrl:httpsValue(body.documentUrl ?? existing?.documentUrl,'Term-sheet document URL'),
    receivedAt:dateValue(body.receivedAt ?? existing?.receivedAt,'Received date'),
    notes:text(body.notes ?? existing?.notes,12000),
    decisionReason:existing?.decisionReason || '',
    decidedAt:existing?.decidedAt || '',
    decidedBy:existing?.decidedBy || '',
  };
  if (!next.instrument) throw issue('Term-sheet instrument is required');
  if (next.proposedInvestment <= 0) throw issue('Proposed investment must be greater than zero');
  next.riskFlags = termRiskFlags(next);
  next.riskCount = next.riskFlags.length;
  return next;
}

function sanitizeStakeholders(value) {
  if (!Array.isArray(value) || !value.length) throw issue('At least one stakeholder is required');
  const names = new Set();
  const items = value.slice(0,100).map((row,index) => {
    const name = text(row?.name,300);
    if (!name) throw issue(`Stakeholder ${index + 1} requires a name`);
    const key = name.toLowerCase();
    if (names.has(key)) throw issue(`Stakeholder names must be unique: ${name}`);
    names.add(key);
    return {
      id:text(row?.id,120) || `stakeholder_${index + 1}`,
      name,
      type:enumValue(row?.type,STAKEHOLDER_TYPES,'OTHER','Stakeholder type'),
      beforePercentage:number(row?.beforePercentage,'Ownership percentage',0,100),
      notes:text(row?.notes,2000),
    };
  });
  const total = round4(items.reduce((sum,item) => sum + item.beforePercentage,0));
  if (total > 100.0001) throw issue('Stakeholder ownership before financing cannot exceed 100%');
  return { items,total };
}

function calculateCapScenario(input) {
  const preMoney = money(input.preMoneyValuation,'Pre-money valuation');
  const investment = money(input.newInvestment,'New investment');
  if (preMoney <= 0) throw issue('Pre-money valuation must be greater than zero');
  const existingPool = number(input.existingOptionPoolPercentage,'Existing option pool',0,100);
  const proposedPool = number(input.proposedOptionPoolPercentage,'Proposed option pool',0,100);
  if (proposedPool < existingPool) throw issue('Proposed option pool cannot be lower than the existing option pool');
  const postMoney = preMoney + investment;
  const investorPercentage = postMoney > 0 ? round4(investment / postMoney * 100) : 0;
  const poolIncrease = round4(proposedPool - existingPool);
  if (investorPercentage + poolIncrease > 100.0001) throw issue('New investor ownership and option-pool increase exceed available ownership');
  const existingFactor = round4((100 - investorPercentage - poolIncrease) / 100);
  const { items:stakeholders,total:beforeTotal } = sanitizeStakeholders(input.stakeholders);
  const calculatedStakeholders = stakeholders.map(item => ({
    ...item,
    afterPercentage:round4(item.beforePercentage * existingFactor),
    dilutionPercentage:round4(item.beforePercentage - item.beforePercentage * existingFactor),
  }));
  const afterStakeholderTotal = round4(calculatedStakeholders.reduce((sum,item) => sum + item.afterPercentage,0));
  const unallocatedBefore = round4(100 - beforeTotal);
  const unallocatedAfter = round4(Math.max(0,100 - afterStakeholderTotal - investorPercentage - poolIncrease));
  return {
    preMoneyValuation:preMoney,
    newInvestment:investment,
    postMoneyValuation:postMoney,
    existingOptionPoolPercentage:existingPool,
    proposedOptionPoolPercentage:proposedPool,
    optionPoolIncreasePercentage:poolIncrease,
    newInvestorPercentage:investorPercentage,
    existingHolderFactor:existingFactor,
    stakeholders:calculatedStakeholders,
    ownershipBeforeTotal:beforeTotal,
    ownershipAfterStakeholders:afterStakeholderTotal,
    unallocatedBeforePercentage:unallocatedBefore,
    unallocatedAfterPercentage:unallocatedAfter,
  };
}

function sanitizeFunding(body,existing,round,owner) {
  const stage = enumValue(body.stage ?? existing?.stage,FUNDING_STAGES,'RESEARCHING','Strategic-funding stage');
  if (stage === 'AWARDED') throw issue('Use the controlled award-recognition action',409);
  const deadline = dateValue(body.deadline ?? existing?.deadline,'Application deadline');
  return {
    roundId:round.id,
    projectId:round.projectId,
    projectName:round.projectName,
    roundName:round.roundName,
    programmeName:text(body.programmeName ?? existing?.programmeName,500),
    providerName:text(body.providerName ?? existing?.providerName,500),
    fundingType:enumValue(body.fundingType ?? existing?.fundingType,FUNDING_TYPES,'GRANT','Funding type'),
    stage,
    amount:money(body.amount ?? existing?.amount,'Funding amount'),
    currency:text(body.currency ?? existing?.currency ?? round.currency ?? 'USD',20).toUpperCase(),
    deadline,
    ownerUserId:owner.id,
    ownerName:owner.full_name,
    requirements:text(body.requirements ?? existing?.requirements,12000),
    nextAction:text(body.nextAction ?? existing?.nextAction,3000),
    applicationUrl:httpsValue(body.applicationUrl ?? existing?.applicationUrl,'Application URL'),
    documentUrl:httpsValue(body.documentUrl ?? existing?.documentUrl,'Funding document URL'),
    notes:text(body.notes ?? existing?.notes,12000),
    awardedAt:existing?.awardedAt || '',
    awardReason:existing?.awardReason || '',
  };
}

export async function strategySnapshot(db,tenantId) {
  const [closing,rows,workspaceMembers] = await Promise.all([
    closingSnapshot(db,tenantId),
    strategyRows(db,tenantId),
    members(db,tenantId),
  ]);
  const decoded = rows.map(row => ({ ...decodeActivity(row),projectName:row.project_name || '',actorName:row.actor_name || '' }));
  const termSheets = decoded.filter(item => item.activityType === TERM_TYPE || rows.find(row => row.id === item.id)?.activity_type === TERM_TYPE);
  const capScenarios = decoded.filter(item => item.activityType === CAP_TYPE || rows.find(row => row.id === item.id)?.activity_type === CAP_TYPE);
  const strategicFunding = decoded.filter(item => item.activityType === FUNDING_TYPE || rows.find(row => row.id === item.id)?.activity_type === FUNDING_TYPE);
  const typeById = new Map(rows.map(row => [row.id,row.activity_type]));
  const withType = decoded.map(item => ({ ...item,activityType:typeById.get(item.id) || item.activityType }));
  const terms = withType.filter(item => item.activityType === TERM_TYPE);
  const caps = withType.filter(item => item.activityType === CAP_TYPE);
  const funding = withType.filter(item => item.activityType === FUNDING_TYPE);
  const rounds = (closing.items || []).map(round => ({
    id:round.id,
    projectId:round.projectId,
    projectName:round.projectName,
    roundName:round.roundName,
    stage:round.stage,
    instrument:round.instrument,
    currency:round.currency,
    targetAmount:round.targetAmount,
    valuation:round.valuation,
    sourceModel:round.sourceModel,
    investorPipeline:round.investorPipeline || [],
    termSheets:terms.filter(item => item.roundId === round.id),
    capTableScenarios:caps.filter(item => item.roundId === round.id),
    strategicFunding:funding.filter(item => item.roundId === round.id),
  }));
  return {
    storageMode:closing.storageMode,
    migrationRequired:closing.migrationRequired,
    rounds,
    members:workspaceMembers,
    summary:{
      termSheets:terms.length,
      termSheetsInReview:terms.filter(item => ['RECEIVED','REVIEWING'].includes(item.status)).length,
      approvedTermSheets:terms.filter(item => ['APPROVED','SIGNED'].includes(item.status)).length,
      capTableScenarios:caps.length,
      approvedScenarios:caps.filter(item => item.status === 'APPROVED').length,
      strategicFunding:funding.length,
      fundingSubmitted:funding.filter(item => ['SUBMITTED','DILIGENCE'].includes(item.stage || item.status)).length,
      fundingAwarded:funding.filter(item => (item.stage || item.status) === 'AWARDED').reduce((sum,item) => sum + Number(item.amount || 0),0),
    },
  };
}

export async function saveTermSheet(db,auth,tenantId,body) {
  const { round } = await roundContext(db,tenantId,text(body.roundId,120));
  const target = await targetContext(db,tenantId,round,body.targetId,body.investorName);
  const id = text(body.id,120) || makeId('fra_term');
  const { row,item:existing } = await existingActivity(db,tenantId,id,TERM_TYPE);
  if (existing && existing.roundId !== round.id) throw issue('Term sheet does not belong to this fundraising round',409);
  const next = sanitizeTerm(body,existing,round,target);
  const saved = await persistActivity(db,auth,{ id,type:TERM_TYPE,projectId:round.projectId,subject:`Term sheet · ${next.investorName}`,status:next.status,occurredAt:next.receivedAt || nowIso(),createdAt:existing?.createdAt,data:next,existing:row });
  await audit(db,auth,row ? 'FUNDRAISING_TERM_SHEET_UPDATED' : 'FUNDRAISING_TERM_SHEET_CREATED','FUNDRAISING_TERM_SHEET',id,existing,saved);
  return { item:saved,created:!row };
}

export async function decideTermSheet(db,auth,tenantId,body) {
  if (!STRATEGY_APPROVAL_ROLES.includes(auth.role) || !canViewFinance(auth)) throw issue('Owner or Admin finance permission is required for a final term-sheet decision',403);
  const decision = enumValue(body.decision,['APPROVED','REJECTED','SIGNED'],'APPROVED','Term-sheet decision');
  const reason = text(body.reason,6000);
  if (!reason) throw issue('A term-sheet decision reason is required');
  const id = text(body.id,120);
  const { row,item:existing } = await existingActivity(db,tenantId,id,TERM_TYPE);
  if (!existing) throw issue('Term sheet was not found in this workspace',404);
  if (decision === 'SIGNED' && !existing.documentUrl) throw issue('A signed term sheet requires an HTTPS document URL');
  const now = nowIso();
  const next = { ...existing,status:decision,decisionReason:reason,decidedAt:now,decidedBy:auth.userId };
  const saved = await persistActivity(db,auth,{ id,type:TERM_TYPE,projectId:existing.projectId,subject:`Term sheet · ${existing.investorName}`,status:decision,occurredAt:existing.receivedAt || now,createdAt:existing.createdAt,data:next,existing:row });
  await audit(db,auth,'FUNDRAISING_TERM_SHEET_DECIDED','FUNDRAISING_TERM_SHEET',id,{status:existing.status},{status:decision,reason,decidedAt:now});
  return { item:saved };
}

export async function saveCapTableScenario(db,auth,tenantId,body) {
  const { round } = await roundContext(db,tenantId,text(body.roundId,120));
  const id = text(body.id,120) || makeId('fra_cap');
  const { row,item:existing } = await existingActivity(db,tenantId,id,CAP_TYPE);
  if (existing && existing.roundId !== round.id) throw issue('Ownership scenario does not belong to this fundraising round',409);
  const status = enumValue(body.status ?? existing?.status,CAP_TABLE_STATUSES,'DRAFT','Ownership-scenario status');
  if (status === 'APPROVED') throw issue('Use the controlled approval action for an ownership scenario',409);
  const calculated = calculateCapScenario({
    preMoneyValuation:body.preMoneyValuation ?? existing?.preMoneyValuation ?? round.valuation,
    newInvestment:body.newInvestment ?? existing?.newInvestment,
    existingOptionPoolPercentage:body.existingOptionPoolPercentage ?? existing?.existingOptionPoolPercentage,
    proposedOptionPoolPercentage:body.proposedOptionPoolPercentage ?? existing?.proposedOptionPoolPercentage,
    stakeholders:Array.isArray(body.stakeholders) ? body.stakeholders : existing?.stakeholders,
  });
  const next = {
    roundId:round.id,
    projectId:round.projectId,
    projectName:round.projectName,
    roundName:round.roundName,
    scenarioName:text(body.scenarioName ?? existing?.scenarioName,500),
    status,
    notes:text(body.notes ?? existing?.notes,12000),
    disclaimer:'Planning scenario only — not the legal cap table of record.',
    approvedAt:existing?.approvedAt || '',
    approvedBy:existing?.approvedBy || '',
    approvalNote:existing?.approvalNote || '',
    ...calculated,
  };
  if (!next.scenarioName) throw issue('Ownership scenario name is required');
  const saved = await persistActivity(db,auth,{ id,type:CAP_TYPE,projectId:round.projectId,subject:`Ownership scenario · ${next.scenarioName}`,status:next.status,occurredAt:nowIso(),createdAt:existing?.createdAt,data:next,existing:row });
  await audit(db,auth,row ? 'FUNDRAISING_CAP_TABLE_SCENARIO_UPDATED' : 'FUNDRAISING_CAP_TABLE_SCENARIO_CREATED','FUNDRAISING_CAP_TABLE_SCENARIO',id,existing,saved);
  return { item:saved,created:!row };
}

export async function approveCapTableScenario(db,auth,tenantId,body) {
  if (!STRATEGY_APPROVAL_ROLES.includes(auth.role) || !canViewFinance(auth)) throw issue('Owner or Admin finance permission is required to approve an ownership scenario',403);
  const note = text(body.note,6000);
  if (!note) throw issue('An ownership-scenario approval note is required');
  const id = text(body.id,120);
  const { row,item:existing } = await existingActivity(db,tenantId,id,CAP_TYPE);
  if (!existing) throw issue('Ownership scenario was not found in this workspace',404);
  const now = nowIso();
  const next = { ...existing,status:'APPROVED',approvedAt:now,approvedBy:auth.userId,approvalNote:note };
  const saved = await persistActivity(db,auth,{ id,type:CAP_TYPE,projectId:existing.projectId,subject:`Ownership scenario · ${existing.scenarioName}`,status:'APPROVED',occurredAt:now,createdAt:existing.createdAt,data:next,existing:row });
  await audit(db,auth,'FUNDRAISING_CAP_TABLE_SCENARIO_APPROVED','FUNDRAISING_CAP_TABLE_SCENARIO',id,{status:existing.status},{status:'APPROVED',note,approvedAt:now});
  return { item:saved };
}

export async function saveStrategicFunding(db,auth,tenantId,body) {
  const { round } = await roundContext(db,tenantId,text(body.roundId,120));
  const ownerUserId = text(body.ownerUserId,120) || auth.userId;
  const owner = await activeMember(db,tenantId,ownerUserId);
  if (!owner) throw issue('Strategic-funding owner must be an active workspace member');
  const id = text(body.id,120) || makeId('fra_funding');
  const { row,item:existing } = await existingActivity(db,tenantId,id,FUNDING_TYPE);
  if (existing && existing.roundId !== round.id) throw issue('Strategic-funding opportunity does not belong to this fundraising round',409);
  const next = sanitizeFunding(body,existing,round,owner);
  if (!next.programmeName || !next.providerName) throw issue('Funding programme and provider are required');
  const saved = await persistActivity(db,auth,{ id,type:FUNDING_TYPE,projectId:round.projectId,subject:`Strategic funding · ${next.programmeName}`,status:next.stage,occurredAt:next.deadline || nowIso(),createdAt:existing?.createdAt,data:next,existing:row });
  await audit(db,auth,row ? 'FUNDRAISING_STRATEGIC_FUNDING_UPDATED' : 'FUNDRAISING_STRATEGIC_FUNDING_CREATED','FUNDRAISING_STRATEGIC_FUNDING',id,existing,saved);
  return { item:saved,created:!row };
}

export async function recognizeFundingAward(db,auth,tenantId,body) {
  if (!STRATEGY_APPROVAL_ROLES.includes(auth.role) || !canViewFinance(auth)) throw issue('Owner or Admin finance permission is required to recognise a funding award',403);
  const reason = text(body.reason,6000);
  if (!reason) throw issue('A funding-award recognition note is required');
  const id = text(body.id,120);
  const { row,item:existing } = await existingActivity(db,tenantId,id,FUNDING_TYPE);
  if (!existing) throw issue('Strategic-funding opportunity was not found in this workspace',404);
  if (Number(existing.amount || 0) <= 0) throw issue('Funding amount must be recorded before recognising an award');
  const now = nowIso();
  const next = { ...existing,stage:'AWARDED',status:'AWARDED',awardedAt:dateValue(body.awardedAt || now,'Award date',true),awardReason:reason,awardedBy:auth.userId };
  const saved = await persistActivity(db,auth,{ id,type:FUNDING_TYPE,projectId:existing.projectId,subject:`Strategic funding · ${existing.programmeName}`,status:'AWARDED',occurredAt:next.awardedAt,createdAt:existing.createdAt,data:next,existing:row });
  await audit(db,auth,'FUNDRAISING_STRATEGIC_FUNDING_AWARDED','FUNDRAISING_STRATEGIC_FUNDING',id,{stage:existing.stage},{stage:'AWARDED',amount:existing.amount,reason,awardedAt:next.awardedAt});
  return { item:saved };
}

export async function createFundingTask(db,auth,tenantId,body) {
  const id = text(body.id,120);
  const { item:funding } = await existingActivity(db,tenantId,id,FUNDING_TYPE);
  if (!funding) throw issue('Strategic-funding opportunity was not found in this workspace',404);
  const ownerUserId = text(body.ownerUserId,120) || funding.ownerUserId || auth.userId;
  const owner = await activeMember(db,tenantId,ownerUserId);
  if (!owner) throw issue('Task owner must be an active workspace member');
  const dueAt = dateValue(body.dueAt || funding.deadline,'Task due date',true);
  const marker = `[Strategic Funding:${id}]`;
  const duplicate = await first(db,`SELECT id FROM tasks WHERE tenant_id=? AND status NOT IN ('DONE','CANCELLED','ARCHIVED') AND description LIKE ? LIMIT 1`,[tenantId,`%${marker}%`]);
  if (duplicate && !bool(body.allowDuplicate)) throw issue('An open follow-up task already exists for this funding opportunity',409);
  const taskId = makeId('tsk');
  const now = nowIso();
  const title = text(body.title || `Strategic funding follow-up · ${funding.programmeName}`,500);
  const description = `${text(body.description || funding.nextAction || 'Complete the next strategic-funding action.',5000)}\n\n${marker}`;
  await run(db,`INSERT INTO tasks (id,tenant_id,title,description,owner_user_id,created_by,status,priority,due_at,project_id,activity_type,show_on_home,created_at,updated_at) VALUES (?,?,?,?,?,?,'TODO','HIGH',?,?,'FUNDRAISING_STRATEGIC_FUNDING',1,?,?)`,[
    taskId,tenantId,title,description,ownerUserId,auth.userId,dueAt,funding.projectId,now,now,
  ]);
  await audit(db,auth,'FUNDRAISING_STRATEGIC_FUNDING_TASK_CREATED','TASK',taskId,null,{ fundingId:id,ownerUserId,dueAt,projectId:funding.projectId });
  return { item:{ id:taskId,title,due_at:dueAt,owner_user_id:ownerUserId,project_id:funding.projectId } };
}
