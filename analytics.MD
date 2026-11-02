# Site analytics and shared caching

The public dashboard at `analytics/` reads Arweave events in the fixed
`Jon-Williams-Personal-Site-Analytics` namespace. Reporting continues across
GitHub Pages and Arweave deployments. No login or funded visitor wallet is needed.

## Two cache layers

**Local:** Validated event records are kept in `localStorage` under
`jw-analytics-cache-v1`. Repeat visits can render before network requests finish.

**Public:** Live dashboards publish snapshots of completed seven-day UTC windows
to Arweave. Other visitors discover them by public GraphQL tags and fetch their
data directly from the gateway. Both layers copy already-public event fields.
They accelerate reporting without becoming an authoritative source of visits.

## Load, refresh, and correction flow

1. Abort any previous load when the date range changes or Refresh is clicked.
2. Validate local data and immediately display the selected cached dates.
3. In parallel, discover public snapshots and index the current unfinished week.
4. Request completed weeks from newest to oldest, with up to three public cache
   downloads running at once. Try the newest usable snapshot for each week.
   Preserve a more recently checked local snapshot instead of replacing it.
5. Give public discovery and downloads up to 750 ms to render first. If they
   finish sooner, start raw-history queries immediately. Otherwise, start those
   queries alongside the cache downloads without waiting for gateway timeouts
   or the current week's query.
6. Scan missing weeks first, then cached weeks, newest first within each group
   and two raw-history queries at a time. Render each result as it arrives.
   Every selected week is checked once, including old weeks, to catch late
   indexing and corrections. A complete raw scan cancels that week's pending
   cache download; late snapshots cannot overwrite its verified results.
7. Replace each window after its complete scan, update local storage, and render
   corrected counts. Deduplicate by event ID and count sessions across the whole
   range, rather than adding weekly session totals.
8. After rendering, publish missing or changed completed snapshots if permitted.
   A publishing failure does not discard the loaded results.

For example, if a public cache covers through Sunday the 28th and a visitor
arrives on Wednesday the 31st, cached history can appear while the dashboard
queries the 29th through the 31st. It then rechecks older days. A newly indexed
event for an older week produces a new snapshot version for that week.

The first visitor before any shared cache exists still needs to index records.
Once a live visitor publishes and the gateway indexes the manifest, other
visitors benefit. No background scheduler runs while the page is closed.

This prevents a slow older cache from holding up recent activity or the raw-data
fallback. Local data still renders immediately, and a fast public cache can
render before raw history finishes. The 750 ms head start is not a promise that
the full dashboard loads within that time; network speed and pagination still
affect completion. If a raw scan is partial or fails, public downloads remain
available as a fallback within their timeout. A late cache merges with partial
raw results for display, while only its complete snapshot is saved locally.

## Seven-day windows and versions

Windows are Monday through Sunday in UTC, anchored at 1970-01-05. All visitors
therefore use the same keys regardless of local timezone, requested range, or
deployment URL. A week becomes publishable only after all seven calendar days
have ended. The current week remains local and is always re-indexed.

The first/last requested dates can lie inside a window. Indexing fetches the
whole available window to create a reusable snapshot, but only selected dates
contribute to displayed counts. New empty weeks before tracking began are not
published. An existing week's revision can be empty after a successful scan.

Arweave snapshots are immutable. Changed canonical records produce a new hash
and a new version; old versions remain available. Readers choose the newest
usable candidate in gateway `HEIGHT_DESC` order, not by a publisher-controlled
timestamp. Older records are always rechecked on a later dashboard load.

Unchanged snapshots are not republished. Before uploading, the client queries
the public index again and compares validated payload hashes. A Web Lock prevents
concurrent same-origin tab publishing where supported. A locally remembered
accepted hash suppresses identical uploads for 24 hours while indexing catches
up; changed hashes remain eligible immediately. Separate visitors can still race
and publish identical snapshots. These duplicates never double-count events.

## Public cache protocol, version 1

Public caches use a separate namespace so they cannot count as analytics events.

| Tag              | Value                                        |
| ---------------- | -------------------------------------------- |
| `App-Name`       | `Jon-Williams-Personal-Site-Analytics-Cache` |
| `App-Version`    | `1`                                          |
| `Source-App`     | `Jon-Williams-Personal-Site-Analytics`       |
| `Source-Version` | `1`                                          |
| `Cache-Kind`     | `manifest` or `part`                         |
| `Cache-Start`    | Monday in `YYYY-MM-DD` format                |
| `Cache-End`      | Sunday in `YYYY-MM-DD` format                |
| `Cache-Hash`     | Lowercase SHA-256 hex of canonical JSON      |
| `Content-Type`   | `application/json`                           |

Use the Mondays covering the requested period in this discovery query:

```graphql
query SharedAnalytics($starts: [String!]!, $after: String) {
  transactions(
    first: 100
    after: $after
    sort: HEIGHT_DESC
    tags: [
      { name: "App-Name", values: ["Jon-Williams-Personal-Site-Analytics-Cache"] }
      { name: "App-Version", values: ["1"] }
      { name: "Cache-Kind", values: ["manifest"] }
      { name: "Cache-Start", values: $starts }
    ]
  ) {
    pageInfo {
      hasNextPage
    }
    edges {
      cursor
      node {
        id
        tags {
          name
          value
        }
      }
    }
  }
}
```

Fetch manifests and parts at `https://arweave.net/<transaction-id>`. A manifest
contains `version`, `source`, `eventVersion`, `start`, `end`, `createdAt` (Unix
milliseconds), `hash`, `count`, and `parts`, an array of `{ id, hash }` references.
Each part is a JSON array of event tuples:

```text
[transactionId, eventId, sessionId, eventType, page, target, timestampMilliseconds]
```

Dates are derived from timestamps in UTC. Records are schema-validated,
deduplicated, and sorted by event ID. For conflicting duplicate event IDs, the
lexicographically smaller transaction ID wins consistently. A part hash covers
`JSON.stringify(part)`. The full hash covers `JSON.stringify(allCanonicalTuples)`
and must equal the manifest's `Cache-Hash` tag. Counts must match. The manifest is
uploaded last, after all referenced parts are accepted.

## Bounds, failures, and trust

- Raw scans paginate 100 records at a time, up to 50 pages per week. Completed
  weeks are queried separately so each can render independently. Truncated scans are labeled
  partial and never published. Prior complete local snapshots survive partial scans.
- Discovery reads at most 500 manifests and tries up to three candidates per
  window. Corrupt or unavailable snapshots fall back to indexed events. Failed
  or truncated pre-upload discovery never counts as proof that a cache is absent.
- Payloads stay under 90 KiB and signed ANS-104 items under 100 KiB. Larger
  windows use multiple parts. Readers cap streamed bytes, part counts, and total
  records at 5,000 per window before accepting a snapshot.
- Initial discovery has a five-second deadline. Each week's initial cache reads
  share an eight-second budget across candidates. Neither deadline delays raw
  history beyond the 750 ms head start. Individual requests have a twenty-second
  timeout. Once all completed weeks are verified, redundant discovery is canceled.
- Local storage retains up to 120 days and drops oldest windows to fit a 3 MiB
  serialized budget. Denied storage, corrupt entries, and quota failures fall back
  to the network. Browser caches are separate for each origin.
- Failed scans retain cached results where possible and show a warning, never a
  false zero. A successful empty scan means no currently indexed matching events.
- Gateway indexing is asynchronous. Scans reflect the records exposed at that
  moment. This is not a realtime monitor or a transactionally consistent snapshot.
- Anyone can submit matching tags. Hashes verify content consistency, not publisher
  honesty. Cached counts are provisional until raw checks finish, and raw events
  are also unauthenticated. Do not use this system for billing or audited counts.

Queries use `https://arweave.net/graphql`. Uploads use only
`https://up.arweave.net/tx`, with a temporary non-extractable browser RSA-PSS key.
The deployment wallet is never used. Receipts must match the signed item's
calculated ID and must not report a nonzero charge. An uploader failure stops
publishing for that load. No payment credentials, paid retries, or alternative
paid endpoints are used. Service allowances can change or run out; publication
is best effort.

References: [Arweave GraphQL](https://gql-guide.arweave.net/) and
[Turbo upload allowances](https://docs.ar.io/build/upload/turbo-credits).

## Tracking and privacy

The tracker still records home/career views, project opens, resume link clicks,
contact clicks, and GitHub link clicks. Historical Gmail clicks remain readable.
Clicks do not confirm downloads or sent messages. Random session IDs expire
after 30 minutes of inactivity or when a tab closes. Separate tabs can count
separately; sessions are not unique people.

Events contain only fixed event/page/target values, timestamps, random event IDs,
and random session IDs. Caches repeat those fields plus public transaction IDs.
No names, emails, IPs, referrers, full URLs, queries, or user-agent strings are
included. Network providers still receive connection information.

The dashboard never records a visit. Cache publishing requires HTTPS, a non-local
origin, Web Crypto, available preference storage, no opt-out, and no Do Not Track
or Global Privacy Control signal. Preferences are rechecked before every upload.
Local previews can read but never publish. Local caching remains an optional
dashboard optimization even when publishing is disabled.

Clearing `jw-analytics-cache-v1` removes local copies, not Arweave records. Opt-out
uses the separate `jw-analytics-excluded` key. The tracker keeps its 8 KiB event
payload cap, 30-event document limit, and one-second repeated-click guard. Event
delivery remains best effort with no persistent queue.

## Chart tooltips

Every bar reveals its date and exact page-view count on hover, keyboard focus,
or tap, including zero-count days. Escape dismisses the tooltip. Buttons have
accessible labels, and the daily totals table remains available. Status-only
updates do not recreate bars or steal focus.

## Implementation and checks

- `cache-format.js`: UTC windows, canonical tuples, hashes, local storage.
- `cache-network.js`: queries, public validation, bounded signed uploads.
- `cache.js`: progressive loading, historical revalidation, publication coordination.
- `dashboard.js` / `dashboard.css`: status, counts, charts, tooltips.
- `shared.js`, `tracker.js`, `data-item.js`: event schema and signing.

The files above are in `src/analytics/`. Tests are in
`scripts/analytics-cache.test.mjs`, `scripts/analytics.test.mjs`, and
`tests/analytics.spec.js`.

Run `npm run test:analytics`, `npm run build`, `npm test`, and
`npm run test:deploy`. Test queries and uploads are intercepted. Tests never
publish events or caches. No new dependency or service setup is required.
Deployment includes the cache code, but local implementation and testing do not
seed public snapshots. Eligible live visitors do that after deployment.
