import { test, expect } from '@playwright/test';

test('V1 runtime resilience loads and shows a safe status banner',async({page})=>{
  await page.goto('/app/index.html');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.AkariRuntimeStatus))).toBe(true);
  await page.evaluate(()=>window.AkariRuntimeStatus.show('Connection restored','CRM by AKARI is back online.','success',{persistent:true}));
  const banner=page.locator('#v1-runtime-status .v1-runtime-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Connection restored');
  await expect(banner).toContainText('CRM by AKARI is back online.');
});

test('V1 runtime resilience remains inside a mobile viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/app/index.html');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.AkariRuntimeStatus))).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  const banner=page.locator('#v1-runtime-status .v1-runtime-banner');
  await expect(banner).toBeVisible();
  const box=await banner.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeLessThan(160);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
