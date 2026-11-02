import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { DataItem } from 'arbundles';
import { APP_NAME, VERSION, QUERY_URL, UPLOAD_URL } from '../src/analytics/shared.js';
import {
  CACHE_APP,
  windowsFor,
  LOCAL_KEY,
  pack,
  digest,
  cacheTags,
  CACHE_VERSION,
} from '../src/analytics/cache-format.js';
import { dateRange, parseEvent } from '../src/analytics/shared.js';

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
      const { variables } = route.request().postDataJSON();
      if (variables.tags[0].values[0] === CACHE_APP) return route.fulfill({ json: response([]) });
      requests++;
      expect(variables.tags[2].values.length).toBeGreaterThan(0);
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
    await expect(page.locator('#analytics-status')).toContainText('Updated');
    expect(requests).toBe(4); // Current week first, then uncovered completed weeks.
    await expect(page.locator('#analytics-recent tr')).toHaveCount(4);
    await expect(page.locator('#analytics-daily tr')).toHaveCount(30);
    const lastBar = page.locator('.analytics-bar').last();
    await lastBar.hover();
    await expect(page.getByRole('tooltip')).toContainText('2 page views');
    await lastBar.focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
    await page.locator('.analytics-bar').first().focus();
    await expect(page.getByRole('tooltip')).toContainText('0 page views');
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

function historicalRecord(index, date) {
  const item = record(index);
  item.node.tags.find((tag) => tag.name === 'Timestamp').value = date;
  item.node.tags.find((tag) => tag.name === 'Event-Time').value = String(
    Date.parse(`${date}T12:00:00Z`),
  );
  return item;
}

test('public history renders before reindexing, then local data survives an offline reload', async ({
  page,
}) => {
  const dates = dateRange(30);
  const window = windowsFor(dates)[1];
  const old = historicalRecord(11, window.dates[2]);
  const late = historicalRecord(12, window.dates[2]);
  const rows = pack([parseEvent(old.node, dates)]);
  const hash = await digest(rows);
  const manifestId = 'M'.repeat(43),
    partId = 'P'.repeat(43);
  const manifest = {
    version: CACHE_VERSION,
    source: APP_NAME,
    eventVersion: VERSION,
    start: window.start,
    end: window.end,
    createdAt: Date.now() - 1000,
    hash,
    count: 1,
    parts: [{ id: partId, hash }],
  };
  let release;
  const historicalGate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(`https://arweave.net/${manifestId}`, (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route(`https://arweave.net/${partId}`, (route) => route.fulfill({ json: rows }));
  await page.route(QUERY_URL, async (route) => {
    const { variables } = route.request().postDataJSON();
    if (variables.tags[0].values[0] === CACHE_APP)
      return route.fulfill({
        json: response([
          { cursor: 'cached', node: { id: manifestId, tags: cacheTags(window, 'manifest', hash) } },
        ]),
      });
    const requested = variables.tags.find((tag) => tag.name === 'Timestamp').values;
    if (requested.includes(window.dates[2])) {
      await historicalGate;
      return route.fulfill({ json: response([old, late]) });
    }
    return route.fulfill({ json: response([]) });
  });
  await page.goto('/analytics/');
  await expect(page.locator('[data-metric="views"]')).toHaveText('1');
  await expect(page.locator('#analytics-status')).toContainText('cached activity');
  release();
  await expect(page.locator('#analytics-status')).toContainText('Updated');
  await expect(page.locator('[data-metric="views"]')).toHaveText('2');
  const local = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), LOCAL_KEY);
  expect(local.windows.find((entry) => entry.start === window.start).events).toHaveLength(2);
  await page.unroute(QUERY_URL);
  await page.route(QUERY_URL, (route) => route.abort());
  await page.reload();
  await expect(page.locator('[data-metric="views"]')).toHaveText('2');
  await expect(page.locator('#analytics-status')).toContainText('Partial results');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole('button', { name: `${window.dates[2]}: 2 page views`, exact: true }).click();
  await expect(page.getByRole('tooltip')).toHaveText(`${window.dates[2]}: 2 page views`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator('.analytics-panel')
    .first()
    .screenshot({ path: 'artifacts/analytics-tooltip-mobile.png' });
});

test('live dashboard publishes signed shared snapshots but never visit events', async ({
  page,
}) => {
  test.setTimeout(60000);
  await productionSite(page);
  const dates = dateRange(30),
    window = windowsFor(dates)[1];
  const old = historicalRecord(20, window.dates[2]);
  const uploads = [];
  await page.route(QUERY_URL, (route) => {
    const { variables } = route.request().postDataJSON();
    if (variables.tags[0].values[0] === CACHE_APP) return route.fulfill({ json: response([]) });
    const requested = variables.tags.find((tag) => tag.name === 'Timestamp').values;
    return route.fulfill({ json: response(requested.includes(window.dates[2]) ? [old] : []) });
  });
  await page.route(UPLOAD_URL, async (route) => {
    const item = new DataItem(route.request().postDataBuffer());
    expect(await item.isValid()).toBe(true);
    expect(item.tags.find((tag) => tag.name === 'App-Name').value).toBe(CACHE_APP);
    uploads.push(item);
    await route.fulfill({ json: { id: item.id, winc: '0' } });
  });
  await page.goto('https://jon.test/analytics/');
  await expect(page.locator('#analytics-status')).toContainText('Shared cache updated.', {
    timeout: 30000,
  });
  expect(uploads).toHaveLength(2);
  expect(uploads[1].tags.find((tag) => tag.name === 'Cache-Kind').value).toBe('manifest');
  const manifest = JSON.parse(uploads[1].rawData.toString());
  expect(manifest.parts[0].id).toBe(uploads[0].id);
  await page.reload();
  await expect(page.locator('#analytics-status')).toContainText('Updated');
  await expect
    .poll(() => page.locator('#analytics-results').getAttribute('aria-busy'))
    .toBe('false');
  expect(uploads).toHaveLength(2);
});

test('privacy exclusions prevent cache signing even when completed history is publishable', async ({
  browser,
}) => {
  const dates = dateRange(30),
    window = windowsFor(dates)[1];
  const old = historicalRecord(30, window.dates[2]);
  for (const mode of ['exclude', 'dnt', 'gpc', 'storage']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await productionSite(page);
    await page.addInitScript((mode) => {
      window.cacheKeys = 0;
      crypto.subtle.generateKey = () => {
        window.cacheKeys++;
        throw new Error('Unexpected cache signing');
      };
      if (mode === 'exclude') localStorage.setItem('jw-analytics-excluded', '1');
      if (mode === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
      if (mode === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
      if (mode === 'storage')
        Storage.prototype.getItem = () => {
          throw new Error('Unavailable');
        };
    }, mode);
    await page.route(QUERY_URL, (route) => {
      const { variables } = route.request().postDataJSON();
      const requested = variables.tags.find((tag) => tag.name === 'Timestamp')?.values || [];
      return route.fulfill({ json: response(requested.includes(window.dates[2]) ? [old] : []) });
    });
    await page.goto('https://jon.test/analytics/');
    await expect(page.locator('#analytics-status')).toContainText('Updated');
    expect(await page.evaluate(() => window.cacheKeys)).toBe(0);
    await context.close();
  }
});
