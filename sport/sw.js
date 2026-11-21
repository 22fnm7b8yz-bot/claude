// Service Worker: Offline-Cache, Erinnerungen im Hintergrund (Periodic Background Sync, wo verfügbar)
// und Antworten direkt aus der Benachrichtigung.
import { askState, status, toDateStr } from './lib.js';

const CACHE = 'sportampel-v1';
const DATA = 'sportampel-data';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lib.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
const STATE_URL = new URL('__state.json', self.registration.scope).href;
const INBOX_URL = new URL('__inbox.json', self.registration.scope).href;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
    })));
  }
});

async function readJson(url, fallback) {
  try {
    const res = await (await caches.open(DATA)).match(url);
    return res ? await res.json() : fallback;
  } catch { return fallback; }
}
async function writeJson(url, value) {
  const c = await caches.open(DATA);
  await c.put(url, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }));
}
async function pushInbox(item) {
  const list = await readJson(INBOX_URL, []);
  list.push(item);
  await writeJson(INBOX_URL, list);
}

async function checkAndNotify() {
  const state = await readJson(STATE_URL, null);
  if (!state || !state.settings?.notify) return;
  const now = new Date();
  // Prüfung auch gegen Antworten, die noch im Posteingang liegen
  const inbox = await readJson(INBOX_URL, []);
  for (const it of inbox) {
    if (it.answer) state.answers[it.date] = { answer: it.answer === 'later' ? 'planned' : 'skip', at: it.at };
    if (it.prompted) state.lastPromptAt = Math.max(state.lastPromptAt || 0, it.prompted);
  }
  if (askState(state, now) !== 'due') return;
  const windows = await self.clients.matchAll({ type: 'window' });
  if (windows.some((w) => w.visibilityState === 'visible')) return; // die offene App fragt selbst
  const st = status(state, toDateStr(now));
  await pushInbox({ prompted: now.getTime() });
  await self.registration.showNotification('🚦 Sport heute?', {
    body: st.days == null ? 'Hast du heute Sport gemacht oder machst du noch welchen?'
      : `${st.days} ${st.days === 1 ? 'Tag' : 'Tage'} seit dem letzten Training. Gemacht oder machst du noch?`,
    tag: 'sport-ask', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { date: toDateStr(now) },
    actions: [{ action: 'done', title: '✅ Gemacht' }, { action: 'later', title: '⏰ Mach ich noch' }, { action: 'skip', title: 'Heute nicht' }],
  });
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'sport-check') e.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;
  const date = e.notification.data?.date || toDateStr(new Date());
  e.waitUntil((async () => {
    if (action === 'later' || action === 'skip') {
      await pushInbox({ date, answer: action, at: Date.now() });
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach((w) => w.postMessage({ type: 'inbox' }));
      return;
    }
    const target = new URL(action === 'done' ? './?antwort=done#ampel' : './#ampel', self.registration.scope).href;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      if (action === 'done') win.postMessage({ type: 'answer', answer: 'done' });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
