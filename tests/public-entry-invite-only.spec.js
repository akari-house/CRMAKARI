import { test, expect } from '@playwright/test';

test('public homepage offers request access without exposing a clickable CRM login', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);

  await expect(page).toHaveTitle(/CRM by AKARI/);
  await expect(page.locator('a[href="/enter-crm"]')).toHaveCount(0);
  await expect(page.locator('[data-public-access="invite-only"]')).toHaveCount(3);
  await expect(page.getByText('Private CRM · Invite only').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Request access|Request early access/ }).first()).toBeVisible();
  await expect(page.locator('script[data-akari-public-core="r6"]')).toHaveCount(1);
});
