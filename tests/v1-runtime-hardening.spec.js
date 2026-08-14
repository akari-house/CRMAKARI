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

test('V1 modal safety suppresses the Relationship 360 launcher while another governed dialog is open',async({page})=>{
  await page.goto('/app/index.html');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.AkariRuntimeStatus))).toBe(true);
  await page.evaluate(()=>{
    document.querySelectorAll('[data-v1-test-dialog]').forEach(node=>node.remove());
    let launcher=document.getElementById('rel73-launch');
    if(!launcher){launcher=document.createElement('button');launcher.id='rel73-launch';launcher.textContent='360° Relationship';document.body.appendChild(launcher);}
    const dialog=document.createElement('section');dialog.dataset.v1TestDialog='true';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.textContent='Term-sheet form';document.body.appendChild(dialog);
    window.AkariRuntimeStatus.syncModalSafety();
  });
  const launcher=page.locator('#rel73-launch').first();
  await expect(launcher).toHaveCSS('pointer-events','none');
  await expect(launcher).toHaveCSS('opacity','0');
  await expect(launcher).toHaveAttribute('aria-hidden','true');
});

test('V1 Founder Capital Data Room handoff opens the institutional Data Room with the legacy accessible dialog name',async({page})=>{
  await page.goto('/app/index.html');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.AkariRuntimeStatus))).toBe(true);
  await page.evaluate(()=>{
    document.querySelectorAll('[data-v1-test-capital],[data-v1-test-dr-launcher],#v1-data-room-fallback-root').forEach(node=>node.remove());
    const capital=document.createElement('section');capital.dataset.v1TestCapital='true';capital.id='founder-capital-command-r67';capital.innerHTML='<select data-fcr67-round><option value="round_1" selected>Round 1</option></select><button data-fcr67-nav="data-room">Data Room</button>';document.body.appendChild(capital);
    const launcher=document.createElement('button');launcher.dataset.v1TestDrLauncher='true';launcher.dataset.dr72Round='round_1';launcher.addEventListener('click',()=>{const dialog=document.createElement('section');dialog.className='dr72-modal';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.textContent='Institutional Data Room';document.body.appendChild(dialog);});document.body.appendChild(launcher);
  });
  await page.locator('[data-v1-test-capital] [data-fcr67-nav="data-room"]').click();
  await expect(page.getByRole('dialog',{name:'Fundraising data room'})).toBeVisible();
});

test('V1 Founder Capital Data Room handoff fails visibly instead of becoming a dead button',async({page})=>{
  await page.goto('/app/index.html');
  await expect.poll(()=>page.evaluate(()=>Boolean(window.AkariRuntimeStatus))).toBe(true);
  await page.evaluate(()=>{
    document.querySelectorAll('[data-dr72-round],#v1-data-room-fallback-root').forEach(node=>node.remove());
    window.AkariRuntimeStatus.openInstitutionalDataRoom(16,true);
  });
  const dialog=page.getByRole('dialog',{name:'Fundraising data room'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Data Room is not available for this round yet.');
  await expect(dialog.getByRole('button',{name:'Retry Data Room'})).toBeVisible();
});
