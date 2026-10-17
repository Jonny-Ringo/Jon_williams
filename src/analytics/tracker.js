import {
  APP_NAME,
  VERSION,
  UPLOAD_URL,
  EVENTS,
  TARGETS,
  excluded,
  privacyRequested,
} from './shared.js';
import { createSigner, signDataItem } from './data-item.js';

const SESSION_KEY = 'jw-analytics-session';
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
const localHost = (host) =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '[::1]' ||
  host === '::1' ||
  /^127\./.test(host);
let signerPromise;
let pending = Promise.resolve();
let sent = 0;
let lastEvent = '';
let lastTime = 0;

export function startAnalytics() {
  const page = document.body.classList.contains('career-page') ? 'career' : 'home';
  if (
    document.body.classList.contains('analytics-page') ||
    localHost(location.hostname) ||
    location.protocol !== 'https:' ||
    !crypto.subtle ||
    privacyRequested() ||
    excluded()
  )
    return;

  function track(event, target = '') {
    if (
      excluded() ||
      privacyRequested() ||
      !Object.hasOwn(EVENTS, event) ||
      !TARGETS[event].includes(target) ||
      sent >= 30
    )
      return;
    const now = Date.now();
    if (lastEvent === `${event}:${target}` && now - lastTime < 1000) return;
    lastEvent = `${event}:${target}`;
    lastTime = now;
    let session;
    try {
      session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (
        !session ||
        !/^[a-f0-9]{32}$/.test(session.id) ||
        !Number.isFinite(session.last) ||
        now - session.last > 1800000 ||
        now < session.last
      ) {
        session = { id: randomId() };
      }
      session.last = now;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      return;
    }
    sent++;
    const payload = {
      event,
      eventId: randomId(),
      sessionId: session.id,
      timestamp: now,
      metadata: { page, target },
    };
    const tags = Object.entries({
      'App-Name': APP_NAME,
      'App-Version': VERSION,
      'Content-Type': 'application/json',
      'Event-Type': event,
      'Event-ID': payload.eventId,
      'Session-ID': session.id,
      Timestamp: new Date(now).toISOString().slice(0, 10),
      'Event-Time': String(now),
      Page: page,
      Target: target,
    }).map(([name, value]) => ({ name, value }));
    // Cache one unfunded, non-extractable signing key per document. Never use
    // the deploy wallet. Failures stay isolated from navigation and site UI.
    signerPromise ??= createSigner();
    pending = pending
      .then(async () => {
        const signer = await signerPromise;
        if (excluded() || privacyRequested()) return;
        const body = await signDataItem(payload, tags, signer);
        if (excluded() || privacyRequested()) return;
        await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
      })
      .catch(() => {});
  }
  track('page_view');
  document.addEventListener('click', (event) => {
    const element = event.target.closest('a, button');
    if (!element) return;
    if (element.dataset.project) track('project_open', element.dataset.project);
    else if (element.hasAttribute('data-resume-download')) track('resume_download', 'pdf');
    else if (element.hasAttribute('data-copy-email')) track('contact_click', 'copy');
    else if (element.matches('a')) {
      const url = new URL(element.href);
      if (url.protocol === 'mailto:') track('contact_click', 'email');
      else if (url.hostname === 'github.com') track('github_click', 'github');
    }
  });
}
