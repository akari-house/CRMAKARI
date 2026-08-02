import { test, expect } from '@playwright/test';

test('modal selects use an accessible in-app combobox instead of the Windows native popup', async ({ page }) => {
  await page.goto('/');
  await page.setContent(`
    <div id="modal-root">
      <div class="modal-backdrop">
        <form class="modal">
          <div class="modal-body">
            <label class="form-group">
              <span>Stage</span>
              <select class="form-control" name="stage">
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="WON">Won</option>
              </select>
            </label>
          </div>
        </form>
      </div>
    </div>
    <div id="commercial-modal-root"></div>
    <div id="work-os-modal-root"></div>
  `);
  await page.addStyleTag({ url:'/assets/modal-system-r9.css?v=1' });
  await page.addScriptTag({ url:'/assets/modal-system-r9.js?v=1' });
  await page.evaluate(() => document.dispatchEvent(new Event('akari:route-rendered')));

  const native = page.locator('select[name="stage"]');
  const trigger = page.locator('.ak-combobox__trigger');
  await expect(native).toHaveClass(/ak-combobox__native/);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('role', 'combobox');
  await expect(trigger).toContainText('New');

  const nativeStyle = await native.evaluate((node) => ({
    opacity:getComputedStyle(node).opacity,
    pointerEvents:getComputedStyle(node).pointerEvents,
    width:node.getBoundingClientRect().width,
  }));
  expect(nativeStyle.opacity).toBe('0');
  expect(nativeStyle.pointerEvents).toBe('none');
  expect(nativeStyle.width).toBeLessThanOrEqual(2);

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('.ak-combobox__panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('option', { name:'Qualified' })).toBeVisible();

  const panelStyle = await panel.evaluate((node) => ({
    color:getComputedStyle(node).color,
    background:getComputedStyle(node).backgroundColor,
    position:getComputedStyle(node).position,
  }));
  expect(panelStyle.color).not.toBe(panelStyle.background);
  expect(panelStyle.background).not.toBe('rgb(255, 255, 255)');
  expect(panelStyle.position).toBe('fixed');

  await panel.getByRole('option', { name:'Qualified' }).click();
  await expect(native).toHaveValue('QUALIFIED');
  await expect(trigger).toContainText('Qualified');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
