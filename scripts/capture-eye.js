import { chromium } from '@playwright/test';

// Capture the same real dashboard state in both of its native color schemes.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 840 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  await page.goto('https://eye-of-ao.arweave.net/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(() => /Current Block:\s*\d+/.test(document.body.innerText), null, {
    timeout: 25000,
  });
  await page.evaluate(() => document.fonts.ready);
  // Wait for the initial overlay to clear without interacting with the live dashboard.
  await page
    .getByRole('heading', { name: 'Arweave & AO Network Stats', exact: true })
    .click({ trial: true, timeout: 25000 });
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `imgs/the-eye-${colorScheme}.png`,
      clip: { x: 0, y: 0, width: 1280, height: 430 },
      animations: 'disabled',
    });
    console.log(`Captured The Eye in ${colorScheme} mode.`);
  }
} finally {
  await browser.close();
}
