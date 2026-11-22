import {
  transposeText, extractChords, transposeChord, chordNotes, guitarChord, isChordLine, GUITAR_TUNING, noteName,
} from './chords.js';

const $ = (id) => document.getElementById(id);
const STORE = 'griffbild:v1';

const PRESETS = {
  lied: `[Strophe]
C            G             Am          F
Ich hab die Akkorde einmal aufgeschrieben,
C            G                F     G
heute klingen sie ein Stück zu tief.

[Refrain]
F       G       Em      Am
Plus und Minus, alles rückt mit,
Dm7          G7          Cmaj7
und jeder Griff bleibt, wo er stand.`,
  pop: 'C  G  Am  F',
  blues: '| A7  | D7  | A7  | A7  |\n| D7  | D7  | A7  | A7  |\n| E7  | D7  | A7  | E7  |',
  jazz: '| Dm7  | G7   | Cmaj7 | Cmaj7 |\n| Em7b5 | A7  | Dm7   | G7    |',
};

let lastPairs = [];
const state = { fbChord: '', fbLabels: 'names', fbShape: true, title: '', text: PRESETS.lied, offset: 0, instrument: 'guitar', notation: 'de', spelling: 'auto' };
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE) || '{}'));
} catch { /* ohne Speicher weiter */ }

const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* egal */ }
};
const opts = () => ({ german: state.notation === 'de', spelling: state.spelling });
const mod12 = (n) => ((n % 12) + 12) % 12;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Darstellung ----------

function renderOutput(text) {
  const o = opts();
  const html = text.split('\n').map((line) => {
    if (!isChordLine(line, o)) return esc(line);
    return line.replace(/[^\s|]+/g, (tok) => {
      const core = tok.replace(/^[(\[]/, '').replace(/[)\],.:;]+$/, '');
      return transposeChord(core, 0, o) != null || transposeChord(tok, 0, o) != null
        ? `<span class="ch">${esc(tok)}</span>` : esc(tok);
    });
  }).join('\n');
  $('output').innerHTML = html || '<span style="color:var(--muted)">Hier erscheinen deine Akkorde in der neuen Tonart.</span>';
}

function guitarSvg(g) {
  const used = g.frets.filter((f) => f != null && f > 0);
  const max = used.length ? Math.max(...used) : 0;
  const min = used.length ? Math.min(...used) : 0;
  const start = max <= 4 ? 1 : min;
  const rows = Math.max(4, max - start + 1);
  const x = (s) => 22 + s * 16;
  const y0 = 30;
  const fh = 22;
  const yFret = (f) => y0 + (f - start + 0.5) * fh;
  const parts = [];
  for (let r = 0; r <= rows; r++) {
    parts.push(`<line class="g-line" x1="${x(0)}" x2="${x(5)}" y1="${y0 + r * fh}" y2="${y0 + r * fh}" stroke-width="1"/>`);
  }
  if (start === 1) parts.push(`<line class="g-nut" x1="${x(0) - 1}" x2="${x(5) + 1}" y1="${y0}" y2="${y0}" stroke-width="4" stroke-linecap="round"/>`);
  else parts.push(`<text class="g-label" x="${x(0) - 10}" y="${yFret(start) + 3.5}" text-anchor="end">${start}</text>`);
  for (let s = 0; s < 6; s++) {
    parts.push(`<line class="g-line" x1="${x(s)}" x2="${x(s)}" y1="${y0}" y2="${y0 + rows * fh}" stroke-width="${1.6 - s * 0.15}"/>`);
  }
  if (g.barre) {
    parts.push(`<rect class="g-dot" x="${x(g.barre.from) - 6}" y="${yFret(g.barre.fret) - 6}" width="${x(g.barre.to) - x(g.barre.from) + 12}" height="12" rx="6"/>`);
  }
  g.frets.forEach((f, s) => {
    if (f == null) {
      parts.push(`<path class="g-mark" d="M${x(s) - 4} 12 l8 8 M${x(s) + 4} 12 l-8 8"/>`);
    } else if (f === 0) {
      parts.push(`<circle class="g-mark ${g.rootStrings.includes(s) ? 'g-root-ring' : ''}" cx="${x(s)}" cy="16" r="4.5" ${g.rootStrings.includes(s) ? 'style="stroke:var(--accent)"' : ''}/>`);
    } else if (!(g.barre && f === g.barre.fret && s >= g.barre.from && s <= g.barre.to && !g.rootStrings.includes(s))) {
      parts.push(`<circle class="${g.rootStrings.includes(s) ? 'g-root' : 'g-dot'}" cx="${x(s)}" cy="${yFret(f)}" r="6.5"/>`);
    }
  });
  const h = y0 + rows * fh + 6;
  return `<svg class="diagram guitar" viewBox="0 0 120 ${h}" role="img" aria-label="Griffbild">${parts.join('')}</svg>`;
}

function pianoSvg(info) {
  // Enge Lage ab dem Grundton, Basston (Slash-Akkord) darunter
  const pcs = [...new Set(info.notes.map((n) => n.pc))];
  const positions = [];
  let r = info.root;
  if (info.bass && info.bass.pc !== info.root) {
    positions.push({ pos: info.bass.pc, bass: true });
    r = info.bass.pc + mod12(info.root - info.bass.pc);
  }
  for (const pc of pcs) positions.push({ pos: r + mod12(pc - info.root), root: pc === info.root });
  positions.sort((a, b) => a.pos - b.pos);
  const lo = Math.floor(positions[0].pos / 12) * 12;
  const hi = Math.ceil((positions[positions.length - 1].pos + 1) / 12) * 12;
  const span = Math.max(24, hi - lo);
  const whiteIdx = [0, 2, 4, 5, 7, 9, 11];
  const blackIdx = [1, 3, 6, 8, 10];
  const ww = 14;
  const whites = [];
  const blacks = [];
  const on = new Map(positions.map((p) => [p.pos, p]));
  let wx = 0;
  const keyX = {};
  for (let n = lo; n < lo + span; n++) {
    const pc = mod12(n);
    if (whiteIdx.includes(pc)) { keyX[n] = wx; wx += ww; }
  }
  for (let n = lo; n < lo + span; n++) {
    const pc = mod12(n);
    const hit = on.get(n);
    const cls = hit ? (hit.bass ? 'k-bass' : hit.root ? 'k-on-root' : 'k-on') : null;
    if (whiteIdx.includes(pc)) {
      whites.push(`<rect class="k-white" x="${keyX[n]}" y="0" width="${ww}" height="60" rx="2"/>`);
      if (cls) whites.push(`<circle class="${cls}" cx="${keyX[n] + ww / 2}" cy="48" r="4.5"/>`);
    } else if (blackIdx.includes(pc)) {
      const bx = keyX[n - 1] + ww - 4.5;
      blacks.push(`<rect class="k-black" x="${bx}" y="0" width="9" height="37" rx="1.5"/>`);
      if (cls) blacks.push(`<circle class="${cls}" cx="${bx + 4.5}" cy="29" r="3.6" style="stroke:var(--key-white);stroke-width:1"/>`);
    }
  }
  const p = { midi: positions.map((x) => 48 + x.pos) };
  return { svg: `<svg class="diagram" viewBox="-1 -1 ${wx + 2} 62" role="img" aria-label="Klaviatur">${whites.join('')}${blacks.join('')}</svg>`, midi: p.midi };
}

const PLAY_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';

// ---------- Griffbrett ----------

const FRETS = 15;
const STRING_NAMES = ['E', 'A', 'D', 'G', 'H', 'e'];

function fretboardSvg({ info, shape, labels, o }) {
  const fw = 50; const nutX = 46; const top = 22; const sh = 26;
  const X = (f) => (f === 0 ? 24 : nutX + (f - 0.5) * fw);
  const Y = (s) => top + (5 - s) * sh; // hohe e-Saite oben, wie in Tabulatur
  const width = nutX + FRETS * fw + 12;
  const height = top + 5 * sh + 34;
  const parts = [];
  // Bundmarkierungen
  for (const f of [3, 5, 7, 9, 15]) parts.push(`<circle class="fb-inlay" cx="${X(f)}" cy="${top + 2.5 * sh}" r="5"/>`);
  parts.push(`<circle class="fb-inlay" cx="${X(12)}" cy="${top + 1.5 * sh}" r="5"/><circle class="fb-inlay" cx="${X(12)}" cy="${top + 3.5 * sh}" r="5"/>`);
  for (let f = 1; f <= FRETS; f++) {
    parts.push(`<line class="g-line" x1="${nutX + f * fw}" x2="${nutX + f * fw}" y1="${top}" y2="${top + 5 * sh}" stroke-width="1.2"/>`);
    parts.push(`<text class="g-label" x="${X(f)}" y="${top + 5 * sh + 22}" text-anchor="middle">${f}</text>`);
  }
  parts.push(`<line class="g-nut" x1="${nutX}" x2="${nutX}" y1="${top - 1}" y2="${top + 5 * sh + 1}" stroke-width="5"/>`);
  for (let s = 0; s < 6; s++) {
    parts.push(`<line class="g-line" x1="${nutX}" x2="${width - 12}" y1="${Y(s)}" y2="${Y(s)}" stroke-width="${1 + (5 - s) * 0.3}"/>`);
    parts.push(`<text class="g-label" x="6" y="${Y(s) + 3.5}">${STRING_NAMES[s]}</text>`);
  }
  const chordPcs = new Map((info?.notes || []).map((n) => [n.pc, n]));
  if (info?.bass && !chordPcs.has(info.bass.pc)) chordPcs.set(info.bass.pc, { pc: info.bass.pc, name: info.bass.name, label: 'B', interval: -1 });
  const preferFlat = info ? info.notes.some((n) => /b$/.test(n.name) || (o.german && n.name === 'B')) : undefined;
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= FRETS; f++) {
      const midi = GUITAR_TUNING[s] + f;
      const pc = midi % 12;
      const hit = chordPcs.get(pc);
      if (info && !hit) continue;
      const inShape = shape && shape.frets[s] === f;
      const cls = !info ? 'fb-note' : hit.interval === 0 ? 'fb-root' : hit.interval === -1 ? 'fb-bass' : 'fb-tone';
      const text = labels === 'intervals' && hit ? hit.label : hit ? hit.name : noteName(pc, { ...o, preferFlat });
      parts.push(`<g class="fb-dot ${cls}${inShape ? ' fb-in-shape' : ''}" data-midi="${midi}" tabindex="0" role="button" aria-label="${text}, Saite ${STRING_NAMES[s]}, Bund ${f}">`
        + `<circle cx="${X(f)}" cy="${Y(s)}" r="10.5"/><text x="${X(f)}" y="${Y(s) + 3.5}" text-anchor="middle">${esc(text)}</text></g>`);
    }
  }
  return `<svg class="fretboard" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Griffbrett">${parts.join('')}</svg>`;
}

function renderFretboard(pairs) {
  const o = opts();
  const names = pairs.map((p) => p.to);
  if (state.fbChord && state.fbChord !== '*' && !names.includes(state.fbChord)) state.fbChord = names[0] || '*';
  if (!state.fbChord) state.fbChord = names[0] || '*';
  const sel = state.fbChord;
  $('fb-chords').innerHTML = names.map((n) => `<button type="button" class="chip${n === sel ? ' on' : ''}" data-fb="${esc(n)}">${esc(n)}</button>`).join('')
    + `<button type="button" class="chip${sel === '*' ? ' on' : ''}" data-fb="*">Alle Töne</button>`;
  const info = sel === '*' ? null : chordNotes(sel, o);
  const shape = info && state.fbShape ? guitarChord(sel, o) : null;
  $('fb-board').innerHTML = fretboardSvg({ info, shape, labels: state.fbLabels, o });
  $('fb-labels').hidden = !info;
  $('fb-shape-wrap').hidden = !info;
  document.querySelectorAll('input[name="fb-labels"]').forEach((r) => { r.checked = r.value === state.fbLabels; });
  $('fb-shape').checked = state.fbShape;
  $('fb-sub').textContent = info
    ? `Alle Töne von ${sel} bis zum ${FRETS}. Bund: ${info.notes.map((n) => n.name).join(' ')}${shape ? ' · Umrandet: der Griff von oben' : ''}`
    : `Alle Töne bis zum ${FRETS}. Bund · Tippe auf einen Ton zum Anhören`;
}

function renderCards(pairs) {
  const o = opts();
  const cards = $('cards');
  if (!pairs.length) {
    cards.innerHTML = '<div class="empty">Noch keine Akkorde erkannt. Tippe oben z. B. <b>C G Am F</b> ein oder lade ein Beispiel.</div>';
    $('cards-sub').textContent = '';
    return;
  }
  const items = pairs.map(({ from, to }) => {
    const info = chordNotes(to, o);
    if (!info) return '';
    let diagram = '';
    let midi = [];
    const hints = [];
    if (state.instrument === 'guitar') {
      const g = guitarChord(to, o);
      if (g) {
        g.rootStrings = g.frets.map((f, s) => (f != null && mod12(GUITAR_TUNING[s] + f) === info.root ? s : -1)).filter((s) => s >= 0);
        diagram = guitarSvg(g);
        midi = g.frets.map((f, s) => (f == null ? null : GUITAR_TUNING[s] + f)).filter((m) => m != null);
        if (g.barre) hints.push(`Barré im ${g.barre.fret}. Bund`);
        if (g.simplified) hints.push('vereinfachter Griff');
        if (!g.bassPlaced && info.bass) hints.push(`Bass ${info.bass.name} extra greifen`);
      } else {
        hints.push('Kein Griff hinterlegt');
      }
    } else {
      const p = pianoSvg(info);
      diagram = p.svg;
      midi = p.midi;
    }
    if (!info.known) hints.push('Zusatz nur teilweise erkannt');
    const notes = info.notes.map((n) => `<span class="note${n.interval === 0 ? ' root' : ''}">${esc(n.name)}<small>${n.label}</small></span>`).join('')
      + (info.bass ? `<span class="note">${esc(info.bass.name)}<small>Bass</small></span>` : '');
    return `<article class="card">
      <div class="card-top">
        <div><div class="name">${esc(to)}</div>${state.offset && from !== to ? `<div class="from">aus ${esc(from)}</div>` : ''}</div>
        <button class="play" type="button" data-midi="${midi.join(',')}" aria-label="${esc(to)} anhören" title="Anhören">${PLAY_ICON}</button>
      </div>
      ${diagram}
      <div class="notes">${notes}</div>
      ${hints.length ? `<div class="hint">${hints.join(' · ')}</div>` : ''}
    </article>`;
  });
  cards.innerHTML = items.join('');
  $('cards-sub').textContent = `${pairs.length} ${pairs.length === 1 ? 'Akkord' : 'Akkorde'} · ${state.instrument === 'guitar' ? 'Standardstimmung E A D G H E' : 'enge Lage ab dem Grundton'}`;
}

function render() {
  const o = opts();
  const n = state.offset;
  const out = transposeText(state.text, n, o);
  renderOutput(out);
  const original = extractChords(state.text, o);
  const pairs = [];
  const seen = new Set();
  for (const c of original) {
    const t = transposeChord(c, n, o);
    if (t && !seen.has(t)) { seen.add(t); pairs.push({ from: c, to: t }); }
  }
  lastPairs = pairs;
  renderCards(pairs);
  renderFretboard(pairs);

  $('offset').textContent = n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
  $('offset-unit').textContent = Math.abs(n) === 1 ? 'Halbton' : 'Halbtöne';
  $('reset').disabled = n === 0;
  $('result-badge').textContent = n ? (n > 0 ? `+${n}` : `−${-n}`) : '';
  const m = mod12(n);
  let sub = 'Originaltonart';
  if (n !== 0 && pairs.length) sub = `${pairs[0].from} → ${pairs[0].to}`;
  if (n !== 0 && m === 0) sub = 'gleiche Tonart, eine Oktave versetzt';
  else if (n !== 0 && state.instrument === 'guitar' && m >= 1 && m <= 7) sub += ` · oder Kapo im ${m}. Bund`;
  $('offset-sub').textContent = sub;
  save();
}

// ---------- Ton ----------

// Klang wird vorab als WAV berechnet und über ein <audio>-Element abgespielt.
// Das funktioniert auch dort, wo Web Audio stumm bleibt (z. B. iPhone mit Lautlos-Schalter).
const RATE = 22050;

function synth(midi, guitar) {
  const len = Math.floor(RATE * (guitar ? 2.2 : 2.6));
  const out = new Float32Array(len);
  midi.forEach((m, i) => {
    const f = 440 * 2 ** ((m - 69) / 12);
    const start = Math.floor(i * (guitar ? 0.04 : 0) * RATE);
    if (guitar) {
      // Karplus-Strong: gezupfte Saite
      const n = Math.max(2, Math.round(RATE / f));
      const buf = new Float32Array(n);
      for (let k = 0; k < n; k++) buf[k] = Math.random() * 2 - 1;
      let idx = 0;
      for (let t = start; t < len; t++) {
        const next = (idx + 1) % n;
        const v = buf[idx];
        buf[idx] = 0.996 * 0.5 * (v + buf[next]);
        out[t] += v * 0.5;
        idx = next;
      }
    } else {
      for (let t = start; t < len; t++) {
        const s = (t - start) / RATE;
        const env = Math.min(1, s / 0.01) * Math.exp(-s * 1.6);
        const w = 2 * Math.PI * f * s;
        out[t] += env * (Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w)) * 0.5;
      }
    }
  });
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.85 / peak : 0;
  const fade = Math.floor(RATE * 0.15);
  for (let t = 0; t < len; t++) out[t] *= gain * (t > len - fade ? (len - t) / fade : 1);
  return out;
}

function wavDataUri(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, RATE, true); dv.setUint32(28, RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}

const sounds = new Map();
let player;
let ctx;

function playWebAudio(samples) {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const buf = ctx.createBuffer(1, samples.length, RATE);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

function play(midi) {
  if (!midi.length) return Promise.resolve(false);
  const guitar = state.instrument === 'guitar';
  const key = (guitar ? 'g' : 'p') + midi.join(',');
  let s = sounds.get(key);
  if (!s) {
    const samples = synth(midi, guitar);
    s = { samples, uri: wavDataUri(samples) };
    sounds.set(key, s);
  }
  try {
    if (player) player.pause();
    player = new Audio(s.uri);
    return player.play().then(() => true, () => {
      try { playWebAudio(s.samples); return true; } catch { return false; }
    });
  } catch {
    try { playWebAudio(s.samples); return Promise.resolve(true); } catch { return Promise.resolve(false); }
  }
}

// ---------- Bedienung ----------

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
}

const step = (d) => {
  state.offset = Math.max(-24, Math.min(24, state.offset + d));
  render();
};

$('up').addEventListener('click', () => step(1));
$('down').addEventListener('click', () => step(-1));
$('reset').addEventListener('click', () => { state.offset = 0; render(); });

const input = $('input');
const fit = () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; };
input.value = state.text;
input.addEventListener('input', () => { state.text = input.value; fit(); render(); });
$('clear').addEventListener('click', () => { state.text = ''; input.value = ''; state.offset = 0; render(); input.focus(); });

document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  state.text = PRESETS[b.dataset.preset];
  state.offset = 0;
  input.value = state.text;
  fit();
  render();
}));

$('apply').addEventListener('click', () => {
  if (!state.offset) { toast('Schon in der Originaltonart'); return; }
  state.text = transposeText(state.text, state.offset, opts());
  state.offset = 0;
  input.value = state.text;
  fit();
  render();
  toast('Als neue Eingabe übernommen');
});

$('copy').addEventListener('click', () => {
  const text = transposeText(state.text, state.offset, opts());
  const fallback = () => {
    const r = document.createRange();
    r.selectNodeContents($('output'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    toast('Markiert – jetzt kopieren');
  };
  try {
    navigator.clipboard.writeText(text).then(() => toast('Kopiert'), fallback);
  } catch { fallback(); }
});

$('cards').addEventListener('click', (e) => {
  const b = e.target.closest('.play');
  if (!b) return;
  b.classList.remove('playing');
  void b.offsetWidth;
  b.classList.add('playing');
  play(b.dataset.midi.split(',').filter(Boolean).map(Number)).then((ok) => {
    if (!ok) toast('Ton wird hier blockiert – Lautstärke und Lautlos-Schalter prüfen');
  });
});

for (const name of ['instrument', 'notation', 'spelling']) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
    r.checked = r.value === state[name];
    r.addEventListener('change', () => { state[name] = r.value; render(); });
  });
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('textarea, input:not([type=radio])')) return;
  if (e.key === 'ArrowUp' || e.key === '+') { e.preventDefault(); step(1); }
  if (e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); step(-1); }
});

// ---------- Lied suchen ----------

const songInput = $('song');
songInput.value = state.title || '';
songInput.addEventListener('input', () => { state.title = songInput.value; save(); });

function updateWebLinks() {
  const q = songInput.value.trim();
  $('web-links').hidden = !q;
  $('web-ug').href = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`;
  $('web-google').href = `https://www.google.com/search?q=${encodeURIComponent(`${q} Akkorde chords`)}`;
}
songInput.addEventListener('input', updateWebLinks);
updateWebLinks();

let sampleFn = null;
let searchCtl = null;
const setSearchStatus = (msg, kind = '') => {
  const el = $('search-status');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = !msg;
};

const SEARCH_ERRORS = {
  not_granted: 'Du hast der Seite nicht erlaubt, Claude zu fragen. Nutze die Websuche daneben.',
  sampling_disabled: 'Claude ist für dein Konto hier nicht verfügbar. Nutze die Websuche daneben.',
  rate_limited: 'Gerade zu viele Anfragen. Versuch es in ein paar Minuten noch einmal.',
  session_expired: 'Bitte melde dich bei Claude neu an und versuch es dann noch einmal.',
  invalid_json: 'Die Antwort war unvollständig. Versuch es noch einmal.',
  refused: 'Zu diesem Lied gab es keine Antwort. Probier die Websuche.',
};

async function searchSong(e) {
  e.preventDefault();
  const q = songInput.value.trim();
  if (!q) { songInput.focus(); return; }
  if (!sampleFn) { setSearchStatus('Die automatische Suche geht nur in der claude.ai-Ansicht. Nutze die Websuche.', 'warn'); return; }
  searchCtl?.abort();
  searchCtl = new AbortController();
  const btn = $('search-btn');
  btn.disabled = true;
  setSearchStatus('Claude sucht die Akkorde …', 'busy');
  const prompt = `Gib die Akkordfolge des Lieds "${q}" an.
Regeln:
- Nur Akkorde, KEIN Liedtext (urheberrechtlich geschützt).
- Internationale Schreibweise: B für H, Bb für das deutsche B, Kreuze als #, z. B. F#m, Bb, Ebmaj7, C/E.
- Gliedere nach Teilen (Intro, Strophe, Refrain, Bridge, Outro …) in der Reihenfolge, wie sie im Lied vorkommen; wiederholte Teile nur einmal angeben.
- Pro Teil die Akkorde in Takten: "| C  G  | Am  F  |", höchstens 4 Takte pro Zeile, mehrere Zeilen mit \n getrennt.
- Wenn du das Lied nicht sicher kennst, setze "found" auf false und lass "sections" leer. Erfinde nichts.
Antworte nur mit JSON in dieser Form:
{"found": true, "title": "Titel", "artist": "Interpret", "key": "G", "capo": 0, "sections": [{"name": "Strophe", "chords": "| G  D  | Em  C  |"}], "note": "kurzer Hinweis oder leer"}`;
  try {
    const r = await sampleFn.json(prompt, { signal: searchCtl.signal, cache: { gcTime: 24 * 3600 * 1000 } });
    if (!r || !r.found || !Array.isArray(r.sections) || !r.sections.length) {
      setSearchStatus(`„${q}“ kennt Claude nicht sicher genug. Nutze die Websuche und kopiere die Akkorde ins Feld.`, 'warn');
      return;
    }
    let text = r.sections
      .filter((sec) => sec && sec.chords)
      .map((sec) => `[${String(sec.name || 'Teil')}]\n${String(sec.chords).trim()}`)
      .join('\n\n');
    // Von internationaler Schreibweise in die gewählte umwandeln
    text = transposeText(text, 0, { ...opts(), parseGerman: false });
    const title = [r.title, r.artist].filter(Boolean).join(' – ') || q;
    state.title = title;
    songInput.value = title;
    state.text = text;
    state.offset = 0;
    input.value = text;
    fit();
    render();
    const extra = [r.key && `Tonart ${transposeChord(String(r.key), 0, { ...opts(), parseGerman: false }) || r.key}`, r.capo ? `Kapo ${r.capo}. Bund` : '', r.note].filter(Boolean).join(' · ');
    setSearchStatus(`Eingetragen: ${title}${extra ? ` (${extra})` : ''}. Aus Claudes Wissen, bitte mit dem Original vergleichen.`, 'ok');
  } catch (err) {
    if (err?.code === 'cancelled') return;
    setSearchStatus(SEARCH_ERRORS[err?.code] || 'Die Suche hat nicht geklappt. Versuch es noch einmal oder nutze die Websuche.', 'warn');
    if (err?.code === 'not_granted' || err?.code === 'sampling_disabled') sampleFn = null;
  } finally {
    btn.disabled = false;
  }
}
$('search-form').addEventListener('submit', searchSong);

// ---------- PDF ----------

let downloadsApi = null;
const loadJsPdf = () => new Promise((resolve, reject) => {
  if (window.jspdf) { resolve(window.jspdf.jsPDF); return; }
  const sc = document.createElement('script');
  sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  sc.onload = () => (window.jspdf ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF fehlt')));
  sc.onerror = () => reject(new Error('jsPDF konnte nicht geladen werden'));
  document.head.appendChild(sc);
});

const ACCENT = [223, 84, 16];
const INK = [22, 26, 36];
const MUTED = [110, 118, 135];
// jsPDF-Standardschriften kennen nur Westeuropäisch: Sonderzeichen ersetzen
const pdfSafe = (t) => t.replace(/[♯]/g, '#').replace(/[♭]/g, 'b').replace(/[−–—]/g, '-').replace(/[„“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xff]/g, '?');

function pdfGuitar(doc, g, x, y, rootPc) {
  const used = g.frets.filter((f) => f != null && f > 0);
  const max = used.length ? Math.max(...used) : 0;
  const min = used.length ? Math.min(...used) : 0;
  const start = max <= 4 ? 1 : min;
  const rows = Math.max(4, max - start + 1);
  const sx = 3.4; const fh = 4.4; const top = y + 5;
  const X = (s) => x + 4 + s * sx;
  const Y = (f) => top + (f - start + 0.5) * fh;
  const roots = g.frets.map((f, s) => (f != null && mod12(GUITAR_TUNING[s] + f) === rootPc ? s : -1)).filter((s) => s >= 0);
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.2);
  for (let r = 0; r <= rows; r++) doc.line(X(0), top + r * fh, X(5), top + r * fh);
  for (let s = 0; s < 6; s++) doc.line(X(s), top, X(s), top + rows * fh);
  if (start === 1) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(X(0), top, X(5), top); }
  else { doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(String(start), X(0) - 1.6, Y(start) + 1, { align: 'right' }); }
  if (g.barre) { doc.setFillColor(...INK); doc.roundedRect(X(g.barre.from) - 1.3, Y(g.barre.fret) - 1.3, X(g.barre.to) - X(g.barre.from) + 2.6, 2.6, 1.3, 1.3, 'F'); }
  doc.setLineWidth(0.3);
  g.frets.forEach((f, s) => {
    const isRoot = roots.includes(s);
    if (f == null) { doc.setDrawColor(...MUTED); doc.line(X(s) - 0.9, y + 1.6, X(s) + 0.9, y + 3.4); doc.line(X(s) + 0.9, y + 1.6, X(s) - 0.9, y + 3.4); }
    else if (f === 0) { doc.setDrawColor(...(isRoot ? ACCENT : MUTED)); doc.circle(X(s), y + 2.5, 1, 'S'); }
    else if (!(g.barre && f === g.barre.fret && s >= g.barre.from && s <= g.barre.to && !isRoot)) {
      doc.setFillColor(...(isRoot ? ACCENT : INK)); doc.circle(X(s), Y(f), 1.35, 'F');
    }
  });
  return top + rows * fh;
}

function pdfPiano(doc, info, x, y, w) {
  const pcs = [...new Set(info.notes.map((n) => n.pc))];
  const whiteIdx = [0, 2, 4, 5, 7, 9, 11];
  const ww = w / 14; const h = 13;
  const on = new Map();
  let r = info.root;
  if (info.bass && info.bass.pc !== info.root) { on.set(info.bass.pc, 'bass'); r = info.bass.pc + mod12(info.root - info.bass.pc); }
  for (const pc of pcs) on.set(r + mod12(pc - info.root), pc === info.root ? 'root' : 'on');
  const lo = Math.floor(Math.min(...on.keys()) / 12) * 12;
  const keyX = {}; let wx = 0;
  for (let n = lo; n < lo + 24; n++) if (whiteIdx.includes(mod12(n))) { keyX[n] = x + wx; wx += ww; }
  doc.setDrawColor(...MUTED); doc.setLineWidth(0.15);
  const mark = (kind, cx, cy, rad) => {
    doc.setFillColor(...(kind === 'root' ? ACCENT : kind === 'bass' ? MUTED : INK));
    doc.circle(cx, cy, rad, 'F');
  };
  for (let n = lo; n < lo + 24; n++) if (keyX[n] != null) { doc.setFillColor(255, 255, 255); doc.rect(keyX[n], y, ww, h, 'FD'); if (on.has(n)) mark(on.get(n), keyX[n] + ww / 2, y + h - 2.2, 0.9); }
  for (let n = lo; n < lo + 24; n++) if (keyX[n] == null) {
    const bx = keyX[n - 1] + ww * 0.68; doc.setFillColor(...INK); doc.rect(bx, y, ww * 0.64, h * 0.6, 'F');
    if (on.has(n)) { doc.setFillColor(255, 255, 255); doc.circle(bx + ww * 0.32, y + h * 0.6 - 1.6, 1, 'F'); mark(on.get(n), bx + ww * 0.32, y + h * 0.6 - 1.6, 0.75); }
  }
  return y + h;
}

async function makePdf() {
  const jsPDF = await loadJsPdf();
  const o = opts();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210; const M = 15; const H = 297;
  let y = M + 4;
  const title = pdfSafe(state.title.trim() || 'Akkorde');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(title, W - 2 * M), M, y);
  y += 8;
  const n = state.offset;
  const keyInfo = n === 0 ? 'Originaltonart' : `Transponiert um ${n > 0 ? '+' : '-'}${Math.abs(n)} ${Math.abs(n) === 1 ? 'Halbton' : 'Halbtöne'}${lastPairs[0] ? ` (${lastPairs[0].from} -> ${lastPairs[0].to})` : ''}`;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text(pdfSafe(keyInfo), M, y);
  y += 4;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(0.6); doc.line(M, y, M + 24, y);
  y += 7;

  const lines = transposeText(state.text, n, o).split('\n');
  const longest = Math.max(20, ...lines.map((l) => l.length));
  const size = Math.min(11, (W - 2 * M) / (longest * 0.6 * 0.3528));
  const lh = size * 0.3528 * 1.45;
  for (const line of lines) {
    if (y > H - M) { doc.addPage(); y = M + 4; }
    const chordLine = isChordLine(line, o);
    doc.setFont('courier', chordLine ? 'bold' : 'normal'); doc.setFontSize(size);
    doc.setTextColor(...(chordLine ? ACCENT : INK));
    doc.text(pdfSafe(line), M, y);
    y += lh;
  }

  if (lastPairs.length) {
    const cols = 6; const cw = (W - 2 * M) / cols; const ch = state.instrument === 'guitar' ? 48 : 34;
    y += 6;
    if (y + 8 + ch > H - M) { doc.addPage(); y = M + 4; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(state.instrument === 'guitar' ? 'Griffbilder (Gitarre)' : 'Griffbilder (Klavier)', M, y);
    y += 6;
    lastPairs.forEach((pair, i) => {
      const col = i % cols;
      if (col === 0 && i > 0) y += ch;
      if (col === 0 && y + ch > H - M) { doc.addPage(); y = M + 4; }
      const x = M + col * cw;
      const info = chordNotes(pair.to, o);
      if (!info) return;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
      doc.text(pdfSafe(pair.to), x + 2, y + 4);
      let bottom = y + 6;
      if (state.instrument === 'guitar') {
        const g = guitarChord(pair.to, o);
        if (g) bottom = pdfGuitar(doc, g, x, y + 6, info.root);
      } else {
        bottom = pdfPiano(doc, info, x + 2, y + 7, cw - 5);
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      const noteLine = info.notes.map((nn) => nn.name).join(' ') + (info.bass ? ` / ${info.bass.name}` : '');
      doc.text(pdfSafe(noteLine), x + 2, bottom + 4);
    });
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Griffbild · Seite ${p}/${pages}`, W - M, H - 8, { align: 'right' });
  }
  return doc.output('blob');
}

const pdfName = () => {
  const base = (state.title.trim() || 'Akkorde').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Akkorde';
  const n = state.offset;
  return `${base}${n ? ` (${n > 0 ? '+' : '-'}${Math.abs(n)})` : ''}.pdf`;
};

$('pdf').addEventListener('click', async () => {
  const btn = $('pdf');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'PDF wird erstellt …';
  try {
    const blob = await makePdf();
    if (downloadsApi) {
      try {
        await downloadsApi.save({ filename: pdfName(), data: blob });
        toast('PDF gespeichert');
      } catch (err) {
        if (err?.code === 'declined') return;
        if (err?.code === 'rate_limited') { toast('Es ist schon ein Speichern-Dialog offen'); return; }
        toast('Speichern ist in dieser Ansicht nicht möglich');
      }
    } else if (window.claude) {
      toast('Speichern ist in dieser Ansicht nicht möglich');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = pdfName();
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('PDF heruntergeladen');
    }
  } catch {
    toast('PDF konnte nicht erstellt werden. Bitte Internetverbindung prüfen.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// Fähigkeiten der claude.ai-Ansicht (fehlen außerhalb: dann Websuche und normaler Download)
if (window.claude?.use) {
  window.claude.use('sample').then((s) => { sampleFn = s; $('search-btn').hidden = !s; }).catch(() => {});
  window.claude.use('downloads').then((d) => { downloadsApi = d; }).catch(() => {});
} else {
  $('search-btn').hidden = true;
}

$('fb-chords').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fb]');
  if (!b) return;
  state.fbChord = b.dataset.fb;
  render();
});
document.querySelectorAll('input[name="fb-labels"]').forEach((r) => r.addEventListener('change', () => { state.fbLabels = r.value; render(); }));
$('fb-shape').addEventListener('change', () => { state.fbShape = $('fb-shape').checked; render(); });
const playDot = (e) => {
  const d = e.target.closest('.fb-dot');
  if (!d) return;
  d.classList.remove('playing');
  void d.getBoundingClientRect();
  d.classList.add('playing');
  const prev = state.instrument;
  state.instrument = 'guitar';
  play([Number(d.dataset.midi)]);
  state.instrument = prev;
};
$('fb-board').addEventListener('click', playDot);
$('fb-board').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playDot(e); } });
// Klick auf einen Akkordnamen in den Griffbildern zeigt ihn auf dem Griffbrett
$('cards').addEventListener('click', (e) => {
  const n = e.target.closest('.name');
  if (!n) return;
  state.fbChord = n.textContent;
  render();
  $('fretboard-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});

render();
fit();
window.addEventListener('resize', fit);
