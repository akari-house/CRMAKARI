import { test, expect } from '@playwright/test';

const me={user:{userId:'user_owner',tenantId:'tenant_akari_house',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true}};
const opportunity={
  id:'opp_creator',project_id:'project_travls',project_name:'TRAVLS.IO',project_lifecycle_status:'CLIENT',name:'Creator Campaign',service_type:'MARKETING_CAMPAIGN',stage:'WON',estimated_value:13000,currency:'USD',probability_percentage:95,expected_close_date:'2026-08-04',owner_name:'Muaz Xinthi',primary_contact_name:null,primary_contact_email:'samarth@travls.io',next_action:'Send invoice',need_confirmed:0,decision_maker_confirmed:0,timeline_confirmed:0,budget_status:'UNKNOWN',qualificationComplete:false,
};
const engagement={id:'campaign_creator',projectId:'project_travls',opportunityId:'opp_creator',name:'Creator Campaign',status:'CONFIRMED',dealModel:'SERVICE',invoiceEligible:true,serviceType:'MARKETING_CAMPAIGN',commercialModel:'FIXED_FEE',startDate:'2026-08-04',endDate:'2026-09-04',deliverables:'Creator campaign',grossRevenue:13000,currency:'USD',directCosts:0,akariNetRevenue:13000,referralReward:0,nextAction:'Deliver campaign',metadata:{}};
const invoices=[
  {id:'inv_1',invoiceNumber:'AKARI-001',invoiceDate:'2026-08-04',total:5000,received:3000,outstanding:2000,currency:'USD',status:'PARTIALLY_PAID'},
  {id:'inv_2',invoiceNumber:'AKARI-002',invoiceDate:'2026-08-05',total:4000,received:0,outstanding:4000,currency:'USD',status:'INVOICED'},
  {id:'inv_3',invoiceNumber:'AKARI-003',invoiceDate:'2026-08-06',total:4000,received:0,outstanding:4000,currency:'USD',status:'INVOICED'},
];
const workspace={
  opportunity,
  proposals:[],negotiations:[],closures:[],engagements:[engagement],
  finance:{invoices,receipts:[],credits:[],referrals:[]},
  clientBilling:{profile:{legalName:'TRAVLS.IO',billingEmail:'samarth@travls.io',addressLine1:'Client Street',city:'Berlin',country:'Germany'},saved:true,readiness:{complete:true,missing:[]}},
  issuerBilling:{readiness:{complete:true,missing:[]}},
  commercialReadiness:{qualified:false,proposalRecorded:false,proposalAccepted:false,negotiationRecorded:false,won:true,lost:false,clientConverted:true,engagementReady:true,invoiceEligible:true,clientBillingReady:true,clientBillingMissing:[],issuerBillingReady:true,issuerBillingMissing:[],invoiceReady:true,invoiceCount:3,received:3000,outstanding:10000,nextAction:'Collect or reconcile the outstanding invoice balance.',nextActionCode:'COLLECT_PAYMENT'},
  permissions:{canWrite:true,canFinance:true,canApproveProposal:true,canEditClientBilling:true},
};

function genericPayload(path){
  if(path==='/api/me')return me;
  if(path==='/api/profile')return{user:me.user};
  if(path==='/api/dashboard')return{currency:'USD',metrics:{monthlyTarget:0,revenueBooked:13000,revenueCollected:3000,netRevenue:13000,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:1,activeCampaigns:1,outstandingPayments:10000,referralRewardsDue:0}};
  if(path.startsWith('/api/tasks'))return{items:[],total:0};
  if(path.startsWith('/api/akari-leads'))return{items:[],total:0,categories:[],canWrite:true};
  if(path==='/api/campaigns'||path==='/api/partners'||path==='/api/contacts'||path==='/api/payments')return{items:[],total:0};
  if(path==='/api/reports')return{pipelineByStage:[],revenueByMonth:[]};
  return{items:[],total:0};
}

test('won opportunity shows one canonical outstanding-balance action with direct invoice controls',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-08-10T20:00:00.000Z'));
  await page.route('**/api/**',async(route)=>{
    const request=route.request();const url=new URL(request.url());const path=`${url.pathname}${url.search}`;
    if(url.pathname==='/api/opportunities'&&request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[opportunity],total:1})});
    if(url.pathname==='/api/opportunities/opp_creator/workspace')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workspace)});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(genericPayload(path))});
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  const card=page.locator('[data-akari-opportunity-id="opp_creator"]');
  await expect(card).toContainText('Creator Campaign');
  await card.getByRole('button',{name:'Manage lifecycle'}).click();

  const dialog=page.getByRole('dialog',{name:'Revenue lifecycle workspace'});
  await expect(dialog).toBeVisible();
  const readiness=dialog.locator('[data-bd-commercial-readiness]');
  await expect(readiness).toBeVisible();
  await expect(readiness).toContainText('NEXT REQUIRED ACTION');
  await expect(readiness).toContainText('Collect or reconcile $10,000.00 outstanding.');
  await expect(readiness).toContainText('3 invoice(s) · outstanding balance remains.');
  await expect(readiness.getByRole('button',{name:'View invoices'})).toBeVisible();
  await expect(readiness.getByRole('button',{name:'Record payment'})).toBeVisible();
  await expect(readiness).not.toContainText('Next safe action');

  const summary=dialog.locator('.revenue-summary-grid');
  await expect(summary.locator('.revenue-property').filter({hasText:'Next action'})).toHaveCount(0);

  const stepper=dialog.locator('.revenue-stepper');
  await expect(stepper.locator('.revenue-step')).toHaveCount(9);
  await expect(stepper.locator('.revenue-step').filter({hasText:'Referral reward'})).toBeVisible();
  await expect(stepper.locator('.revenue-step').filter({hasText:/^Opportunity$/})).toHaveCount(0);
  await expect(stepper.locator('.revenue-step').filter({hasText:'Client'})).toHaveClass(/complete/);
  await expect.poll(()=>stepper.evaluate((node)=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();
  const labelsContained=await stepper.locator('.revenue-step').evaluateAll((steps)=>steps.every((step)=>{
    const label=step.querySelector('strong');
    if(!label)return false;
    const box=step.getBoundingClientRect();
    const textBox=label.getBoundingClientRect();
    return textBox.left>=box.left-1&&textBox.right<=box.right+1&&textBox.top>=box.top-1&&textBox.bottom<=box.bottom+1;
  }));
  expect(labelsContained).toBeTruthy();

  await readiness.getByRole('button',{name:'View invoices'}).click();
  const invoicePanel=dialog.locator('.revenue-panel').filter({hasText:'Invoices and payments'}).first();
  await expect(invoicePanel).toHaveClass(/r64-focus-panel/);

  await readiness.getByRole('button',{name:'Record payment'}).click();
  await expect(page.getByRole('heading',{name:'Record client payment'})).toBeVisible();
});