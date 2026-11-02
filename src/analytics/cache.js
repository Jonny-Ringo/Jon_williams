import { dateRange } from './shared.js';
import { DAY, digest, pack, windowsFor, readLocal, saveLocal } from './cache-format.js';
import { discoverCaches, indexEvents, readPublicCache, createPublisher } from './cache-network.js';

async function pool(items, work, concurrency = 2) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

// All network/storage dependencies can be replaced in tests. No uploads in tests
// or local previews; the production caller explicitly supplies its privacy gate.
export async function loadAnalytics({
  dates,
  signal,
  onUpdate,
  storage,
  fetcher = fetch,
  canPublish = () => false,
  locks,
  now = Date.now(),
  publish = createPublisher({ fetcher, canPublish }),
}) {
  const windows = windowsFor(dates, now);
  const states = readLocal(storage, windowsFor(dateRange(120, now), now), now);
  const verified = new Set(),
    failed = new Set(),
    partial = new Set();
  let cacheUsed = false,
    published = 0,
    publishFailed = 0;
  function emit(stage) {
    signal.throwIfAborted();
    const unique = new Map(),
      covered = new Set();
    for (const window of windows) {
      const entry = states.get(window.start);
      if (!entry) continue;
      for (const day of window.dates) if (dates.includes(day)) covered.add(day);
      for (const event of entry.events) {
        if (!dates.includes(event.date)) continue;
        const previous = unique.get(event.eventId);
        if (!previous || event.id < previous.id) unique.set(event.eventId, event);
      }
    }
    onUpdate({
      events: [...unique.values()],
      covered: covered.size,
      total: dates.length,
      stage,
      cacheUsed,
      partial: partial.size > 0,
      failed: failed.size > 0,
      published,
      publishFailed,
      verified: windows.every((window) => verified.has(window.start)),
    });
  }
  cacheUsed = windows.some((window) => states.has(window.start));
  if (cacheUsed) emit('local');

  async function refresh(group) {
    if (!group.length) return;
    try {
      const result = await indexEvents(
        [...new Set(group.flatMap((w) => w.dates))],
        signal,
        fetcher,
        now,
      );
      signal.throwIfAborted();
      for (const window of group) {
        const previous = states.get(window.start);
        let events = result.events.filter((event) => window.dates.includes(event.date));
        if (!result.complete) {
          partial.add(window.start);
          // Partial queries never erase a complete cached window or become publishable.
          const merged = new Map((previous?.events || []).map((event) => [event.eventId, event]));
          for (const event of events) merged.set(event.eventId, event);
          events = [...merged.values()];
        } else verified.add(window.start);
        states.set(window.start, {
          ...previous,
          events,
          complete: result.complete,
          previousComplete: result.complete
            ? undefined
            : previous?.complete
              ? previous
              : previous?.previousComplete,
          checkedAt: now,
          source: 'indexed',
        });
      }
      saveLocal(storage, states, now);
      emit('indexing');
    } catch (error) {
      if (signal.aborted) throw error;
      group.forEach((window) => failed.add(window.start));
      emit('indexing');
    }
  }

  // The current week always refreshes immediately, alongside public discovery.
  const tail = refresh(windows.filter((window) => !window.closed)).catch(() => {});
  const closed = windows.filter((window) => window.closed);
  try {
    const discovery = await discoverCaches(
      closed,
      AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      fetcher,
    );
    await pool(closed, async (window) => {
      for (const candidate of discovery.candidates.get(window.start) || []) {
        try {
          const cached = await readPublicCache(
            candidate,
            window,
            AbortSignal.any([signal, AbortSignal.timeout(8000)]),
            fetcher,
            now,
          );
          signal.throwIfAborted();
          const local = states.get(window.start);
          // A fresh local raw scan must not be replaced by an older public snapshot.
          if (!local || local.checkedAt < cached.createdAt) {
            states.set(window.start, {
              events: cached.events,
              checkedAt: cached.createdAt,
              complete: true,
              source: 'public',
            });
            cacheUsed = true;
            saveLocal(storage, states, now);
            emit('public');
          }
          break;
        } catch {
          if (signal.aborted) return;
        }
      }
    });
  } catch {
    /* Cache discovery failure falls back to original indexed records. */
  }
  await tail;
  signal.throwIfAborted();

  // Fill missing windows first. Then verify every cached week, including old
  // dates, so late indexing and corrections cannot remain hidden indefinitely.
  const missing = closed.filter((window) => !states.has(window.start));
  await refresh(missing);
  const existing = closed.filter((window) => !missing.includes(window));
  await pool(existing, (window) => refresh([window]));
  emit('ready');

  // Publishing follows rendering and only uses complete, freshly indexed weeks.
  for (const window of closed) {
    signal.throwIfAborted();
    if (!canPublish() || !verified.has(window.start)) continue;
    const entry = states.get(window.start);
    const hash = await digest(pack(entry.events));
    const publishWindow = async () => {
      signal.throwIfAborted();
      const local = readLocal(storage, [window], now).get(window.start);
      if (
        local?.publishedHash === hash &&
        local.publishedAt <= now &&
        now - local.publishedAt < DAY
      )
        return;
      // Recheck immediately before writing. Discovery failures are not absence.
      const latest = await discoverCaches([window], signal, fetcher);
      if (!latest.complete) return;
      const candidates = latest.candidates.get(window.start) || [];
      for (const candidate of candidates) {
        try {
          const snapshot = await readPublicCache(candidate, window, signal, fetcher, now);
          if (snapshot.hash === hash) return;
          break; // The newest usable snapshot differs; publish a revision.
        } catch {
          signal.throwIfAborted();
        }
      }
      // Do not manufacture weeks of empty history before tracking began.
      if (!entry.events.length && !candidates.length) return;
      const receipt = await publish(window, entry.events, signal, now);
      signal.throwIfAborted();
      entry.publishedHash = receipt.hash;
      entry.publishedAt = now;
      saveLocal(storage, states, now);
      published++;
    };
    try {
      if (locks)
        await locks.request(
          `jw-analytics-cache:${window.start}`,
          { ifAvailable: true },
          async (lock) => {
            if (lock) await publishWindow();
          },
        );
      else await publishWindow();
    } catch {
      if (signal.aborted) return;
      publishFailed++;
      break; // A rejected uploader must not be retried for every older window.
    }
  }
  emit('done');
}
