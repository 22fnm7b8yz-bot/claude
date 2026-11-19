import {
  transposeText, extractChords, transposeChord, chordNotes, guitarChord, isChordLine, GUITAR_TUNING,
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

const state = { text: PRESETS.lied, offset: 0, instrument: 'guitar', notation: 'de', spelling: 'auto' };
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
  renderCards(pairs);

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

let audio;
function play(midi) {
  if (!midi.length) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.02;
    const master = audio.createGain();
    master.gain.value = 0.5 / Math.sqrt(midi.length);
    master.connect(audio.destination);
    const strum = state.instrument === 'guitar' ? 0.035 : 0;
    midi.forEach((m, i) => {
      const t = t0 + i * strum;
      const f = 440 * 2 ** ((m - 69) / 12);
      const g = audio.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + (state.instrument === 'guitar' ? 1.8 : 2.4));
      g.connect(master);
      for (const [type, mult, vol] of [['triangle', 1, 0.8], ['sine', 2, 0.25]]) {
        const osc = audio.createOscillator();
        const v = audio.createGain();
        osc.type = type;
        osc.frequency.value = f * mult;
        v.gain.value = vol;
        osc.connect(v).connect(g);
        osc.start(t);
        osc.stop(t + 2.5);
      }
    });
  } catch { /* kein Ton verfügbar */ }
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
  if (b) play(b.dataset.midi.split(',').filter(Boolean).map(Number));
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

render();
fit();
window.addEventListener('resize', fit);
