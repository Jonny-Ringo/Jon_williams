import '@fontsource-variable/manrope';
import '../styles.css';
import '../themes.css';
import './dashboard.css';
import { EVENTS, OPT_OUT_KEY, excluded, privacyRequested, dateRange } from './shared.js';
import { loadAnalytics } from './cache.js';

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

let controller;
function mayPublishCache() {
  return (
    location.protocol === 'https:' &&
    !/^(localhost|127\.|\[?::1\]?)/.test(location.hostname) &&
    !location.hostname.endsWith('.localhost') &&
    !!crypto.subtle &&
    !excluded() &&
    !privacyRequested()
  );
}
async function load() {
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  const days = Number($('#analytics-range').value);
  const dates = dateRange(days);
  let renderedKey = '';
  const results = $('#analytics-results');
  results.hidden = true;
  results.setAttribute('aria-busy', 'true');
  $('#analytics-status').textContent = 'Checking local and public caches...';
  let storage;
  try {
    storage = localStorage;
  } catch {
    /* Continue without browser storage. */
  }
  try {
    await loadAnalytics({
      dates,
      signal: active.signal,
      storage,
      locks: navigator.locks,
      canPublish: mayPublishCache,
      onUpdate(state) {
        if (active.signal.aborted) return;
        if (state.covered) {
          const key = JSON.stringify(
            [...state.events].sort((a, b) => a.eventId.localeCompare(b.eventId)),
          );
          if (key !== renderedKey) {
            render(state.events, dates);
            renderedKey = key;
          }
          results.hidden = false;
        }
        const done = state.stage === 'ready' || state.stage === 'done';
        results.setAttribute('aria-busy', String(!done));
        let message;
        if (!done) {
          message = state.cacheUsed
            ? 'Showing cached activity while indexing new data and checking older records.'
            : 'Indexing public activity...';
          if (state.covered < state.total) message += ' Some dates are still loading.';
        } else if (!state.covered) {
          message =
            'Analytics could not be loaded. The data service may be unavailable or blocked. Try Refresh in a moment.';
        } else if (state.partial || state.failed) {
          message =
            'Partial results: some dates could not be fully checked. Cached activity is retained where available. Try Refresh or a shorter date range.';
        } else {
          message = state.events.length
            ? 'Updated ' +
              new Date().toLocaleTimeString() +
              '. Showing indexed activity for the last ' +
              days +
              ' days; recent visits may take time to appear.'
            : 'No indexed activity in this date range yet. Recent visits may take time to appear.';
        }
        if (state.published) message += ' Shared cache updated.';
        if (state.publishFailed)
          message +=
            ' Public cache publishing was unavailable; your loaded results are still usable.';
        $('#analytics-status').textContent = message;
      },
    });
  } catch {
    if (!active.signal.aborted)
      $('#analytics-status').textContent =
        'Analytics could not be loaded. Try Refresh in a moment.';
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
  const tooltip = document.createElement('div');
  tooltip.className = 'analytics-tooltip';
  tooltip.id = 'analytics-bar-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  $('#analytics-daily').replaceChildren();
  dates.forEach((date, index) => {
    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'analytics-bar';
    const label = `${date}: ${totals[index].toLocaleString()} page ${totals[index] === 1 ? 'view' : 'views'}`;
    bar.setAttribute('aria-label', label);
    const fill = document.createElement('span');
    fill.className = 'analytics-bar-fill';
    fill.style.height = `${(totals[index] / maximum) * 100}%`;
    fill.dataset.empty = String(totals[index] === 0);
    bar.append(fill);
    const show = () => {
      tooltip.textContent = label;
      tooltip.hidden = false;
      const center = bar.offsetLeft + bar.offsetWidth / 2;
      const half = tooltip.offsetWidth / 2;
      tooltip.style.left = `${Math.max(half, Math.min(chart.clientWidth - half, center))}px`;
    };
    bar.addEventListener('mouseenter', show);
    bar.addEventListener('focus', show);
    bar.addEventListener('click', show);
    bar.addEventListener('mouseleave', () => {
      if (document.activeElement !== bar) tooltip.hidden = true;
    });
    bar.addEventListener('blur', () => {
      tooltip.hidden = true;
    });
    bar.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') tooltip.hidden = true;
    });
    bars.append(bar);
    const row = document.createElement('tr');
    cell(row, date);
    cell(row, String(totals[index]));
    $('#analytics-daily').append(row);
  });
  chart.append(bars, tooltip);
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
