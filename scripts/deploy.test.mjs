import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import Arweave from 'arweave';
import { ArweaveSigner, createData } from 'arbundles';
import { chromium } from '@playwright/test';
import {
  PAYLOAD_LIMIT,
  SIGNED_LIMIT,
  UPLOAD_URL,
  collectFiles,
  fitFreeSize,
  createManifest,
  prepareDeployment,
  uploadSigned,
} from '../deploy-personal-site.mjs';

const root = path.resolve(import.meta.dirname, '..');
const digest = (data) => createHash('sha256').update(data).digest('base64url');

test('deployment keeps every public build asset, fits signed limits, and preserves original files', async () => {
  const before = await collectFiles(path.join(root, 'dist'));
  const { files, stage } = await prepareDeployment();
  const signer = new ArweaveSigner(await Arweave.init({}).wallets.generate());
  assert.equal(files.length, before.length);
  for (const file of files) {
    assert.equal(file.name.split('/').map(encodeURIComponent).join('/'), file.name);
    assert.ok(file.data.length <= PAYLOAD_LIMIT, file.name);
    assert.equal(
      digest(await readFile(path.join(root, 'dist', file.name))),
      digest(before.find((entry) => entry.name === file.name).data),
    );
    assert.equal(digest(await readFile(path.join(stage, file.name))), digest(file.data));
    const item = createData(file.data, signer, {
      tags: [
        { name: 'Content-Type', value: file.contentType },
        { name: 'File-Path', value: file.name },
      ],
    });
    await item.sign(signer);
    assert.ok(item.getRaw().length <= SIGNED_LIMIT, file.name);
    assert.equal(await item.isValid(), true);
  }
  const paths = Object.fromEntries(files.map((file) => [file.name, { id: digest(file.data) }]));
  const manifest = createManifest(paths);
  assert.deepEqual(manifest.paths['career/'], manifest.paths['career/index.html']);
  assert.deepEqual(manifest.paths['analytics/'], manifest.paths['analytics/index.html']);
  assert.equal(manifest.index.path, 'index.html');
  assert.ok(manifest.paths['jon-williams-resume.pdf']);
  assert.ok(!JSON.stringify(manifest).includes('wallet'));

  // Serve only exact manifest entries beneath a transaction-ID prefix, as on a gateway.
  const byId = new Map(files.map((file) => [digest(file.data), file]));
  const prefix = `/${'M'.repeat(43)}/`;
  const server = createServer((request, response) => {
    // Do not decode path keys: reproduce the live gateway's encoded-space mismatch.
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const key = pathname.startsWith(prefix)
      ? pathname.slice(prefix.length) || manifest.index.path
      : null;
    const file = byId.get(manifest.paths[key]?.id);
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': file.contentType });
    response.end(file.data);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage();
    await page.route('https://arweave.net/graphql', (route) =>
      route.fulfill({
        json: {
          data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } },
        },
      }),
    );
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(response.url());
    });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const route of [
        '',
        'career/',
        'career/index.html',
        'analytics/',
        'analytics/index.html',
      ]) {
        await page.goto(origin + prefix + route);
        for (const image of await page.locator('img').all()) {
          await image.scrollIntoViewIfNeeded();
          await image.evaluate((element) => element.decode());
        }
        assert.equal(await page.locator('h1').isVisible(), true);
      }
    }
    await page.goto(origin + prefix);
    await page.locator('[data-project="metrics"]').click();
    await page.locator('.dialog-preview img').evaluate((element) => element.decode());
    await page.keyboard.press('Escape');
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Career' })
      .click();
    assert.equal(new URL(page.url()).pathname, prefix + 'career/');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download resume (PDF)' }).click();
    assert.equal(await (await downloadEvent).failure(), null);
    assert.deepEqual(failures, []);
    await page.goto(origin + prefix);
    await page
      .locator('#story')
      .screenshot({ path: path.join(root, 'artifacts/deploy-story.png') });
    await page
      .locator('.project-grid')
      .screenshot({ path: path.join(root, 'artifacts/deploy-projects.png') });
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await noJs.newPage();
    await staticPage.goto(origin + prefix + 'career/');
    assert.equal(await staticPage.locator('#experience').isVisible(), true);
    assert.equal(await staticPage.locator('#ai').isVisible(), true);
    await noJs.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('oversized non-images and accidental private build files are rejected before upload', async () => {
  await assert.rejects(
    fitFreeSize({ name: 'assets/huge.js', data: Buffer.alloc(PAYLOAD_LIMIT + 1) }),
    /paid uploads are disabled/,
  );
  assert.throws(() => createManifest({}), /homepage, career page, and resume/);
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, 'artifacts/deploy-fixture-'));
  await writeFile(path.join(fixture, 'wallet.json'), '{}');
  await assert.rejects(collectFiles(fixture), /Unexpected build artifact/);
  const spacedFixture = await mkdtemp(path.join(root, 'artifacts/deploy-spaced-'));
  await writeFile(path.join(spacedFixture, 'AO Alien.png'), 'fixture');
  await assert.rejects(collectFiles(spacedFixture), /Unsafe manifest path/);
});

test('retry posts the same signed item only to up.arweave.net', async () => {
  const signer = new ArweaveSigner(await Arweave.init({}).wallets.generate());
  const item = createData('offline test', signer);
  await item.sign(signer);
  const requests = [];
  const receipt = await uploadSigned(item, {
    wait: async () => {},
    fetcher: async (url, options) => {
      requests.push({ url, ...options });
      return requests.length === 1
        ? new Response('temporarily unavailable', { status: 503 })
        : new Response(JSON.stringify({ id: item.id, winc: '0' }));
    },
  });
  assert.equal(receipt.id, item.id);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, UPLOAD_URL);
    assert.equal(request.url, 'https://up.arweave.net/tx');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.deepEqual(Object.keys(request.headers), ['content-type']);
    assert.deepEqual(request.body, item.getRaw());
  }
});

test('payment requests, oversized signed items, and bad receipts stop without fallback', async () => {
  const item = { id: 'A'.repeat(43), getRaw: () => Buffer.from('signed-fixture') };
  let requests = 0;
  await assert.rejects(
    uploadSigned(item, {
      fetcher: async () => {
        requests++;
        return new Response('Payment required', { status: 402 });
      },
    }),
    /No payment will be attempted/,
  );
  assert.equal(requests, 1);
  await assert.rejects(
    uploadSigned(
      { ...item, getRaw: () => Buffer.alloc(SIGNED_LIMIT + 1) },
      {
        fetcher: async () => {
          throw new Error('Must not send');
        },
      },
    ),
    /size limit/,
  );
  await assert.rejects(
    uploadSigned(item, {
      fetcher: async () => new Response(JSON.stringify({ id: 'B'.repeat(43) })),
    }),
    /mismatched transaction ID/,
  );
  await assert.rejects(
    uploadSigned(item, {
      fetcher: async () => new Response(JSON.stringify({ id: item.id, winc: '1' })),
    }),
    /nonzero charge/,
  );
});
