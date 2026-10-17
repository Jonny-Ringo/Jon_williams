import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { DataItem } from 'arbundles';
import { APP_NAME, VERSION, QUERY_URL, UPLOAD_URL } from '../src/analytics/shared.js';

function record(index, event = 'page_view', page = 'home', session = 'a', target = '') {
  const now = Date.now() - index * 1000;
  const tags = {
    'App-Name': APP_NAME,
    'App-Version': VERSION,
    'Event-Type': event,
    'Session-ID': session.repeat(32),
    'Event-ID': index.toString(16).padStart(32, '0'),
    'Event-Time': String(now),
    Timestamp: new Date(now).toISOString().slice(0, 10),
    Page: page,
    Target: target,
  };
  return {
    cursor: `cursor-${index}`,
    node: {
      id: index.toString().padStart(43, 'A'),
      tags: Object.entries(tags).map(([name, value]) => ({ name, value })),
    },
  };
}
const response = (edges, hasNextPage = false) => ({
  data: { transactions: { edges, pageInfo: { hasNextPage } } },
});

for (const colorScheme of ['light', 'dark']) {
  test(`analytics paginates and displays accessible real counts in ${colorScheme} mode`, async ({
    page,
  }) => {
    let requests = 0;
    await page.route(QUERY_URL, async (route) => {
      requests++;
      const { variables } = route.request().postDataJSON();
      expect(variables.tags[2].values).toHaveLength(30);
      await route.fulfill({
        json: variables.after
          ? response([
              record(2, 'page_view', 'career'), // duplicate must not count twice
              record(3, 'resume_download', 'career', 'b', 'pdf'),
              record(4, 'contact_click', 'home', 'b', 'email'),
            ])
          : response([record(1), record(2, 'page_view', 'career')], true),
      });
    });
    await page.emulateMedia({ colorScheme });
    await page.goto('/analytics/');
    await expect(page.locator('[data-metric="views"]')).toHaveText('2');
    await expect(page.locator('[data-metric="sessions"]')).toHaveText('2');
    await expect(page.locator('[data-metric="resume"]')).toHaveText('1');
    await expect(page.locator('[data-metric="contact"]')).toHaveText('1');
    expect(requests).toBe(2);
    await expect(page.locator('#analytics-recent tr')).toHaveCount(4);
    await expect(page.locator('#analytics-daily tr')).toHaveCount(30);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
          .violations,
      ).toEqual([]);
    }
    await page.screenshot({ path: `artifacts/analytics-${colorScheme}.png`, fullPage: true });
    await page.getByLabel('Exclude my visits').check();
    await page.reload();
    await expect(page.getByLabel('Exclude my visits')).toBeChecked();
  });
}

test('analytics distinguishes an empty period from service errors and recovers', async ({
  page,
}) => {
  let failing = true;
  await page.route(QUERY_URL, (route) =>
    route.fulfill({ json: failing ? { errors: [{ message: 'Unavailable' }] } : response([]) }),
  );
  await page.goto('/analytics/');
  await expect(page.getByRole('status').first()).toContainText('could not be loaded');
  await expect(page.locator('#analytics-results')).toBeHidden();
  failing = false;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('status').first()).toContainText('No indexed activity');
  await expect(page.locator('[data-metric="views"]')).toHaveText('0');
  await page.getByLabel('Date range').selectOption('7');
  await expect(page.locator('#analytics-daily tr')).toHaveCount(7);
});

async function productionSite(page) {
  // Serve local production bytes on a mock secure origin. All network routes
  // are intercepted; neither analytics events nor queries reach the internet.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://jon.test') return route.abort();
    const filename = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
    const types = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2',
      '.pdf': 'application/pdf',
    };
    await route.fulfill({
      body: await readFile(resolve('dist', `.${filename}`)),
      contentType: types[extname(filename)],
    });
  });
}

test('production tracking signs minimal events and keeps sessions across page navigation', async ({
  page,
}) => {
  test.setTimeout(60000);
  await productionSite(page);
  const items = [];
  await page.route(UPLOAD_URL, async (route) => {
    expect(route.request().headers().referer).toBeUndefined();
    const item = new DataItem(route.request().postDataBuffer());
    expect(await item.isValid()).toBe(true);
    expect(item.getRaw().length).toBeLessThan(100 * 1024);
    items.push(JSON.parse(item.rawData.toString()));
    await route.fulfill({ json: { id: item.id } });
  });
  await page.goto('https://jon.test/?private=do-not-record');
  await expect.poll(() => items.length, { timeout: 30000 }).toBe(1);
  await page.locator('[data-project="metrics"]').click();
  await expect.poll(() => items.length).toBe(2);
  expect(items[1].metadata).toEqual({ page: 'home', target: 'metrics' });
  await page.goto('https://jon.test/career/');
  await expect.poll(() => items.length, { timeout: 30000 }).toBe(3);
  expect(items[2].sessionId).toBe(items[0].sessionId);
  expect(items[2].event).toBe('page_view');
  expect(items[2].metadata.page).toBe('career');
  expect(JSON.stringify(items)).not.toMatch(
    /private|do-not-record|jon\.k|https|userAgent|referrer/,
  );
  expect(Object.keys(items[0]).sort()).toEqual([
    'event',
    'eventId',
    'metadata',
    'sessionId',
    'timestamp',
  ]);
});

test('privacy choices, dashboard and local previews prevent even signing-key generation', async ({
  browser,
}) => {
  for (const mode of ['exclude', 'dnt', 'gpc', 'storage', 'dashboard', 'local']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await productionSite(page);
    await page.addInitScript((mode) => {
      window.analyticsKeys = 0;
      crypto.subtle.generateKey = () => {
        window.analyticsKeys++;
        throw new Error('Unexpected signing');
      };
      if (mode === 'exclude') localStorage.setItem('jw-analytics-excluded', '1');
      if (mode === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
      if (mode === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
      if (mode === 'storage')
        Storage.prototype.getItem = () => {
          throw new Error('Unavailable');
        };
    }, mode);
    if (mode === 'local') await page.unroute('**/*');
    await page.goto(
      mode === 'local'
        ? 'http://127.0.0.1:4173/'
        : `https://jon.test/${mode === 'dashboard' ? 'analytics/' : ''}`,
    );
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => window.analyticsKeys)).toBe(0);
    await context.close();
  }
});

test('footer analytics links work and dashboard explains its JavaScript requirement', async ({
  page,
  browser,
}) => {
  await page.route(QUERY_URL, (route) => route.fulfill({ json: response([]) }));
  for (const path of ['/', '/career/']) {
    await page.goto(path);
    await page.locator('footer').getByRole('link', { name: 'Analytics', exact: true }).click();
    await expect(page).toHaveURL(/\/analytics\/$/);
  }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await context.newPage();
  await staticPage.goto('http://127.0.0.1:4173/analytics/');
  await expect(staticPage.locator('noscript p')).toBeVisible();
  await expect(staticPage.locator('noscript p')).toContainText('JavaScript is needed');
  await context.close();
});
