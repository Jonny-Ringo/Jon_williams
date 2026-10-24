import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('work photos open full-size, support keyboard close, and restore focus', async ({ page }) => {
  await page.goto('/career/');
  const photos = page.locator('[data-work-photo]');
  await expect(photos).toHaveCount(5);
  for (const photo of await photos.all()) {
    await photo.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveJSProperty('complete', true);
    await expect
      .poll(() => dialog.locator('img').evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(photo).toBeFocused();
  }
  await photos.first().click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await photos.last().click();
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('built photo links resolve to images without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/career/');
    for (const href of await page
      .locator('[data-work-photo]')
      .evaluateAll((links) => links.map((a) => a.href))) {
      const response = await context.request.get(href);
      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toMatch(/^image\//);
    }
  } finally {
    await context.close();
  }
});
