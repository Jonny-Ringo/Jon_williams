import test from 'node:test';
import assert from 'node:assert/strict';
import { DataItem } from 'arbundles';
import { createSigner, signDataItem } from '../src/analytics/data-item.js';
import { APP_NAME, VERSION, parseEvent, dateRange } from '../src/analytics/shared.js';

test('native browser encoder creates valid ANS-104 events accepted by arbundles', async () => {
  const signer = await createSigner();
  assert.equal(signer.key.extractable, false);
  for (const tags of [
    [],
    [
      { name: 'App-Name', value: APP_NAME },
      { name: 'Test', value: 'Resume — long value '.repeat(20) },
    ],
  ]) {
    const payload = { event: 'page_view', metadata: { page: 'home' } };
    const bytes = await signDataItem(payload, tags, signer);
    const item = new DataItem(Buffer.from(bytes));
    assert.equal(await item.isValid(), true);
    assert.deepEqual(item.tags, tags);
    assert.deepEqual(JSON.parse(item.rawData.toString()), payload);
    assert.ok(bytes.length < 100 * 1024);
    assert.equal(item.signatureType, 1);
    const corrupted = Buffer.from(bytes);
    corrupted[corrupted.length - 1] ^= 1;
    assert.equal(await new DataItem(corrupted).isValid(), false);
  }
});

test('query parsing validates namespace, dates, event types and anonymous identifiers', () => {
  const now = Date.parse('2026-09-08T18:00:00Z');
  const dates = dateRange(7, now);
  assert.deepEqual([dates[0], dates.at(-1), dates.length], ['2026-09-02', '2026-09-08', 7]);
  const tags = {
    'App-Name': APP_NAME,
    'App-Version': VERSION,
    'Event-Type': 'page_view',
    'Session-ID': 'a'.repeat(32),
    'Event-ID': 'b'.repeat(32),
    'Event-Time': String(now),
    Timestamp: '2026-09-08',
    Page: 'home',
    Target: '',
  };
  const node = (overrides = {}) => ({
    id: 'A'.repeat(43),
    tags: Object.entries({ ...tags, ...overrides }).map(([name, value]) => ({ name, value })),
  });
  assert.equal(parseEvent(node(), dates, now).event, 'page_view');
  for (const invalid of [
    { 'App-Name': 'other' },
    { 'Event-Time': 'Infinity' },
    { Page: '/?email=someone' },
    { 'Session-ID': 'name@example.com' },
    { 'Event-Type': '__proto__' },
    { Timestamp: '2026-09-01' },
    { 'Event-Time': String(now + 120000) },
    { Target: 'arbitrary text' },
  ]) {
    assert.equal(parseEvent(node(invalid), dates, now), null);
  }
});
