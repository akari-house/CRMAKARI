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

test('moving TRAVLS to won keeps the opportunity visible after refresh', async ({ page }) => {
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
  }];
  let patchCount = 0;

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

    if (url.pathname === '/api/opportunities/opp_travls' && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      items[0] = { ...items[0], stage: String(body.stage || items[0].stage).toUpperCase() };
      patchCount += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'opp_travls', updated: true, stage: items[0].stage }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  await expect(page.locator('[data-akari-stage="QUALIFIED"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');

  await page.locator('.stage-select[data-id="opp_travls"]').selectOption('WON');
  await expect.poll(() => patchCount).toBe(1);

  await expect(page.locator('[data-akari-stage="WON"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');
  await expect(page.locator('[data-akari-stage="QUALIFIED"] [data-akari-opportunity-id="opp_travls"]')).toHaveCount(0);
  await expect(page.locator('#view-root .pipeline')).toHaveAttribute('data-akari-closed-opportunity-count', '1');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect(page.locator('[data-akari-stage="WON"] [data-akari-opportunity-id="opp_travls"]')).toContainText('TRAVLS creator campaign');
});
