import {
  SPORTS, SPORT_BY_ID, emptyState, normalizeState, toDateStr, addDays, daysBetween, parseDate, uid,
  sortSessions, status, askState, isAskDay, nextSlotAfter, levelOnDay, periodRange, summarize, series,
  greenStreak, formatDate, formatMinutes, monthName, weekdayShort, toCsv, buildIcs,
} from './lib.js';

const KEY = 'sportampel-v1';
const STATE_URL = new URL('__state.json', location.href).href; // Kopie für den Service Worker
const INBOX_URL = new URL('__inbox.json', location.href).href; // Antworten aus Benachrichtigungen
const LEVEL = {
  green: { name: 'Grün', icon: '●', color: '#1d8a4e' },
  orange: { name: 'Orange', icon: '▲', color: '#d9730d' },
  red: { name: 'Rot', icon: '■', color: '#c62828' },
  none: { name: 'Aus', icon: '○', color: '#6b7280' },
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const dialog = $('#dialog');
const today = () => toDateStr(new Date());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Daten ----------

let state = load();

function load() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(KEY)), today());
  } catch {
    return emptyState(today());
  }
}

function save() {
  state.sessions = sortSessions(state.sessions);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Speichern nicht möglich – ist der Speicher voll?'); }
  mirrorForWorker();
  updateChrome();
}

async function mirrorForWorker() {
  if (!('caches' in window)) return;
  try {
    const c = await caches.open('sportampel-data');
    await c.put(STATE_URL, new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json' } }));
  } catch { /* egal */ }
}

/** Antworten übernehmen, die direkt in einer Benachrichtigung gegeben wurden. */
async function readInbox() {
  if (!('caches' in window)) return;
  try {
    const c = await caches.open('sportampel-data');
    const res = await c.match(INBOX_URL);
    if (!res) return;
    const items = await res.json();
    await c.delete(INBOX_URL);
    let changed = false;
    for (const it of items) {
      if (it.answer === 'later' || it.answer === 'skip') {
        state.answers[it.date] = { answer: it.answer === 'later' ? 'planned' : 'skip', at: it.at };
        changed = true;
      }
      if (it.prompted) { state.lastPromptAt = Math.max(state.lastPromptAt, it.prompted); changed = true; }
    }
    if (changed) { save(); render(); }
  } catch { /* egal */ }
}

function addSession(s) {
  state.sessions.push({ id: uid(), created: Date.now(), note: '', ...s });
  delete state.answers[s.date];
  save();
}

function answer(kind) {
  const t = today();
  if (kind === 'done') return openLog({ date: t });
  state.answers[t] = { answer: kind === 'later' ? 'planned' : 'skip', at: Date.now() };
  state.lastPromptAt = Date.now();
  save();
  render();
  if (kind === 'later') {
    const next = nextSlotAfter(state.settings.times, new Date());
    toast(next && toDateStr(next) === t ? `Super! Ich frag um ${hhmm(next)} nochmal nach.` : 'Super, viel Spaß! Trag es danach ein.');
  } else {
    toast('Okay – dann vielleicht morgen.');
  }
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ---------- Rahmen ----------

function updateChrome() {
  const st = status(state, today());
  const lv = LEVEL[st.level];
  document.documentElement.dataset.level = st.level;
  $('meta[name="theme-color"]').content = lv.color;
  document.title = st.days == null ? 'SportAmpel' : `${lv.icon} ${st.days} ${st.days === 1 ? 'Tag' : 'Tage'} – SportAmpel`;
  if ('setAppBadge' in navigator) {
    try {
      if (st.level === 'orange' || st.level === 'red') navigator.setAppBadge(st.days);
      else navigator.clearAppBadge();
    } catch { /* nicht unterstützt */ }
  }
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Navigation ----------

const VIEWS = { ampel: renderHome, uebersicht: renderOverview, statistik: renderStats, einstellungen: renderSettings };
const ui = { month: today().slice(0, 7), unit: 'week', offset: 0 };

function currentTab() {
  const t = location.hash.slice(1);
  return VIEWS[t] ? t : 'ampel';
}

function render() {
  const tab = currentTab();
  document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  VIEWS[tab]();
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ---------- Ampel (Start) ----------

function renderHome() {
  const t = today();
  const st = status(state, t);
  const ask = askState(state, new Date());
  const ans = state.answers[t];
  const y = addDays(t, -1);
  const yAns = state.answers[y];
  const missedPlan = yAns?.answer === 'planned' && !yAns.resolved && !state.sessions.some((s) => s.date === y);
  const week = summarize(state.sessions, periodRange('week', t), t);
  const month = summarize(state.sessions, periodRange('month', t), t);
  const streak = greenStreak(state.sessions, t);

  view.innerHTML = `
    <section class="hero lvl-${st.level}">
      <div class="lamp-box" role="img" aria-label="Ampel: ${LEVEL[st.level].name}">
        <span class="lamp red ${st.level === 'red' ? 'on' : ''}"></span>
        <span class="lamp orange ${st.level === 'orange' ? 'on' : ''}"></span>
        <span class="lamp green ${st.level === 'green' ? 'on' : ''}"></span>
      </div>
      <div class="hero-text">
        <p class="level-chip"><span aria-hidden="true">${LEVEL[st.level].icon}</span> ${LEVEL[st.level].name}</p>
        <h2>${esc(st.headline)}</h2>
        <p class="muted">${esc(st.detail)}</p>
        ${st.days != null ? `<p class="days"><strong>${st.days}</strong> ${st.days === 1 ? 'Tag' : 'Tage'} seit dem letzten Training</p>` : ''}
      </div>
    </section>

    ${missedPlan ? `
    <section class="card ask">
      <h3>Gestern hattest du Sport geplant – hat's geklappt?</h3>
      <div class="btn-row">
        <button class="btn primary" data-act="yesterday-yes">Ja, eintragen</button>
        <button class="btn" data-act="yesterday-no">Nein</button>
      </div>
    </section>` : ''}

    ${ask !== 'none' ? `
    <section class="card ask">
      <h3>${ans?.answer === 'planned' ? 'Hast du deinen Sport schon gemacht?' : 'Hast du heute Sport gemacht – oder machst du noch welchen?'}</h3>
      ${ans?.answer === 'planned' ? '<p class="muted small">Du hattest gesagt, du machst heute noch was.</p>' : ''}
      <div class="btn-row">
        <button class="btn primary" data-act="done">✅ Gemacht</button>
        <button class="btn" data-act="later">⏰ Mach ich noch</button>
        <button class="btn ghost" data-act="skip">Heute nicht</button>
      </div>
    </section>` : ''}

    <button class="btn big primary" data-act="log">+ Training eintragen</button>

    <section class="card">
      <h3>Die letzten 14 Tage</h3>
      <div class="strip">${last14(t)}</div>
      <p class="legend small">
        <span><i class="sw green"></i> grün</span><span><i class="sw orange"></i> orange</span>
        <span><i class="sw red"></i> rot</span><span><b class="dot-ex">●</b> Training</span>
      </p>
    </section>

    <section class="tiles">
      ${tile('Diese Woche', formatMinutes(week.minutes), `${week.count} ${week.count === 1 ? 'Training' : 'Trainings'}`)}
      ${tile(monthName(parseDate(t).getMonth()), formatMinutes(month.minutes), `${month.activeDays} Sporttage`)}
      ${tile('Ohne Rot', `${streak} ${streak === 1 ? 'Tag' : 'Tage'}`, 'am Stück')}
    </section>

    ${recentList()}
  `;
}

function last14(t) {
  let html = '';
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    const lv = levelOnDay(state.sessions, d);
    const mins = state.sessions.filter((s) => s.date === d).reduce((a, s) => a + s.minutes, 0);
    const did = state.sessions.some((s) => s.date === d);
    html += `<div class="day lv-${lv} ${d === t ? 'today' : ''}" title="${esc(formatDate(d))}${did ? ` – ${formatMinutes(mins)}` : ''}">
      <span class="wd">${weekdayShort(d)}</span>
      <span class="cell">${did ? '●' : ''}</span>
      <span class="dn">${parseDate(d).getDate()}</span>
    </div>`;
  }
  return html;
}

const tile = (label, value, sub) => `<div class="tile"><span class="t-label">${esc(label)}</span><strong>${esc(value)}</strong><span class="small">${esc(sub)}</span></div>`;

function recentList() {
  const recent = [...state.sessions].reverse().slice(0, 5);
  if (!recent.length) return '';
  return `<section class="card"><h3>Zuletzt</h3><ul class="list">${recent.map(sessionItem).join('')}</ul>
    <a class="link" href="#uebersicht">Alle Trainings ansehen →</a></section>`;
}

function sessionItem(s) {
  const sp = SPORT_BY_ID[s.type];
  return `<li class="item" data-id="${s.id}">
    <span class="sp-ico" aria-hidden="true">${sp.icon}</span>
    <span class="item-main"><strong>${esc(sp.name)}</strong> · ${formatMinutes(s.minutes)}
      <span class="small block">${esc(formatDate(s.date))}${s.note ? ' · ' + esc(s.note) : ''}</span></span>
    <button class="icon-btn" data-act="edit" data-id="${s.id}" aria-label="Bearbeiten">✎</button>
  </li>`;
}

// ---------- Eintragen ----------

function openLog({ date, session } = {}) {
  const s = session || { date: date || today(), minutes: state.settings.defaultMinutes, type: lastType(), note: '' };
  const t = today();
  dialog.querySelector('#dialog-body').innerHTML = `
    <form method="dialog" class="log" id="log-form">
      <h2>${session ? 'Training bearbeiten' : 'Training eintragen'}</h2>

      <fieldset>
        <legend>Wann?</legend>
        <div class="chips">
          <button type="button" class="chip" data-date="${t}">Heute</button>
          <button type="button" class="chip" data-date="${addDays(t, -1)}">Gestern</button>
          <button type="button" class="chip" data-date="${addDays(t, -2)}">Vorgestern</button>
        </div>
        <input type="date" name="date" value="${s.date}" max="${t}" required>
      </fieldset>

      <fieldset>
        <legend>Wie lange?</legend>
        <div class="chips">
          ${[15, 20, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="chip" data-min="${m}">${formatMinutes(m)}</button>`).join('')}
        </div>
        <label class="inline"><input type="number" name="minutes" min="1" max="1440" step="1" value="${s.minutes}" required inputmode="numeric"> Minuten</label>
      </fieldset>

      <fieldset>
        <legend>Was?</legend>
        <div class="chips sports">
          ${SPORTS.map(([id, name, icon]) => `<label class="chip radio"><input type="radio" name="type" value="${id}" ${id === s.type ? 'checked' : ''}><span>${icon} ${name}</span></label>`).join('')}
        </div>
      </fieldset>

      <label class="block-label">Notiz (optional)
        <input type="text" name="note" maxlength="120" value="${esc(s.note)}" placeholder="z. B. 5 km, Rücken, mit Anna …">
      </label>

      <div class="btn-row end">
        ${session ? '<button type="button" class="btn danger ghost" data-act="delete">Löschen</button>' : ''}
        <button type="button" class="btn ghost" data-act="cancel">Abbrechen</button>
        <button type="submit" class="btn primary">Speichern</button>
      </div>
    </form>`;

  const form = $('#log-form');
  const mark = () => {
    form.querySelectorAll('[data-date]').forEach((b) => b.classList.toggle('sel', b.dataset.date === form.date.value));
    form.querySelectorAll('[data-min]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.min) === Number(form.minutes.value)));
  };
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.date) { form.date.value = b.dataset.date; mark(); }
    if (b.dataset.min) { form.minutes.value = b.dataset.min; mark(); }
    if (b.dataset.act === 'cancel') dialog.close();
    if (b.dataset.act === 'delete' && confirm('Dieses Training löschen?')) {
      state.sessions = state.sessions.filter((x) => x.id !== session.id);
      save(); dialog.close(); render(); toast('Training gelöscht.');
    }
  });
  form.addEventListener('input', mark);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      date: form.date.value,
      minutes: Math.max(1, Math.round(Number(form.minutes.value) || 0)),
      type: form.type.value || 'sonst',
      note: form.note.value.trim(),
    };
    if (!data.date || data.date > t) { form.date.focus(); return; }
    if (session) Object.assign(state.sessions.find((x) => x.id === session.id), data), save();
    else addSession(data);
    if (data.date === addDays(t, -1) && state.answers[data.date]) state.answers[data.date].resolved = true;
    dialog.close();
    render();
    toast(session ? 'Gespeichert.' : `Eingetragen: ${formatMinutes(data.minutes)} ${SPORT_BY_ID[data.type].name}. Stark! 💪`);
  });
  mark();
  dialog.showModal();
}

function lastType() {
  return state.sessions.length ? state.sessions[state.sessions.length - 1].type : 'laufen';
}

// ---------- Übersicht ----------

function renderOverview() {
  const t = today();
  const [y, m] = ui.month.split('-').map(Number);
  const first = `${ui.month}-01`;
  const r = periodRange('month', first);
  const sum = summarize(state.sessions, r, t);
  const list = state.sessions.filter((s) => s.date.startsWith(ui.month)).reverse();
  const lead = (parseDate(first).getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  let cells = '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${ui.month}-${String(d).padStart(2, '0')}`;
    const mins = state.sessions.filter((s) => s.date === ds).reduce((a, s) => a + s.minutes, 0);
    const did = state.sessions.some((s) => s.date === ds);
    const future = ds > t;
    const lv = future || !state.sessions.length ? 'future' : levelOnDay(state.sessions, ds);
    cells += `<button class="cal-day lv-${lv} ${ds === t ? 'today' : ''} ${did ? 'did' : ''}" data-day="${ds}" ${future ? 'disabled' : ''}
      aria-label="${esc(formatDate(ds))}${did ? ', ' + formatMinutes(mins) + ' Sport' : ''}">
      <span>${d}</span>${did ? `<em>${mins}′</em>` : ''}</button>`;
  }
  const canNext = ui.month < t.slice(0, 7);

  view.innerHTML = `
    <div class="period-nav">
      <button class="icon-btn" data-act="month-prev" aria-label="Vorheriger Monat">‹</button>
      <h2>${monthName(m - 1)} ${y}</h2>
      <button class="icon-btn" data-act="month-next" aria-label="Nächster Monat" ${canNext ? '' : 'disabled'}>›</button>
    </div>
    <section class="card">
      <div class="cal-head">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal">${cells}</div>
      <p class="small muted">Farbe = Ampel an diesem Tag, Zahl = Minuten Sport. Auf einen Tag tippen zum Nachtragen.</p>
    </section>
    <section class="tiles">
      ${tile('Trainings', String(sum.count), `an ${sum.activeDays} Tagen`)}
      ${tile('Gesamtzeit', formatMinutes(sum.minutes), sum.count ? `Ø ${formatMinutes(sum.avgMinutes)}` : '–')}
      ${tile('Längste Pause', `${sum.longestPause} ${sum.longestPause === 1 ? 'Tag' : 'Tage'}`, 'ohne Sport')}
    </section>
    <section class="card">
      <h3>Trainings im ${monthName(m - 1)}</h3>
      ${list.length ? `<ul class="list">${list.map(sessionItem).join('')}</ul>` : '<p class="muted">Noch keine Trainings in diesem Monat.</p>'}
    </section>`;
}

// ---------- Statistik ----------

const UNIT_LABEL = { week: 'Woche', month: 'Monat', year: 'Jahr' };
const SERIES_N = { week: 12, month: 12, year: 5 };

function renderStats() {
  const t = today();
  const r = periodRange(ui.unit, t, ui.offset);
  const sum = summarize(state.sessions, r, t);
  const prev = summarize(state.sessions, periodRange(ui.unit, t, ui.offset - 1), t);
  const ref = r.end <= t ? addDays(r.end, -1) : t;
  const ser = series(state.sessions, ui.unit, ref, SERIES_N[ui.unit]);
  const diff = sum.minutes - prev.minutes;

  view.innerHTML = `
    <div class="seg" role="tablist" aria-label="Zeitraum">
      ${Object.entries(UNIT_LABEL).map(([u, l]) => `<button role="tab" aria-selected="${u === ui.unit}" data-unit="${u}">${l}</button>`).join('')}
    </div>
    <div class="period-nav">
      <button class="icon-btn" data-act="per-prev" aria-label="Zurück">‹</button>
      <div class="pn-text"><h2>${esc(r.label)}</h2>${ui.unit === 'week' ? `<span class="small">${esc(r.long)}</span>` : ''}</div>
      <button class="icon-btn" data-act="per-next" aria-label="Weiter" ${ui.offset < 0 ? '' : 'disabled'}>›</button>
    </div>

    <section class="tiles four">
      ${tile('Trainings', String(sum.count), `an ${sum.activeDays} ${sum.activeDays === 1 ? 'Tag' : 'Tagen'}`)}
      ${tile('Gesamtzeit', formatMinutes(sum.minutes), prev.minutes || sum.minutes ? `${diff >= 0 ? '+' : '−'}${formatMinutes(Math.abs(diff))} zum Vor${ui.unit === 'year' ? 'jahr' : ui.unit === 'month' ? 'monat' : 'woche'}` : '–')}
      ${tile('Ø Dauer', sum.count ? formatMinutes(sum.avgMinutes) : '–', 'pro Training')}
      ${ui.unit === 'week'
        ? tile('Längste Pause', `${sum.longestPause} ${sum.longestPause === 1 ? 'Tag' : 'Tage'}`, 'ohne Sport')
        : tile('Pro Woche', sum.perWeek.toFixed(1).replace('.', ','), `Sporttage · Pause max. ${sum.longestPause} T.`)}
    </section>

    <section class="card">
      <h3>Minuten pro ${UNIT_LABEL[ui.unit]}</h3>
      ${barChart(ser, r.start)}
    </section>

    <div class="two">
      <section class="card">
        <h3>Sportarten</h3>
        ${sum.types.length ? hbars(sum.types.map((x) => ({ label: `${SPORT_BY_ID[x.type].icon} ${SPORT_BY_ID[x.type].name}`, value: x.minutes, sub: `${x.count}×` }))) : '<p class="muted">Keine Trainings in diesem Zeitraum.</p>'}
      </section>
      <section class="card">
        <h3>Wochentage</h3>
        ${sum.count ? hbars(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map((l, i) => ({ label: l, value: sum.byWeekday[i] }))) : '<p class="muted">Keine Trainings in diesem Zeitraum.</p>'}
      </section>
    </div>

    <details class="card">
      <summary>Als Tabelle</summary>
      <table class="tbl"><thead><tr><th>${UNIT_LABEL[ui.unit]}</th><th>Trainings</th><th>Sporttage</th><th>Minuten</th></tr></thead>
      <tbody>${[...ser].reverse().map((p) => `<tr><td>${esc(p.label)}</td><td>${p.count}</td><td>${p.activeDays}</td><td>${p.minutes}</td></tr>`).join('')}</tbody></table>
    </details>`;
}

/** Senkrechte Balken (eine Reihe, eine Farbe), ausgewählter Zeitraum hervorgehoben. */
function barChart(ser, selStart) {
  const W = Math.round(Math.min(640, Math.max(300, view.clientWidth - 34))); const H = W < 420 ? 200 : 220; const padL = 34; const padB = 26; const padT = 18;
  const max = Math.max(30, ...ser.map((p) => p.minutes));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - 8;
  const ih = H - padT - padB;
  const bw = iw / ser.length;
  const y = (v) => padT + ih - (v / top) * ih;
  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'grid' : 'base'}"/>
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${v >= 60 && v % 60 === 0 ? v / 60 + 'h' : v}</text>`;
  }
  const bars = ser.map((p, i) => {
    const x = padL + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const h = Math.max(0, y(0) - y(p.minutes));
    const sel = p.start === selStart;
    const rr = Math.min(4, w / 2, h);
    const path = h > 0 ? `M${x},${y(0)} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${w - 2 * rr} q${rr},0 ${rr},${rr} v${h - rr} z` : '';
    const showLabel = bw >= 34 || ser.length <= 6 || i % 2 === (ser.length - 1) % 2;
    return `<g class="bar ${sel ? 'sel' : ''}" data-start="${p.start}" tabindex="0">
      <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ih + padB}" class="hit"/>
      ${path ? `<path d="${path}"/>` : ''}
      ${sel && p.minutes ? `<text x="${x + w / 2}" y="${y(p.minutes) - 5}" text-anchor="middle" class="val">${p.minutes}</text>` : ''}
      ${showLabel || sel ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="ax ${sel ? 'strong' : ''}">${esc(p.short)}</text>` : ''}
      <title>${esc(p.label)}: ${formatMinutes(p.minutes)}, ${p.count} Trainings</title>
    </g>`;
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minuten Sport pro Zeitraum">${grid}${bars}</svg>
    <div class="tip" hidden></div></div>`;
}

function niceStep(max) {
  for (const s of [15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000]) if (max / s <= 5) return s;
  return Math.ceil(max / 5 / 600) * 600;
}

function hbars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<ul class="hbars">${rows.map((r) => `<li>
    <span class="hb-label">${esc(r.label)}</span>
    <span class="hb-track"><span class="hb-fill" style="width:${(r.value / max) * 100}%"></span></span>
    <span class="hb-val">${r.value ? formatMinutes(r.value) : '–'}${r.sub ? ` <span class="small">${esc(r.sub)}</span>` : ''}</span>
  </li>`).join('')}</ul>`;
}

// ---------- Einstellungen ----------

function renderSettings() {
  const s = state.settings;
  const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `
    <section class="card">
      <h3>Nachfragen</h3>
      <label class="block-label">Fragen, wenn der letzte Sport so lange her ist:
        <select name="askEveryDays">
          ${[1, 2, 3].map((n) => `<option value="${n}" ${n === s.askEveryDays ? 'selected' : ''}>${n === 1 ? 'jeden Tag' : n === 2 ? 'ab 2 Tagen (jeden zweiten Tag)' : 'ab 3 Tagen'}</option>`).join('')}
        </select>
      </label>
      <p class="small muted">An Fragetagen fragt die App zu jeder Erinnerungszeit nach, bis du „Gemacht“ oder „Heute nicht“ antwortest.
        Nach „Mach ich noch“ fragt sie zur nächsten Zeit wieder.</p>
      <h4>Erinnerungszeiten</h4>
      <ul class="times">
        ${s.times.map((t, i) => `<li><input type="time" value="${t}" data-time="${i}" aria-label="Erinnerungszeit ${i + 1}">
          <button class="icon-btn" data-act="time-del" data-i="${i}" aria-label="Entfernen" ${s.times.length <= 1 ? 'disabled' : ''}>✕</button></li>`).join('')}
      </ul>
      <button class="btn" data-act="time-add" ${s.times.length >= 6 ? 'disabled' : ''}>+ Uhrzeit</button>
      <label class="block-label">Vorschlag für die Dauer
        <select name="defaultMinutes">${[15, 20, 30, 45, 60, 90].map((m) => `<option value="${m}" ${m === s.defaultMinutes ? 'selected' : ''}>${formatMinutes(m)}</option>`).join('')}</select>
      </label>
    </section>

    <section class="card">
      <h3>Benachrichtigungen</h3>
      ${notifState === 'granted' && s.notify
        ? '<p>✅ Eingeschaltet.</p><div class="btn-row"><button class="btn" data-act="notif-test">Test senden</button><button class="btn ghost" data-act="notif-off">Ausschalten</button></div>'
        : notifState === 'denied'
          ? '<p class="muted">Benachrichtigungen sind im Browser blockiert. Du kannst sie in den Website-Einstellungen wieder erlauben.</p>'
          : notifState === 'unsupported'
            ? `<p class="muted">Dieser Browser kann keine Benachrichtigungen anzeigen.${ios && !standalone ? ' Auf dem iPhone: erst über Teilen → „Zum Home-Bildschirm“ installieren, dann hier einschalten.' : ''}</p>`
            : '<button class="btn primary" data-act="notif-on">Benachrichtigungen einschalten</button>'}
      <p class="small muted">Web-Apps dürfen im Hintergrund nur eingeschränkt erinnern: Zuverlässig klappt es, solange die App geöffnet
        ist; installiert auf Android (Chrome) prüft sie zusätzlich ab und zu im Hintergrund.
        <strong>Ganz sicher</strong> sind Kalender-Erinnerungen:</p>
      <button class="btn" data-act="ics">📆 Erinnerungen in den Kalender übernehmen</button>
      <p class="small muted">Lädt eine Kalenderdatei mit Terminen alle ${s.askEveryDays === 1 ? 'Tage' : s.askEveryDays + ' Tage'} zu deinen Erinnerungszeiten.
        Öffnen und in den Kalender (iPhone, Google, Outlook) übernehmen. Ein Tipp auf den Termin führt hierher.</p>
    </section>

    <section class="card">
      <h3>Daten</h3>
      <p class="small muted">Alles bleibt nur auf diesem Gerät. ${state.sessions.length} Trainings gespeichert.</p>
      <div class="btn-row">
        <button class="btn" data-act="export">Sicherung (JSON)</button>
        <button class="btn" data-act="csv">Tabelle (CSV/Excel)</button>
        <label class="btn">Sicherung laden<input type="file" accept="application/json,.json" data-act="import" hidden></label>
      </div>
      <button class="btn danger ghost" data-act="reset">Alle Daten löschen</button>
    </section>

    <section class="card small muted">
      <h3>So funktioniert die Ampel</h3>
      <p>Gezählt werden die Tage seit deinem letzten Training:
        <b>0–3 Tage grün</b>, <b>4 Tage orange</b>, <b>ab 5 Tagen rot</b>.</p>
    </section>`;

  view.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
    state.settings[sel.name] = Number(sel.value);
    save(); render();
  }));
  view.querySelectorAll('[data-time]').forEach((inp) => inp.addEventListener('change', () => {
    if (!inp.value) return;
    state.settings.times[Number(inp.dataset.time)] = inp.value;
    state.settings.times = [...new Set(state.settings.times)].sort();
    save(); render();
  }));
  view.querySelector('[data-act="import"]').addEventListener('change', importFile);
}

async function enableNotifications() {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  if (p === 'granted') {
    state.settings.notify = true;
    save();
    registerPeriodic();
    toast('Benachrichtigungen eingeschaltet.');
  }
  render();
}

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) return;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state === 'granted') await reg.periodicSync.register('sport-check', { minInterval: 60 * 60 * 1000 });
  } catch { /* nicht unterstützt */ }
}

async function notify(title, body, tag = 'sport-ask') {
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = {
    body, tag, renotify: true, icon: 'icon-192.png', badge: 'icon-192.png', data: { date: today() },
    actions: [{ action: 'done', title: '✅ Gemacht' }, { action: 'later', title: '⏰ Mach ich noch' }, { action: 'skip', title: 'Heute nicht' }],
  };
  if (reg) return reg.showNotification(title, opts);
  delete opts.actions;
  return new Notification(title, opts);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = normalizeState(data, today());
    const merge = state.sessions.length && confirm('Mit den vorhandenen Trainings zusammenführen? (Abbrechen = ersetzen)');
    if (merge) {
      const ids = new Set(state.sessions.map((s) => s.id));
      state.sessions.push(...incoming.sessions.filter((s) => !ids.has(s.id)));
    } else {
      state = incoming;
    }
    save(); render();
    toast(`${incoming.sessions.length} Trainings geladen.`);
  } catch {
    toast('Die Datei konnte nicht gelesen werden.');
  }
}

// ---------- Klicks ----------

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act], [data-unit], [data-day]');
  if (!b || b.closest('#log-form')) return;
  if (b.dataset.unit) { ui.unit = b.dataset.unit; ui.offset = 0; return render(); }
  if (b.dataset.day) return openLog({ date: b.dataset.day });
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'done': case 'later': case 'skip': return answer(b.dataset.act);
    case 'log': return openLog();
    case 'edit': return openLog({ session: state.sessions.find((s) => s.id === id) });
    case 'yesterday-yes': return openLog({ date: addDays(today(), -1) });
    case 'yesterday-no': state.answers[addDays(today(), -1)].resolved = true; save(); return render();
    case 'month-prev': case 'month-next': {
      const d = parseDate(`${ui.month}-01`);
      d.setMonth(d.getMonth() + (b.dataset.act === 'month-prev' ? -1 : 1));
      ui.month = toDateStr(d).slice(0, 7);
      return render();
    }
    case 'per-prev': ui.offset--; return render();
    case 'per-next': ui.offset = Math.min(0, ui.offset + 1); return render();
    case 'time-add': {
      const free = ['08:00', '12:00', '14:00', '19:00', '21:00', '07:00'].find((t) => !state.settings.times.includes(t));
      state.settings.times = [...state.settings.times, free].sort(); save(); return render();
    }
    case 'time-del': state.settings.times.splice(Number(b.dataset.i), 1); save(); return render();
    case 'notif-on': return enableNotifications();
    case 'notif-off': state.settings.notify = false; save(); return render();
    case 'notif-test': return notify('🚦 Sport heute?', 'So sieht die Erinnerung aus.', 'sport-test');
    case 'ics': return download('sportampel-erinnerungen.ics',
      buildIcs({ times: state.settings.times, everyDays: state.settings.askEveryDays, startDate: nextAskDay(), url: location.href.split('#')[0] }),
      'text/calendar');
    case 'export': return download(`sportampel-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
    case 'csv': return download(`sportampel-${today()}.csv`, toCsv(state.sessions), 'text/csv');
    case 'reset':
      if (confirm('Wirklich alle Trainings und Einstellungen löschen?')) { state = emptyState(today()); save(); render(); }
      return undefined;
    default: return undefined;
  }
});

function nextAskDay() {
  for (let i = 0; i < 8; i++) {
    const d = addDays(today(), i);
    if (isAskDay({ ...state, sessions: state.sessions }, d)) return d;
  }
  return today();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// Tooltip im Balkendiagramm
document.addEventListener('pointerover', (e) => {
  const g = e.target.closest?.('.bar');
  const chart = e.target.closest?.('.chart');
  if (!chart) return;
  const tip = chart.querySelector('.tip');
  if (!g) { tip.hidden = true; return; }
  tip.textContent = g.querySelector('title').textContent;
  tip.hidden = false;
});
document.addEventListener('pointerout', (e) => {
  const chart = e.target.closest?.('.chart');
  if (chart && !chart.contains(e.relatedTarget)) chart.querySelector('.tip').hidden = true;
});
document.addEventListener('click', (e) => {
  const g = e.target.closest('.bar');
  if (!g) return;
  const r = periodRange(ui.unit, today(), 0);
  // Auf einen Balken tippen → diesen Zeitraum auswählen
  let off = 0;
  for (let p = r; p.start > g.dataset.start && off > -400; ) p = periodRange(ui.unit, today(), --off);
  ui.offset = off;
  render();
});

// ---------- Erinnern ----------

let asking = false;
async function tick() {
  if (dialog.open) return;
  const t = today();
  if (tick.day && tick.day !== t) render(); // Mitternacht: Ampel neu
  tick.day = t;
  if (askState(state, new Date()) !== 'due' || asking) return;
  asking = true;
  state.lastPromptAt = Date.now();
  save();
  const st = status(state, t);
  const ans = state.answers[t];
  const body = ans?.answer === 'planned' ? 'Du wolltest heute noch Sport machen – schon erledigt?'
    : st.days == null ? 'Hast du heute Sport gemacht oder machst du noch welchen?'
      : `${st.days} ${st.days === 1 ? 'Tag' : 'Tage'} seit dem letzten Training (Ampel ${LEVEL[st.level].name}). Gemacht oder machst du noch?`;
  if (document.visibilityState === 'visible') {
    if (currentTab() !== 'ampel') location.hash = 'ampel';
    render();
    $('.card.ask')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('.card.ask')?.classList.add('pulse');
  } else if (state.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    try { await notify('🚦 Sport heute?', body); } catch { /* egal */ }
  }
  asking = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { state = load(); readInbox(); render(); tick(); }
});

// Antwort aus einer Benachrichtigung (?antwort=done)
function handleUrlAnswer() {
  const p = new URLSearchParams(location.search);
  const a = p.get('antwort');
  if (!a) return;
  history.replaceState(null, '', location.pathname + '#ampel');
  if (['done', 'later', 'skip'].includes(a)) answer(a);
}

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'answer') answer(e.data.answer);
  if (e.data?.type === 'inbox') readInbox();
});

// ---------- Start ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { type: 'module' })
    .catch(() => navigator.serviceWorker.register('sw.js'))
    .then(() => { if (state.settings.notify) registerPeriodic(); })
    .catch(() => {});
}

updateChrome();
render();
mirrorForWorker();
readInbox();
handleUrlAnswer();
tick();
setInterval(tick, 30 * 1000);
