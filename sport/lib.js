// Reine Logik ohne DOM – testbar mit `node --test`.
// Datumswerte sind lokale Kalendertage im Format 'YYYY-MM-DD'.

export const SPORTS = [
  ['laufen', 'Laufen', '🏃'],
  ['rad', 'Radfahren', '🚴'],
  ['kraft', 'Krafttraining', '🏋️'],
  ['schwimmen', 'Schwimmen', '🏊'],
  ['yoga', 'Yoga / Dehnen', '🧘'],
  ['ball', 'Ballsport', '⚽'],
  ['wandern', 'Wandern / Gehen', '🥾'],
  ['sonst', 'Sonstiges', '✨'],
];
export const SPORT_BY_ID = Object.fromEntries(SPORTS.map(([id, name, icon]) => [id, { id, name, icon }]));

export const DEFAULT_SETTINGS = {
  askEveryDays: 2, // Fragetag, sobald der letzte Sport so viele Tage her ist
  times: ['10:00', '17:00', '20:00'], // Uhrzeiten, zu denen erinnert wird
  notify: false,
  defaultMinutes: 30,
};

export function emptyState(today) {
  return { version: 1, sessions: [], answers: {}, lastPromptAt: 0, startedOn: today, settings: { ...DEFAULT_SETTINGS } };
}

/** Ältere oder kaputte Daten auf den aktuellen Stand bringen. */
export function normalizeState(raw, today) {
  const base = emptyState(today);
  if (!raw || typeof raw !== 'object') return base;
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter((s) => s && isDateStr(s.date)).map((s) => ({
      id: String(s.id || uid()),
      date: s.date,
      minutes: Math.max(0, Math.round(Number(s.minutes) || 0)),
      type: SPORT_BY_ID[s.type] ? s.type : 'sonst',
      note: typeof s.note === 'string' ? s.note : '',
      created: Number(s.created) || Date.now(),
    }))
    : [];
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  settings.askEveryDays = clamp(Math.round(Number(settings.askEveryDays) || 2), 1, 7);
  settings.times = (Array.isArray(settings.times) ? settings.times : DEFAULT_SETTINGS.times)
    .filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
  return {
    version: 1,
    sessions: sortSessions(sessions),
    answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    lastPromptAt: Number(raw.lastPromptAt) || 0,
    startedOn: isDateStr(raw.startedOn) ? raw.startedOn : today,
    settings,
  };
}

// ---------- Datum ----------

export const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pad = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const dayNum = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
/** Ganze Kalendertage von a bis b (b später → positiv). */
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function sortSessions(list) {
  return [...list].sort((a, b) => (a.date === b.date ? a.created - b.created : a.date < b.date ? -1 : 1));
}

// ---------- Ampel ----------

/**
 * Ampel nach Tagen seit dem letzten Sport:
 * 0–3 Tage grün, 4 Tage orange, ab 5 Tagen rot.
 */
export function levelForDays(days) {
  if (days == null) return 'none';
  if (days <= 3) return 'green';
  if (days === 4) return 'orange';
  return 'red';
}

export function lastSessionDate(sessions, today) {
  let last = null;
  for (const s of sessions) if (s.date <= today && (!last || s.date > last)) last = s.date;
  return last;
}

export function status(state, today) {
  const last = lastSessionDate(state.sessions, today);
  const days = last ? daysBetween(last, today) : null;
  const level = levelForDays(days);
  let headline;
  let detail;
  if (days == null) {
    headline = 'Noch kein Sport eingetragen';
    detail = 'Trag dein erstes Training ein, dann startet die Ampel.';
  } else if (days === 0) {
    headline = 'Heute Sport gemacht 💪';
    detail = 'Die Ampel bleibt bis einschließlich ' + weekdayLong(addDays(today, 3)) + ' grün.';
  } else {
    headline = days === 1 ? 'Letzter Sport: gestern' : `Seit ${days} Tagen kein Sport`;
    if (level === 'green') {
      const left = 3 - days;
      detail = left === 0 ? 'Heute ist der letzte grüne Tag – morgen wird es orange.'
        : `Noch ${left} ${left === 1 ? 'Tag' : 'Tage'} grün.`;
    } else if (level === 'orange') detail = 'Heute noch Sport machen, sonst wird es morgen rot.';
    else detail = 'Zeit, wieder anzufangen – schon 15 Minuten zählen.';
  }
  return { last, days, level, headline, detail };
}

// ---------- Nachfragen ----------

/** Ist heute ein Tag, an dem die App nachfragt? */
export function isAskDay(state, today) {
  const last = lastSessionDate(state.sessions, today);
  if (last === today) return false;
  const ref = last || addDays(state.startedOn || today, -state.settings.askEveryDays);
  return daysBetween(ref, today) >= state.settings.askEveryDays;
}

/**
 * Soll gerade gefragt werden? Liefert
 *  'none'  – heute nicht (Sport gemacht, abgesagt oder kein Fragetag)
 *  'open'  – Fragetag, Frage steht auf der Startseite
 *  'due'   – zusätzlich ist eine Erinnerungszeit erreicht, die noch nicht gemeldet wurde
 */
export function askState(state, now) {
  const today = toDateStr(now);
  if (!isAskDay(state, today)) return 'none';
  const ans = state.answers[today];
  if (ans && ans.answer === 'skip') return 'none';
  const slot = lastSlotBefore(state.settings.times, now);
  if (slot && slot > (state.lastPromptAt || 0) && (!ans || ans.at < slot)) return 'due';
  return 'open';
}

/** Zeitpunkt (ms) der letzten Erinnerungszeit heute, die schon vorbei ist. */
export function lastSlotBefore(times, now) {
  let best = 0;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= now.getTime()) best = Math.max(best, d.getTime());
  }
  return best;
}

/** Nächste Erinnerungszeit (Date) ab jetzt, auch an folgenden Tagen. */
export function nextSlotAfter(times, now) {
  for (let add = 0; add < 8; add++) {
    for (const t of [...times].sort()) {
      const [h, m] = t.split(':').map(Number);
      const d = new Date(now);
      d.setDate(d.getDate() + add);
      d.setHours(h, m, 0, 0);
      if (d > now) return d;
    }
  }
  return null;
}

// ---------- Statistik ----------

/** Montag der Woche (ISO) als 'YYYY-MM-DD'. */
export function weekStart(s) {
  const d = parseDate(s);
  const wd = (d.getDay() + 6) % 7;
  return addDays(s, -wd);
}
/** ISO-Kalenderwoche. */
export function isoWeek(s) {
  const d = parseDate(s);
  const th = new Date(d);
  th.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(th.getFullYear(), 0, 4);
  return { year: th.getFullYear(), week: 1 + Math.round(((th - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7) };
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const monthName = (m) => MONTHS[m];
export const weekdayLong = (s) => WEEKDAYS[parseDate(s).getDay()];
export const weekdayShort = (s) => WEEKDAYS[parseDate(s).getDay()].slice(0, 2);

export function formatDate(s, withWeekday = true) {
  const d = parseDate(s);
  const base = `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withWeekday ? `${WEEKDAYS[d.getDay()].slice(0, 2)}, ${base}` : base;
}
export function formatMinutes(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Zeitraum (start inkl., end exkl.) für 'week' | 'month' | 'year', um offset Perioden verschoben. */
export function periodRange(unit, ref, offset = 0) {
  if (unit === 'week') {
    const start = addDays(weekStart(ref), 7 * offset);
    const { year, week } = isoWeek(start);
    const endIncl = addDays(start, 6);
    return { unit, start, end: addDays(start, 7), label: `KW ${week} · ${year}`, short: `KW${week}`,
      long: `${formatDate(start, false).replace(/ \d{4}$/, '')} – ${formatDate(endIncl, false)}` };
  }
  const d = parseDate(ref);
  if (unit === 'month') {
    const s = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 1);
    return { unit, start: toDateStr(s), end: toDateStr(e), label: `${MONTHS[s.getMonth()]} ${s.getFullYear()}`,
      short: MONTHS_SHORT[s.getMonth()], long: `${MONTHS[s.getMonth()]} ${s.getFullYear()}` };
  }
  const y = d.getFullYear() + offset;
  return { unit, start: `${y}-01-01`, end: `${y + 1}-01-01`, label: String(y), short: String(y), long: String(y) };
}

export const inRange = (sessions, r) => sessions.filter((s) => s.date >= r.start && s.date < r.end);

/** Kennzahlen für einen Zeitraum; today begrenzt laufende Zeiträume. */
export function summarize(sessions, r, today) {
  const list = inRange(sessions, r);
  const minutes = list.reduce((a, s) => a + s.minutes, 0);
  const days = new Set(list.map((s) => s.date));
  const lastDay = r.end <= today ? addDays(r.end, -1) : today;
  const spanDays = Math.max(0, daysBetween(r.start, lastDay) + 1);
  const byType = {};
  for (const s of list) {
    byType[s.type] ||= { type: s.type, count: 0, minutes: 0 };
    byType[s.type].count++;
    byType[s.type].minutes += s.minutes;
  }
  const byWeekday = Array(7).fill(0); // Mo..So
  for (const s of list) byWeekday[(parseDate(s.date).getDay() + 6) % 7] += s.minutes;
  return {
    count: list.length,
    minutes,
    activeDays: days.size,
    spanDays,
    avgMinutes: list.length ? minutes / list.length : 0,
    perWeek: spanDays ? (days.size / spanDays) * 7 : 0,
    longestPause: longestPause(sessions, r.start, lastDay),
    types: Object.values(byType).sort((a, b) => b.minutes - a.minutes || b.count - a.count),
    byWeekday,
  };
}

/** Die letzten n Perioden (älteste zuerst) mit Summen – für das Balkendiagramm. */
export function series(sessions, unit, today, n) {
  const out = [];
  for (let i = -(n - 1); i <= 0; i++) {
    const r = periodRange(unit, today, i);
    const list = inRange(sessions, r);
    out.push({ ...r, minutes: list.reduce((a, s) => a + s.minutes, 0), count: list.length,
      activeDays: new Set(list.map((s) => s.date)).size });
  }
  return out;
}

/**
 * Längste Pause (Tage ohne Sport) zwischen from und to (inklusive).
 * Pausen, die vor from beginnen, werden ab dem letzten Training davor gezählt.
 */
export function longestPause(sessions, from, to) {
  const days = [...new Set(sessions.map((s) => s.date))].filter((d) => d <= to).sort();
  if (!days.length || to < from) return 0;
  // Pausentage zwischen zwei Trainings (a, b) sind a+1 … b-1; gezählt wird nur der Teil im Zeitraum.
  const gap = (a, b) => {
    const s = a < from ? from : addDays(a, 1);
    const e = b > to ? to : addDays(b, -1);
    return s <= e ? daysBetween(s, e) + 1 : 0;
  };
  let best = 0;
  for (let i = 1; i < days.length; i++) best = Math.max(best, gap(days[i - 1], days[i]));
  best = Math.max(best, gap(days[days.length - 1], addDays(to, 1)));
  return best;
}

/** Wie viele Tage in Folge die Ampel zuletzt nicht rot war (Trainingsabstand ≤ 4 Tage). */
export function greenStreak(sessions, today) {
  const days = [...new Set(sessions.map((s) => s.date))].filter((d) => d <= today).sort();
  if (!days.length) return 0;
  if (daysBetween(days[days.length - 1], today) > 4) return 0;
  let i = days.length - 1;
  while (i > 0 && daysBetween(days[i - 1], days[i]) <= 5) i--;
  return daysBetween(days[i], today) + 1;
}

/** Ampelfarbe eines vergangenen Tages – für den Kalender. */
export function levelOnDay(sessions, day) {
  return levelForDays(((last) => (last ? daysBetween(last, day) : null))(lastSessionDate(sessions, day)));
}

// ---------- Export ----------

export function toCsv(sessions) {
  const esc = (v) => (/[";\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const rows = [['Datum', 'Wochentag', 'Sportart', 'Minuten', 'Notiz']];
  for (const s of sortSessions(sessions)) {
    rows.push([s.date, weekdayLong(s.date), SPORT_BY_ID[s.type]?.name || s.type, String(s.minutes), s.note || '']);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
}

/**
 * Kalenderdatei (.ics): Erinnerungen alle `everyDays` Tage zu den gewählten Uhrzeiten.
 * Funktioniert auch auf dem iPhone, wo Web-Apps im Hintergrund nicht erinnern dürfen.
 */
export function buildIcs({ times, everyDays, startDate, url }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const d = startDate.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SportAmpel//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  times.forEach((t, i) => {
    const [h, m] = t.split(':');
    lines.push(
      'BEGIN:VEVENT',
      `UID:sportampel-${d}-${i}@sportampel.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${d}T${h}${m}00`,
      'DURATION:PT5M',
      `RRULE:FREQ=DAILY;INTERVAL=${everyDays}`,
      'SUMMARY:🚦 Sport heute? – SportAmpel',
      `DESCRIPTION:Hast du Sport gemacht oder machst du noch welchen? ${url}`,
      `URL:${url}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Sport heute?',
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
