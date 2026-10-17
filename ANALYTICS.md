# Site analytics

The footer links to `analytics/`. The dashboard reads publicly indexed Arweave
transactions for the fixed `Jon-Williams-Personal-Site-Analytics` namespace. This
keeps reporting continuous across new deployment transaction IDs. It has no
login: the records and dashboard are public, and the records are permanent.

Deploy as usual with `npm run deploy`. No separate service setup, funded visitor
wallet, secret, or analytics account is needed. Uploads use only
`https://up.arweave.net/tx`; reads use `https://arweave.net/graphql`. The deploy
manifest includes the analytics route. `npm run deploy:check` checks asset sizes
without uploading. No historical visits can be recovered from before tracking
was installed. Indexing is asynchronous, so newly accepted events may not appear
immediately; this is not a realtime monitor.

## What is counted

- Home and career page views.
- Approximate sessions: a random ID in sessionStorage, expiring after 30 minutes
  of inactivity or when its tab closes. Separate tabs can count separately;
  sessions are not unique people.
- Project-detail opens, resume download-link clicks, contact-button clicks
  (mailto and copy), and GitHub-link clicks. Clicks do not confirm completion.
  Historical Gmail-button events remain readable by the dashboard.

Records contain only these fixed event/page/target values, a timestamp, a random
event ID, and the session ID. No email, IP, referrer, raw URL, query string, user
agent, or form contents are put in the records. Network providers necessarily
receive connection information. The dashboard explains this collection and has
an “Exclude my visits” option (localStorage, per browser and origin). Do Not
Track and Global Privacy Control disable tracking. Unavailable browser storage,
HTTP, localhost/127.0.0.1/::1 previews, and the dashboard itself also disable it.
New gateway origins have separate storage/preferences.

## Implementation and limits

`src/analytics/tracker.js` observes clicks without preventing navigation and
submits small signed ANS-104 items in the background. Native Web Crypto generates
one ephemeral, non-extractable RSA-PSS signing key per document; it is never the
deployment wallet and holds no funds. The narrow binary encoder is checked
against arbundles (including signature verification). It avoids adding a large
wallet library to every visit, keeping deploy artifacts below the free upload
limit. The private key disappears when the document closes.

Delivery is best effort: signing may not finish before a quick exit, requests
can be blocked/rejected, and there are no persistent queues or paid fallbacks.
Repeated identical clicks within one second are ignored; a document sends at
most 30 events. Failures do not block site features. Service pricing/availability
is outside the site’s control; it never supplies payment credentials.

The dashboard queries 100 records per page, paginates up to 5,000 records, filters
the requested UTC dates, validates fields, and deduplicates event IDs. The UI
labels truncated results and suggests a shorter range. Errors are shown as
errors, not zero visits. Tags are public and others can submit matching events,
so counts are not authenticated or suitable for billing/audited reporting.

## Checks

`npm run build`, `npm run test:analytics`, `npm test`, `npm run test:deploy`.
Tests verify ANS-104 signatures, payload boundaries, dashboard counts/pagination,
empty/error states, privacy exclusions, and mobile/dark accessibility. Browser
uploads and GraphQL responses are mocked; tests never publish analytics events.
