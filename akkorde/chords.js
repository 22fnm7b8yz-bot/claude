// Akkord-Logik: Erkennen, Transponieren, Töne und Gitarrengriffe berechnen.
// Reines Modul ohne DOM, damit es auch in Node getestet werden kann.

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Übliche Schreibweise je Grundton (Dur bzw. Moll)
const AUTO_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const AUTO_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

const mod12 = (n) => ((n % 12) + 12) % 12;

// Erlaubte Zeichen hinter dem Grundton, damit normale Wörter nicht als Akkord gelten
const SUFFIX_RE = /^(?:maj|min|dim|aug|sus|add|mmaj|m|M|j|Δ|ø|°|o|\+|-|b|#|♭|♯|\d|\(|\)|,)*$/;

/** Liest einen Ton am Anfang von `s`. German: "B" = B♭, "H" = H/B. */
function readNote(s, german) {
  const m = /^([A-H])/.exec(s);
  if (!m) return null;
  const letter = m[1];
  let pc = LETTER[letter];
  let rest = s.slice(1);
  let flat = false;
  if (letter === 'B' && german) {
    pc = 10;
    flat = true;
    if (rest[0] === 'b' || rest[0] === '♭') rest = rest.slice(1); // "Bb" ist auch im Deutschen B
  }
  if (rest.startsWith('is')) { pc += 1; rest = rest.slice(2); }
  else if (rest.startsWith('es')) { pc -= 1; flat = true; rest = rest.slice(2); }
  else if ((letter === 'A' || letter === 'E') && rest.startsWith('s') && !rest.startsWith('sus')) {
    pc -= 1; flat = true; rest = rest.slice(1);
  } else if (rest[0] === '#' || rest[0] === '♯') { pc += 1; rest = rest.slice(1); }
  else if ((rest[0] === 'b' || rest[0] === '♭') && !(letter === 'B' && german)) {
    pc -= 1; flat = true; rest = rest.slice(1);
  }
  return { pc: mod12(pc), flat, rest };
}

/**
 * Zerlegt einen Akkordnamen wie "F#m7/C#" in Grundton, Zusatz und Basston.
 * Gibt null zurück, wenn es kein Akkord ist.
 */
export function parseChord(text, { german = true } = {}) {
  const root = readNote(text, german);
  if (!root) return null;
  let suffix = root.rest;
  let bass = null;
  const slash = suffix.lastIndexOf('/');
  if (slash >= 0) {
    const b = readNote(suffix.slice(slash + 1), german);
    if (!b || b.rest !== '') return null;
    bass = b.pc;
    suffix = suffix.slice(0, slash);
  }
  if (!SUFFIX_RE.test(suffix)) return null;
  return { root: root.pc, flat: root.flat, suffix, bass };
}

/** Vereinheitlicht die Schreibweise des Zusatzes ("Δ" → "maj7", "-7" → "m7", …). */
export function normalizeSuffix(suffix) {
  let s = suffix.replace(/[()]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/,/g, '');
  s = s.replace(/^Δ7?/, 'maj7').replace(/^j7?/, 'maj7').replace(/^M7/, 'maj7').replace(/^M(?=\d|$)/, 'maj7');
  s = s.replace(/^-/, 'm').replace(/^min/, 'm').replace(/^ø7?/, 'm7b5').replace(/^°7/, 'dim7')
    .replace(/^°/, 'dim').replace(/^o7/, 'dim7').replace(/^o$/, 'dim');
  s = s.replace(/^\+/, 'aug').replace(/^mmaj/, 'mmaj');
  if (s === 'sus') s = 'sus4';
  if (s === '7sus') s = '7sus4';
  if (s === 'add2') s = 'add9';
  if (s === 'm7-5') s = 'm7b5';
  return s;
}

// Intervalle in Halbtönen über dem Grundton
const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  5: [0, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  aug7: [0, 4, 8, 10],
  '7#5': [0, 4, 8, 10],
  '7b5': [0, 4, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  69: [0, 4, 7, 9, 14],
  '6/9': [0, 4, 7, 9, 14],
  11: [0, 4, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  13: [0, 4, 7, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
};

const INTERVAL_NAMES = { 0: '1', 2: '2', 3: 'b3', 4: '3', 5: '4', 6: 'b5', 7: '5', 8: '#5', 9: '6', 10: 'b7', 11: '7', 13: 'b9', 14: '9', 15: '#9', 17: '11', 21: '13' };

/** Intervalle des Akkords; `known` ist false, wenn der Zusatz nur geschätzt wurde. */
export function chordIntervals(suffix) {
  const s = normalizeSuffix(suffix);
  if (QUALITIES[s]) return { intervals: QUALITIES[s], known: true, quality: s };
  const minor = /^m(?!aj)/.test(s);
  const base = minor ? [0, 3, 7] : [0, 4, 7];
  if (/maj7|maj9/.test(s)) base.push(11);
  else if (/7|9|11|13/.test(s)) base.push(10);
  return { intervals: base, known: false, quality: minor ? 'm' : '' };
}

export const intervalName = (iv) => INTERVAL_NAMES[iv] ?? String(iv);

/** Tonname für eine Tonklasse. spelling: 'auto' | 'sharp' | 'flat'. */
export function noteName(pc, { spelling = 'auto', german = true, minor = false, preferFlat } = {}) {
  pc = mod12(pc);
  let name;
  if (preferFlat === true) name = FLAT[pc];
  else if (preferFlat === false) name = SHARP[pc];
  else if (spelling === 'sharp') name = SHARP[pc];
  else if (spelling === 'flat') name = FLAT[pc];
  else name = (minor ? AUTO_MINOR : AUTO_MAJOR)[pc];
  if (german) {
    if (name === 'B') return 'H';
    if (name === 'Bb') return 'B';
  }
  return name;
}

/** Vorzeichen-Vorliebe aus der Tonart des Akkords: true = ♭, false = ♯, undefined = egal. */
function keyPrefersFlat(rootName, root, minor, opts) {
  if (opts.spelling === 'sharp') return false;
  if (opts.spelling === 'flat') return true;
  if (/b$/.test(rootName) || (opts.german !== false && rootName === 'B')) return true;
  if (rootName.includes('#')) return false;
  const key = minor ? mod12(root + 3) : root;
  if ([5, 10, 3, 8, 1].includes(key)) return true;
  if ([7, 2, 9, 4, 11, 6].includes(key)) return false;
  return undefined;
}

const isMinorSuffix = (suffix) => /^m(?!aj)/.test(normalizeSuffix(suffix)) || /^(dim|m7b5)/.test(normalizeSuffix(suffix));

/** Schreibt einen geparsten Akkord wieder als Text. */
export function formatChord(chord, opts = {}) {
  const minor = isMinorSuffix(chord.suffix);
  const rootName = noteName(chord.root, { ...opts, minor });
  let out = rootName + chord.suffix;
  if (chord.bass != null) {
    out += '/' + noteName(chord.bass, { ...opts, preferFlat: keyPrefersFlat(rootName, chord.root, minor, opts) });
  }
  return out;
}

/** Transponiert einen Akkord um `steps` Halbtöne. Gibt null zurück, wenn kein Akkord. */
export function transposeChord(text, steps, opts = {}) {
  const c = parseChord(text, opts);
  if (!c) return null;
  return formatChord({ ...c, root: mod12(c.root + steps), bass: c.bass == null ? null : mod12(c.bass + steps) }, opts);
}

// Akkordwörter in einer Zeile finden; "(Am)" oder "Am," werden auch erkannt
function chordCore(token, opts) {
  const m = /^([(\[]?)(.*?)([)\],.:;]*)$/.exec(token);
  if (m && parseChord(m[2], opts)) return { pre: m[1], core: m[2], post: m[3] };
  if (parseChord(token, opts)) return { pre: '', core: token, post: '' };
  return null;
}

/** Ist das eine Akkordzeile? (mindestens die Hälfte der Wörter sind Akkorde) */
export function isChordLine(line, opts = {}) {
  const tokens = line.split(/[\s|]+/).filter(Boolean);
  if (!tokens.length) return false;
  const chords = tokens.filter((t) => chordCore(t, opts)).length;
  return chords > 0 && chords * 2 >= tokens.length;
}

/**
 * Transponiert alle Akkorde in einem Text. Liedtextzeilen bleiben unverändert,
 * und die Abstände werden so angepasst, dass Akkorde über dem Text an ihrer Stelle bleiben.
 */
export function transposeText(text, steps, opts = {}) {
  return text.split('\n').map((line) => {
    if (!isChordLine(line, opts)) return line;
    const parts = line.match(/[^\s|]+|[\s|]+/g) || [];
    let debt = 0; // >0: Zeile ist zu lang geworden, <0: zu kurz
    let out = '';
    parts.forEach((part, i) => {
      if (/^[\s|]+$/.test(part)) {
        const isLast = i === parts.length - 1;
        if (isLast || debt === 0) { out += part; return; }
        if (!/^ +$/.test(part)) {
          // Trennstriche: Leerzeichen davor/dahinter anpassen
          const lead = part.match(/^ */)[0].length;
          const keep = part.slice(lead);
          if (debt > 0) {
            const remove = Math.min(debt, Math.max(0, lead - 1));
            debt -= remove;
            out += ' '.repeat(lead - remove) + keep;
          } else {
            out += ' '.repeat(lead - debt) + keep;
            debt = 0;
          }
          return;
        }
        if (debt > 0) {
          const remove = Math.min(debt, part.length - 1);
          debt -= remove;
          out += ' '.repeat(part.length - remove);
        } else {
          out += ' '.repeat(part.length - debt);
          debt = 0;
        }
        return;
      }
      const c = chordCore(part, opts);
      if (!c) { out += part; return; }
      const t = c.pre + transposeChord(c.core, steps, opts) + c.post;
      debt += t.length - part.length;
      out += t;
    });
    return out;
  }).join('\n');
}

/** Alle Akkorde eines Texts in der Reihenfolge ihres ersten Auftretens (ohne Doppelte). */
export function extractChords(text, opts = {}) {
  const seen = new Set();
  const list = [];
  for (const line of text.split('\n')) {
    if (!isChordLine(line, opts)) continue;
    for (const token of line.split(/[\s|]+/)) {
      const c = token && chordCore(token, opts);
      if (c && !seen.has(c.core)) {
        seen.add(c.core);
        list.push(c.core);
      }
    }
  }
  return list;
}

/** Töne eines Akkords mit Namen und Intervallen. */
export function chordNotes(text, opts = {}) {
  const c = parseChord(text, opts);
  if (!c) return null;
  const { intervals, known, quality } = chordIntervals(c.suffix);
  const minor = isMinorSuffix(c.suffix);
  const rootName = noteName(c.root, { ...opts, minor });
  const preferFlat = keyPrefersFlat(rootName, c.root, minor, opts);
  const notes = intervals.map((iv) => ({
    pc: mod12(c.root + iv),
    interval: iv,
    name: iv === 0 ? rootName : noteName(c.root + iv, { ...opts, preferFlat }),
    label: intervalName(iv),
  }));
  const bass = c.bass == null ? null : { pc: c.bass, name: noteName(c.bass, { ...opts, preferFlat }) };
  return { ...c, notes, bass, known, quality };
}

// ---------- Gitarre ----------

// Standardstimmung E A D G H E (tiefste Saite zuerst), MIDI-Nummern
export const GUITAR_TUNING = [40, 45, 50, 55, 59, 64];

const X = null;
// Bekannte offene Griffe, Schlüssel = Tonklasse + Akkordart
const OPEN = {
  '0:': [X, 3, 2, 0, 1, 0], // C
  '0:7': [X, 3, 2, 3, 1, 0],
  '0:maj7': [X, 3, 2, 0, 0, 0],
  '0:add9': [X, 3, 2, 0, 3, 0],
  '2:': [X, X, 0, 2, 3, 2], // D
  '2:m': [X, X, 0, 2, 3, 1],
  '2:7': [X, X, 0, 2, 1, 2],
  '2:m7': [X, X, 0, 2, 1, 1],
  '2:maj7': [X, X, 0, 2, 2, 2],
  '2:sus2': [X, X, 0, 2, 3, 0],
  '2:sus4': [X, X, 0, 2, 3, 3],
  '5:maj7': [X, X, 3, 2, 1, 0], // F
  '7:': [3, 2, 0, 0, 0, 3], // G
  '7:7': [3, 2, 0, 0, 0, 1],
  '7:maj7': [3, 2, 0, 0, 0, 2],
  '11:7': [X, 2, 1, 2, 0, 2], // H7
};

// Verschiebbare Griffe relativ zum Grundton auf der E-Saite (E-Form) bzw. A-Saite (A-Form)
const E_FORM = {
  '': [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  7: [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, X, 1, 1, 0, X],
  sus4: [0, 2, 2, 2, 0, 0],
  '7sus4': [0, 2, 0, 2, 0, 0],
  5: [0, 2, 2, X, X, X],
  m6: [0, 2, 2, 0, 2, 0],
  dim7: [0, X, -1, 0, -1, X],
  m7b5: [0, X, 0, 0, -1, X],
  9: [0, 2, 0, 1, 0, 2],
};
const A_FORM = {
  '': [X, 0, 2, 2, 2, 0],
  m: [X, 0, 2, 2, 1, 0],
  7: [X, 0, 2, 0, 2, 0],
  m7: [X, 0, 2, 0, 1, 0],
  maj7: [X, 0, 2, 1, 2, 0],
  sus2: [X, 0, 2, 2, 0, 0],
  sus4: [X, 0, 2, 2, 3, 0],
  '7sus4': [X, 0, 2, 0, 3, 0],
  5: [X, 0, 2, 2, X, X],
  6: [X, 0, 2, 2, 2, 2],
  m6: [X, 0, 2, 2, 1, 2],
  dim: [X, 0, 1, 2, 1, X],
  dim7: [X, 0, 1, 2, 1, 2],
  m7b5: [X, 0, 1, 0, 1, X],
  aug: [X, 0, 3, 2, 2, 1],
  add9: [X, 0, 2, 4, 2, 0],
  9: [X, 0, 2, 4, 2, 3],
  m9: [X, 0, 2, 4, 1, 3],
  mmaj7: [X, 0, 2, 1, 1, 0],
};

// Akkordarten ohne eigenen Griff auf eine verwandte Art abbilden
const FALLBACK = {
  aug7: 'aug', '7#5': 'aug', '7b5': '7', madd9: 'm', maj9: 'maj7', 69: '6', '6/9': '6',
  11: '7sus4', m11: 'm7', 13: '7', '7b9': '7', '7#9': '7', mmaj7: 'm', 6: '', m6: 'm', 9: '7', m9: 'm7', add9: '',
};

function place(shape, rootFret) {
  const frets = shape.map((f) => (f == null ? null : f + rootFret));
  return frets.every((f) => f == null || f >= 0) ? frets : null;
}

function candidates(root, quality) {
  const list = [];
  const open = OPEN[`${root}:${quality}`];
  if (open) list.push({ frets: open, barre: null, form: 'offen' });
  const eFret = mod12(root - 4);
  const aFret = mod12(root - 9);
  for (const [shapes, fret, string, form] of [[E_FORM, eFret, 0, 'E-Form'], [A_FORM, aFret, 1, 'A-Form']]) {
    const shape = shapes[quality];
    if (!shape) continue;
    const frets = place(shape, fret) || place(shape, fret + 12);
    if (!frets) continue;
    const rf = frets[string];
    const atRoot = frets.filter((f) => f === rf).length;
    let barre = null;
    if (rf > 0 && atRoot >= 2) {
      let last = string;
      frets.forEach((f, i) => { if (f === rf) last = i; });
      barre = { fret: rf, from: string, to: last };
    }
    list.push({ frets, barre, form: rf === 0 ? 'offen' : form });
  }
  return list;
}

const shapeCost = (c) => {
  const used = c.frets.filter((f) => f != null && f > 0);
  return (used.length ? Math.max(...used) : 0) + (c.barre ? 1.5 : 0);
};

/** Gitarrengriff für einen Akkord: frets je Saite (null = nicht spielen), Barré, Hinweis. */
export function guitarChord(text, opts = {}) {
  const c = chordNotes(text, opts);
  if (!c) return null;
  let quality = normalizeSuffix(c.suffix);
  if (!QUALITIES[quality]) quality = c.quality;
  let simplified = false;
  let list = candidates(c.root, quality);
  while (!list.length && FALLBACK[quality] != null) {
    quality = FALLBACK[quality];
    simplified = true;
    list = candidates(c.root, quality);
  }
  if (!list.length) return null;
  list.sort((a, b) => shapeCost(a) - shapeCost(b));
  const best = { ...list[0], frets: [...list[0].frets] };
  // Basston (Slash-Akkord): auf der tiefsten passenden Saite ergänzen, sonst nur anzeigen
  let bassPlaced = c.bass == null;
  if (c.bass != null && !best.barre) {
    for (let s = 0; s < 3 && !bassPlaced; s++) {
      const f = [0, 1, 2, 3, 4].find((x) => mod12(GUITAR_TUNING[s] + x - c.bass.pc) === 0);
      if (f == null || !best.frets.some((x, i) => i > s && x != null)) continue;
      best.frets[s] = f;
      for (let i = 0; i < s; i++) best.frets[i] = null;
      bassPlaced = true;
    }
  }
  return { ...best, simplified, bassPlaced };
}
