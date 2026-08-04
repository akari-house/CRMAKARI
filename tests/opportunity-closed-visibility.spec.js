import { test, expect } from '@playwright/test';

function mePayload() {
  return {
    user: {
      userId: 'user_owner',
      tenantId: 'tenant_akari_house',
      tenantSlug: 'akari-house',
      email: 'owner@example.com',
      fullName: 'Muaz Test',
      role: 'OWNER',
      financeAccess: true,
    },
  };
}

test('controlled TRAVLS won close remains visible after refresh', async ({ page }) => {
  const items = [{
    id: 'opp_travls',
    project_id: 'project_travls',
    project_name: 'TRAVLS',
    name: 'TRAVLS creator campaign',
    service_type: 'MARKETING_CAMPAIGN',
    stage: 'QUALIFIED',
    estimated_value: 15000,
    estimated_value_base_currency: 15000,
    currency: 'USD',
    probability_percentage: 60,
    next_action: 'Confirm final campaign scope',
    owner_name: 'Muaz Test',
    primary_contact_name: 'TRAVLS Founder',
    qualificationComplete: true,
    need_confirmed: 1,
    decision_maker_confirmed: 1,
    timeline_confirmed: 1,
    budget_status: 'CONFIRMED',
  }];
  let directPatchCount = 0;
  let controlledCloseCount = 0;

  const workspace = () => ({
    opportunity: items[0],
    proposals: [],
    negotiations: [],
    closures: [],
    engagements: [],
    finance: { invoices: [], receipts: [], referrals: [] },
    permissions: { canWrite: true, canFinance: true, canApproveProposal: true },
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload()) });
      return;
    }

    if (url.pathname === '/api/opportunities' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, total: items.length }) });
      return;
    }

    if (url.pathname === '/api/opportunities/opp_travls/workspace') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspace()) });
      return;
    }

    if (url.pathname === '/api/opportunities/opp_travls' && request.method() === 'PATCH') {
      directPatchCount += 1;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Use the controlled close workflow' }) });
      return;
    }

    if (url.pathname === '/api/opportunities/opp_travls/close' && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.outcome).toBe('WON');
      expect(body.acceptedBy).toBe('TRAVLS Founder');
      items[0] = { ...items[0], stage: 'WON', probability_percentage: 100, next_action: body.nextAction };
      controlledCloseCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'opp_travls', closed: true, outcome: 'WON' }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  await expect(page.locator('[data-akari-stage="QUALIFIED"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');

  const stage = page.locator('.stage-select[data-id="opp_travls"]');
  await stage.selectOption('WON');
  await expect(stage).toHaveValue('QUALIFIED');
  expect(directPatchCount).toBe(0);

  await expect(page.getByLabel('Revenue lifecycle workspace')).toBeVisible();
  await page.getByLabel('Revenue lifecycle workspace').getByRole('button', { name: 'Mark won' }).click();
  const form = page.locator('#governance-active-form');
  await expect(form).toBeVisible();
  await form.locator('[name="acceptedBy"]').fill('TRAVLS Founder');
  await form.locator('[name="acceptanceReference"]').fill('Confirmed during founder call');
  await form.locator('[name="termsConfirmed"]').check();
  await form.locator('[name="manualCloseReason"]').fill('Partnership and creator campaign confirmed directly with the founder.');
  await form.locator('[name="deliverables"]').fill('Creator campaign and dedicated X Space');
  await form.locator('button[type="submit"]').click();
  await expect.poll(() => controlledCloseCount).toBe(1);

  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect(page.locator('[data-akari-stage="WON"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');
  await expect(page.locator('#view-root .pipeline')).toHaveAttribute('data-akari-closed-opportunity-count', '1');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect(page.locator('[data-akari-stage="WON"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');
});