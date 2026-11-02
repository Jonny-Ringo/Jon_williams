import { APP_NAME, VERSION, QUERY_URL, UPLOAD_URL, parseEvent } from './shared.js';
import { createSigner, signDataItem } from './data-item.js';
import {
  CACHE_APP,
  CACHE_VERSION,
  MAX_EVENTS,
  PAYLOAD_BYTES,
  ID,
  cacheTags,
  digest,
  normalizeEvents,
  pack,
  splitEvents,
} from './cache-format.js';

const query = `query SiteActivity($tags: [TagFilter!], $after: String) {
  transactions(tags: $tags, first: 100, after: $after, sort: HEIGHT_DESC) {
    pageInfo { hasNextPage }
    edges { cursor node { id tags { name value } } }
  }
}`;
const options = (signal) => ({
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
});

export async function queryRecords(tags, signal, fetcher = fetch, maxPages = 50) {
  const edges = [],
    cursors = new Set();
  let after;
  for (let page = 0; page < maxPages; page++) {
    signal.throwIfAborted();
    const response = await fetcher(QUERY_URL, {
      ...options(signal),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { tags, after } }),
    });
    if (!response.ok) throw new Error('Query unavailable');
    const data = await response.json();
    const connection = data.data?.transactions;
    if (
      data.errors?.length ||
      !Array.isArray(connection?.edges) ||
      connection.edges.length > 100 ||
      typeof connection.pageInfo?.hasNextPage !== 'boolean'
    )
      throw new Error('Invalid query response');
    edges.push(...connection.edges);
    if (!connection.pageInfo.hasNextPage) return { edges, complete: true };
    const next = connection.edges.at(-1)?.cursor;
    if (typeof next !== 'string' || !next || cursors.has(next))
      throw new Error('Pagination stalled');
    cursors.add(next);
    after = next;
  }
  return { edges, complete: false };
}

export async function indexEvents(dates, signal, fetcher = fetch, now = Date.now()) {
  const { edges, complete } = await queryRecords(
    [
      { name: 'App-Name', values: [APP_NAME] },
      { name: 'App-Version', values: [VERSION] },
      { name: 'Timestamp', values: dates },
    ],
    signal,
    fetcher,
  );
  const events = edges.map((edge) => parseEvent(edge?.node, dates, now)).filter(Boolean);
  return { events: normalizeEvents(pack(events), dates, now), complete };
}

export async function discoverCaches(windows, signal, fetcher = fetch) {
  if (!windows.length) return { candidates: new Map(), complete: true };
  const { edges, complete } = await queryRecords(
    [
      { name: 'App-Name', values: [CACHE_APP] },
      { name: 'App-Version', values: [CACHE_VERSION] },
      { name: 'Cache-Kind', values: ['manifest'] },
      { name: 'Cache-Start', values: windows.map((w) => w.start) },
    ],
    signal,
    fetcher,
    5,
  );
  const candidates = new Map(windows.map((w) => [w.start, []]));
  for (const { node } of edges) {
    if (
      !ID.test(node?.id) ||
      !Array.isArray(node.tags) ||
      node.tags.some((tag) => !tag || typeof tag.name !== 'string' || typeof tag.value !== 'string')
    )
      continue;
    const tags = Object.fromEntries(node.tags.map(({ name, value }) => [name, value]));
    const window = windows.find((w) => w.start === tags['Cache-Start']);
    if (
      !window ||
      tags['Cache-End'] !== window.end ||
      tags['App-Name'] !== CACHE_APP ||
      tags['App-Version'] !== CACHE_VERSION ||
      tags['Source-App'] !== APP_NAME ||
      tags['Source-Version'] !== VERSION ||
      tags['Cache-Kind'] !== 'manifest' ||
      !/^[a-f0-9]{64}$/.test(tags['Cache-Hash'])
    )
      continue;
    const list = candidates.get(window.start);
    if (list.length < 3 && !list.some((item) => item.id === node.id))
      list.push({ id: node.id, hash: tags['Cache-Hash'] });
  }
  return { candidates, complete };
}

async function readJSON(id, signal, fetcher) {
  if (!ID.test(id)) throw new Error('Invalid cache ID');
  const response = await fetcher(`https://arweave.net/${id}`, {
    ...options(signal),
    // Gateways may serve immutable payloads from transaction-isolated subdomains.
    redirect: 'follow',
  });
  if (!response.ok) throw new Error('Cache unavailable');
  if (response.url) {
    const url = new URL(response.url);
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'arweave.net' && !url.hostname.endsWith('.arweave.net'))
    )
      throw new Error('Unexpected cache gateway');
  }
  if (Number(response.headers.get('content-length')) > PAYLOAD_BYTES)
    throw new Error('Oversized cache');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > PAYLOAD_BYTES) throw new Error('Oversized cache');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function readPublicCache(
  candidate,
  window,
  signal,
  fetcher = fetch,
  now = Date.now(),
) {
  const manifest = await readJSON(candidate.id, signal, fetcher);
  if (
    manifest.version !== CACHE_VERSION ||
    manifest.source !== APP_NAME ||
    manifest.eventVersion !== VERSION ||
    manifest.start !== window.start ||
    manifest.end !== window.end ||
    manifest.hash !== candidate.hash ||
    !Number.isSafeInteger(manifest.createdAt) ||
    manifest.createdAt > now + 60000 ||
    manifest.createdAt < Date.parse(`${window.end}T00:00:00Z`) + 86400000 ||
    !Number.isInteger(manifest.count) ||
    manifest.count < 0 ||
    manifest.count > MAX_EVENTS ||
    !Array.isArray(manifest.parts) ||
    manifest.parts.length > 20
  )
    throw new Error('Invalid cache manifest');
  const rows = [];
  for (const part of manifest.parts) {
    if (!part || !ID.test(part.id) || !/^[a-f0-9]{64}$/.test(part.hash))
      throw new Error('Invalid cache part');
    const chunk = await readJSON(part.id, signal, fetcher);
    if (
      !Array.isArray(chunk) ||
      rows.length + chunk.length > MAX_EVENTS ||
      (await digest(chunk)) !== part.hash
    )
      throw new Error('Invalid cache part');
    rows.push(...chunk);
  }
  const events = normalizeEvents(rows, window.dates, now);
  if (
    events.length !== rows.length ||
    events.length !== manifest.count ||
    (await digest(pack(events))) !== manifest.hash
  )
    throw new Error('Invalid cache content hash');
  return { events, hash: manifest.hash, createdAt: manifest.createdAt };
}

export function createPublisher({ fetcher = fetch, canPublish = () => false } = {}) {
  let signerPromise;
  async function upload(payload, tags, signal) {
    signal.throwIfAborted();
    if (!canPublish()) throw new Error('Cache publishing disabled');
    signerPromise ??= createSigner();
    const bytes = await signDataItem(payload, tags, await signerPromise, PAYLOAD_BYTES);
    if (bytes.length > 100 * 1024) throw new Error('Signed cache too large');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice(2, 514)));
    const expectedId = btoa(String.fromCharCode(...hash))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    signal.throwIfAborted();
    if (!canPublish()) throw new Error('Cache publishing disabled');
    const response = await fetcher(UPLOAD_URL, {
      ...options(signal),
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Cache upload rejected (${response.status})`);
    const receipt = await response.json();
    if (receipt.id !== expectedId || (receipt.winc != null && String(receipt.winc) !== '0'))
      throw new Error('Invalid or paid cache receipt');
    return expectedId;
  }
  return async function publish(window, events, signal, now = Date.now()) {
    if (!window.closed) throw new Error('Open windows cannot be published');
    const rows = pack(normalizeEvents(pack(events), window.dates, now));
    const hash = await digest(rows);
    const parts = [];
    for (const chunk of splitEvents(rows)) {
      const partHash = await digest(chunk);
      parts.push({
        id: await upload(chunk, cacheTags(window, 'part', partHash), signal),
        hash: partHash,
      });
    }
    // Only expose a discoverable manifest once every referenced part is accepted.
    const manifest = {
      version: CACHE_VERSION,
      source: APP_NAME,
      eventVersion: VERSION,
      start: window.start,
      end: window.end,
      createdAt: now,
      hash,
      count: rows.length,
      parts,
    };
    const id = await upload(manifest, cacheTags(window, 'manifest', hash), signal);
    return { id, hash };
  };
}
