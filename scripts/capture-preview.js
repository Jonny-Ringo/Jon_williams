import { chromium } from '@playwright/test';
import { mkdir, copyFile } from 'node:fs/promises';

// Start `npm run dev` first. Captures stay local and are excluded from the build.
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const [name, route] of [
      ['home', '/'],
      ['career', '/career/'],
    ]) {
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.goto(`http://127.0.0.1:5173${route}`);
      await page.evaluate(() => document.fonts.ready);
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element) => element.decode());
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({
        path: `artifacts/${name}-${colorScheme}-desktop.png`,
        fullPage: true,
      });
      if (name === 'home')
        await page
          .locator('.project-grid')
          .screenshot({ path: `artifacts/cards-${colorScheme}.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: `artifacts/${name}-${colorScheme}-mobile.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await copyFile('public/jon-williams-resume.pdf', 'artifacts/jon-williams-resume.pdf');
  await page.emulateMedia({ media: 'screen' });
  for (const width of [320, 600, 820, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/career/']) {
      await page.goto(`http://127.0.0.1:5173${route}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      console.log(`${route} at ${width}px: ${overflow ? 'OVERFLOW' : 'fits'}`);
    }
  }
} finally {
  await browser.close();
}
