import test from 'node:test';
import assert from 'node:assert/strict';
import { DataItem } from 'arbundles';
import { APP_NAME, VERSION, QUERY_URL, UPLOAD_URL, dateRange } from '../src/analytics/shared.js';
import {
  CACHE_APP,
  CACHE_VERSION,
  LOCAL_KEY,
  DAY,
  PAYLOAD_BYTES,
  windowsFor,
  digest,
  pack,
  splitEvents,
  cacheTags,
  readLocal,
  saveLocal,
} from '../src/analytics/cache-format.js';
import { readPublicCache, createPublisher, indexEvents } from '../src/analytics/cache-network.js';
import { loadAnalytics } from '../src/analytics/cache.js';

const now = Date.parse('2026-11-04T12:00:00Z');
const dates = dateRange(14, now);
const windows = windowsFor(dates, now);
const signal = () => new AbortController().signal;
const storage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
};
const event = (n, date) => ({
  id: String(n).padStart(43, 'A'),
  eventId: n.toString(16).padStart(32, '0'),
  sessionId: 'a'.repeat(32),
  event: 'page_view',
  page: 'home',
  target: '',
  date,
  timestamp: Date.parse(`${date}T12:00:00Z`),
});
const edge = (e) => ({
  cursor: e.id,
  node: {
    id: e.id,
    tags: Object.entries({
      'App-Name': APP_NAME,
      'App-Version': VERSION,
      'Event-ID': e.eventId,
      'Session-ID': e.sessionId,
      'Event-Type': e.event,
      Page: e.page,
      Target: e.target,
      'Event-Time': String(e.timestamp),
      Timestamp: e.date,
    }).map(([name, value]) => ({ name, value })),
  },
});
const response = (edges = [], more = false) =>
  Response.json({ data: { transactions: { edges, pageInfo: { hasNextPage: more } } } });
async function fixture(window, events, letter = 'M', createdAt = now - 1000) {
  const rows = pack(events),
    hash = await digest(rows),
    id = letter.repeat(43),
    partId = letter.toLowerCase().repeat(43);
  return {
    id,
    hash,
    window,
    rows,
    partId,
    manifest: {
      version: CACHE_VERSION,
      source: APP_NAME,
      eventVersion: VERSION,
      start: window.start,
      end: window.end,
      createdAt,
      hash,
      count: events.length,
      parts: rows.length ? [{ id: partId, hash }] : [],
    },
  };
}
function network({
  events = [],
  caches = [],
  unavailable = false,
  failedDates = [],
  calls = [],
} = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === QUERY_URL) {
      const { variables } = JSON.parse(options.body);
      const tags = Object.fromEntries(variables.tags.map((tag) => [tag.name, tag.values]));
      if (tags['App-Name'][0] === CACHE_APP) {
        if (unavailable) throw new Error('Discovery unavailable');
        return response(
          caches
            .filter((cache) => tags['Cache-Start'].includes(cache.window.start))
            .map((cache) => ({
              cursor: cache.id,
              node: { id: cache.id, tags: cacheTags(cache.window, 'manifest', cache.hash) },
            })),
        );
      }
      if (tags.Timestamp.some((date) => failedDates.includes(date)))
        throw new Error('Index unavailable');
      return response(events.filter((item) => tags.Timestamp.includes(item.date)).map(edge));
    }
    const cache = caches.find((item) => url.endsWith(item.id) || url.endsWith(item.partId));
    if (!cache) throw new Error(`Unexpected request ${url}`);
    return Response.json(url.endsWith(cache.id) ? cache.manifest : cache.rows);
  };
}

test('weekly UTC windows cover month/year boundaries and never close the current week', () => {
  assert.deepEqual(
    windows.map((w) => [w.start, w.end, w.closed]),
    [
      ['2026-10-19', '2026-10-25', true],
      ['2026-10-26', '2026-11-01', true],
      ['2026-11-02', '2026-11-08', false],
    ],
  );
  assert.equal(windows.at(-1).dates.at(-1), '2026-11-04');
  const crossYear = windowsFor(dateRange(7, Date.parse('2027-01-02')), Date.parse('2027-01-02'));
  assert.equal(crossYear.at(-1).start, '2026-12-28');
});

test('local cache renders before network and stale weeks gain late indexed events', async () => {
  const old = event(1, '2026-10-23'),
    late = event(2, '2026-10-23'),
    recent = event(3, '2026-11-03');
  const local = storage();
  saveLocal(
    local,
    new Map([[windows[0].start, { events: [old], complete: true, checkedAt: now - 2 * DAY }]]),
    now,
  );
  const cache = await fixture(windows[0], [old]);
  const states = [],
    published = [];
  await loadAnalytics({
    dates,
    now,
    signal: signal(),
    storage: local,
    fetcher: network({ events: [old, late, recent], caches: [cache] }),
    onUpdate: (state) => states.push(state),
    canPublish: () => true,
    publish: async (window, events) => {
      published.push({ window, events });
      return { hash: await digest(pack(events)) };
    },
  });
  assert.equal(states[0].stage, 'local');
  assert.equal(states[0].events.length, 1);
  assert.equal(states.at(-1).events.length, 3);
  assert.equal(states.at(-1).verified, true);
  assert.equal(published.length, 1);
  assert.equal(published[0].window.start, windows[0].start);
  assert.equal(published[0].events.length, 2);
  assert.equal(readLocal(local, windows, now).get(windows[0].start).events.length, 2);
});

test('a first-time visitor sees a public snapshot before historical reindexing completes', async () => {
  const old = event(1, '2026-10-23'),
    recent = event(2, '2026-11-03');
  const cache = await fixture(windows[0], [old]);
  const states = [],
    calls = [];
  const fetcher = network({ events: [old, recent], caches: [cache], calls });
  await loadAnalytics({
    dates,
    now,
    signal: signal(),
    storage: storage(),
    fetcher,
    onUpdate: (state) => {
      states.push(state);
      if (state.stage === 'public') {
        assert.equal(
          state.events.some((item) => item.eventId === old.eventId),
          true,
        );
        const rawDates = calls
          .filter((call) => call.url === QUERY_URL)
          .flatMap(
            (call) =>
              JSON.parse(call.options.body).variables.tags.find((tag) => tag.name === 'Timestamp')
                ?.values || [],
          );
        assert.equal(rawDates.includes(old.date), false);
      }
    },
  });
  assert.ok(states.some((state) => state.stage === 'public'));
  assert.equal(states.at(-1).events.length, 2);
});

test('unchanged public cache and recently accepted identical uploads do not republish', async () => {
  const old = event(1, '2026-10-23');
  const cache = await fixture(windows[0], [old]);
  let publishes = 0;
  const local = storage();
  const base = {
    dates,
    now,
    signal: signal(),
    storage: local,
    onUpdate() {},
    canPublish: () => true,
    publish: async (_window, events) => {
      publishes++;
      return { hash: await digest(pack(events)) };
    },
  };
  await loadAnalytics({ ...base, fetcher: network({ events: [old], caches: [cache] }) });
  assert.equal(publishes, 0);
  await loadAnalytics({ ...base, fetcher: network({ events: [old] }) });
  assert.equal(publishes, 1);
  await loadAnalytics({ ...base, fetcher: network({ events: [old] }) });
  assert.equal(publishes, 1);
});

test('failed discovery does not imply absence; failed indexing keeps cached data and never publishes', async () => {
  const old = event(1, '2026-10-23');
  const local = storage();
  saveLocal(
    local,
    new Map([[windows[0].start, { events: [old], complete: true, checkedAt: now - DAY }]]),
    now,
  );
  let published = 0,
    last;
  for (const config of [{ unavailable: true }, { failedDates: [old.date] }]) {
    await loadAnalytics({
      dates,
      now,
      signal: signal(),
      storage: local,
      fetcher: network({ events: [old], ...config }),
      onUpdate: (state) => {
        last = state;
      },
      canPublish: () => true,
      publish: async () => {
        published++;
      },
    });
    assert.equal(last.events.length, 1);
  }
  assert.equal(last.failed, true);
  assert.equal(published, 0);
});

test('corrupt public snapshots fall back to raw events; denied local storage is harmless', async () => {
  const old = event(1, '2026-10-23');
  const cache = await fixture(windows[0], [old]);
  cache.rows[0][4] = 'not-a-page';
  let last;
  const denied = {
    getItem() {
      throw new Error('Denied');
    },
    setItem() {
      throw new Error('Denied');
    },
  };
  await loadAnalytics({
    dates,
    now,
    signal: signal(),
    storage: denied,
    fetcher: network({ events: [old], caches: [cache] }),
    onUpdate: (state) => {
      last = state;
    },
  });
  assert.equal(last.events.length, 1);
  assert.equal(last.verified, true);
  assert.equal(last.cacheUsed, false);
});

test('public readers reject mismatched hashes, foreign namespaces and oversized payloads', async () => {
  const cache = await fixture(windows[0], [event(1, '2026-10-23')]);
  const fetcher = network({ caches: [cache] });
  await assert.rejects(
    readPublicCache({ ...cache, hash: '0'.repeat(64) }, windows[0], signal(), fetcher, now),
    /manifest/,
  );
  cache.manifest.source = 'other';
  await assert.rejects(readPublicCache(cache, windows[0], signal(), fetcher, now), /manifest/);
  await assert.rejects(
    readPublicCache(
      cache,
      windows[0],
      signal(),
      async () => new Response('x'.repeat(PAYLOAD_BYTES + 1)),
      now,
    ),
    /Oversized/,
  );
});

test('bounded pagination labels partial data and stalled cursors fail', async () => {
  const item = edge(event(1, '2026-10-23'));
  let requests = 0;
  const partial = await indexEvents(
    windows[0].dates,
    signal(),
    async () => response([{ ...item, cursor: String(requests++) }], true),
    now,
  );
  assert.equal(partial.complete, false);
  assert.equal(partial.events.length, 1);
  assert.equal(requests, 50);
  await assert.rejects(
    indexEvents(windows[0].dates, signal(), async () => response([item], true), now),
    /stalled/,
  );
});

test('cache publisher signs bounded shards before manifest and checks uploader receipts', async () => {
  const events = Array.from({ length: 800 }, (_, i) => event(i + 1, '2026-10-23'));
  const items = [];
  const publisher = createPublisher({
    canPublish: () => true,
    fetcher: async (url, options) => {
      assert.equal(url, UPLOAD_URL);
      assert.equal(options.redirect, 'error');
      const item = new DataItem(Buffer.from(options.body));
      assert.equal(await item.isValid(), true);
      assert.ok(item.getRaw().length < 100 * 1024);
      items.push(item);
      return Response.json({ id: item.id, winc: '0' });
    },
  });
  const receipt = await publisher(windows[0], events, signal(), now);
  assert.ok(items.length > 2);
  assert.equal(items.at(-1).tags.find((tag) => tag.name === 'Cache-Kind').value, 'manifest');
  const manifest = JSON.parse(items.at(-1).rawData.toString());
  assert.equal(manifest.count, 800);
  assert.equal(receipt.id, items.at(-1).id);
  assert.deepEqual(
    manifest.parts.map((part) => part.id),
    items.slice(0, -1).map((item) => item.id),
  );
  assert.ok(
    splitEvents(pack(events)).every(
      (chunk) => Buffer.byteLength(JSON.stringify(chunk)) <= PAYLOAD_BYTES,
    ),
  );
  const paid = createPublisher({
    canPublish: () => true,
    fetcher: async () => new Response('', { status: 402 }),
  });
  await assert.rejects(paid(windows[0], [events[0]], signal(), now), /402/);
  const disabled = createPublisher({ canPublish: () => false });
  await assert.rejects(disabled(windows[0], [events[0]], signal(), now), /disabled/);
  await assert.rejects(publisher(windows.at(-1), [], signal(), now), /Open windows/);
});

test('aborted range loads cannot emit results or publish', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    loadAnalytics({
      dates,
      now,
      signal: controller.signal,
      storage: storage(),
      fetcher: async () => {
        throw new Error('Must not fetch');
      },
      onUpdate() {
        assert.fail('Stale render');
      },
    }),
    /abort/i,
  );
});

test('partial historical scans do not overwrite a complete local snapshot or publish it', async () => {
  const old = event(1, '2026-10-23');
  const local = storage();
  saveLocal(
    local,
    new Map([[windows[0].start, { events: [old], complete: true, checkedAt: now - DAY }]]),
    now,
  );
  let pages = 0,
    last,
    published = 0;
  const original = network();
  const fetcher = async (url, options) => {
    const tags = JSON.parse(options.body).variables.tags;
    if (tags.find((tag) => tag.name === 'Timestamp')?.values.includes(old.date)) {
      return response([{ ...edge(event(2, old.date)), cursor: String(pages++) }], true);
    }
    return original(url, options);
  };
  await loadAnalytics({
    dates,
    now,
    signal: signal(),
    storage: local,
    fetcher,
    onUpdate: (state) => {
      last = state;
    },
    canPublish: () => true,
    publish: async () => {
      published++;
    },
  });
  assert.equal(last.partial, true);
  assert.equal(last.events.length, 2);
  assert.equal(published, 0);
  assert.deepEqual(readLocal(local, windows, now).get(windows[0].start).events, [old]);
});

test('an occupied browser lock prevents concurrent publication', async () => {
  let publishes = 0,
    locks = 0;
  await loadAnalytics({
    dates,
    now,
    signal: signal(),
    storage: storage(),
    fetcher: network({ events: [event(1, '2026-10-23')] }),
    onUpdate() {},
    canPublish: () => true,
    locks: {
      async request(_name, _options, callback) {
        locks++;
        await callback(null);
      },
    },
    publish: async () => {
      publishes++;
    },
  });
  assert.ok(locks > 0);
  assert.equal(publishes, 0);
});

test('public cache reads support transaction-isolated gateway redirects', async () => {
  const cache = await fixture(windows[0], [event(1, '2026-10-23')]);
  const original = network({ caches: [cache] });
  const redirected = async (url, options) => {
    assert.equal(options.redirect, 'follow');
    const response = await original(url, options);
    Object.defineProperty(response, 'url', {
      value: url.replace('arweave.net', 'sandbox.arweave.net'),
    });
    return response;
  };
  assert.equal(
    (await readPublicCache(cache, windows[0], signal(), redirected, now)).events.length,
    1,
  );
});

function stallUntilAborted(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('recent caches load first and stalled downloads cannot delay complete raw history', async () => {
  const range = dateRange(30, now);
  const closed = windowsFor(range, now).filter((w) => w.closed);
  const events = closed.map((w, i) => event(i + 1, w.end));
  const caches = await Promise.all(
    closed.map((w, i) => fixture(w, [events[i]], String.fromCharCode(65 + i))),
  );
  const original = network({ events, caches });
  const downloads = [],
    states = [];
  let aborted = 0;
  await loadAnalytics({
    dates: range,
    now,
    signal: AbortSignal.timeout(3000),
    storage: storage(),
    fetcher: async (url, options) => {
      if (url !== QUERY_URL) {
        downloads.push(url);
        try {
          return await stallUntilAborted(options.signal);
        } finally {
          aborted++;
        }
      }
      return original(url, options);
    },
    onUpdate: (state) => states.push(state),
  });
  assert.deepEqual(
    downloads.slice(0, 3),
    caches
      .slice(-3)
      .reverse()
      .map((c) => `https://arweave.net/${c.id}`),
  );
  assert.ok(aborted >= 3);
  assert.equal(states.at(-1).events.length, events.length);
  assert.equal(states.at(-1).verified, true);
  assert.equal(states.at(-1).failed, false);
});

test('stalled discovery and current-week indexing do not block historical results', async () => {
  const old = event(1, '2026-10-23');
  const original = network({ events: [old] });
  let releaseTail;
  const tailGate = new Promise((resolve) => {
    releaseTail = resolve;
  });
  let historyRendered = false;
  await loadAnalytics({
    dates,
    now,
    signal: AbortSignal.timeout(3000),
    storage: storage(),
    fetcher: async (url, options) => {
      const tags = JSON.parse(options.body).variables.tags;
      if (tags[0].values[0] === CACHE_APP) return stallUntilAborted(options.signal);
      if (tags.find((t) => t.name === 'Timestamp').values.includes('2026-11-04')) await tailGate;
      return original(url, options);
    },
    onUpdate: (state) => {
      if (state.events.some((e) => e.eventId === old.eventId)) {
        historyRendered = true;
        releaseTail();
      }
    },
  });
  assert.equal(historyRendered, true);
});

test('a late public snapshot cannot resurrect events removed by a complete raw scan', async () => {
  const old = event(1, '2026-10-23');
  const cache = await fixture(windows[0], [old], 'M', now + 500);
  const original = network({ caches: [cache] });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const states = [];
  await loadAnalytics({
    dates,
    now,
    signal: AbortSignal.timeout(3000),
    storage: storage(),
    fetcher: async (url, options) => {
      // Simulate a response already completing as its cancellation arrives.
      if (url !== QUERY_URL) await gate;
      return original(url, options);
    },
    onUpdate: (state) => {
      states.push(state);
      if (state.verified) release();
    },
  });
  assert.equal(states.at(-1).verified, true);
  assert.ok(states.every((state) => state.events.length === 0));
});

test('a cache arriving after a partial raw scan retains both sets of events without publishing', async () => {
  const old = event(1, '2026-10-23'),
    late = event(2, '2026-10-23');
  const cache = await fixture(windows[0], [old]);
  const original = network({ caches: [cache] });
  const local = storage();
  let release,
    pages = 0,
    last;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await loadAnalytics({
    dates,
    now,
    signal: AbortSignal.timeout(3000),
    storage: local,
    fetcher: async (url, options) => {
      if (url !== QUERY_URL) await gate;
      else {
        const tags = JSON.parse(options.body).variables.tags;
        if (tags.find((t) => t.name === 'Timestamp')?.values.includes(old.date))
          return response([{ ...edge(late), cursor: String(pages++) }], true);
      }
      return original(url, options);
    },
    onUpdate: (state) => {
      last = state;
      if (state.partial) release();
    },
    canPublish: () => true,
    publish: async () => assert.fail('A partial scan cannot publish'),
  });
  assert.equal(last.partial, true);
  assert.equal(last.events.length, 2);
  assert.deepEqual(readLocal(local, windows, now).get(windows[0].start).events, [old]);
});
