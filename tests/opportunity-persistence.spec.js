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

test('new lead opportunity remains visible after save and reload', async ({ page }) => {
  const records = [];
  const captures = [];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;

    if (path === '/api/me') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload()) });
      return;
    }

    if (path === '/api/akari-leads?limit=100&offset=0') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [{ id: 'project_new', name: 'New Lead Project' }], total: 1 }),
      });
      return;
    }

    if (url.pathname === '/api/opportunities' && request.method() === 'POST') {
      const body = request.postDataJSON();
      captures.push(body);
      records.push({
        id: 'opportunity_new',
        project_id: body.projectId,
        project_name: 'New Lead Project',
        name: body.name,
        service_type: body.serviceType,
        stage: body.stage,
        estimated_value: Number(body.estimatedValue || 0),
        currency: body.currency || 'USD',
        probability_percentage: Number(body.probabilityPercentage || 0),
        next_action: body.nextAction,
        next_follow_up_at: body.nextFollowUpAt || null,
        owner_name: 'Muaz Test',
      });
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'opportunity_new', created: true }) });
      return;
    }

    if (url.pathname === '/api/opportunities' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: records, total: records.length }) });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) });
  });

  await page.goto('http://127.0.0.1:4173/app/akari-house/opportunities');
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await page.getByRole('button', { name: 'New opportunity' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'New opportunity' })).toBeVisible();

  await page.locator('#active-form input[name="name"]').fill('Launch campaign opportunity');
  await page.locator('#active-form input[name="estimatedValue"]').fill('25000');
  await page.locator('#active-form input[name="nextAction"]').fill('Book discovery call');
  await page.locator('#active-form button[type="submit"]').click();

  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({
    projectId: 'project_new',
    name: 'Launch campaign opportunity',
    serviceType: 'MARKETING_CAMPAIGN',
    stage: 'NEW',
    estimatedValue: '25000',
    nextAction: 'Book discovery call',
  });

  const savedCard = page.locator('[data-akari-early-stage="NEW"] [data-akari-opportunity-id="opportunity_new"]');
  await expect(savedCard).toContainText('Launch campaign opportunity');
  await expect(savedCard).toContainText('New Lead Project');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Opportunity Pipeline' })).toBeVisible();
  await expect(page.locator('[data-akari-early-stage="NEW"] [data-akari-opportunity-id="opportunity_new"]')).toHaveCount(1);
  await expect(page.getByText('Launch campaign opportunity')).toBeVisible();
});
