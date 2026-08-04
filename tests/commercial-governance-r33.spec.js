import { test, expect } from '@playwright/test';

const workspace = {
  opportunity: {
    id:'opp_a', project_id:'project_a', project_name:'Client', name:'Client campaign', stage:'QUALIFIED',
    estimated_value:10000, currency:'USD', service_type:'MARKETING', probability_percentage:60,
  },
  proposals:[{
    id:'proposal_a', outcome:'ACCEPTED', metadata:{recordType:'AKARI_PROPOSAL_V1',status:'ACCEPTED',version:2,amount:10000,currency:'USD',serviceType:'MARKETING',commercialModel:'FIXED_FEE',deliverables:'Creator campaign',paymentTerms:'50% upfront',acceptedBy:'Alice',acceptedAt:'2026-08-04T10:00',acceptanceMethod:'EMAIL',acceptanceReference:'Acceptance email',termsConfirmed:true},
  }],
  negotiations:[], closures:[], engagements:[], finance:{invoices:[],receipts:[],credits:[],referrals:[]},
  clientBilling:{profile:{},readiness:{complete:false,missing:[]}}, issuerBilling:{readiness:{complete:true,missing:[]}},
  commercialReadiness:{}, permissions:{canWrite:true,canFinance:true,canApproveProposal:true,canEditClientBilling:true},
};

async function fixture(page) {
  await page.goto('/');
  await page.setContent(`<div id="toast-root"></div><div id="modal-root"><div class="revenue-workspace"><div class="revenue-toolbar"><button data-revenue-action="close-won">Mark won</button><button data-revenue-action="close-lost">Mark lost</button></div><div id="revenue-form-layer"></div></div></div><article data-akari-opportunity-id="opp_a"><button data-revenue-action="open" data-id="opp_a">Manage lifecycle</button><select class="stage-select" data-id="opp_a"><option value="QUALIFIED" selected>Qualified</option><option value="WON">Won</option><option value="LOST">Lost</option><option value="ON_HOLD">On hold</option></select></article><button data-commercial-action="proposal-status" data-id="proposal_a" data-status="SENT">Send to client</button><button data-commercial-action="proposal-decision" data-id="proposal_a">Record decision</button>`);
  await page.addStyleTag({url:'/assets/commercial-governance-r33.css?v=1'});
  await page.addScriptTag({url:'/assets/commercial-governance-r33.js?v=1'});
}

test('direct won stage is intercepted and controlled won form carries accepted proposal terms',async({page})=>{
  const writes=[];
  await page.route('**/api/**',async(route)=>{
    const req=route.request(), url=new URL(req.url());
    if(url.pathname==='/api/opportunities/opp_a/workspace') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workspace)});
    if(url.pathname==='/api/opportunities/opp_a/close'){writes.push(req.postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({closed:true})});}
    return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await fixture(page);
  let opened=0;
  await page.locator('[data-revenue-action="open"]').evaluate((node)=>node.addEventListener('click',()=>window.__opened=(window.__opened||0)+1));
  const select=page.locator('.stage-select');
  await select.selectOption('WON');
  await expect(select).toHaveValue('QUALIFIED');
  opened=await page.evaluate(()=>window.__opened||0);
  expect(opened).toBe(1);
  await page.locator('[data-revenue-action="close-won"]').click();
  const form=page.locator('#governance-active-form');
  await expect(form).toBeVisible();
  await expect(form.locator('[name="sourceProposalId"]')).toHaveValue('proposal_a');
  await expect(form.locator('[name="finalValue"]')).toHaveValue('10000');
  await expect(form.locator('[name="deliverables"]')).toHaveValue('Creator campaign');
  await expect(page.getByText('Accepted proposal v2')).toBeVisible();
  await form.locator('[name="endDate"]').fill('2026-09-30');
  await form.locator('button[type="submit"]').click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].outcome).toBe('WON');
  expect(writes[0].sourceProposalId).toBe('proposal_a');
});

test('proposal decision requires acceptance evidence and remains usable on mobile',async({page})=>{
  const writes=[];
  await page.route('**/api/**',async(route)=>{
    const req=route.request(), url=new URL(req.url());
    if(url.pathname==='/api/proposals/proposal_a'){writes.push(req.postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({updated:true})});}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(workspace)});
  });
  await fixture(page);
  await page.locator('[data-commercial-action="proposal-decision"]').click();
  const form=page.locator('#governance-active-form');
  await expect(form.getByText('Accepted terms match this proposal version')).toBeVisible();
  await form.locator('[name="acceptedBy"]').fill('Alice');
  await form.locator('[name="acceptanceReference"]').fill('Email acceptance');
  await form.locator('[name="termsConfirmed"]').check();
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('.governance-modal').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(391);
  await form.locator('button[type="submit"]').click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].status).toBe('ACCEPTED');
  expect(writes[0].termsConfirmed).toBe(true);
  expect(writes[0].acceptanceMethod).toBe('EMAIL');
});