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

// Let a fast public cache paint first, without making indexing wait for a
// stalled gateway. Clear the timer/listener whichever path finishes first.
function cacheHeadStart(task, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    };
    const aborted = () => finish(signal.reason);
    const timer = setTimeout(() => finish(), 750);
    signal.addEventListener('abort', aborted, { once: true });
    task.then(() => finish(), finish);
  });
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
  signal.throwIfAborted();
  const windows = windowsFor(dates, now);
  const closed = windows.filter((window) => window.closed).reverse();
  const cacheStop = new AbortController();
  const cacheReads = new Map(closed.map((window) => [window.start, new AbortController()]));
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
        } else {
          verified.add(window.start);
          // A complete raw scan wins over any cache still in flight.
          cacheReads.get(window.start)?.abort();
        }
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
      if (closed.every((window) => verified.has(window.start))) cacheStop.abort();
    } catch (error) {
      if (signal.aborted) throw error;
      group.forEach((window) => failed.add(window.start));
      emit('indexing');
    }
  }

  // The current week always refreshes immediately, alongside public discovery.
  const tail = refresh(windows.filter((window) => !window.closed)).catch(() => {});
  const publicTask = (async () => {
    try {
      const discovery = await discoverCaches(
        closed,
        AbortSignal.any([signal, cacheStop.signal, AbortSignal.timeout(5000)]),
        fetcher,
      );
      await pool(
        closed,
        async (window) => {
          if (verified.has(window.start) || signal.aborted || cacheStop.signal.aborted) return;
          const cacheSignal = AbortSignal.any([
            signal,
            cacheStop.signal,
            cacheReads.get(window.start).signal,
            AbortSignal.timeout(8000),
          ]);
          for (const candidate of discovery.candidates.get(window.start) || []) {
            try {
              const cached = await readPublicCache(candidate, window, cacheSignal, fetcher, now);
              signal.throwIfAborted();
              if (verified.has(window.start) || cacheSignal.aborted) return;
              const local = states.get(window.start);
              const baseline = local?.complete ? local : local?.previousComplete;
              if (!baseline || baseline.checkedAt < cached.createdAt) {
                const snapshot = {
                  events: cached.events,
                  checkedAt: cached.createdAt,
                  complete: true,
                  source: 'public',
                };
                // A partial raw scan may finish before the cache. Retain its new
                // events, but only persist the complete snapshot as the fallback.
                if (local && !local.complete) {
                  const merged = new Map(cached.events.map((event) => [event.eventId, event]));
                  for (const event of local.events) merged.set(event.eventId, event);
                  states.set(window.start, {
                    ...local,
                    events: [...merged.values()],
                    previousComplete: snapshot,
                  });
                } else states.set(window.start, snapshot);
                cacheUsed = true;
                saveLocal(storage, states, now);
                emit('public');
              }
              break;
            } catch {
              if (cacheSignal.aborted) return;
            }
          }
        },
        3,
      );
    } catch {
      /* Cache discovery failure falls back to original indexed records. */
    }
  })();

  await cacheHeadStart(publicTask, signal);
  // Fill missing weeks first, newest first within each group. Raw scans run
  // independently of cache downloads and the current week's query.
  const history = [
    ...closed.filter((window) => !states.has(window.start)),
    ...closed.filter((window) => states.has(window.start)),
  ];
  try {
    await Promise.all([tail, pool(history, (window) => refresh([window])), publicTask]);
  } finally {
    cacheStop.abort();
  }
  signal.throwIfAborted();
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
