import { test, expect } from '@playwright/test';

test('native modal select options remain readable in Chromium dark mode', async ({ page }) => {
  await page.goto('/');
  await page.setContent(`
    <div id="modal-root">
      <div class="modal-backdrop">
        <form class="modal ak-modal-standard">
          <label class="form-group">
            <span>Stage</span>
            <select class="form-control" name="stage">
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="QUALIFIED">Qualified</option>
              <option value="WON">Won</option>
            </select>
          </label>
        </form>
      </div>
    </div>
  `);
  await page.addStyleTag({ url:'/assets/select-option-contrast-v1.css?v=1' });

  const styles = await page.evaluate(() => {
    const select = document.querySelector('select[name="stage"]');
    const option = select.querySelector('option');
    const selected = select.querySelector('option:checked');
    return {
      colorScheme:getComputedStyle(select).colorScheme,
      optionColor:getComputedStyle(option).color,
      optionBackground:getComputedStyle(option).backgroundColor,
      selectedColor:getComputedStyle(selected).color,
      selectedBackground:getComputedStyle(selected).backgroundColor,
    };
  });

  expect(styles.colorScheme).toContain('dark');
  expect(styles.optionColor).toBe('rgb(247, 248, 251)');
  expect(styles.optionBackground).toBe('rgb(13, 18, 26)');
  expect(styles.selectedColor).toBe('rgb(255, 255, 255)');
  expect(styles.selectedBackground).not.toBe('rgba(0, 0, 0, 0)');
});
