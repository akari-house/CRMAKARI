import { test, expect } from '@playwright/test';

test('modal dropdowns use the styled custom listbox and preserve native form values', async ({ page }) => {
  await page.goto('/');
  await page.setContent(`
    <div id="modal-root">
      <div class="modal-backdrop">
        <form class="modal ak-modal-standard">
          <label class="form-group"><span>Stage</span><select class="form-control" name="stage">
            <option value="NEW">New</option><option value="CONTACTED">Contacted</option><option value="QUALIFIED">Qualified</option>
          </select></label>
          <label class="form-group"><span>Currency</span><select class="form-control" name="currency">
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
          </select></label>
        </form>
      </div>
    </div>
  `);
  await page.addStyleTag({ url:'/assets/modal-system-r9.css?v=1' });
  await page.addStyleTag({ url:'/assets/custom-select-v2.css?v=1' });
  await page.addScriptTag({ url:'/assets/custom-select-v2.js?v=1' });

  const controls = page.locator('#modal-root .ak-select');
  await expect(controls).toHaveCount(2);
  await expect(page.locator('select[name="currency"]')).toHaveValue('USD');

  await controls.nth(1).locator('.ak-select__trigger').click();
  const menu = page.locator('.ak-select__menu:visible');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option', { name:'EUR' })).toBeVisible();

  const menuStyles = await menu.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background:style.backgroundColor, color:style.color, position:style.position, zIndex:Number(style.zIndex) };
  });
  expect(menuStyles.background).not.toBe('rgb(255, 255, 255)');
  expect(menuStyles.color).not.toBe('rgb(255, 255, 255, 0)');
  expect(menuStyles.position).toBe('fixed');
  expect(menuStyles.zIndex).toBeGreaterThan(9999);

  await menu.getByRole('option', { name:'EUR' }).click();
  await expect(page.locator('select[name="currency"]')).toHaveValue('EUR');
  await expect(controls.nth(1).locator('.ak-select__value')).toHaveText('EUR');
  await expect(menu).toBeHidden();

  const stageTrigger = controls.nth(0).locator('.ak-select__trigger');
  await stageTrigger.focus();
  await stageTrigger.press('ArrowDown');
  const stageMenu = page.locator('.ak-select__menu:visible');
  await expect(stageMenu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('select[name="stage"]')).toHaveValue('CONTACTED');
  await expect(stageTrigger).toContainText('Contacted');
});