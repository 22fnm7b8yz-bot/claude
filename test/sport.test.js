import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelForDays, status, emptyState, isAskDay, askState, normalizeState, periodRange, summarize,
  series, longestPause, greenStreak, isoWeek, weekStart, nextSlotAfter, buildIcs, toCsv, daysBetween,
} from '../sport/lib.js';

const T = '2026-11-21'; // Samstag
const withSessions = (dates, extra = {}) => {
  const s = emptyState('2026-10-01');
  s.sessions = dates.map((date, i) => ({ id: String(i), date, minutes: 30, type: 'laufen', note: '', created: i }));
  return Object.assign(s, extra);
};
const at = (date, time) => new Date(`${date}T${time}:00`);

test('Ampel: 0–3 Tage grün, 4 orange, ab 5 rot', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(levelForDays), ['green', 'green', 'green', 'green', 'orange', 'red', 'red']);
  assert.equal(levelForDays(null), 'none');
  assert.equal(status(withSessions(['2026-11-17']), T).level, 'orange');
  assert.equal(status(withSessions(['2026-11-18']), T).level, 'green');
  assert.equal(status(withSessions(['2026-11-16']), T).level, 'red');
  assert.equal(status(withSessions([]), T).level, 'none');
});

test('Fragetag: ab 2 Tagen ohne Sport, nicht wenn heute schon Sport', () => {
  assert.equal(isAskDay(withSessions(['2026-11-20']), T), false);
  assert.equal(isAskDay(withSessions(['2026-11-19']), T), true);
  assert.equal(isAskDay(withSessions([T]), T), false);
  const daily = withSessions(['2026-11-20']);
  daily.settings.askEveryDays = 1;
  assert.equal(isAskDay(daily, T), true);
});

test('Nachfragen mehrmals am Tag und Antworten', () => {
  const s = withSessions(['2026-11-18']);
  assert.equal(askState(s, at(T, '08:00')), 'open'); // noch vor der ersten Zeit
  assert.equal(askState(s, at(T, '10:05')), 'due');
  s.lastPromptAt = at(T, '10:05').getTime();
  assert.equal(askState(s, at(T, '12:00')), 'open');
  s.answers[T] = { answer: 'planned', at: at(T, '12:00').getTime() };
  assert.equal(askState(s, at(T, '16:00')), 'open');
  assert.equal(askState(s, at(T, '17:01')), 'due'); // „Mach ich noch“ → um 17 Uhr wieder fragen
  s.answers[T] = { answer: 'skip', at: at(T, '17:02').getTime() };
  assert.equal(askState(s, at(T, '20:30')), 'none');
});

test('nächste Erinnerungszeit', () => {
  const n = nextSlotAfter(['10:00', '17:00'], at(T, '18:00'));
  assert.equal(n.getDate(), 22);
  assert.equal(n.getHours(), 10);
});

test('Wochen und Monate', () => {
  assert.equal(weekStart(T), '2026-11-16');
  assert.deepEqual(isoWeek('2026-11-21'), { year: 2026, week: 47 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  const m = periodRange('month', T, -1);
  assert.equal(m.start, '2026-10-01');
  assert.equal(m.end, '2026-11-01');
  assert.equal(periodRange('year', T).label, '2026');
});

test('Statistik für einen Zeitraum', () => {
  const s = withSessions(['2026-11-02', '2026-11-03', '2026-11-10', '2026-11-20']);
  s.sessions[1].minutes = 60;
  s.sessions[1].type = 'kraft';
  const sum = summarize(s.sessions, periodRange('month', T), T);
  assert.equal(sum.count, 4);
  assert.equal(sum.minutes, 150);
  assert.equal(sum.activeDays, 4);
  assert.equal(sum.longestPause, 9); // 11.–19.11.
  assert.equal(sum.types[0].type, 'laufen');
  assert.equal(sum.byWeekday[1], 90); // Dienstage 3. + 10.11.
  const ser = series(s.sessions, 'week', T, 4);
  assert.equal(ser.length, 4);
  assert.deepEqual(ser.map((p) => p.minutes), [0, 90, 30, 30]);
});

test('Pausen und Serien', () => {
  const sess = withSessions(['2026-11-01', '2026-11-05', '2026-11-08']).sessions;
  assert.equal(longestPause(sess, '2026-11-01', '2026-11-08'), 3);
  assert.equal(longestPause(sess, '2026-11-01', T), 13); // seit 8.11. kein Sport
  assert.equal(longestPause(sess, '2026-11-07', '2026-11-08'), 1); // nur der Teil im Zeitraum
  assert.equal(greenStreak(withSessions(['2026-11-10', '2026-11-14', '2026-11-18']).sessions, T), 12);
  assert.equal(greenStreak(withSessions(['2026-11-10']).sessions, T), 0);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2); // Zeitumstellung
});

test('Daten werden bereinigt', () => {
  const s = normalizeState({ sessions: [{ date: '2026-11-01', minutes: '45', type: 'quatsch' }, { date: 'kaputt' }], settings: { askEveryDays: 99 } }, T);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].minutes, 45);
  assert.equal(s.sessions[0].type, 'sonst');
  assert.equal(s.settings.askEveryDays, 7);
  assert.equal(normalizeState(null, T).startedOn, T);
});

test('Export als CSV und Kalender', () => {
  const csv = toCsv(withSessions(['2026-11-20']).sessions);
  assert.match(csv, /2026-11-20;Freitag;Laufen;30;/);
  const ics = buildIcs({ times: ['10:00', '17:00'], everyDays: 2, startDate: T, url: 'https://x.test/sport/' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /RRULE:FREQ=DAILY;INTERVAL=2/);
  assert.match(ics, /DTSTART:20261121T170000/);
});
