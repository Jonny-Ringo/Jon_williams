export const APP_NAME = 'Jon-Williams-Personal-Site-Analytics';
export const VERSION = '1';
export const UPLOAD_URL = 'https://up.arweave.net/tx';
export const QUERY_URL = 'https://arweave.net/graphql';
export const OPT_OUT_KEY = 'jw-analytics-excluded';
export const EVENTS = {
  page_view: 'Page views',
  project_open: 'Project details opened',
  resume_download: 'Resume download clicks',
  contact_click: 'Contact clicks',
  github_click: 'GitHub clicks',
};
export const TARGETS = {
  page_view: [''],
  project_open: ['auction', 'metrics', 'community'],
  resume_download: ['pdf'],
  contact_click: ['email', 'gmail', 'copy'],
  github_click: ['github'],
};
export function excluded() {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return true;
  }
}
export function privacyRequested() {
  return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
}
export function dateRange(days, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) =>
    new Date(end - (days - 1 - index) * 86400000).toISOString().slice(0, 10),
  );
}
export function parseEvent(node, dates, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(node?.id ?? '') || !Array.isArray(node.tags)) return null;
  const tags = Object.fromEntries(node.tags.map(({ name, value }) => [name, value]));
  const timestamp = Number(tags['Event-Time']);
  const event = tags['Event-Type'];
  if (
    tags['App-Name'] !== APP_NAME ||
    tags['App-Version'] !== VERSION ||
    !Object.hasOwn(EVENTS, event) ||
    !['home', 'career'].includes(tags.Page) ||
    !TARGETS[event].includes(tags.Target ?? '') ||
    !/^[a-f0-9]{32}$/.test(tags['Session-ID'] ?? '') ||
    !/^[a-f0-9]{32}$/.test(tags['Event-ID'] ?? '') ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    timestamp > now + 60000 ||
    !dates.includes(tags.Timestamp)
  )
    return null;
  if (new Date(timestamp).toISOString().slice(0, 10) !== tags.Timestamp) return null;
  return {
    id: node.id,
    eventId: tags['Event-ID'],
    sessionId: tags['Session-ID'],
    event,
    page: tags.Page,
    target: tags.Target ?? '',
    timestamp,
    date: tags.Timestamp,
  };
}
