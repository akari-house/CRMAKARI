// Sanitized local-development data only.
// Never place real AKARI contacts, customer records or financial data here.
export const DEMO_AUTH = {
  userId: 'usr_demo_owner',
  tenantId: 'tenant_demo_workspace',
  tenantSlug: 'demo-workspace',
  email: 'demo.user@example.com',
  fullName: 'Demo User',
  role: 'OWNER',
  financeAccess: true,
};

export const DEMO_DASHBOARD = {
  month: '2026-07',
  currency: 'USD',
  metrics: {
    monthlyTarget: 25000,
    revenueBooked: 18500,
    revenueCollected: 13000,
    netRevenue: 9240,
    weightedPipeline: 56800,
    activeOpportunities: 4,
    yearToDateRevenue: 142900,
    activeCustomers: 18,
    activeCampaigns: 5,
    activePartners: 31,
    outstandingPayments: 11500,
    referralRewardsDue: 1260,
  },
};

export const DEMO_PROJECTS = [
  {
    id: 'prj_demo_northstar',
    name: 'Northstar Labs',
    category: 'Infrastructure',
    lifecycle_status: 'ACTIVE_OPPORTUNITY',
    priority: 'HIGH',
    owner: 'Demo User',
    primary_contact: 'Sample Contact',
    open_opportunities: 2,
    pipeline_value: 25000,
    last_activity_at: '2026-07-29',
    next_follow_up_at: '2026-08-02',
    source_name: 'Sample Referral',
  },
  {
    id: 'prj_demo_stream',
    name: 'Streamworks',
    category: 'Payments',
    lifecycle_status: 'CLIENT',
    priority: 'MEDIUM',
    owner: 'Demo Manager',
    primary_contact: 'Example Lead',
    open_opportunities: 1,
    pipeline_value: 20000,
    last_activity_at: '2026-07-31',
    next_follow_up_at: '2026-08-04',
    source_name: 'Sample Inbound',
  },
];

export const DEMO_OPPORTUNITIES = [
  {
    id: 'opp_demo_creator',
    project_id: 'prj_demo_northstar',
    project_name: 'Northstar Labs',
    name: 'Regional creator activation',
    stage: 'CONTACTED',
    estimated_value: 18000,
    currency: 'USD',
    probability_percentage: 30,
    owner_name: 'Demo User',
    next_action: 'Schedule discovery call',
  },
  {
    id: 'opp_demo_growth',
    project_id: 'prj_demo_stream',
    project_name: 'Streamworks',
    name: 'Growth advisory engagement',
    stage: 'QUALIFIED',
    estimated_value: 15000,
    currency: 'USD',
    probability_percentage: 60,
    owner_name: 'Demo Manager',
    next_action: 'Review proposal',
  },
];

export const DEMO_TASKS = [
  {
    id: 'tsk_demo_1',
    title: 'Review sample opportunity',
    description: 'Sanitized development task',
    status: 'TODO',
    priority: 'HIGH',
    due_at: '2026-08-02T14:00:00+02:00',
    owner_name: 'Demo User',
    project_name: 'Northstar Labs',
  },
  {
    id: 'tsk_demo_2',
    title: 'Prepare sample campaign brief',
    description: 'Sanitized development task',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    due_at: '2026-08-04T16:00:00+02:00',
    owner_name: 'Demo Manager',
    project_name: 'Streamworks',
  },
];
