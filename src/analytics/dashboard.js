import '@fontsource-variable/manrope';
import '../styles.css';
import '../themes.css';
import './dashboard.css';
import {
  APP_NAME,
  VERSION,
  QUERY_URL,
  EVENTS,
  OPT_OUT_KEY,
  excluded,
  privacyRequested,
  dateRange,
  parseEvent,
} from './shared.js';

const $ = (selector) => document.querySelector(selector);
document.querySelectorAll('[data-year]').forEach((element) => {
  element.textContent = new Date().getFullYear();
});
const preference = $('#analytics-exclude');
preference.disabled = false;
$('#analytics-controls').hidden = false;
preference.checked = excluded();
function preferenceMessage() {
  $('#analytics-preference').textContent = privacyRequested()
    ? 'Your browser’s privacy signal already excludes your visits.'
    : preference.checked
      ? 'Your visits are excluded on this site origin in this browser.'
      : 'Your visits can be counted. This dashboard is always excluded.';
}
preferenceMessage();
preference.addEventListener('change', () => {
  try {
    localStorage.setItem(OPT_OUT_KEY, preference.checked ? '1' : '0');
    preferenceMessage();
  } catch {
    preference.checked = true;
    $('#analytics-preference').textContent =
      'Browser storage is unavailable; tracking stays disabled.';
  }
});

const query = `query SiteActivity($tags: [TagFilter!], $after: String) {
  transactions(tags: $tags, first: 100, after: $after, sort: HEIGHT_DESC) {
    pageInfo { hasNextPage }
    edges { cursor node { id tags { name value } } }
  }
}`;
let controller;
async function load() {
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  const days = Number($('#analytics-range').value);
  const dates = dateRange(days);
  const results = $('#analytics-results');
  results.hidden = true;
  results.setAttribute('aria-busy', 'true');
  $('#analytics-status').textContent = 'Loading public records from Arweave…';
  try {
    const events = [];
    const seen = new Set();
    const cursors = new Set();
    let after;
    let more = false;
    // Bound network work. Clearly label a partial result rather than silently
    // treating the first GraphQL page as the entire reporting period.
    for (let page = 0; page < 50; page++) {
      const response = await fetch(QUERY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(20000)]),
        body: JSON.stringify({
          query,
          variables: {
            after,
            tags: [
              { name: 'App-Name', values: [APP_NAME] },
              { name: 'App-Version', values: [VERSION] },
              { name: 'Timestamp', values: dates },
            ],
          },
        }),
      });
      if (!response.ok) throw new Error('Query unavailable');
      const data = await response.json();
      const connection = data.data?.transactions;
      if (
        data.errors?.length ||
        !Array.isArray(connection?.edges) ||
        typeof connection.pageInfo?.hasNextPage !== 'boolean'
      )
        throw new Error('Invalid query response');
      for (const edge of connection.edges) {
        const event = parseEvent(edge.node, dates);
        if (event && !seen.has(event.eventId)) {
          events.push(event);
          seen.add(event.eventId);
        }
      }
      more = connection.pageInfo.hasNextPage;
      if (!more) break;
      const next = connection.edges.at(-1)?.cursor;
      if (!next || cursors.has(next)) throw new Error('Pagination stalled');
      cursors.add(next);
      after = next;
      $('#analytics-status').textContent =
        `Reading records… ${events.length.toLocaleString()} events found.`;
    }
    if (active.signal.aborted) return;
    render(events, dates);
    results.hidden = false;
    $('#analytics-status').textContent = more
      ? 'Partial results: the query reached 5,000 records. Choose a shorter date range for a more complete view.'
      : events.length
        ? `Updated ${new Date().toLocaleTimeString()}. Showing indexed activity for the last ${days} days; recent visits may take time to appear.`
        : 'No indexed activity in this date range yet. Tracking begins after deployment; recent visits may take time to appear.';
  } catch {
    if (active.signal.aborted) return;
    $('#analytics-status').textContent =
      'Analytics could not be loaded. The data service may be unavailable or blocked. Try Refresh in a moment.';
  } finally {
    if (!active.signal.aborted) results.setAttribute('aria-busy', 'false');
  }
}
function cell(row, value) {
  const element = document.createElement('td');
  element.textContent = value;
  row.append(element);
}
function list(selector, entries) {
  const element = $(selector);
  element.replaceChildren();
  for (const [label, count] of entries) {
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = count.toLocaleString();
    element.append(term, value);
  }
}
function render(events, dates) {
  const count = (type) => events.filter((event) => event.event === type).length;
  const views = events.filter((event) => event.event === 'page_view');
  const metrics = {
    views: views.length,
    sessions: new Set(events.map((event) => event.sessionId)).size,
    resume: count('resume_download'),
    contact: count('contact_click'),
  };
  for (const [name, value] of Object.entries(metrics))
    $(`[data-metric="${name}"]`).textContent = value.toLocaleString();
  list(
    '#analytics-pages',
    ['home', 'career'].map((page) => [
      page === 'home' ? 'Home' : 'Career',
      views.filter((event) => event.page === page).length,
    ]),
  );
  list(
    '#analytics-events',
    Object.entries(EVENTS)
      .filter(([key]) => key !== 'page_view')
      .map(([key, label]) => [label, count(key)]),
  );
  const totals = dates.map((date) => views.filter((event) => event.date === date).length);
  const maximum = Math.max(1, ...totals);
  const chart = $('#analytics-chart');
  chart.replaceChildren();
  const bars = document.createElement('div');
  bars.className = 'analytics-bars';
  bars.setAttribute('aria-hidden', 'true');
  $('#analytics-daily').replaceChildren();
  dates.forEach((date, index) => {
    const bar = document.createElement('span');
    bar.style.height = `${(totals[index] / maximum) * 100}%`;
    bar.title = `${date}: ${totals[index]} page views`;
    bars.append(bar);
    const row = document.createElement('tr');
    cell(row, date);
    cell(row, String(totals[index]));
    $('#analytics-daily').append(row);
  });
  chart.append(bars);
  const labels = document.createElement('p');
  labels.className = 'analytics-chart-labels';
  for (const value of [dates[0], `Peak: ${Math.max(...totals)} views/day`, dates.at(-1)]) {
    const label = document.createElement('span');
    label.textContent = value;
    labels.append(label);
  }
  chart.append(labels);
  const recent = $('#analytics-recent');
  recent.replaceChildren();
  for (const event of events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)) {
    const row = document.createElement('tr');
    cell(row, new Date(event.timestamp).toISOString().replace('T', ' ').slice(0, 19));
    cell(row, event.page === 'home' ? 'Home' : 'Career');
    cell(row, EVENTS[event.event]);
    recent.append(row);
  }
  if (!events.length) {
    const row = document.createElement('tr');
    cell(row, 'No recorded activity yet.');
    row.firstChild.colSpan = 3;
    recent.append(row);
  }
}
$('#analytics-controls').addEventListener('submit', (event) => {
  event.preventDefault();
  load();
});
$('#analytics-range').addEventListener('change', load);
load();
