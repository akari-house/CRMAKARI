import { test, expect } from '@playwright/test';

const me = { user: { userId:'usr_owner',tenantId:'tenant_akari_house',tenantSlug:'akari-house',email:'owner@example.com',fullName:'Muaz Test',role:'OWNER',financeAccess:true } };
const project = {
  id:'prj_1',name:'Project Alpha',category:'Web3',lifecycle_status:'LEAD',priority:'HIGH',website:'https://alpha.example',
  x_url:'https://x.com/projectalpha',telegram:'@projectalpha',region:'Germany',source_name:'Referral',owner_user_id:'usr_owner',referral_partner_id:'par_1',
  next_follow_up_at:'2030-02-01T10:00:00Z',profile_completeness:82,
  bdProfile:{
    entityType:'PROJECT',funding:{stage:'Seed',amountRaised:2500000,currency:'USD',valuation:15000000},
    capital:{aumAmount:null,currency:'USD',checkSizeMin:null,checkSizeMax:null,investmentFocus:null},
    qualification:{bdStage:'PROFILE_READY',serviceInterest:'GTM strategy',nextAction:'Book discovery call'},
    meeting:{status:'NOT_BOOKED',scheduledAt:null,durationMinutes:30,timezone:'Europe/Berlin',locationUrl:null,syncStatus:'NOT_CONNECTED'},
  },
  contacts:[{id:'con_1',full_name:'Alice Founder',job_title:'CEO',email:'alice@example.com',x_handle:'https://x.com/alice',telegram:'@alice',preferred_channel:'TELEGRAM',is_primary_contact:1,is_decision_maker:1}],
  opportunities:[],activities:[],invoiceSummary:{count:0,outstanding:0,collected:0},
};

function payloadFor(url, method) {
  const parsed=new URL(url); const path=`${parsed.pathname}${parsed.search}`;
  if(path==='/api/me') return me;
  if(path==='/api/profile') return {user:{id:'usr_owner',fullName:'Muaz Test',email:'owner@example.com',jobTitle:'Owner',bio:'',status:'ACTIVE',lastLoginAt:null}};
  if(path==='/api/dashboard') return {currency:'USD',metrics:{monthlyTarget:0,revenueBooked:0,revenueCollected:0,netRevenue:0,weightedPipeline:0,activeOpportunities:0,yearToDateRevenue:0,activeCustomers:0,activeCampaigns:0,activePartners:0,outstandingPayments:0,referralRewardsDue:0}};
  if(path==='/api/tasks?scope=mine') return {items:[],total:0};
  if(path==='/api/tasks?scope=mine&includeCompleted=1') return {items:[],total:0};
  if(path==='/api/projects?limit=5') return {items:[project],total:1};
  if(path==='/api/opportunities') return {items:[],total:0};
  if(path==='/api/campaigns') return {items:[],total:0};
  if(path==='/api/payments') return {items:[],total:0};
  if(path==='/api/invoices') return {items:[],total:0};
  if(path==='/api/partners') return {items:[{id:'par_1',name:'Referral Partner',status:'ACTIVE'}],total:1};
  if(path==='/api/team') return {items:[{userId:'usr_owner',fullName:'Muaz Test',role:'OWNER',status:'ACTIVE',financeAccess:true},{userId:'usr_bd',fullName:'BD Teammate',role:'BD_MEMBER',status:'ACTIVE',financeAccess:false}],total:2};
  if(path==='/api/billing-profile') return {tenant:{name:'AKARI House',baseCurrency:'USD'},billingProfile:{legalName:'AKARI House',addressLine1:'Example Street 1',country:'Germany',email:'billing@example.com',invoicePrefix:'AKARI',defaultTaxRate:0,defaultPaymentTermsDays:14}};
  if(parsed.pathname==='/api/projects/prj_1') return project;
  if(parsed.pathname.startsWith('/api/akari-leads')) return {items:[{...project,primary_contact:'Alice Founder',contact_count:1,owner:'Muaz Test'}],total:1,categories:[{category:'Web3',count:1}],owners:[{id:'usr_owner',full_name:'Muaz Test'}],canWrite:true};
  if(path==='/api/contacts') return {items:[],total:0};
  if(path==='/api/reports') return {pipelineByStage:[],revenueByMonth:[]};
  if(method==='POST'&&path==='/api/activities') return {id:'act_1',created:true,calendarSync:'PENDING_INTEGRATION'};
  if(method==='POST'&&path==='/api/invoices') return {id:'inv_1',invoiceNumber:'AKARI-2030-0001',total:5000,status:'INVOICED',created:true};
  if(method==='PATCH'&&path==='/api/billing-profile') return {updated:true};
  if(method==='POST'&&path==='/api/akari-leads') return {id:'prj_new',created:true};
  return {items:[],total:0};
}

async function boot(page, captures=[]) {
  await page.route('**/api/**',async(route)=>{
    const request=route.request();
    if(['POST','PATCH'].includes(request.method())) captures.push({path:new URL(request.url()).pathname,method:request.method(),body:request.postDataJSON()});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payloadFor(request.url(),request.method()))});
  });
  await page.goto('http://127.0.0.1:4173/app/akari-house/home');
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Muaz/i})).toBeVisible();
}

test('new lead form captures structured qualification POC ownership and referral data',async({page})=>{
  const captures=[];await boot(page,captures);
  await page.locator('[data-route="leads"]').first().click();
  await page.getByRole('button',{name:/New lead/i}).click();
  await expect(page.locator('.bd-lead-modal')).toBeVisible();
  await expect(page.getByText('Organisation profile',{exact:true})).toBeVisible();
  await expect(page.getByText('Primary point of contact',{exact:true})).toBeVisible();
  const assign=page.locator('input[name="assignToMe"]');
  const assignBox=await assign.boundingBox();
  expect(assignBox).not.toBeNull();
  expect(assignBox.width).toBeLessThanOrEqual(20);
  await page.selectOption('select[name="entityType"]','VENTURE_CAPITAL');
  await expect(page.locator('.bd-capital-profile')).toBeVisible();
  await expect(page.locator('.bd-project-profile')).toBeHidden();
  await page.selectOption('select[name="entityType"]','PROJECT');
  await page.fill('input[name="name"]','New Project');
  await page.fill('input[name="xUrl"]','@newproject');
  await page.fill('input[name="telegram"]','@newproject');
  await page.fill('input[name="fundingAmount"]','3000000');
  await page.fill('input[name="contactFullName"]','Jane Founder');
  await page.fill('input[name="contactXHandle"]','@janefounder');
  await page.fill('input[name="contactTelegram"]','@janefounder');
  await page.selectOption('select[name="referralPartnerId"]','par_1');
  await page.selectOption('select[name="ownerUserId"]','usr_bd');
  await page.getByRole('button',{name:'Create lead'}).click();
  await expect.poll(()=>captures.some((item)=>item.path==='/api/akari-leads')).toBeTruthy();
  const sent=captures.find((item)=>item.path==='/api/akari-leads').body;
  expect(sent.entityType).toBe('PROJECT');
  expect(sent.fundingAmount).toBe('3000000');
  expect(sent.contactFullName).toBe('Jane Founder');
  expect(sent.contactXHandle).toBe('@janefounder');
  expect(sent.referralPartnerId).toBe('par_1');
  expect(sent.ownerUserId).toBe('usr_bd');
});

test('relationship drawer shows qualification and records a booked call',async({page})=>{
  const captures=[];await boot(page,captures);
  await page.locator('[data-route="leads"]').first().click();
  await page.getByText('Project Alpha',{exact:true}).first().click();
  await expect(page.getByText('BD qualification profile',{exact:true})).toBeVisible();
  await expect(page.getByText('$2,500,000',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Book call/i}).click();
  await expect(page.getByRole('heading',{name:'Book discovery call'})).toBeVisible();
  await page.fill('input[name="meetingScheduledAt"]','2030-02-15T14:30');
  await page.fill('input[name="meetingLocationUrl"]','https://meet.google.com/example');
  await page.locator('[data-bd-form="book-call"] button[type="submit"]').click();
  await expect.poll(()=>captures.some((item)=>item.path==='/api/activities')).toBeTruthy();
  const sent=captures.find((item)=>item.path==='/api/activities').body;
  expect(sent.activityType).toBe('MEETING');
  expect(sent.outcome).toBe('BOOKED');
  expect(sent.calendarProvider).toBe('GOOGLE');
  expect(sent.createPreparationTask).toBe(true);
});

test('canonical billing profile and relationship invoice flow are connected',async({page})=>{
  const captures=[];await boot(page,captures);
  await page.locator('[data-route="settings"]').first().click();
  await expect(page.getByRole('heading',{name:'Settings & Profile'})).toBeVisible();
  await expect(page.getByText('Organisation billing',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit billing'}).click();
  await expect(page.getByRole('heading',{name:'Organisation billing details'})).toBeVisible();
  await page.fill('#ops-form input[name="legalName"]','AKARI GmbH');
  await page.getByRole('button',{name:'Save billing details'}).click();
  await expect.poll(()=>captures.some((item)=>item.path==='/api/billing-profile'&&item.method==='PATCH')).toBeTruthy();

  await page.locator('[data-route="leads"]').first().click();
  await page.getByText('Project Alpha',{exact:true}).first().click();
  await page.getByRole('button',{name:/Create invoice/i}).click();
  await expect(page.getByRole('heading',{name:'Create invoice'})).toBeVisible();
  await page.fill('input[name="unitPrice"]','5000');
  await page.fill('input[name="recipientAddressLine1"]','Client Street 2');
  await page.fill('input[name="recipientCountry"]','Germany');
  await page.locator('[data-bd-form="create-invoice"] button[type="submit"]').click();
  await expect.poll(()=>captures.some((item)=>item.path==='/api/invoices')).toBeTruthy();
  const sent=captures.find((item)=>item.path==='/api/invoices').body;
  expect(sent.projectId).toBe('prj_1');
  expect(sent.lineItems[0].unitPrice).toBe(5000);
  expect(sent.recipient.name).toBe('Project Alpha');
});
