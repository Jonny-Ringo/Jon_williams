import { APP_NAME, VERSION, parseEvent } from './shared.js';

export const CACHE_APP = `${APP_NAME}-Cache`;
export const CACHE_VERSION = '1';
export const LOCAL_KEY = 'jw-analytics-cache-v1';
export const DAY = 86400000;
export const MAX_EVENTS = 5000;
export const PAYLOAD_BYTES = 90 * 1024;
export const ID = /^[A-Za-z0-9_-]{43}$/;
const MONDAY = Date.UTC(1970, 0, 5);
const iso = (time) => new Date(time).toISOString().slice(0, 10);
export const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

// Fixed Monday-Sunday windows let every browser discover the same cache keys.
export function windowsFor(dates, now = Date.now()) {
  const today = iso(now);
  return [
    ...new Set(
      dates.map((date) => {
        const time = Date.parse(`${date}T00:00:00Z`);
        return MONDAY + Math.floor((time - MONDAY) / (7 * DAY)) * 7 * DAY;
      }),
    ),
  ].map((start) => {
    const days = Array.from({ length: 7 }, (_, i) => iso(start + i * DAY));
    return {
      start: days[0],
      end: days[6],
      dates: days.filter((date) => date <= today),
      closed: days[6] < today,
    };
  });
}

export function normalizeEvents(events, dates, now = Date.now()) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS)
    throw new Error('Invalid cache event count');
  const unique = new Map();
  for (const entry of events) {
    if (!Array.isArray(entry) || entry.length !== 7) throw new Error('Invalid cache event');
    const [id, eventId, sessionId, event, page, target, timestamp] = entry;
    if (
      typeof timestamp !== 'number' ||
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      timestamp > now + 60000
    )
      throw new Error('Invalid cache time');
    if ([id, eventId, sessionId, event, page, target].some((value) => typeof value !== 'string'))
      throw new Error('Invalid cache fields');
    const tags = {
      'App-Name': APP_NAME,
      'App-Version': VERSION,
      'Event-ID': eventId,
      'Session-ID': sessionId,
      'Event-Type': event,
      Page: page,
      Target: target,
      'Event-Time': String(timestamp),
      Timestamp: iso(timestamp),
    };
    const valid = parseEvent(
      { id, tags: Object.entries(tags).map(([name, value]) => ({ name, value })) },
      dates,
      now,
    );
    if (!valid) throw new Error('Invalid cache event');
    const previous = unique.get(eventId);
    if (!previous || id < previous.id) unique.set(eventId, valid);
  }
  return [...unique.values()].sort((a, b) => a.eventId.localeCompare(b.eventId));
}
export const pack = (events) =>
  events.map(({ id, eventId, sessionId, event, page, target, timestamp }) => [
    id,
    eventId,
    sessionId,
    event,
    page,
    target,
    timestamp,
  ]);
export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function splitEvents(rows) {
  const chunks = [];
  let chunk = [];
  for (const row of rows) {
    if (byteLength([...chunk, row]) > PAYLOAD_BYTES) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(row);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
export function cacheTags(window, kind, hash) {
  return Object.entries({
    'App-Name': CACHE_APP,
    'App-Version': CACHE_VERSION,
    'Source-App': APP_NAME,
    'Source-Version': VERSION,
    'Cache-Kind': kind,
    'Cache-Start': window.start,
    'Cache-End': window.end,
    'Cache-Hash': hash,
    'Content-Type': 'application/json',
  }).map(([name, value]) => ({ name, value }));
}

export function readLocal(storage, windows, now = Date.now()) {
  const result = new Map();
  try {
    const raw = storage?.getItem(LOCAL_KEY);
    if (!raw || raw.length > 4 * 1024 * 1024) return result;
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION || !Array.isArray(data.windows)) return result;
    for (const window of windows) {
      const entry = data.windows.find((item) => item?.start === window.start);
      if (!entry || !Number.isFinite(entry.checkedAt) || entry.checkedAt > now + 60000) continue;
      try {
        const events = normalizeEvents(entry.events, window.dates, now);
        result.set(window.start, {
          events,
          checkedAt: entry.checkedAt,
          complete: true,
          source: 'local',
          publishedHash: /^[a-f0-9]{64}$/.test(entry.publishedHash) ? entry.publishedHash : '',
          publishedAt: Number.isFinite(entry.publishedAt) ? entry.publishedAt : 0,
        });
      } catch {
        /* A bad window must not discard other usable local windows. */
      }
    }
  } catch {
    /* Storage is an optional optimization. */
  }
  return result;
}
export function saveLocal(storage, states, now = Date.now()) {
  try {
    const windows = [...states]
      .map(([start, entry]) => [start, entry.complete ? entry : entry.previousComplete])
      .filter(([, entry]) => entry?.complete)
      .map(([start, entry]) => ({
        start,
        checkedAt: entry.checkedAt || now,
        events: pack(entry.events),
        publishedHash: entry.publishedHash || '',
        publishedAt: entry.publishedAt || 0,
      }))
      .sort((a, b) => b.start.localeCompare(a.start));
    while (windows.length && byteLength({ version: CACHE_VERSION, windows }) > 3 * 1024 * 1024)
      windows.pop();
    storage?.setItem(LOCAL_KEY, JSON.stringify({ version: CACHE_VERSION, windows }));
  } catch {
    /* Quotas and privacy modes must not stop the dashboard. */
  }
}
